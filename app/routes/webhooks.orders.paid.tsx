import type { ActionFunctionArgs } from "@remix-run/node";

import { METAFIELDS_SET_MUTATION, TAGS_REMOVE_MUTATION } from "~/graphql/customer";
import { gql } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { authenticate } from "~/shopify.server";

// Architect §5.4 — orders/paid:
// Belt-and-braces version of orders/create. Stamps last_staff_id (if POS) and
// removes lapsed tag. last_visit_at is set by orders/create; we don't touch
// it here to avoid clobbering a more recent visit stamp written manually via
// /api/customer/:id/visit.

type OrdersPaidPayload = {
  customer?: {
    id?: number | string | null;
    admin_graphql_api_id?: string;
  } | null;
  user_id?: number | string | null;
};

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, admin } = await authenticate.webhook(request);
  if (!admin) return new Response(null, { status: 200 });

  const body = payload as OrdersPaidPayload;
  const customerGid =
    body.customer?.admin_graphql_api_id ??
    (body.customer?.id ? `gid://shopify/Customer/${body.customer.id}` : null);
  if (!customerGid) return new Response(null, { status: 200 });

  const staffId = body.user_id != null ? String(body.user_id) : null;

  try {
    if (staffId) {
      await gql(admin, METAFIELDS_SET_MUTATION, {
        metafields: [
          {
            ownerId: customerGid,
            namespace: ELKA.customerMetafieldNamespace,
            key: ELKA.customerMetafieldKeys.lastStaffId,
            type: "single_line_text_field",
            value: staffId,
          },
        ],
      });
    }
    await gql(admin, TAGS_REMOVE_MUTATION, {
      id: customerGid,
      tags: [ELKA.tags.lapsed],
    }).catch(() => {});
  } catch (err) {
    console.error(`[webhooks/orders/paid] ${shop}:`, err);
  }

  return new Response(null, { status: 200 });
}
