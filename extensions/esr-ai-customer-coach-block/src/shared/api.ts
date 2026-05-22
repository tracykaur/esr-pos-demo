import { BACKEND_URL } from "./config";

async function token(): Promise<string> {
  const value = await shopify.session.getSessionToken();
  if (!value) throw new Error("No POS session token available");
  return value;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.ok === false) throw new Error(json?.error?.message || `Request failed (${response.status})`);
  return json?.data ?? json;
}

export function toCustomerGid(id: unknown): string {
  const raw = String(id ?? "");
  return raw.startsWith("gid://") ? raw : `gid://shopify/Customer/${raw}`;
}
