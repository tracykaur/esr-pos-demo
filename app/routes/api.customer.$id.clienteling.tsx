import type { LoaderFunctionArgs } from "@remix-run/node";

import { CUSTOMER_CLIENTELING_QUERY } from "~/graphql/customer";
import { gql, runRouteOp } from "~/lib/admin.server";
import {
  homeStoreHandleFromTags,
  interestsFromTags,
  tagsToBadges,
} from "~/lib/badges";
import { ELKA, newDropSegmentName, type InterestCategory } from "~/lib/constants";
import { errorJson, okJson } from "~/lib/json.server";
import { listLocations, listStaff } from "~/lib/lookups.server";
import { authenticatePos } from "~/lib/pos-auth.server";

// Architect §5.3a — full clienteling payload composed from a single GraphQL
// call (customer + tags + metafields + recent orders + notes refs).

type MetaobjectField = { key: string; value: string };
type NoteNode = { id: string; handle: string; fields: MetaobjectField[] };

type CatalogProduct = {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  handle: string;
  collections: {
    edges: Array<{ node: { id: string; title: string; handle: string } }>;
  };
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string;
        inventoryQuantity: number | null;
      };
    }>;
  };
};

type CustomerClientelingResponse = {
  products: {
    edges: Array<{ node: CatalogProduct }>;
  };
  customer: {
    id: string;
    displayName: string;
    defaultEmailAddress: { emailAddress: string | null } | null;
    defaultPhoneNumber: { phoneNumber: string | null } | null;
    tags: string[];
    amountSpent: { amount: string; currencyCode: string } | null;
    numberOfOrders: string | number | null;
    sizing: { value: string | null } | null;
    lastStaff: { value: string | null } | null;
    lastVisit: { value: string | null } | null;
    contact: { value: string | null } | null;
    notes: {
      references: { nodes: NoteNode[] } | null;
    } | null;
    orders: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          processedAt: string;
          totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
        };
      }>;
    };
  } | null;
};

function fieldsToRecord(fields: MetaobjectField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.key] = f.value;
  return out;
}

function parseSizing(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // fall through
  }
  return {};
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function staffFallbackName(id: string): string {
  const tail = id.length > 4 ? id.slice(-4) : id;
  return `Staff ${tail}`;
}

function deriveSegments(tags: string[], homeStoreName: string | null) {
  const segments: Array<{ id: string; name: string }> = [];
  const normalized = tags.map((tag) => tag.toLowerCase());
  const isConcierge = normalized.includes(ELKA.tags.concierge);
  const isVip = normalized.includes(ELKA.tags.vip);
  const isLapsed = normalized.includes(ELKA.tags.lapsed);

  if (isConcierge) {
    segments.push({ id: "tag:concierge", name: ELKA.segmentNames.concierge });
  }
  if (isVip) {
    segments.push({
      id: isLapsed ? "tag:lapsed-vip" : "tag:vip-active",
      name: isLapsed ? ELKA.segmentNames.lapsedVip : ELKA.segmentNames.vipActive,
    });
  }
  if (isLapsed && !isVip) {
    segments.push({ id: "tag:lapsed", name: "Lapsed" });
  }
  if (homeStoreName) {
    segments.push({ id: `home-store:${homeStoreName}`, name: `Home store — ${homeStoreName}` });
  }
  for (const interest of interestsFromTags(tags)) {
    segments.push({
      id: `interest:${interest}`,
      name: newDropSegmentName(interest),
    });
  }

  return segments;
}

