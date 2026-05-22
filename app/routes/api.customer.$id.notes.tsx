import type { ActionFunctionArgs } from "@remix-run/node";

import {
  METAFIELDS_SET_MUTATION,
  METAOBJECT_CREATE_MUTATION,
} from "~/graphql/customer";
import { gql, runRouteOp, userErrorsOf } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { errorJson, okJson } from "~/lib/json.server";
import { normalizeLocationGid } from "~/lib/lookups.server";
import { authenticatePos } from "~/lib/pos-auth.server";

// Architect §5.3:
//   POST /api/customer/:id/notes  body { body, storeId, authorId }
// Creates a `clienteling_note` metaobject and appends its GID to the
// customer's `$app:esr.notes` list via metafieldsSet.

type NoteRequestBody = {
  body?: unknown;
  storeId?: unknown;
  authorId?: unknown;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return errorJson("BAD_REQUEST", "Method not allowed.", { status: 405 });
  }

  const { admin } = await authenticatePos(request);
  const id = params.id;
  if (!id) return errorJson("BAD_REQUEST", "Missing customer id.");

  let body: NoteRequestBody;
  try {
    body = (await request.json()) as NoteRequestBody;
  } catch {
    return errorJson("BAD_REQUEST", "Invalid JSON body.");
  }

  if (!isNonEmptyString(body.body) || body.body.length > 8000) {
    return errorJson("VALIDATION_FAILED", "`body` must be 1–8000 chars.");
  }
  if (!isNonEmptyString(body.storeId)) {
    return errorJson("VALIDATION_FAILED", "`storeId` is required.");
  }
  if (!isNonEmptyString(body.authorId)) {
    return errorJson("VALIDATION_FAILED", "`authorId` is required.");
  }

  const customerGid = id.startsWith("gid://")
    ? id
    : `gid://shopify/Customer/${id}`;
  const storeGid = normalizeLocationGid(body.storeId as string) ?? (body.storeId as string);
  const createdAt = new Date().toISOString();

  return runRouteOp(async () => {
    // 1. Create the metaobject.
    const created = await gql<{
      metaobjectCreate: {
        metaobject: { id: string; handle: string } | null;
        userErrors: Array<{ field?: string[]; message: string; code?: string }>;
      };
    }>(admin, METAOBJECT_CREATE_MUTATION, {
      metaobject: {
        type: ELKA.noteMetaobjectType,
        fields: [
          { key: "body", value: body.body as string },
          { key: "author_id", value: body.authorId as string },
          { key: "store_id", value: storeGid },
          { key: "created_at", value: createdAt },
        ],
      },
    });

    const noteUserErrors = userErrorsOf(created.metaobjectCreate.userErrors);
    if (noteUserErrors || !created.metaobjectCreate.metaobject) {
      return errorJson("UPSTREAM_ERROR", "Could not create note metaobject.", {
        details: noteUserErrors,
      });
    }

    const noteId = created.metaobjectCreate.metaobject.id;

    // 2. Append to the customer's notes list. metafieldsSet with type
    //    list.metaobject_reference expects a JSON-encoded array of GIDs.
    //    Read-then-write would race; we use compareDigest-free semantics here
    //    and prepend the new GID (we don't have a digest cheaply available).
    //    Implementation: fetch the current list inside the same mutation
    //    transaction is not possible; in practice a small race window is
    //    acceptable because the resource is owned exclusively by the staff
    //    member taking the note, and the note's authoritative copy lives in
    //    the metaobject regardless.

    // Naïve write: a single-element list is replaced wholesale by Shopify if
    // type is list.metaobject_reference, so we MUST include the prior list.
    // Read it first.
    const current = await gql<{
      customer: {
        metafield: {
          value: string | null;
          compareDigest: string | null;
        } | null;
      } | null;
    }>(
      admin,
      /* GraphQL */ `
        query NotesList($id: ID!, $ns: String!, $key: String!) {
          customer(id: $id) {
            metafield(namespace: $ns, key: $key) {
              value
              compareDigest
            }
          }
        }
      `,
      {
        id: customerGid,
        ns: ELKA.customerMetafieldNamespace,
        key: ELKA.customerMetafieldKeys.notes,
      },
    );

    const existing = (() => {
      const raw = current.customer?.metafield?.value;
      if (!raw) return [] as string[];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as string[]) : [];
      } catch {
        return [] as string[];
      }
    })();

    const updatedList = [noteId, ...existing];

    const set = await gql<{
      metafieldsSet: {
        metafields: Array<{ id: string; key: string; value: string }> | null;
        userErrors: Array<{ field?: string[]; message: string; code?: string }>;
      };
    }>(admin, METAFIELDS_SET_MUTATION, {
      metafields: [
        {
          ownerId: customerGid,
          namespace: ELKA.customerMetafieldNamespace,
          key: ELKA.customerMetafieldKeys.notes,
          type: "list.metaobject_reference",
          value: JSON.stringify(updatedList),
          compareDigest: current.customer?.metafield?.compareDigest ?? null,
        },
      ],
    });

    const setErrors = userErrorsOf(set.metafieldsSet.userErrors);
    if (setErrors) {
      return errorJson("UPSTREAM_ERROR", "Could not append note to customer.", {
        details: setErrors,
      });
    }

    return okJson(
      {
        id: noteId,
        body: body.body,
        authorId: body.authorId,
        storeId: storeGid,
        createdAt,
      },
      { status: 201 },
    );
  });
}
