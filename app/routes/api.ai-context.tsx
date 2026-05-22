import type { ActionFunctionArgs } from "@remix-run/node";

import { CUSTOMER_CLIENTELING_QUERY } from "~/graphql/customer";
import { gql } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { errorJson, okJson } from "~/lib/json.server";
import { authenticatePos } from "~/lib/pos-auth.server";

type Body = { customerId?: string };

type ResponseData = {
  customer: null | {
    displayName: string;
    tags: string[];
    sizing: { value: string | null } | null;
    contact: { value: string | null } | null;
    lastVisit: { value: string | null } | null;
  };
};

function gid(id?: string): string | null {
  if (!id) return null;
  return id.startsWith("gid://") ? id : `gid://shopify/Customer/${id}`;
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = (await authenticatePos(request)) as { admin: unknown };
  const body = (await request.json().catch(() => ({}))) as Body;
  const customerId = gid(body.customerId);
  if (!customerId) return errorJson("BAD_REQUEST", "customerId is required.");

  const data = await gql<ResponseData>(admin, CUSTOMER_CLIENTELING_QUERY, {
    id: customerId,
    cnamespace: ELKA.customerMetafieldNamespace,
    sizingKey: ELKA.customerMetafieldKeys.sizing,
    notesKey: ELKA.customerMetafieldKeys.notes,
    lastStaffKey: ELKA.customerMetafieldKeys.lastStaffId,
    lastVisitKey: ELKA.customerMetafieldKeys.lastVisitAt,
    contactKey: ELKA.customerMetafieldKeys.preferredContact,
  });
  if (!data.customer) return errorJson("NOT_FOUND", "Customer not found.");
  const tags = data.customer.tags.map((t) => t.toLowerCase());
  const tips = [
    tags.includes("concierge") ? "Concierge: mention free delivery, tailoring, and VIP discount." : null,
    tags.includes("vip") && !tags.includes("concierge") ? "VIP: confirm the configured product discount is active." : null,
    data.customer.sizing?.value ? `Sizing: ${data.customer.sizing.value}` : "Ask for sizing preferences and save a note.",
    data.customer.contact?.value ? `Preferred contact: ${data.customer.contact.value}` : "Confirm preferred follow-up channel.",
  ].filter(Boolean);
  return okJson({ displayName: data.customer.displayName, tips });
}
