// staffMembers requires read_users (Plus/Advanced only, support-approval gated)
// so we split it off — the seed runs it best-effort and the StaffMember cache
// is also populated lazily from POS order webhooks (Order.staffMember).
export const INSTALL_LOOKUPS_QUERY = /* GraphQL */ `
  query InstallLookups {
    locations(first: 50) {
      edges {
        node {
          id
          name
          address {
            city
            province
            countryCode
          }
        }
      }
    }
    segments(first: 100) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

export const INSTALL_STAFF_QUERY = /* GraphQL */ `
  query InstallStaff {
    staffMembers(first: 250) {
      edges {
        node {
          id
          name
          email
        }
      }
    }
  }
`;

export const CREATE_METAFIELD_DEFINITION_MUTATION = /* GraphQL */ `
  mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const CREATE_METAOBJECT_DEFINITION_MUTATION = /* GraphQL */ `
  mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        name
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const GET_METAOBJECT_DEFINITION_BY_TYPE_QUERY = /* GraphQL */ `
  query MetaobjectDefinitionByType($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      type
    }
  }
`;

export const CREATE_SEGMENT_MUTATION = /* GraphQL */ `
  mutation CreateSegment($name: String!, $query: String!) {
    segmentCreate(name: $name, query: $query) {
      segment {
        id
        name
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const DISCOUNT_AUTOMATIC_APP_CREATE_MUTATION = /* GraphQL */ `
  mutation DiscountAutomaticAppCreate(
    $automaticAppDiscount: DiscountAutomaticAppInput!
  ) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount {
        discountId
        title
        status
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const LIST_SHOPIFY_FUNCTIONS_QUERY = /* GraphQL */ `
  query VipFunction {
    shopifyFunctions(first: 25) {
      edges {
        node {
          id
          title
          handle
          apiType
          apiVersion
          app {
            id
          }
        }
      }
    }
  }
`;
