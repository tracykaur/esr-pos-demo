import type { ActionFunctionArgs } from "@remix-run/node";

import {
  TAGS_ADD_MUTATION,
  TAGS_REMOVE_MUTATION,
} from "~/graphql/customer";
import { gql } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { authenticate } from "~/shopify.server";

// Architect §5.4 — customers/update:
// Re-evaluate `lapsed` tag: if last_order_date > 180d ago AND not present →
// add it; if recent and present → remove it. Skip if tags didn't change since
// last hash (the dedupe in §5.4). We approximate "tags didn't change" by
// short-circuiting when the desired tag state already matches.

type CustomersUpdatePayload = {
  id: number | string;
  admin_graphql_api_id?: string;
  tags?: string | string[];
  last_order_id?: number | null;
  last_order_name?: string | null;
  // The classic webhook surfaces `orders_count` and an embedded `last_order`
  // object on newer payloads. We can't trust the shape so we look this up via
  // a fresh admin query if needed.
};

function tagsArray(t: CustomersUpdatePayload["tags"]): string[] {
  if (!t) return [];
  if (Array.isArray(t)) return t;
  return t.split(",").map((s) => s.trim()).filter(Boolean);
}

const LAPSED_MS = ELKA.lapsedDays * 24 * 60 * 60 * 1000;

const LAST_ORDER_QUERY = /* GraphQL */ `
  query CustomerLastOrder($id: ID!) {
    customer(id: $id) {
      id
      tags
      orders(first: 1, sortKey: PROCESSED_AT, reverse: true) {
        edges {
          node {
            id
            processedAt
          }
        }
      }
    }
  }
`;

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, admin } = await authenticate.webhook(request);
  if (!admin) {
    // Webhook delivered but app is uninstalled — nothing to do.
    return new Response(null, { status: 200 });
  }

  const body = payload as CustomersUpdatePayload;
  const customerGid =
    body.admin_graphql_api_id ?? `gid://shopify/Customer/${body.id}`;
  const currentTags = new Set(tagsArray(body.tags));

  try {
    const data = await gql<{
      customer: {
        id: string;
        tags: string[];
        orders: { edges: Array<{ node: { id: string; processedAt: string } }> };
      } | null;
    }>(admin, LAST_ORDER_QUERY, { id: customerGid });

    if (!data.customer) return new Response(null, { status: 200 });

    // Trust the freshly fetched tags over the webhook payload (it can be stale
    // by the time we process it).
    for (const t of data.customer.tags) currentTags.add(t);

    const lastOrder = data.customer.orders.edges[0]?.node;
    const isLapsedNow = (() => {
      if (!lastOrder) return true; // never ordered → treat as lapsed
      const processed = new Date(lastOrder.processedAt).getTime();
      return Date.now() - processed > LAPSED_MS;
    })();

    const hasLapsedTag = currentTags.has(ELKA.tags.lapsed);

    if (isLapsedNow && !hasLapsedTag) {
      await gql(admin, TAGS_ADD_MUTATION, {
        id: customerGid,
        tags: [ELKA.tags.lapsed],
      });
    } else if (!isLapsedNow && hasLapsedTag) {
      await gql(admin, TAGS_REMOVE_MUTATION, {
        id: customerGid,
        tags: [ELKA.tags.lapsed],
      });
    }
  } catch (err) {
    // Log and ack — Shopify will retry on 5xx, which we want only for true
    // transient failures, not application bugs.
    console.error(`[webhooks/customers/update] ${shop}:`, err);
  }

  return new Response(null, { status: 200 });
}
