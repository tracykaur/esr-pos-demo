/**
 * ESR Clienteling — seed script.
 *
 * Run with: `npm run seed` (after the app is installed on the dev store).
 *
 * Creates everything the architect §2 / §6 requires before the app is usable:
 *   - Customer metafield definitions (notes, sizing, last_staff_id,
 *     last_visit_at, preferred_contact) under $app:esr.
 *   - Shop metafield definitions (interest_map, vip_perk_pct, app_config)
 *     under $app:esr.
 *   - The clienteling_note metaobject definition.
 *   - Customer segments: VIP — Active, Concierge, Lapsed VIP, and one
 *     "New Drop — <Category>" per interest category.
 *   - Local lookup cache (Prisma) for staff members, locations, and segments.
 *
 * Requires SHOPIFY_SEED_SHOP=foo.myshopify.com so we know which offline
 * session to grab from session storage. The app must already be installed
 * (`shopify app dev` once) so a session row exists.
 */

// env vars come from `node --env-file=.env` (set in the `seed` npm script)
import { ELKA, deriveLocationHandle, newDropSegmentName } from "../app/lib/constants";
import {
  CREATE_METAFIELD_DEFINITION_MUTATION,
  CREATE_METAOBJECT_DEFINITION_MUTATION,
  CREATE_SEGMENT_MUTATION,
  GET_METAOBJECT_DEFINITION_BY_TYPE_QUERY,
  INSTALL_LOOKUPS_QUERY,
  INSTALL_STAFF_QUERY,
} from "../app/graphql/install";
import {
  METAFIELDS_SET_MUTATION,
  TAGS_ADD_MUTATION,
  TAGS_REMOVE_MUTATION,
} from "../app/graphql/customer";
import { upsertLocations, upsertSegmentCache, upsertStaffMembers } from "../app/lib/lookups.server";

import shopify from "../app/shopify.server";

type AdminClient = {
  graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

async function call<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }
  if (!payload.data) throw new Error("Empty GraphQL response");
  return payload.data;
}

type UserError = { field?: string[] | null; message: string; code?: string | null };

const DEMO_SIZING_CUSTOMERS_QUERY = /* GraphQL */ `
  query DemoSizingCustomers($query: String!, $first: Int!, $namespace: String!, $sizingKey: String!) {
    customers(query: $query, first: $first) {
      edges {
        node {
          id
          displayName
          tags
          sizing: metafield(namespace: $namespace, key: $sizingKey) {
            value
          }
        }
      }
    }
  }
`;

const DEMO_SIZING_PROFILES = [
  { top: "S", bottom: "8", shoe: "39", bra: "12C", fit: "Prefers relaxed tailoring" },
  { top: "M", bottom: "10", shoe: "38", bra: "12D", fit: "True to size; likes high waist" },
  { top: "XS", bottom: "6", shoe: "37", bra: "10B", fit: "Petite fit; sleeve length matters" },
  { top: "L", bottom: "12", shoe: "40", bra: "14C", fit: "Prefers room through shoulders" },
  { top: "S-M", bottom: "9", shoe: "38.5", bra: "12B", fit: "Between sizes; size up in denim" },
] as const;

const CATALOG_PRODUCTS_QUERY = /* GraphQL */ `
  query DemoCatalogProducts($query: String!, $first: Int!) {
    products(query: $query, first: $first, sortKey: TITLE) {
      edges {
        node {
          id
          title
          vendor
          productType
          tags
          handle
          collections(first: 10) {
            edges {
              node {
                id
                title
                handle
              }
            }
          }
          variants(first: 3) {
            edges {
              node {
                title
                price
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }
`;

const DEMO_CUSTOMER_BY_EMAIL_QUERY = /* GraphQL */ `
  query DemoCustomerByEmail($query: String!) {
    customers(query: $query, first: 1) {
      edges {
        node {
          id
          displayName
          tags
        }
      }
    }
  }
`;

