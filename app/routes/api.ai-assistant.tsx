import type { ActionFunctionArgs } from "@remix-run/node";

import { CUSTOMER_CLIENTELING_QUERY } from "~/graphql/customer";
import { gql } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { errorJson, okJson } from "~/lib/json.server";
import { chatCompletion, isLlmConfigured, type ChatMessage } from "~/lib/llm.server";
import { authenticatePos } from "~/lib/pos-auth.server";

type AiMode = "CLIENTELING_COACH" | "PROMO_ADVISOR" | "PRODUCT_EXPERT" | "OUTREACH_DRAFT";

type AiRequest = {
  message?: string;
  mode?: AiMode;
  customerId?: string;
  cartItems?: Array<{ title?: string; variantId?: string; quantity?: number }>;
  locationId?: string;
};

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
  variants: {
    edges: Array<{
      node: { id: string; title: string; price: string; inventoryQuantity: number | null };
    }>;
  };
};

type ProductVariantCard = {
  id: number;
  title: string;
  price?: string;
  available: boolean;
  inventoryQuantity?: number | null;
};

type ProductCard = {
  id: string;
  title: string;
  productType: string;
  price?: string;
  imageUrl?: string;
  altText?: string;
  variantId?: number;
  variantTitle?: string;
  suggestedVariantId?: number;
  suggestedSize?: string;
  variants: ProductVariantCard[];
};

type CustomerResponse = {
  customer: null | {
    id: string;
    displayName: string;
    tags: string[];
    defaultEmailAddress: { emailAddress: string | null } | null;
    defaultPhoneNumber: { phoneNumber: string | null } | null;
    amountSpent: { amount: string; currencyCode: string } | null;
    numberOfOrders: string | number | null;
    sizing: { value: string | null } | null;
    lastVisit: { value: string | null } | null;
    contact: { value: string | null } | null;
    orders: { edges: Array<{ node: { name: string; processedAt: string; totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } } }> };
  };
  products: { edges: Array<{ node: ProductNode }> };
};

const PROMPTS: Record<AiMode, string> = {
  CLIENTELING_COACH: "Give POS staff concise clienteling guidance for this customer. Mention VIP/Concierge perks, sizing, interests, recent visits, and exactly what to say next. Max 5 bullets.",
  PROMO_ADVISOR: "Tell POS staff which Elka VIP/Concierge perks apply. Never invent discounts. If Concierge or VIP, mention the configured VIP product discount and Concierge free delivery only when applicable. Max 4 bullets.",
  PRODUCT_EXPERT: "Recommend real Elka catalogue products from context. Use the exact product titles from the catalogue. Explain why they fit this customer and what to show next. Max 5 bullets.",
  OUTREACH_DRAFT: "Draft a short customer outreach message in the customer's preferred channel. Use real Elka products and perks from context. Return only the message plus one staff note.",
};

function parseSizing(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, val]) => [key.toLowerCase(), String(val)]),
      );
    }
  } catch {
    // ignore malformed metafield values
  }
  return {};
}

function customerGid(id?: string): string | null {
  if (!id) return null;
  return id.startsWith("gid://") ? id : `gid://shopify/Customer/${id}`;
}

function numericGid(gid: string | undefined): number | undefined {
  if (!gid) return undefined;
  const value = Number(gid.split("/").pop());
  return Number.isFinite(value) ? value : undefined;
}

function productSizingKey(product: ProductNode): string | null {
  const text = `${product.title} ${product.productType}`.toLowerCase();
  if (/pant|short|skirt|denim|jean|trouser/.test(text)) return "bottom";
  if (/dress|jumpsuit/.test(text)) return "dress";
  if (/shoe|boot|sandal/.test(text)) return "shoe";
  if (/coat|jacket|blazer|top|shirt|knit|cardigan|tee|tank/.test(text)) return "top";
  return null;
}

function normalizeSize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function variantMatchesSize(variantTitle: string, preferredSize: string): boolean {
  const title = normalizeSize(variantTitle);
  const size = normalizeSize(preferredSize);
  if (!size) return false;
  return title === size || title.includes(size) || title.includes(`size${size}`);
}

function productCard(product: ProductNode, sizing: Record<string, string>): ProductCard {
  const variants = product.variants.edges
    .map(({ node }) => {
      const id = numericGid(node.id);
      if (!id) return null;
      return {
        id,
        title: node.title && node.title !== "Default Title" ? node.title : "Default",
        price: node.price,
        available: node.inventoryQuantity == null || node.inventoryQuantity > 0,
        inventoryQuantity: node.inventoryQuantity,
      };
    })
    .filter((variant): variant is ProductVariantCard => Boolean(variant));

  const preferredSize = productSizingKey(product) ? sizing[productSizingKey(product)!] : undefined;
  const suggested =
    (preferredSize && variants.find((variant) => variant.available && variantMatchesSize(variant.title, preferredSize))) ||
    variants.find((variant) => variant.available) ||
    variants[0];
  const image = product.featuredMedia?.preview?.image;

  return {
    id: product.id,
    title: product.title,
    productType: product.productType,
    price: suggested?.price ?? variants[0]?.price,
    imageUrl: image?.url,
    altText: image?.altText ?? product.title,
    variantId: suggested?.id,
    variantTitle: suggested?.title && suggested.title !== "Default" ? suggested.title : undefined,
    suggestedVariantId: suggested?.id,
    suggestedSize: preferredSize,
    variants,
  };
}

