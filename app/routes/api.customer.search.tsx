import type { LoaderFunctionArgs } from "@remix-run/node";

import { CUSTOMER_SEARCH_QUERY } from "~/graphql/customer";
import { gql, runRouteOp } from "~/lib/admin.server";
import { tagsToBadges } from "~/lib/badges";
import { errorJson, okJson } from "~/lib/json.server";
import { authenticatePos } from "~/lib/pos-auth.server";

// Architect §5.3:
//   GET /api/customer/search?q=<text>&limit=20  (POS auth)
// Returns [{ id, displayName, phone, email, tags, badges }]
//
// Search syntax: Shopify customers query supports name/email/phone tokens with
// wildcard suffixes. We combine them so a single staff query "alice" matches
// name, email username, or partial phone.

type SearchHit = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  badges: string[];
};

function buildQueryString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Strip control chars and Shopify-special characters so callers cannot break
  // out of the query (defense in depth — admin auth is the primary guard).
  const safe = trimmed.replace(/["()\\:]/g, " ").replace(/\s+/g, " ");
  if (/^\+?\d[\d\s-]+$/.test(safe)) {
    // Looks like a phone number — query the phone index directly.
    const digits = safe.replace(/\D/g, "");
    return `phone:*${digits}*`;
  }
  if (safe.includes("@")) {
    return `email:*${safe}*`;
  }
  return `${safe}*`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticatePos(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 50);

  const queryString = buildQueryString(q);
  if (!queryString) {
    return errorJson("BAD_REQUEST", "Missing or empty q parameter.");
  }

  const result = await runRouteOp(async () => {
    const data = await gql<{
      customers: {
        edges: Array<{
          node: {
            id: string;
            displayName: string;
            defaultEmailAddress: { emailAddress: string | null } | null;
            defaultPhoneNumber: { phoneNumber: string | null } | null;
            tags: string[];
          };
        }>;
      };
    }>(admin, CUSTOMER_SEARCH_QUERY, { query: queryString, first: limit });

    const hits: SearchHit[] = data.customers.edges.map(({ node }) => ({
      id: node.id,
      displayName: node.displayName,
      email: node.defaultEmailAddress?.emailAddress ?? null,
      phone: node.defaultPhoneNumber?.phoneNumber ?? null,
      tags: node.tags,
      badges: tagsToBadges(node.tags),
    }));

    // Extension expects `data` to be the array directly (ClientelingSearchResult[]).
    // Wrapping it in { q, count, results } caused results.map(...) to throw and
    // freeze the spinner in the search modal.
    return okJson(hits);
  });

  return result;
}