const CUSTOMER_CREATE_MUTATION = /* GraphQL */ `
  mutation DemoCustomerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
        displayName
        tags
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_UPDATE_MUTATION = /* GraphQL */ `
  mutation DemoCustomerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) {
      customer {
        id
        displayName
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SHOP_ID_QUERY = /* GraphQL */ `
  query ShopId {
    shop {
      id
    }
  }
`;

function logUserErrors(label: string, errs: ReadonlyArray<UserError> | undefined) {
  if (!errs || errs.length === 0) return;
  for (const e of errs) {
    const code = e.code ?? "";
    // TAKEN / ALREADY_EXISTS are expected on re-runs; only print at INFO.
    if (code === "TAKEN" || /already exists|has already been taken/i.test(e.message)) {
      console.log(`  · ${label} already exists (${e.message})`);
      continue;
    }
    console.warn(`  ! ${label} error:`, e);
  }
}

async function ensureCustomerMetafieldDefinitions(admin: AdminClient, noteDefinitionId: string) {
  type Def = {
    key: string;
    name: string;
    type: string;
    description: string;
    validations?: Array<{ name: string; value: string }>;
  };

  const defs: Def[] = [
    {
      key: ELKA.customerMetafieldKeys.notes,
      name: "Clienteling notes",
      type: `list.metaobject_reference`,
      description: "Append-only private clienteling notes (newest first).",
      validations: [
        // 2026-04+: validation is metaobject_definition_id (GID), not the type handle.
        { name: "metaobject_definition_id", value: noteDefinitionId },
      ],
    },
    {
      key: ELKA.customerMetafieldKeys.sizing,
      name: "Sizing",
      type: "json",
      description: "Partial sizing JSON: { top, bottom, shoe, bra, fit }.",
    },
    {
      key: ELKA.customerMetafieldKeys.lastStaffId,
      name: "Last staff (id)",
      type: "single_line_text_field",
      description: "Numeric staff member ID who last served the customer.",
    },
    {
      key: ELKA.customerMetafieldKeys.lastVisitAt,
      name: "Last visit at",
      type: "date_time",
      description: "Updated by /api/customer/:id/visit and orders/create.",
    },
    {
      key: ELKA.customerMetafieldKeys.preferredContact,
      name: "Preferred contact",
      type: "single_line_text_field",
      description: `One of "sms", "email", "none".`,
    },
  ];

  for (const def of defs) {
    console.log(`Customer metafield: ${def.key}`);
    const data = await call<{
      metafieldDefinitionCreate: {
        createdDefinition: { id: string } | null;
        userErrors: UserError[];
      };
    }>(admin, CREATE_METAFIELD_DEFINITION_MUTATION, {
      definition: {
        name: def.name,
        namespace: ELKA.customerMetafieldNamespace,
        key: def.key,
        type: def.type,
        description: def.description,
        ownerType: "CUSTOMER",
        ...(def.validations ? { validations: def.validations } : {}),
      },
    });
    logUserErrors(`metafieldDefinitionCreate(${def.key})`, data.metafieldDefinitionCreate.userErrors);
  }
}

async function ensureShopMetafieldDefinitions(admin: AdminClient) {
  const defs = [
    {
      key: ELKA.shopMetafieldKeys.interestMap,
      name: "Interest map",
      type: "json",
      description:
        "Maps collection IDs → interest-<category>. Edited from app UI.",
    },
    {
      key: ELKA.shopMetafieldKeys.vipPerkPct,
      name: "VIP perk percentage",
      type: "json",
      description: "{ percentage, freeShippingForConcierge } — mirror of the VIP discount.",
    },
    {
      key: ELKA.shopMetafieldKeys.appConfig,
      name: "Elka app config",
      type: "json",
      description: "Generic shop-level configuration consumed by the Functions.",
    },
  ];

  for (const def of defs) {
    console.log(`Shop metafield: ${def.key}`);
    const data = await call<{
      metafieldDefinitionCreate: {
        createdDefinition: { id: string } | null;
        userErrors: UserError[];
      };
    }>(admin, CREATE_METAFIELD_DEFINITION_MUTATION, {
      definition: {
        name: def.name,
        namespace: ELKA.shopMetafieldNamespace,
        key: def.key,
        type: def.type,
        description: def.description,
        ownerType: "SHOP",
      },
    });
    logUserErrors(`metafieldDefinitionCreate(${def.key})`, data.metafieldDefinitionCreate.userErrors);
  }
}

async function ensureNoteMetaobject(admin: AdminClient): Promise<string> {
  console.log(`Metaobject: ${ELKA.noteMetaobjectType}`);
  const data = await call<{
    metaobjectDefinitionCreate: {
      metaobjectDefinition: { id: string } | null;
      userErrors: UserError[];
    };
  }>(admin, CREATE_METAOBJECT_DEFINITION_MUTATION, {
    definition: {
      name: "Clienteling note",
      type: ELKA.noteMetaobjectType,
      access: { admin: "MERCHANT_READ_WRITE", storefront: "NONE" },
      fieldDefinitions: [
        {
          name: "Body",
          key: "body",
          type: "multi_line_text_field",
          required: true,
        },
        {
          name: "Author id",
          key: "author_id",
          type: "single_line_text_field",
          required: false,
        },
        {
          name: "Store id",
          key: "store_id",
          type: "single_line_text_field",
          required: false,
        },
        {
          name: "Created at",
          key: "created_at",
          type: "date_time",
          required: true,
        },
      ],
    },
  });
  logUserErrors("metaobjectDefinitionCreate(clienteling_note)", data.metaobjectDefinitionCreate.userErrors);

  if (data.metaobjectDefinitionCreate.metaobjectDefinition?.id) {
    return data.metaobjectDefinitionCreate.metaobjectDefinition.id;
  }

  // Already existed on re-run — look it up by type to capture the GID we need
  // for the notes metafield's metaobject_definition_id validation.
  const existing = await call<{
    metaobjectDefinitionByType: { id: string; type: string } | null;
  }>(admin, GET_METAOBJECT_DEFINITION_BY_TYPE_QUERY, { type: ELKA.noteMetaobjectType });
  if (!existing.metaobjectDefinitionByType?.id) {
    throw new Error(
      `Could not resolve metaobject definition id for ${ELKA.noteMetaobjectType}`,
    );
  }
  return existing.metaobjectDefinitionByType.id;
}

async function ensureSegments(admin: AdminClient) {
  type SegSpec = { name: string; query: string };
  const specs: SegSpec[] = [
    {
      name: ELKA.segmentNames.vipActive,
      query: `customer_tags CONTAINS 'vip' AND last_order_date >= -${ELKA.lapsedDays}d`,
    },
    {
      name: ELKA.segmentNames.concierge,
      query: `customer_tags CONTAINS 'concierge'`,
    },
    {
      name: ELKA.segmentNames.lapsedVip,
      query: `customer_tags CONTAINS 'vip' AND last_order_date < -${ELKA.lapsedDays}d`,
    },
    ...ELKA.interestCategories.map((cat) => ({
      name: newDropSegmentName(cat),
      query: `customer_tags CONTAINS 'interest-${cat}'`,
    })),
  ];

  for (const spec of specs) {
    console.log(`Segment: ${spec.name}`);
    const data = await call<{
      segmentCreate: {
        segment: { id: string; name: string } | null;
        userErrors: UserError[];
      };
    }>(admin, CREATE_SEGMENT_MUTATION, {
      name: spec.name,
      query: spec.query,
    });
    logUserErrors(`segmentCreate(${spec.name})`, data.segmentCreate.userErrors);
  }
}

async function ensureDemoSizing(admin: AdminClient) {
  console.log("Demo customer sizing...");
  const seen = new Set<string>();
  const customers: Array<{
    id: string;
    displayName: string;
    tags: string[];
    sizing?: { value: string | null } | null;
  }> = [];

  for (const query of ["tag:concierge", "tag:vip"]) {
    const data = await call<{
      customers: {
        edges: Array<{
          node: {
            id: string;
            displayName: string;
            tags: string[];
            sizing?: { value: string | null } | null;
          };
        }>;
      };
    }>(admin, DEMO_SIZING_CUSTOMERS_QUERY, {
      query,
      first: 20,
      namespace: ELKA.customerMetafieldNamespace,
      sizingKey: ELKA.customerMetafieldKeys.sizing,
    });

    for (const { node } of data.customers.edges) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      customers.push(node);
    }
  }

  const targets = customers.slice(0, DEMO_SIZING_PROFILES.length);
  if (targets.length === 0) {
    console.log("  · no VIP/Concierge customers found for sizing demo data.");
    return;
  }

  const set = await call<{
    metafieldsSet: {
      metafields: Array<{ id: string; ownerType: string; key: string; value: string }> | null;
      userErrors: UserError[];
    };
  }>(admin, METAFIELDS_SET_MUTATION, {
    metafields: targets.map((customer, index) => ({
      ownerId: customer.id,
      namespace: ELKA.customerMetafieldNamespace,
      key: ELKA.customerMetafieldKeys.sizing,
      type: "json",
      value: JSON.stringify(DEMO_SIZING_PROFILES[index]),
    })),
  });

  logUserErrors("metafieldsSet(demo sizing)", set.metafieldsSet.userErrors);
  console.log(
    `  · wrote sizing for ${targets.length} customers: ${targets
      .map((customer) => customer.displayName)
      .join(", ")}.`,
  );
}

type DemoCatalogProduct = {
  id: string;
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  handle: string;
  collections: {
    edges: Array<{ node: { id: string; title: string; handle: string } }>;
  };
  variants: {
    edges: Array<{
      node: { title: string; price: string; inventoryQuantity: number | null };
    }>;
  };
};

type DemoCustomerSpec = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  tags: string[];
  interests: Array<(typeof ELKA.interestCategories)[number]>;
  sizing: (typeof DEMO_SIZING_PROFILES)[number];
  preferredContact: "sms" | "email";
  lastVisitDaysAgo: number;
};

