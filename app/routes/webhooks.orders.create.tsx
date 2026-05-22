import type { ActionFunctionArgs } from "@remix-run/node";

import { METAFIELDS_SET_MUTATION, TAGS_REMOVE_MUTATION } from "~/graphql/customer";
import { gql } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { authenticate } from "~/shopify.server";

// Architect §5.4 — orders/create:
//   1. Stamp last_visit_at on the customer.
//   2. If the order has a staff member (POS), set last_staff_id.
//   3. Remove `lapsed` tag if present.

type OrdersCreatePayload = {
  id: number | string;
  admin_graphql_api_id?: string;
  customer?: {
    id?: number | string | null;
    admin_graphql_api_id?: string;
  } | null;
  user_id?: number | string | null; // staff member numeric id on POS orders
  location_id?: number | string | null;
  source_name?: string;
  processed_at?: string;
};

function customerGidFrom(p: OrdersCreatePayload): string | null {
  if (p.customer?.admin_graphql_api_id) return p.customer.admin_graphql_api_id;
  if (p.customer?.id) return `gid://shopify/Customer/${p.customer.id}`;
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, admin } = await authenticate.webhook(request);
  if (!admin) return new Response(null, { status: 200 });

  const body = payload as OrdersCreatePayload;
  const customerGid = customerGidFrom(body);
  if (!customerGid) return new Response(null, { status: 200 });

  const visitAt =
    (body.processed_at ?? new Date().toISOString()) ??
    new Date().toISOString();
  const staffId = body.user_id != null ? String(body.user_id) : null;

  type MfInput = {
    ownerId: string;
    namespace: string;
    key: string;
    type: string;
    value: string;
  };
  const metafields: MfInput[] = [
    {
      ownerId: customerGid,
      namespace: ELKA.customerMetafieldNamespace,
      key: ELKA.customerMetafieldKeys.lastVisitAt,
      type: "date_time",
      value: visitAt,
    },
  ];
  if (staffId) {
    metafields.push({
      ownerId: customerGid,
      namespace: ELKA.customerMetafieldNamespace,
      key: ELKA.customerMetafieldKeys.lastStaffId,
      type: "single_line_text_field",
      value: staffId,
    });
  }

  try {
    await gql(admin, METAFIELDS_SET_MUTATION, { metafields });
    await gql(admin, TAGS_REMOVE_MUTATION, {
      id: customerGid,
      tags: [ELKA.tags.lapsed],
    }).catch(() => {
      /* tag may not be present — fine */
    });
  } catch (err) {
    console.error(`[webhooks/orders/create] ${shop}:`, err);
  }

  return new Response(null, { status: 200 });
}
