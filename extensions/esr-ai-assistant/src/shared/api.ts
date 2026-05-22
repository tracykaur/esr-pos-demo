import { BACKEND_URL } from "./config";

export type AiMode = "CLIENTELING_COACH" | "PROMO_ADVISOR" | "PRODUCT_EXPERT" | "OUTREACH_DRAFT";
export type ProductVariantRecommendation = {
  id: number;
  title: string;
  price?: string;
  available: boolean;
  inventoryQuantity?: number | null;
};

export type ProductRecommendation = {
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
  variants: ProductVariantRecommendation[];
};
export type AiResponse = { content: string; model?: string; productRecommendations?: ProductRecommendation[] };

async function token(): Promise<string> {
  const value = await shopify.session.getSessionToken();
  if (!value) throw new Error("No POS session token available");
  return value;
}

export async function postAi(body: {
  message: string;
  mode: AiMode;
  customerId?: string | null;
  cartItems?: Array<{ title?: string; variantId?: string; quantity?: number }>;
  locationId?: string;
}): Promise<AiResponse> {
  const response = await fetch(`${BACKEND_URL}/api/ai-assistant`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.error?.message || json?.error || `AI request failed (${response.status})`);
  }
  return json?.data ?? json;
}

export function toCustomerGid(id: unknown): string | null {
  if (id == null || String(id).trim() === "") return null;
  const raw = String(id);
  return raw.startsWith("gid://") ? raw : `gid://shopify/Customer/${raw}`;
}

export function currentLocationGid(): string | undefined {
  const id = (shopify.session.currentSession as unknown as { locationId?: string | number })?.locationId;
  return id == null ? undefined : String(id).startsWith("gid://") ? String(id) : `gid://shopify/Location/${id}`;
}