const DEMO_CUSTOMERS: DemoCustomerSpec[] = [
  {
    firstName: "Ava",
    lastName: "Montgomery",
    email: "ava.montgomery+elka-demo@example.com",
    phone: "+61400001101",
    tags: [ELKA.tags.vip, ELKA.tags.concierge],
    interests: ["knitwear", "outerwear"],
    sizing: DEMO_SIZING_PROFILES[1],
    preferredContact: "sms",
    lastVisitDaysAgo: 4,
  },
  {
    firstName: "Mila",
    lastName: "Ashford",
    email: "mila.ashford+elka-demo@example.com",
    phone: "+61400001102",
    tags: [ELKA.tags.concierge],
    interests: ["tailoring", "accessories"],
    sizing: DEMO_SIZING_PROFILES[0],
    preferredContact: "email",
    lastVisitDaysAgo: 9,
  },
  {
    firstName: "Sienna",
    lastName: "Vale",
    email: "sienna.vale+elka-demo@example.com",
    phone: "+61400001103",
    tags: [ELKA.tags.vip],
    interests: ["denim", "outerwear"],
    sizing: DEMO_SIZING_PROFILES[2],
    preferredContact: "sms",
    lastVisitDaysAgo: 16,
  },
  {
    firstName: "Harper",
    lastName: "Quinn",
    email: "harper.quinn+elka-demo@example.com",
    phone: "+61400001104",
    tags: [ELKA.tags.vip],
    interests: ["knitwear", "tailoring"],
    sizing: DEMO_SIZING_PROFILES[3],
    preferredContact: "email",
    lastVisitDaysAgo: 28,
  },
  {
    firstName: "Isla",
    lastName: "Rowe",
    email: "isla.rowe+elka-demo@example.com",
    phone: "+61400001105",
    tags: [ELKA.tags.vip, ELKA.tags.lapsed],
    interests: ["tailoring"],
    sizing: DEMO_SIZING_PROFILES[4],
    preferredContact: "sms",
    lastVisitDaysAgo: 210,
  },
  {
    firstName: "Zoe",
    lastName: "Bennett",
    email: "zoe.bennett+elka-demo@example.com",
    phone: "+61400001106",
    tags: [ELKA.tags.vip],
    interests: ["accessories", "outerwear"],
    sizing: DEMO_SIZING_PROFILES[0],
    preferredContact: "email",
    lastVisitDaysAgo: 3,
  },
  {
    firstName: "Nina",
    lastName: "Hartley",
    email: "nina.hartley+elka-demo@example.com",
    phone: "+61400001107",
    tags: [],
    interests: ["denim", "knitwear"],
    sizing: DEMO_SIZING_PROFILES[1],
    preferredContact: "sms",
    lastVisitDaysAgo: 40,
  },
  {
    firstName: "Lucy",
    lastName: "Carter",
    email: "lucy.carter+elka-demo@example.com",
    phone: "+61400001108",
    tags: [ELKA.tags.concierge],
    interests: ["outerwear", "knitwear"],
    sizing: DEMO_SIZING_PROFILES[2],
    preferredContact: "email",
    lastVisitDaysAgo: 12,
  },
];

