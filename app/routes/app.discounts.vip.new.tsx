import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Banner,
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

import {
  DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION,
  LIST_SHOPIFY_FUNCTIONS_QUERY,
} from "~/graphql/install";
import { METAFIELDS_SET_MUTATION } from "~/graphql/customer";
import { gql, userErrorsOf } from "~/lib/admin.server";
import { ELKA } from "~/lib/constants";
import { authenticate } from "~/shopify.server";

// Embedded admin page that creates the automatic discount tied to the
// `vip` function (architect §3.1, §5.3, §7). The merchant picks the
// VIP percentage and toggles the free-shipping-for-concierge perk. The page
// also writes $app:esr.vip_perk_pct so Sidekick / future merchant tooling
// can read the current value.

const SHOP_ID_QUERY = /* GraphQL */ `
  query ShopId {
    shop {
      id
    }
  }
`;

type LoaderData = {
  vipFunctionHandle: string | null;
  knownFunctions: Array<{ id: string; handle: string; title: string; apiType: string }>;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const data = await gql<{
    shopifyFunctions: {
      edges: Array<{
        node: { id: string; title: string; handle: string; apiType: string; apiVersion: string };
      }>;
    };
  }>(admin, LIST_SHOPIFY_FUNCTIONS_QUERY);

  const knownFunctions = data.shopifyFunctions.edges.map(({ node }) => ({
    id: node.id,
    handle: node.handle,
    title: node.title,
    apiType: node.apiType,
  }));
  const vip = knownFunctions.find(
    (f) => f.handle === ELKA.vipDiscountFunctionHandle,
  );
  return json<LoaderData>({
    vipFunctionHandle: vip?.handle ?? null,
    knownFunctions,
  });
}

type ActionResult =
  | { ok: true; discountId: string }
  | { ok: false; error: string; details?: unknown };

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const functionHandle = form.get("functionHandle");
  const percentageRaw = form.get("percentage");
  const freeShippingRaw = form.get("freeShippingForConcierge");

  if (typeof functionHandle !== "string" || functionHandle.length === 0) {
    return json<ActionResult>(
      { ok: false, error: "Missing function handle. Has the `vip` function been deployed?" },
      { status: 400 },
    );
  }

  const percentage = Number(percentageRaw);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
    return json<ActionResult>(
      { ok: false, error: "Percentage must be between 1 and 100." },
      { status: 422 },
    );
  }
  const freeShippingForConcierge = freeShippingRaw === "on" || freeShippingRaw === "true";

  // 1. Create the automatic app discount.
  const created = await gql<{
    discountAutomaticAppCreate: {
      automaticAppDiscount: { discountId: string; title: string; status: string } | null;
      userErrors: Array<{ field?: string[]; message: string; code?: string }>;
    };
  }>(admin, DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION, {
    automaticAppDiscount: {
      title: `Elka VIP ${percentage}% & Concierge perks`,
      functionHandle,
      discountClasses: ["PRODUCT", "SHIPPING"],
      startsAt: new Date().toISOString(),
      metafields: [
        {
          namespace: ELKA.functionConfigNamespace,
          key: ELKA.functionConfigKey,
          type: "json",
          value: JSON.stringify({
            percentage,
            freeShippingForConcierge,
          }),
        },
      ],
    },
  });

  const userErrors = userErrorsOf(created.discountAutomaticAppCreate.userErrors);
  if (userErrors || !created.discountAutomaticAppCreate.automaticAppDiscount) {
    return json<ActionResult>(
      { ok: false, error: "Could not create discount.", details: userErrors },
      { status: 502 },
    );
  }

  // 2. Mirror the percentage onto the shop-level metafield so Sidekick can
  //    cite "currently 15%" without parsing the discount node.
  const shopData = await gql<{ shop: { id: string } }>(admin, SHOP_ID_QUERY);
  await gql(admin, METAFIELDS_SET_MUTATION, {
    metafields: [
      {
        ownerId: shopData.shop.id,
        namespace: ELKA.shopMetafieldNamespace,
        key: ELKA.shopMetafieldKeys.vipPerkPct,
        type: "json",
        value: JSON.stringify({ percentage, freeShippingForConcierge }),
      },
    ],
  }).catch((err) => {
    // Best-effort — not worth failing the create flow over.
    console.error("Failed to mirror vip_perk_pct shop metafield:", err);
  });

  const discountId = created.discountAutomaticAppCreate.automaticAppDiscount.discountId;
  const numericId = discountId.split("/").pop();
  return redirect(`/app/discounts/vip/${numericId}`);
}

function formatDetails(details: unknown): string | null {
  if (!details) return null;
  if (Array.isArray(details)) {
    return details
      .map((detail) => {
        if (detail && typeof detail === "object" && "message" in detail) {
          const error = detail as { field?: unknown; message?: unknown; code?: unknown };
          const field = Array.isArray(error.field) ? error.field.join(".") : undefined;
          return [field, error.message, error.code].filter(Boolean).join(" — ");
        }
        return String(detail);
      })
      .join("\n");
  }
  return typeof details === "string" ? details : JSON.stringify(details, null, 2);
}

export default function NewVipDiscount() {
  const { vipFunctionHandle, knownFunctions } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [percentage, setPercentage] = useState("15");
  const [freeShipping, setFreeShipping] = useState(true);

  return (
    <Page title="Create VIP & Concierge discount" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          {!vipFunctionHandle && (
            <Banner tone="warning" title="vip function not found">
              Deploy the <code>vip</code> Shopify Function with
              <code> shopify app deploy</code> before creating this discount.
            </Banner>
          )}
          {actionData && !actionData.ok && (
            <Banner tone="critical" title="Could not create discount">
              <BlockStack gap="100">
                <Text as="p">{actionData.error}</Text>
                {formatDetails(actionData.details) && (
                  <Text as="p" tone="subdued">
                    {formatDetails(actionData.details)}
                  </Text>
                )}
              </BlockStack>
            </Banner>
          )}
          <Card>
            <Form method="post">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Perk configuration
                </Text>
                <input
                  type="hidden"
                  name="functionHandle"
                  value={vipFunctionHandle ?? ""}
                />
                <TextField
                  label="VIP discount percentage"
                  type="number"
                  name="percentage"
                  value={percentage}
                  onChange={setPercentage}
                  autoComplete="off"
                  min={1}
                  max={100}
                  helpText="Applied to line items for customers tagged `vip`."
                />
                <Checkbox
                  label="Free shipping for `concierge` customers (all delivery options 100% off)"
                  checked={freeShipping}
                  onChange={setFreeShipping}
                  name="freeShippingForConcierge"
                />
                <InlineStack align="end">
                  <Button
                    submit
                    variant="primary"
                    loading={nav.state === "submitting"}
                    disabled={!vipFunctionHandle}
                  >
                    Create discount
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Functions detected on this shop
              </Text>
              {knownFunctions.length === 0 ? (
                <Text as="p">No app-owned functions yet.</Text>
              ) : (
                <BlockStack gap="100">
                  {knownFunctions.map((f) => (
                    <Text as="p" key={f.id}>
                      <code>{f.handle}</code> · {f.title} ·{" "}
                      <Text as="span" tone="subdued">
                        {f.apiType}
                      </Text>
                    </Text>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
