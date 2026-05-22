import { Page, Layout, Card, BlockStack, Text, Link } from "@shopify/polaris";

export default function AppIndex() {
  return (
    <Page title="ESR Clienteling">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Setup
              </Text>
              <Text as="p">
                Run <code>npm run seed</code> against this store to provision
                metafield definitions, the clienteling_note metaobject, and the
                customer segments referenced by Sidekick (see architect §2.5).
              </Text>
              <Text as="p">
                Then go to <Link url="/app/discounts/vip/new">Create VIP
                discount</Link> to wire up the automatic discount that drives
                §3.1's VIP and Concierge perks.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Sidekick context
              </Text>
              <Text as="p">
                Paste the conventions doc from architect §6.1 into Sidekick's
                Shop Brain so head-office queries map to our tag/segment
                vocabulary.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