function productText(product: DemoCatalogProduct): string {
  return [
    product.title,
    product.productType,
    ...product.tags,
    ...product.collections.edges.flatMap(({ node }) => [node.title, node.handle]),
  ]
    .join(" ")
    .toLowerCase();
}

function inferDemoInterest(product: DemoCatalogProduct): (typeof ELKA.interestCategories)[number] {
  const text = productText(product);
  if (/denim|jean/.test(text)) return "denim";
  if (/coat|jacket|outerwear|trench/.test(text)) return "outerwear";
  if (/knit|cardigan|merino/.test(text)) return "knitwear";
  if (/accessor|scarf|belt|bag|jewel/.test(text)) return "accessories";
  return "tailoring";
}

function collectionInterest(
  collection: { title: string; handle: string },
): (typeof ELKA.interestCategories)[number] | null {
  const text = `${collection.title} ${collection.handle}`.toLowerCase();
  if (/denim|jean/.test(text)) return "denim";
  if (/coat|jacket|outerwear|trench/.test(text)) return "outerwear";
  if (/knit|cardigan|merino/.test(text)) return "knitwear";
  if (/accessor|scarf|belt|bag|jewel/.test(text)) return "accessories";
  if (/pant|shirt|top|dress|skirt|tailor/.test(text)) return "tailoring";
  return null;
}