function deriveEntitlements(tags: string[]) {
  const entitlements: Array<{
    id: string;
    label: string;
    status: "active" | "attention";
    description: string;
  }> = [];
  const normalized = tags.map((tag) => tag.toLowerCase());
  const isConcierge = normalized.includes(ELKA.tags.concierge);
  const isVip = normalized.includes(ELKA.tags.vip);
  const isLapsed = normalized.includes(ELKA.tags.lapsed);

  if (isConcierge) {
    entitlements.push(
      {
        id: "concierge-free-delivery",
        label: "Free delivery / transfers",
        status: "active",
        description: "Concierge perk: waive eligible delivery or in-store transfer charges.",
      },
      {
        id: "concierge-tailoring",
        label: "Tailoring support",
        status: "active",
        description: "Offer tailoring or alteration support during the appointment.",
      },
      {
        id: "concierge-early-access",
        label: "Early access",
        status: "active",
        description: "Eligible for early access drops and priority appointment handling.",
      },
    );
  }

  if (isVip || isConcierge) {
    entitlements.push({
      id: "vip-promotions",
      label: "VIP promotions",
      status: "active",
      description: "Apply eligible VIP promotions when configured for the cart or checkout.",
    });
  }

  if (isLapsed) {
    entitlements.push({
      id: "lapsed-follow-up",
      label: "Win-back follow-up",
      status: "attention",
      description: "Prioritise a personal check-in before or after checkout.",
    });
  }

  return entitlements;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

function productSearchText(product: CatalogProduct): string {
  return [
    product.title,
    product.productType,
    ...product.tags,
    ...product.collections.edges.flatMap(({ node }) => [node.title, node.handle]),
  ]
    .join(" ")
    .toLowerCase();
}

function inferProductInterest(product: CatalogProduct): InterestCategory {
  const text = productSearchText(product);
  if (/denim|jean/.test(text)) return "denim";
  if (/coat|jacket|outerwear|trench/.test(text)) return "outerwear";
  if (/knit|cardigan|merino/.test(text)) return "knitwear";
  if (/accessor|scarf|belt|bag|jewel/.test(text)) return "accessories";
  return "tailoring";
}

function productCategory(product: CatalogProduct): string {
  const nonGeneric = product.collections.edges.find(
    ({ node }) => !/automated collection/i.test(node.title),
  );
  return nonGeneric?.node.title ?? titleize(inferProductInterest(product));
}

function numericGid(gid: string | undefined): number | undefined {
  if (!gid) return undefined;
  const value = Number(gid.split("/").pop());
  return Number.isFinite(value) ? value : undefined;
}

function productVariantNode(product: CatalogProduct, index = 0) {
  return product.variants.edges[index % Math.max(product.variants.edges.length, 1)]?.node;
}

function productVariant(product: CatalogProduct, index = 0): string {
  const variant = productVariantNode(product, index);
  if (!variant || variant.title === "Default Title") return "Selected size";
  return variant.title;
}

function productVariantId(product: CatalogProduct, index = 0): number | undefined {
  return numericGid(productVariantNode(product, index)?.id);
}

function productPrice(product: CatalogProduct, fallback = "229.00", index = 0): string {
  return productVariantNode(product, index)?.price ?? fallback;
}

function chooseCatalogProducts(tags: string[], catalogProducts: CatalogProduct[]): CatalogProduct[] {
  const brandProducts = catalogProducts.filter(
    (product) => product.vendor === "Early Settler" && product.title !== "Gift Card",
  );
  const interest = (interestsFromTags(tags)[0] ?? "tailoring") as InterestCategory;
  const matching = brandProducts.filter((product) => inferProductInterest(product) === interest);
  const secondary = brandProducts.filter((product) => inferProductInterest(product) !== interest);
  return [...matching, ...secondary].slice(0, 6);
}

function deriveDigitalClienteling(
  tags: string[],
  displayName: string,
  catalogProducts: CatalogProduct[],
) {
  const firstName = displayName.split(/\s+/)[0] || "there";
  const interest = interestsFromTags(tags)[0] ?? "tailoring";
  const interestLabel = titleize(interest);
  const normalized = tags.map((tag) => tag.toLowerCase());
  const isConcierge = normalized.includes(ELKA.tags.concierge);
  const isVip = normalized.includes(ELKA.tags.vip) || isConcierge;
  const products = chooseCatalogProducts(tags, catalogProducts);
  const [hero, second, third, fourth, fifth, sixth] = products;
  const cartItems = [hero, second, third].filter(isDefined);
  const cartTotal = cartItems
    .reduce((sum, product) => sum + Number(productPrice(product, "0")), 0)
    .toFixed(2);

  return {
    browsingHistory: [hero, second, third].filter(isDefined).map((product, index) => ({
      id: `view-${product.handle}`,
      title: product.title,
      category: productCategory(product),
      lastViewedAt: [
        "2026-05-21T08:35:00Z",
        "2026-05-20T19:12:00Z",
        "2026-05-19T11:04:00Z",
      ][index],
      viewCount: index === 0 ? (isConcierge ? 6 : 3) : index === 1 ? 2 : 1,
      size: productVariant(product, index),
      source: index === 2 ? "Email campaign" : "Online store",
      intent: ["High", "Medium", "Low"][index],
    })),
    onlineCart: {
      id: "cart-demo",
      itemCount: cartItems.length,
      total: cartTotal,
      currency: "AUD",
      updatedAt: "2026-05-21T08:42:00Z",
      items: cartItems.map((product, index) => ({
        id: `cart-${product.handle}`,
        title: product.title,
        variant: productVariant(product, index),
        variantId: productVariantId(product, index),
        price: productPrice(product, "229.00", index),
      })),
    },
    recommendations: [fourth, fifth, sixth].filter(isDefined).map((product, index) => ({
      id: `rec-${product.handle}`,
      title: product.title,
      reason:
        index === 0
          ? `Matches ${interestLabel.toLowerCase()} interest and recent browsing`
          : index === 1
            ? "Pairs with viewed pieces and is available in likely size"
            : isVip
              ? "VIP early-access candidate"
              : `High affinity ${productCategory(product).toLowerCase()}`,
      action: index === 0 ? "Show in store" : index === 1 ? "Add to fitting room" : "Send product link",
    })),
    reservations: hero
      ? [
          {
            id: `reserve-${hero.handle}`,
            title: hero.title,
            status: "Ready to try",
            location: "Armadale",
            expiresAt: "2026-05-22T18:00:00Z",
          },
        ]
      : [],
    messageDrafts: [
      {
        id: "draft-reserve",
        label: "Reservation reply",
        channel: "sms",
        body: `Hi ${firstName}, no problem. I've set aside ${hero?.title ?? "the piece"} in ${hero ? productVariant(hero) : "your size"} for you to try. It will be ready at Armadale until tomorrow evening.`,
      },
      {
        id: "draft-new-drop",
        label: "New drop outreach",
        channel: "email",
        body: `Hi ${firstName}, a new ${interestLabel.toLowerCase()} drop has arrived and I noticed it lines up with pieces you've viewed recently. I can pull a few options for you.`,
      },
    ],
    followUps: [
      {
        id: "follow-up-online-cart",
        priority: isConcierge ? "high" : "medium",
        label: "Online cart in progress",
        detail: `Customer has ${cartItems.length} online cart items. Offer to resume cart or reserve pieces.`,
      },
      {
        id: "follow-up-browse-repeat",
        priority: "high",
        label: "Repeated product views",
        detail: `${hero?.title ?? "A catalogue item"} viewed multiple times in the last 24 hours.`,
      },
      {
        id: "follow-up-message",
        priority: isVip ? "high" : "medium",
        label: "Personal message ready",
        detail: "Use the reservation or new-drop draft for fast outreach.",
      },
    ],
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = (await authenticatePos(request)) as {
    admin: unknown;
    session: { shop: string };
  };

  const id = params.id;
  if (!id) {
    return errorJson("BAD_REQUEST", "Missing customer id.");
  }

  const customerGid = id.startsWith("gid://") ? id : `gid://shopify/Customer/${id}`;

  return runRouteOp(async () => {
    const [data, staff, locations] = await Promise.all([
      gql<CustomerClientelingResponse>(admin, CUSTOMER_CLIENTELING_QUERY, {
        id: customerGid,
        cnamespace: ELKA.customerMetafieldNamespace,
        sizingKey: ELKA.customerMetafieldKeys.sizing,
        notesKey: ELKA.customerMetafieldKeys.notes,
        lastStaffKey: ELKA.customerMetafieldKeys.lastStaffId,
        lastVisitKey: ELKA.customerMetafieldKeys.lastVisitAt,
        contactKey: ELKA.customerMetafieldKeys.preferredContact,
      }),
      listStaff(session.shop),
      listLocations(session.shop),
    ]);

    if (!data.customer) {
      return errorJson("NOT_FOUND", "Customer not found.");
    }

    const c = data.customer;
    const homeHandle = homeStoreHandleFromTags(c.tags);
    const homeStore = homeHandle
      ? locations.find((l) => l.handle === homeHandle) ?? null
      : null;
    const lastStaffId = c.lastStaff?.value ?? null;
    const lastStaff = lastStaffId
      ? staff.find((s) => s.id === lastStaffId) ?? null
      : null;

    const notes = (c.notes?.references?.nodes ?? []).map((n) => {
      const f = fieldsToRecord(n.fields);
      return {
        id: n.id,
        handle: n.handle,
        body: f.body ?? "",
        authorId: f.author_id ?? null,
        storeId: f.store_id ?? null,
        createdAt: f.created_at ?? null,
      };
    });

    const recentOrders = c.orders.edges.map(({ node }) => ({
      id: node.id,
      name: node.name,
      total: node.totalPriceSet.shopMoney.amount,
      currency: node.totalPriceSet.shopMoney.currencyCode,
      processedAt: node.processedAt,
      location: "Store or online",
    }));
    const segments = deriveSegments(c.tags, homeStore?.name ?? null);
    const interests = interestsFromTags(c.tags).map((interest) => ({
      tag: `${ELKA.tagPrefixes.interest}${interest}`,
      label: titleize(interest),
    }));

    return okJson({
      id: c.id,
      displayName: c.displayName,
      email: c.defaultEmailAddress?.emailAddress ?? null,
      phone: c.defaultPhoneNumber?.phoneNumber ?? null,
      tags: c.tags,
      badges: tagsToBadges(c.tags),
      homeStore: homeStore
        ? { handle: homeStore.handle, name: homeStore.name, id: homeStore.id }
        : null,
      lastStaff: lastStaff
        ? { id: lastStaff.id, name: lastStaff.name }
        : lastStaffId
          ? { id: lastStaffId, name: staffFallbackName(lastStaffId) }
          : null,
      lastVisitAt: c.lastVisit?.value ?? null,
      preferredContact: c.contact?.value ?? null,
      sizing: parseSizing(c.sizing?.value),
      entitlements: deriveEntitlements(c.tags),
      segments,
      interests,
      amountSpent: c.amountSpent ?? null,
      numberOfOrders:
        typeof c.numberOfOrders === "string"
          ? parseInt(c.numberOfOrders, 10) || 0
          : (c.numberOfOrders ?? 0),
      notes,
      recentOrders,
      digital: deriveDigitalClienteling(
        c.tags,
        c.displayName,
        data.products.edges.map(({ node }) => node),
      ),
    });
  });
}
