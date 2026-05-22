import type { ActionFunctionArgs } from "@remix-run/node";

import {
  CUSTOMER_TAGS_QUERY,
  METAFIELDS_SET_MUTATION,
  TAGS_ADD_MUTATION,
  TAGS_REMOVE_MUTATION,
} from "~/graphql/customer";
import { gql, runRouteOp, userErrorsOf } from "~/lib/admin.server";
import { ELKA, homeStoreTagFor } from "~/lib/constants";
import { errorJson, okJson } from "~/lib/json.server";
import { freshLocationById } from "~/lib/locations.server";
import { authenticatePos } from "~/lib/pos-auth.server";

// Architect §5.3:
//   POST /api/customer/:id/visit body { staffId, storeId }
// Writes last_staff_id, last_visit_at = now(). Idempotent within the same
// minute (we round to the nearest minute so back-to-back taps are no-ops).
//
// Also removes the `lapsed` tag if present — visiting a store counts as
// activity for clienteling purposes even without a purchase.

type VisitRequestBody = {
  staffId?: unknown;
  storeId?: unknown;
};

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function nowFloorToMinute(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString();
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return errorJson("BAD_REQUEST", "Method not allowed.", { status: 405 });
  }

  const { admin, session } = (await authenticatePos(request)) as {
    admin: unknown;
    session: { shop: string };
  };
  const id = params.id;
  if (!id) return errorJson("BAD_REQUEST", "Missing customer id.");

  let body: VisitRequestBody;
  try {
    body = (await request.json()) as VisitRequestBody;
  } catch {
    return errorJson("BAD_REQUEST", "Invalid JSON body.");
  }

  if (!nonEmptyString(body.staffId)) {
    return errorJson("VALIDATION_FAILED", "`staffId` is required.");
  }
  if (!nonEmptyString(body.storeId)) {
    return errorJson("VALIDATION_FAILED", "`storeId` is required.");
  }

  const customerGid = id.startsWith("gid://") ? id : `gid://shopify/Customer/${id}`;
  const lastVisitAt = nowFloorToMinute();

  return runRouteOp(async () => {
    const location = await freshLocationById(admin, session.shop, body.storeId as string);
    const homeStoreTag = location ? homeStoreTagFor(location.handle) : null;

    const setResult = await gql<{
      metafieldsSet: {
        metafields: Array<{ id: string; key: string; value: string }> | null;
        userErrors: Array<{ field?: string[]; message: string; code?: string }>;
      };
    }>(admin, METAFIELDS_SET_MUTATION, {
      metafields: [
        {
          ownerId: customerGid,
          namespace: ELKA.customerMetafieldNamespace,
          key: ELKA.customerMetafieldKeys.lastStaffId,
          type: "single_line_text_field",
          value: body.staffId as string,
        },
        {
          ownerId: customerGid,
          namespace: ELKA.customerMetafieldNamespace,
          key: ELKA.customerMetafieldKeys.lastVisitAt,
          type: "date_time",
          value: lastVisitAt,
        },
      ],
    });

    const setErrors = userErrorsOf(setResult.metafieldsSet.userErrors);
    if (setErrors) {
      return errorJson("UPSTREAM_ERROR", "Could not stamp visit.", {
        details: setErrors,
      });
    }

    // Best-effort remove `lapsed` tag. If it isn't there, tagsRemove is a
    // no-op; we don't fail the visit on this branch.
    const tagsToRemove: string[] = [ELKA.tags.lapsed];
    if (homeStoreTag) {
      const tagData = await gql<{
        customer: { id: string; tags: string[] } | null;
      }>(admin, CUSTOMER_TAGS_QUERY, { id: customerGid }).catch(() => null);
      const oldHomeStoreTags =
        tagData?.customer?.tags.filter(
          (tag) => tag.startsWith(ELKA.tagPrefixes.homeStore) && tag !== homeStoreTag,
        ) ?? [];
      tagsToRemove.push(...oldHomeStoreTags);
    }

    await gql<{
      tagsRemove: {
        node: { id: string } | null;
        userErrors: Array<{ field?: string[]; message: string }>;
      };
    }>(admin, TAGS_REMOVE_MUTATION, {
      id: customerGid,
      tags: tagsToRemove,
    }).catch(() => {
      /* ignored: visit succeeded regardless of tag bookkeeping */
    });

    if (homeStoreTag) {
      await gql<{
        tagsAdd: {
          node: { id: string } | null;
          userErrors: Array<{ field?: string[]; message: string }>;
        };
      }>(admin, TAGS_ADD_MUTATION, {
        id: customerGid,
        tags: [homeStoreTag],
      }).catch(() => {
        /* ignored: visit succeeded regardless of home-store tag bookkeeping */
      });
    }

    return okJson({
      customerId: customerGid,
      lastStaffId: body.staffId,
      lastVisitAt,
      storeId: body.storeId,
      homeStore: location
        ? { id: location.id, handle: location.handle, name: location.name, tag: homeStoreTag }
        : null,
    });
  });
}