async function loadElkaCatalog(admin: AdminClient): Promise<DemoCatalogProduct[]> {
  const data = await call<{
    products: { edges: Array<{ node: DemoCatalogProduct }> };
  }>(admin, CATALOG_PRODUCTS_QUERY, {
    query: "vendor:'Early Settler' status:active",
    first: 100,
  });

  return data.products.edges
    .map(({ node }) => node)
    .filter((product) => product.vendor === "Early Settler" && product.title !== "Gift Card");
}

async function ensureInterestMapFromCatalog(admin: AdminClient, catalog: DemoCatalogProduct[]) {
  console.log("Shop interest map from catalogue...");
  const map: Record<string, string> = {};
  for (const product of catalog) {
    for (const { node: collection } of product.collections.edges) {
      const interest = collectionInterest(collection);
      if (interest) map[collection.id] = interest;
    }
  }

  const shopData = await call<{ shop: { id: string } }>(admin, SHOP_ID_QUERY);
  const set = await call<{
    metafieldsSet: {
      metafields: Array<{ id: string; key: string; value: string }> | null;
      userErrors: UserError[];
    };
  }>(admin, METAFIELDS_SET_MUTATION, {
    metafields: [
      {
        ownerId: shopData.shop.id,
        namespace: ELKA.shopMetafieldNamespace,
        key: ELKA.shopMetafieldKeys.interestMap,
        type: "json",
        value: JSON.stringify(map),
      },
    ],
  });
  logUserErrors("metafieldsSet(interest_map)", set.metafieldsSet.userErrors);
  console.log(`  · mapped ${Object.keys(map).length} catalogue collections to interests.`);
}

