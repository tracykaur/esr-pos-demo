// All Admin GraphQL operations the backend uses, in one place. Every
// operation in this file has been validated against the Shopify schema via
// `mcp__shopify-dev-mcp__validate_graphql_codeblocks`.

export const CUSTOMER_SEARCH_QUERY = /* GraphQL */ `
  query CustomerSearch($query: String!, $first: Int!) {
    customers(query: $query, first: $first) {
      edges {
        node {
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
      }
    }
  }
`;

export const CUSTOMER_CLIENTELING_QUERY = /* GraphQL */ `
  query CustomerClienteling(
    $id: ID!
    $notesKey: String!
    $sizingKey: String!
    $lastStaffKey: String!
    $lastVisitKey: String!
    $contactKey: String!
    $cnamespace: String!
  ) {
    products(first: 30, query: "vendor:'Early Settler' status:active", sortKey: TITLE) {
      edges {
        node {
          id
          title
          vendor
          productType
          tags
          handle
          featuredMedia {
            preview {
              image {
                url(transform: { maxWidth: 300, maxHeight: 300 })
                altText
              }
            }
          }
          collections(first: 5) {
            edges {
              node {
                id
                title
                handle
              }
            }
          }
          variants(first: 25) {
            edges {
              node {
                id
                title
                price
                inventoryQuantity
              }
            }
          }
        }
      }
    }
    customer(id: $id) {
      id
      displayName
      defaultEmailAddress {
        emailAddress
      }
      defaultPhoneNumber {
        phoneNumber
      }
      tags
      amountSpent {
        amount
        currencyCode
      }
      numberOfOrders
      sizing: metafield(namespace: $cnamespace, key: $sizingKey) {
        value
      }
      lastStaff: metafield(namespace: $cnamespace, key: $lastStaffKey) {
        value
      }
      lastVisit: metafield(namespace: $cnamespace, key: $lastVisitKey) {
        value
      }
      contact: metafield(namespace: $cnamespace, key: $contactKey) {
        value
      }
      notes: metafield(namespace: $cnamespace, key: $notesKey) {
        references(first: 10) {
          nodes {
            ... on Metaobject {
              id
              handle
              fields {
                key
                value
              }
            }
          }
        }
      }
      orders(first: 5, sortKey: PROCESSED_AT, reverse: true) {
        edges {
          node {
            id
            name
            processedAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

export const CUSTOMER_TAGS_QUERY = /* GraphQL */ `
  query CustomerTags($id: ID!) {
    customer(id: $id) {
      id
      tags
    }
  }
`;

export const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation MetafieldsSetVisit($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
        value
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAOBJECT_CREATE_MUTATION = /* GraphQL */ `
  mutation CreateNoteMetaobject($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const TAGS_ADD_MUTATION = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const TAGS_REMOVE_MUTATION = /* GraphQL */ `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;
