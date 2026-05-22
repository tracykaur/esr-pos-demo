import type { ActionFunctionArgs } from "@remix-run/node";

import { METAFIELDS_SET_MUTATION } from "~/graphql/customer";
import { gql, runRouteOp, userErrorsOf } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { errorJson, okJson } from "~/lib/json.server";
import { authenticatePos } from "~/lib/pos-auth.server";

const SIZING_KEYS = ["top", "bottom", "dress", "shoe", "bra", "fit"] as const;
type SizingKey = (typeof SIZING_KEYS)[number];
type PreferredContact = "sms" | "email" | "none";

type ProfileRequestBody = {
  sizing?: unknown;
  preferredContact?: unknown;
};

function cleanSizing(value: unknown): Partial<Record<SizingKey, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const sizing: Partial<Record<SizingKey, string>> = {};
  for (const key of SIZING_KEYS) {
    const raw = input[key];
    if (raw == null) continue;
    const cleaned = String(raw).trim();
    if (cleaned.length > 40) throw new Error(`${key} must be 40 characters or fewer.`);
    if (cleaned) sizing[key] = cleaned;
  }
  return sizing;
}

function cleanPreferredContact(value: unknown): PreferredContact {
  if (value === "sms" || value === "email" || value === "none") return value;
  throw new Error("preferredContact must be one of sms, email, none.");
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return errorJson("BAD_REQUEST", "Method not allowed.", { status: 405 });
  }

  const { admin } = await authenticatePos(request);
  const id = params.id;
  if (!id) return errorJson("BAD_REQUEST", "Missing customer id.");

  let body: ProfileRequestBody;
  try {
    body = (await request.json()) as ProfileRequestBody;
  } catch {
    return errorJson("BAD_REQUEST", "Invalid JSON body.");
  }

  let sizing: Partial<Record<SizingKey, string>>;
  let preferredContact: PreferredContact;
  try {
    sizing = cleanSizing(body.sizing);
    preferredContact = cleanPreferredContact(body.preferredContact);
  } catch (err) {
    return errorJson("VALIDATION_FAILED", err instanceof Error ? err.message : "Invalid profile fields.");
  }

  const customerGid = id.startsWith("gid://") ? id : `gid://shopify/Customer/${id}`;

  return runRouteOp(async () => {
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
          key: ELKA.customerMetafieldKeys.sizing,
          type: "json",
          value: JSON.stringify(sizing),
        },
        {
          ownerId: customerGid,
          namespace: ELKA.customerMetafieldNamespace,
          key: ELKA.customerMetafieldKeys.preferredContact,
          type: "single_line_text_field",
          value: preferredContact,
        },
      ],
    });

    const errors = userErrorsOf(set.metafieldsSet.userErrors);
    if (errors) {
      return errorJson("UPSTREAM_ERROR", "Could not save sizing/contact preferences.", {
        details: errors,
      });
    }

    return okJson({ customerId: customerGid, sizing, preferredContact });
  });
}