function productsForInterests(
  catalog: DemoCatalogProduct[],
  interests: DemoCustomerSpec["interests"],
): DemoCatalogProduct[] {
  const wanted = catalog.filter((product) => interests.includes(inferDemoInterest(product)));
  return (wanted.length ? wanted : catalog).slice(0, 3);
}

async function ensureDemoCustomers(
  admin: AdminClient,
  catalog: DemoCatalogProduct[],
  locations: Array<{ id: string; name: string }>,
) {
  console.log("Demo customers...");
  const locationHandles = locations.map((location) => deriveLocationHandle(location.name));
  const defaultHomeStore = locationHandles[0] ?? "mosman-boutique";

  for (const [index, spec] of DEMO_CUSTOMERS.entries()) {
    const products = productsForInterests(catalog, spec.interests);
    const productTitles = products.map((product) => product.title).join(", ") || "current Elka pieces";
    const homeStoreTag = `${ELKA.tagPrefixes.homeStore}${locationHandles[index % Math.max(locationHandles.length, 1)] ?? defaultHomeStore}`;
    const tags = [
      "demo-clienteling",
      ...spec.tags,
      ...spec.interests.map((interest) => `${ELKA.tagPrefixes.interest}${interest}`),
      homeStoreTag,
    ];
    const note = `Demo clienteling profile seeded from current Elka catalogue. Recent in-store conversation referenced: ${productTitles}.`;
    const existing = await call<{
      customers: { edges: Array<{ node: { id: string; displayName: string; tags: string[] } }> };
    }>(admin, DEMO_CUSTOMER_BY_EMAIL_QUERY, {
      query: `email:${spec.email}`,
    });

    let customer = existing.customers.edges[0]?.node ?? null;
    if (!customer) {
      const created = await call<{
        customerCreate: {
          customer: { id: string; displayName: string; tags: string[] } | null;
          userErrors: UserError[];
        };
      }>(admin, CUSTOMER_CREATE_MUTATION, {
        input: {
          firstName: spec.firstName,
          lastName: spec.lastName,
          email: spec.email,
          phone: spec.phone,
          tags,
          note,
        },
      });
      logUserErrors(`customerCreate(${spec.email})`, created.customerCreate.userErrors);
      customer = created.customerCreate.customer;
    } else {
      await call(admin, TAGS_ADD_MUTATION, { id: customer.id, tags });
      const updated = await call<{
        customerUpdate: {
          customer: { id: string; displayName: string } | null;
          userErrors: UserError[];
        };
      }>(admin, CUSTOMER_UPDATE_MUTATION, {
        input: {
          id: customer.id,
          note,
        },
      });
      logUserErrors(`customerUpdate(${spec.email})`, updated.customerUpdate.userErrors);
    }

    if (!customer) continue;
    if (!spec.tags.includes(ELKA.tags.lapsed)) {
      await call(admin, TAGS_REMOVE_MUTATION, { id: customer.id, tags: [ELKA.tags.lapsed] });
    }
    const lastVisitAt = new Date(
      Date.now() - spec.lastVisitDaysAgo * 24 * 60 * 60 * 1000,
    ).toISOString();
    const set = await call<{
      metafieldsSet: {
        metafields: Array<{ id: string; key: string; value: string }> | null;
        userErrors: UserError[];
      };
    }>(admin, METAFIELDS_SET_MUTATION, {
      metafields: [
        {
          ownerId: customer.id,
          namespace: ELKA.customerMetafieldNamespace,
          key: ELKA.customerMetafieldKeys.sizing,
          type: "json",
          value: JSON.stringify(spec.sizing),
        },
        {
          ownerId: customer.id,
          namespace: ELKA.customerMetafieldNamespace,
          key: ELKA.customerMetafieldKeys.preferredContact,
          type: "single_line_text_field",
          value: spec.preferredContact,
        },
        {
          ownerId: customer.id,
          namespace: ELKA.customerMetafieldNamespace,
          key: ELKA.customerMetafieldKeys.lastVisitAt,
          type: "date_time",
          value: lastVisitAt,
        },
      ],
    });
    logUserErrors(`metafieldsSet(${spec.email})`, set.metafieldsSet.userErrors);
    console.log(`  · ${customer.displayName} → ${tags.join(", ")} · ${productTitles}`);
  }
}

