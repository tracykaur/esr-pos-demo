import type { LoaderFunctionArgs } from "@remix-run/node";

import { SEGMENT_MEMBERS_QUERY } from "~/graphql/segments";
import { gql, runRouteOp } from "~/lib/admin.server";
import { errorJson, okJson } from "~/lib/json.server";
import { authenticatePos } from "~/lib/pos-auth.server";

// Architect §5.3:
//   GET /api/segments/:id/members?after=<cursor>  (POS auth)
// Returns { members: [{id, displayName, phone, lastOrderDate?}], pageInfo }.

type SegmentMembersResponse = {
  customerSegmentMembers: {
    edges: Array<{
      cursor: string;
      node: {
        id: string;
        displayName: string;
        defaultEmailAddress: { emailAddress: string | null } | null;
        defaultPhoneNumber: { phoneNumber: string | null } | null;
        amountSpent: { amount: string; currencyCode: string } | null;
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin } = await authenticatePos(request);
  const id = params.id;
  if (!id) return errorJson("BAD_REQUEST", "Missing segment id.");

  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const firstParam = url.searchParams.get("first");
  const first = Math.min(Math.max(parseInt(firstParam ?? "50", 10) || 50, 1), 1000);

  const segmentGid = id.startsWith("gid://") ? id : `gid://shopify/Segment/${id}`;

  return runRouteOp(async () => {
    const data = await gql<SegmentMembersResponse>(admin, SEGMENT_MEMBERS_QUERY, {
      id: segmentGid,
      first,
      after,
    });

    const members = data.customerSegmentMembers.edges.map(({ node, cursor }) => ({
      id: node.id,
      displayName: node.displayName,
      email: node.defaultEmailAddress?.emailAddress ?? null,
      phone: node.defaultPhoneNumber?.phoneNumber ?? null,
      amountSpent: node.amountSpent ?? null,
      cursor,
    }));

    return okJson({
      segmentId: segmentGid,
      members,
      pageInfo: data.customerSegmentMembers.pageInfo,
    });
  });
}
