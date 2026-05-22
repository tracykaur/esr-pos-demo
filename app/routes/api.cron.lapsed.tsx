import type { LoaderFunctionArgs } from "@remix-run/node";

import { CUSTOMER_SEARCH_QUERY, TAGS_ADD_MUTATION } from "~/graphql/customer";
import { gql, runRouteOp } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { errorJson, okJson } from "~/lib/json.server";
import { authenticate } from "~/shopify.server";

// Architect §5.4 — daily cron:
//   "scans for customers with last_order_date < -180d AND no `lapsed` tag,
//    batches customerUpdate to add `lapsed`. Bounded to avoid hammering rate
//    limit."
//
// Auth model: this endpoint requires `?token=` matching CRON_SHARED_SECRET
// (env var). Fly/Vercel/Cron-Workers can hit it from the deployment that
// owns the secret. If CRON_SHARED_SECRET is unset we refuse to run — defense
// in depth so a misconfiguration doesn't expose the loop to the public.
//
// Note: we cap the batch at 200 customers per invocation. A daily cron at
// midnight local-time keeps us well within Admin rate limits for the
// architect's ~40 stores.

const SHARED_SECRET_ENV = "CRON_SHARED_SECRET";
const BATCH_SIZE = 200;

export async function loader({ request }: LoaderFunctionArgs) {
  const secret = process.env[SHARED_SECRET_ENV];
  if (!secret) {
    return errorJson("INTERNAL", `${SHARED_SECRET_ENV} not configured.`);
  }
  const url = new URL(request.url);
  if (url.searchParams.get("token") !== secret) {
    return errorJson("UNAUTHENTICATED", "Invalid cron token.");
  }
  const shopParam = url.searchParams.get("shop");
  if (!shopParam) return errorJson("BAD_REQUEST", "Missing ?shop= parameter.");

  return runRouteOp(async () => {
    const offline = await import("~/shopify.server");
    const { admin } = await offline.unauthenticated.admin(shopParam);

    // Shopify customers query supports an order_date range; we look for
    // customers whose last order is older than the cutoff AND who don't
    // already have the lapsed tag.
    const cutoff = new Date(
      Date.now() - ELKA.lapsedDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const data = await gql<{
      customers: {
        edges: Array<{
          node: {
            id: string;
            displayName: string;
            tags: string[];
          };
        }>;
      };
    }>(admin, CUSTOMER_SEARCH_QUERY, {
      query: `order_date:<${cutoff} AND -tag:${ELKA.tags.lapsed}`,
      first: BATCH_SIZE,
    });

    let tagged = 0;
    for (const edge of data.customers.edges) {
      if (edge.node.tags.includes(ELKA.tags.lapsed)) continue;
      await gql(admin, TAGS_ADD_MUTATION, {
        id: edge.node.id,
        tags: [ELKA.tags.lapsed],
      });
      tagged += 1;
    }

    return okJson({
      shop: shopParam,
      cutoff,
      candidates: data.customers.edges.length,
      tagged,
    });
  });
}