function recommendationCards(
  content: string,
  products: ProductNode[],
  mode: AiMode,
  sizing: Record<string, string>,
): ProductCard[] {
  const normalized = content.toLowerCase();
  const matches = products
    .filter((product) => normalized.includes(product.title.toLowerCase()))
    .map((product) => productCard(product, sizing))
    .filter((card) => card.imageUrl);

  if (matches.length > 0) return matches.slice(0, 4);
  if (mode !== "PRODUCT_EXPERT") return [];

  return products.map((product) => productCard(product, sizing)).filter((card) => card.imageUrl).slice(0, 4);
}

async function buildContext(
  admin: unknown,
  req: AiRequest,
): Promise<{ context: string; products: ProductNode[]; sizing: Record<string, string> }> {
  const lines: string[] = [
    "Brand: Early Settler womenswear.",
    "Current app rules: Concierge is a higher tier than VIP. Customers tagged VIP or Concierge get the VIP product percentage discount. Concierge also gets free delivery when enabled.",
  ];
  let products: ProductNode[] = [];
  let sizing: Record<string, string> = {};

  if (req.cartItems?.length) {
    lines.push("Cart items:");
    for (const item of req.cartItems) lines.push(`- ${item.quantity ?? 1} × ${item.title ?? item.variantId ?? "item"}`);
  }

  const gid = customerGid(req.customerId);
  if (gid) {
    const data = await gql<CustomerResponse>(admin, CUSTOMER_CLIENTELING_QUERY, {
      id: gid,
      cnamespace: ELKA.customerMetafieldNamespace,
      sizingKey: ELKA.customerMetafieldKeys.sizing,
      notesKey: ELKA.customerMetafieldKeys.notes,
      lastStaffKey: ELKA.customerMetafieldKeys.lastStaffId,
      lastVisitKey: ELKA.customerMetafieldKeys.lastVisitAt,
      contactKey: ELKA.customerMetafieldKeys.preferredContact,
    });
    products = data.products.edges.map(({ node }) => node);
    const c = data.customer;
    if (c) {
      sizing = parseSizing(c.sizing?.value);
      lines.push(`Customer: ${c.displayName}`);
      lines.push(`Tags: ${c.tags.join(", ") || "none"}`);
      lines.push(`Contact: ${c.contact?.value ?? c.defaultPhoneNumber?.phoneNumber ?? c.defaultEmailAddress?.emailAddress ?? "unknown"}`);
      lines.push(`Spend/orders: ${c.amountSpent?.currencyCode ?? ""} ${c.amountSpent?.amount ?? "0"}; ${c.numberOfOrders ?? 0} orders`);
      lines.push(`Sizing: ${JSON.stringify(sizing)}`);
      lines.push(`Last visit: ${c.lastVisit?.value ?? "unknown"}`);
      lines.push("Recent orders:");
      for (const { node } of c.orders.edges.slice(0, 3)) lines.push(`- ${node.name} ${node.totalPriceSet.shopMoney.currencyCode} ${node.totalPriceSet.shopMoney.amount} on ${node.processedAt.slice(0, 10)}`);
    }
    lines.push("Relevant Elka catalogue products:");
    for (const node of products.slice(0, 12)) {
      const v = node.variants.edges[0]?.node;
      lines.push(`- ${node.title} (${node.productType}) ${v ? `$${v.price}` : ""}`);
    }
  }

  return { context: lines.join("\n"), products, sizing };
}

function fallback(req: AiRequest): string {
  const cart = req.cartItems?.map((i) => i.title).filter(Boolean).join(", ");
  if (req.mode === "PROMO_ADVISOR") return "• VIP/Concierge product discount applies for tagged customers\n• Concierge customers also qualify for free delivery when enabled\n• Confirm the customer is attached to cart before checkout";
  if (req.mode === "OUTREACH_DRAFT") return "Hi, we have a few new Elka pieces that match your recent interests. I can set aside options in your preferred size if you'd like to pop in.";
  return `• Open with recognition and check sizing\n• Use current cart context${cart ? `: ${cart}` : ""}\n• Suggest one matching Elka catalogue piece\n• Capture a note after the visit`;
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = (await authenticatePos(request)) as { admin: unknown };
  const body = (await request.json().catch(() => ({}))) as AiRequest;
  const mode = body.mode ?? "CLIENTELING_COACH";
  const message = body.message?.trim() || "What should I do next?";

  try {
    const { context, products, sizing } = await buildContext(admin, body);
    if (!isLlmConfigured()) {
      const content = fallback(body);
      return okJson({ content, model: "fallback", productRecommendations: recommendationCards(content, products, mode, sizing) });
    }
    const messages: ChatMessage[] = [
      { role: "system", content: `${PROMPTS[mode]}\nBe factual, concise, and never invent customer data or products.` },
      { role: "user", content: `Context:\n${context}\n\nStaff question: ${message}` },
    ];
    const response = await chatCompletion(messages, { model: mode === "OUTREACH_DRAFT" ? "standard" : "fast", maxTokens: 450 });
    return okJson({ content: response.content, model: response.model, productRecommendations: recommendationCards(response.content, products, mode, sizing) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI failed";
    return errorJson("INTERNAL", msg);
  }
}
