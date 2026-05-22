import type { LoaderFunctionArgs } from "@remix-run/node";

import { CUSTOMER_SEARCH_QUERY } from "~/graphql/customer";
import {
  CUSTOMERS_COUNT_QUERY,
  PRODUCT_PRIMARY_COLLECTION_QUERY,
  SEGMENT_MEMBERS_QUERY,
  SHOP_METAFIELD_QUERY,
} from "~/graphql/segments";
import { gql, runRouteOp } from "~/lib/admin.server";
import { tagsToBadges } from "~/lib/badges";
import {
  ELKA,
  homeStoreTagFor,
  interestTagFor,
  newDropSegmentName,
} from "~/lib/constants";
import { errorJson, okJson } from "~/lib/json.server";
import { segmentByName } from "~/lib/lookups.server";
import { freshLocationById } from "~/lib/locations.server";
import { authenticatePos } from "~/lib/pos-auth.server";

// Architect §5.5 — "Reach out about this drop":
//   1. Load product → mapped collection or catalogue-derived interest.
//   2. Look up collection ID in $app:esr.interest_map → interest-<category> tag.
//   3. Look up segment "New Drop — <Category>" (cached on boot).
//   4. customerSegmentMembers for the headline list.
//   5. customersCount with tag:interest-<category> AND tag:home-store-<handle>
//      for the at-location number.

type ProductCollectionsResponse = {
  product: {
    id: string;
    title: string;
    vendor: string;
    productType: string;
    tags: string[];
    collections: {
      edges: Array<{ node: { id: string; title: string; handle: string } }>;
    };
  } | null;
};

type ShopMetafieldResponse = {
  shop: {
    metafield: { value: string | null; jsonValue: unknown } | null;
  };
};

type CustomerSearchResponse = {
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
};

type CountResponse = {
  customersCount: { count: number; precision: string };
};

function productSearchText(product: NonNullable<ProductCollectionsResponse["product"]>): string {
  return [
    product.title,
    product.productType,
    ...product.tags,
    ...product.collections.edges.flatMap(({ node }) => [node.title, node.handle]),
  ]
    .join(" ")
    .toLowerCase();
}

function inferInterestCategory(
  product: NonNullable<ProductCollectionsResponse["product"]>,
): string {
  const text = productSearchText(product);
  if (/denim|jean/.test(text)) return "denim";
  if (/knit|cardigan|merino|wool/.test(text)) return "knitwear";
  if (/coat|jacket|outerwear|trench/.test(text)) return "outerwear";
  if (/accessor|scarf|belt|bag|jewel/.test(text)) return "accessories";
  return "tailoring";
}

function parseInterestMap(raw: unknown): Record<string, string> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") map[k] = v;
    }
    return map;
  }
  return {};
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = (await authenticatePos(request)) as {
    admin: unknown;
    session: { shop: string };
  };
  const id = params.id;
  if (!id) return errorJson("BAD_REQUEST", "Missing product id.");

  const url = new URL(request.url);
  const locationGid = url.searchParams.get("locationId");

  const productGid = id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;

  return runRouteOp(async () => {
    // Step 1+2: product → collection → interest tag (via shop metafield).
    const [product, shopMetafield, locationRow] = await Promise.all([
      gql<ProductCollectionsResponse>(admin, PRODUCT_PRIMARY_COLLECTION_QUERY, {
        id: productGid,
      }),
      gql<ShopMetafieldResponse>(admin, SHOP_METAFIELD_QUERY, {
        namespace: ELKA.shopMetafieldNamespace,
        key: ELKA.shopMetafieldKeys.interestMap,
      }),
      locationGid ? freshLocationById(admin, session.shop, locationGid) : Promise.resolve(null),
    ]);

    if (!product.product) return errorJson("NOT_FOUND", "Product not found.");

    const interestMap = parseInterestMap(shopMetafield.shop.metafield?.jsonValue);
    const collectionEdge = product.product.collections.edges.find(
      ({ node }) => interestMap[node.id],
    );
    const interestCategory = collectionEdge
      ? interestMap[collectionEdge.node.id]
      : inferInterestCategory(product.product);

    const interestTag = interestTagFor(interestCategory);

    // Step 3: lookup segment id from the cache.
    const segmentName = newDropSegmentName(interestCategory);
    const segment = await segmentByName(session.shop, segmentName);

    // Step 4: pull headline list from segment members (if we have the id),
    // otherwise fall back to a tag-based customers query.
    type Customer = {
      id: string;
      displayName: string;
      email: string | null;
      phone: string | null;
      badges: string[];
    };
    let customers: Customer[] = [];

    if (segment) {
      const data = await gql<{
        customerSegmentMembers: {
          edges: Array<{
            node: {
              id: string;
              displayName: string;
              defaultEmailAddress: { emailAddress: string | null } | null;
              defaultPhoneNumber: { phoneNumber: string | null } | null;
            };
          }>;
        };
      }>(admin, SEGMENT_MEMBERS_QUERY, {
        id: segment.id,
        first: 50,
        after: null,
      });
      customers = data.customerSegmentMembers.edges.map(({ node }) => ({
        id: node.id,
        displayName: node.displayName,
        email: node.defaultEmailAddress?.emailAddress ?? null,
        phone: node.defaultPhoneNumber?.phoneNumber ?? null,
        badges: [], // segment members don't expose tags directly here
      }));
    } else {
      // Segment not yet seeded; degrade gracefully to a tag search.
      const fallback = await gql<CustomerSearchResponse>(
        admin,
        CUSTOMER_SEARCH_QUERY,
        {
          query: `tag:${interestTag}`,
          first: 50,
        },
      );
      customers = fallback.customers.edges.map(({ node }) => ({
        id: node.id,
        displayName: node.displayName,
        email: node.defaultEmailAddress?.emailAddress ?? null,
        phone: node.defaultPhoneNumber?.phoneNumber ?? null,
        badges: tagsToBadges(node.tags),
      }));
    }

    // Step 5: counts.
    const totalQuery = `tag:${interestTag}`;
    const atLocationQuery = locationRow
      ? `${totalQuery} AND tag:${homeStoreTagFor(locationRow.handle)}`
      : totalQuery;

    const [totalCount, atLocationCount] = await Promise.all([
      gql<CountResponse>(admin, CUSTOMERS_COUNT_QUERY, { q: totalQuery }),
      locationRow
        ? gql<CountResponse>(admin, CUSTOMERS_COUNT_QUERY, { q: atLocationQuery })
        : Promise.resolve({ customersCount: { count: 0, precision: "EXACT" } } as CountResponse),
    ]);

    return okJson({
      productId: productGid,
      collection: collectionEdge?.node ?? null,
      interestTag,
      segmentId: segment?.id ?? null,
      segmentName,
      countAtLocation: atLocationCount.customersCount.count,
      countTotal: totalCount.customersCount.count,
      atLocation: locationRow
        ? { id: locationRow.id, handle: locationRow.handle, name: locationRow.name }
        : null,
      customers,
    });
  });
}
