import type { ActionFunctionArgs } from "@remix-run/node";

import { gql, runRouteOp, userErrorsOf } from "~/lib/admin.server";
import { tagsToBadges } from "~/lib/badges";
import { errorJson, okJson } from "~/lib/json.server";
import { authenticatePos } from "~/lib/pos-auth.server";

const CUSTOMER_CREATE_MUTATION = /* GraphQL */ `
  mutation AppointmentCustomerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
        displayName
        defaultEmailAddress {
          emailAddress
        }
        defaultPhoneNumber {
          phoneNumber
        }
        tags
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

type CreateCustomerBody = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
};

function clean(value: unknown, max = 120): string {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "Client", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return errorJson("BAD_REQUEST", "Method not allowed.", { status: 405 });
  }

  const { admin } = await authenticatePos(request);

  let body: CreateCustomerBody;
  try {
    body = (await request.json()) as CreateCustomerBody;
  } catch {
    return errorJson("BAD_REQUEST", "Invalid JSON body.");
  }

  const name = clean(body.name);
  const email = clean(body.email, 254);
  const phone = clean(body.phone, 40);

  if (!name && !email && !phone) {
    return errorJson("VALIDATION_FAILED", "Enter a client name, email, or phone number.");
  }

  if (email && !email.includes("@")) {
    return errorJson("VALIDATION_FAILED", "Enter a valid email address.");
  }

  const { firstName, lastName } = splitName(name || email || phone);

  return runRouteOp(async () => {
    const input: Record<string, unknown> = {
      firstName,
      lastName,
      tags: ["appointment-client"],
    };
    if (email) input.email = email;
    if (phone) input.phone = phone;

    const data = await gql<{
      customerCreate: {
        customer: {
          id: string;
          displayName: string;
          defaultEmailAddress: { emailAddress: string | null } | null;
          defaultPhoneNumber: { phoneNumber: string | null } | null;
          tags: string[];
        } | null;
        userErrors: Array<{ field?: string[]; message: string; code?: string }>;
      };
    }>(admin, CUSTOMER_CREATE_MUTATION, { input });

    const errors = userErrorsOf(data.customerCreate.userErrors);
    if (errors) {
      return errorJson("VALIDATION_FAILED", errors.map((error) => error.message).join("; "), {
        details: errors,
      });
    }

    const customer = data.customerCreate.customer;
    if (!customer) return errorJson("UPSTREAM_ERROR", "Customer was not created.");

    return okJson({
      id: customer.id,
      displayName: customer.displayName,
      email: customer.defaultEmailAddress?.emailAddress ?? null,
      phone: customer.defaultPhoneNumber?.phoneNumber ?? null,
      tags: customer.tags,
      badges: tagsToBadges(customer.tags),
    });
  });
}
