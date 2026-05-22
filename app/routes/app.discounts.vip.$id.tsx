import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";

import { METAFIELDS_SET_MUTATION } from "~/graphql/customer";
import { gql, userErrorsOf } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { authenticate } from "~/shopify.server";

// Edit existing discount: lets the merchant tweak percentage and free-shipping
// without recreating the discount. We write the function-config metafield on
// the discount itself (namespace $app:config / key config — architect §3.1).

const SHOP_ID_QUERY = /* GraphQL */ `
  query ShopId {
    shop {
      id
    }
  }
`;

const READ_DISCOUNT_QUERY = /* GraphQL */ `
  query ReadDiscount($id: ID!, $ns: String!, $key: String!) {
    discountNode(id: $id) {
      id
      configuration: metafield(namespace: $ns, key: $key) {
        id
        value
        jsonValue
      }
      discount {
        ... on DiscountAutomaticApp {
          title
          status
          startsAt
          endsAt
          appDiscountType {
            functionId
            title
          }
        }
      }
    }
  }
`;

type LoaderData = {
  discountNodeId: string;
  title: string;
  status: string;
  config: { percentage: number; freeShippingForConcierge: boolean };
};

function parseConfig(jsonValue: unknown): LoaderData["config"] {
  if (jsonValue && typeof jsonValue === "object" && !Array.isArray(jsonValue)) {
    const obj = jsonValue as Record<string, unknown>;
    const pct = typeof obj.percentage === "number" ? obj.percentage : 15;
    const fs =
      typeof obj.freeShippingForConcierge === "boolean"
        ? obj.freeShippingForConcierge
        : true;
    return { percentage: pct, freeShippingForConcierge: fs };
  }
  return { percentage: 15, freeShippingForConcierge: true };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const id = params.id;
  if (!id) throw new Response("Missing id", { status: 400 });
  const discountNodeId = id.startsWith("gid://")
    ? id
    : `gid://shopify/DiscountAutomaticNode/${id}`;

  const data = await gql<{
    discountNode: {
      id: string;
      configuration: { value: string | null; jsonValue: unknown } | null;
      discount:
        | {
            title?: string;
            status?: string;
          }
        | null;
    } | null;
  }>(admin, READ_DISCOUNT_QUERY, {
    id: discountNodeId,
    ns: ELKA.functionConfigNamespace,
    key: ELKA.functionConfigKey,
  });

  if (!data.discountNode) {
    throw new Response("Discount not found", { status: 404 });
  }

  return json<LoaderData>({
    discountNodeId: data.discountNode.id,
    title: data.discountNode.discount?.title ?? "VIP discount",
    status: data.discountNode.discount?.status ?? "UNKNOWN",
    config: parseConfig(data.discountNode.configuration?.jsonValue),
  });
}

type ActionResult =
  | { ok: true; saved: true }
  | { ok: false; error: string; details?: unknown };

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const id = params.id;
  if (!id) return json<ActionResult>({ ok: false, error: "Missing id." }, { status: 400 });
  const discountNodeId = id.startsWith("gid://")
    ? id
    : `gid://shopify/DiscountAutomaticNode/${id}`;

  const form = await request.formData();
  const percentage = Number(form.get("percentage"));
  const freeShippingForConcierge = form.get("freeShippingForConcierge") === "on";

  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
    return json<ActionResult>(
      { ok: false, error: "Percentage must be between 1 and 100." },
      { status: 422 },
    );
  }

  const shopData = await gql<{ shop: { id: string } }>(admin, SHOP_ID_QUERY);

  const set = await gql<{
    metafieldsSet: {
      metafields: Array<{ id: string }> | null;
      userErrors: Array<{ field?: string[]; message: string; code?: string }>;
    };
  }>(admin, METAFIELDS_SET_MUTATION, {
    metafields: [
      {
        ownerId: discountNodeId,
        namespace: ELKA.functionConfigNamespace,
        key: ELKA.functionConfigKey,
        type: "json",
        value: JSON.stringify({ percentage, freeShippingForConcierge }),
      },
      {
        ownerId: shopData.shop.id,
        namespace: ELKA.shopMetafieldNamespace,
        key: ELKA.shopMetafieldKeys.vipPerkPct,
        type: "json",
        value: JSON.stringify({ percentage, freeShippingForConcierge }),
      },
    ],
  });

  const userErrors = userErrorsOf(set.metafieldsSet.userErrors);
  if (userErrors) {
    return json<ActionResult>(
      { ok: false, error: "Could not save configuration.", details: userErrors },
      { status: 502 },
    );
  }

  return json<ActionResult>({ ok: true, saved: true });
}

export default function EditVipDiscount() {
  const { title, status, config, discountNodeId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [percentage, setPercentage] = useState(String(config.percentage));
  const [freeShipping, setFreeShipping] = useState(config.freeShippingForConcierge);

  return (
    <Page
      title={title}
      backAction={{ url: "/app" }}
      titleMetadata={
        <Text as="span" tone="subdued">
          {status}
        </Text>
      }
    >
      <Layout>
        <Layout.Section>
          {actionData && actionData.ok && (
            <Banner tone="success" title="Saved" />
          )}
          {actionData && !actionData.ok && (
            <Banner tone="critical" title="Could not save">
              <Text as="p">{actionData.error}</Text>
            </Banner>
          )}
          <Card>
            <Form method="post">
              <input type="hidden" name="discountNodeId" value={discountNodeId} />
              <BlockStack gap="400">
                <TextField
                  label="VIP discount percentage"
                  type="number"
                  name="percentage"
                  value={percentage}
                  onChange={setPercentage}
                  autoComplete="off"
                  min={1}
                  max={100}
                />
                <Checkbox
                  label="Free shipping for `concierge` customers"
                  checked={freeShipping}
                  onChange={setFreeShipping}
                  name="freeShippingForConcierge"
                />
                <InlineStack align="end">
                  <Button
                    submit
                    variant="primary"
                    loading={nav.state === "submitting"}
                  >
                    Save
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