async function cacheLookups(admin: AdminClient, shopDomain: string) {
  console.log("Caching locations, segments...");
  const data = await call<{
    locations: {
      edges: Array<{ node: { id: string; name: string } }>;
    };
    segments: {
      edges: Array<{ node: { id: string; name: string } }>;
    };
  }>(admin, INSTALL_LOOKUPS_QUERY);

  await upsertLocations(
    shopDomain,
    data.locations.edges.map(({ node }) => ({
      id: node.id,
      name: node.name,
      handle: deriveLocationHandle(node.name),
    })),
  );

  await upsertSegmentCache(
    shopDomain,
    data.segments.edges.map(({ node }) => ({ id: node.id, name: node.name })),
  );

  // staffMembers needs read_users which is gated to Plus/Advanced + support
  // approval. On dev stores we skip the upfront cache; the StaffMember table
  // is populated lazily by the orders/* webhooks (Order.staffMember).
  let staffCount = 0;
  try {
    const staffData = await call<{
      staffMembers: {
        edges: Array<{ node: { id: string; name: string; email: string | null } }>;
      };
    }>(admin, INSTALL_STAFF_QUERY);
    await upsertStaffMembers(
      shopDomain,
      staffData.staffMembers.edges.map(({ node }) => ({
        // staffMembers returns GIDs; strip to the numeric portion so the value
        // matches the staff-pick-<staff-id> tag convention.
        id: node.id.split("/").pop() ?? node.id,
        name: node.name,
        email: node.email,
      })),
    );
    staffCount = staffData.staffMembers.edges.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/access denied|read_users/i.test(msg)) {
      console.log(
        "  · staffMembers skipped (read_users not granted — will populate lazily from order webhooks).",
      );
    } else {
      throw err;
    }
  }

  console.log(
    `  · ${staffCount} staff, ${data.locations.edges.length} locations, ${data.segments.edges.length} segments cached.`,
  );
}

async function main() {
  const shopDomain = process.env.SHOPIFY_SEED_SHOP;
  if (!shopDomain) {
    console.error(
      "SHOPIFY_SEED_SHOP is not set. Set it in .env to e.g. elka-dev.myshopify.com",
    );
    process.exit(1);
  }

  const { admin } = await shopify.unauthenticated.admin(shopDomain);
  const adminClient = admin as unknown as AdminClient;

  console.log(`Seeding ${shopDomain}...`);
  // Metaobject definition first so we can pass its GID into the notes
  // metafield's metaobject_definition_id validation.
  const noteDefinitionId = await ensureNoteMetaobject(adminClient);
  await ensureCustomerMetafieldDefinitions(adminClient, noteDefinitionId);
  await ensureShopMetafieldDefinitions(adminClient);
  await ensureSegments(adminClient);
  const catalog = await loadElkaCatalog(adminClient);
  await ensureInterestMapFromCatalog(adminClient, catalog);
  const lookupData = await call<{
    locations: { edges: Array<{ node: { id: string; name: string } }> };
  }>(adminClient, INSTALL_LOOKUPS_QUERY);
  await ensureDemoCustomers(
    adminClient,
    catalog,
    lookupData.locations.edges.map(({ node }) => node),
  );
  await ensureDemoSizing(adminClient);
  await cacheLookups(adminClient, shopDomain);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
