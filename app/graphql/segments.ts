export const SEGMENT_MEMBERS_QUERY = /* GraphQL */ `
  query SegmentMembers($id: ID!, $first: Int!, $after: String) {
    customerSegmentMembers(segmentId: $id, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          displayName
          defaultEmailAddress {
            emailAddress
          }
          defaultPhoneNumber {
            phoneNumber
          }
          amountSpent {
            amount
            currencyCode
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const CUSTOMERS_COUNT_QUERY = /* GraphQL */ `
  query ReachoutCount($q: String!) {
    customersCount(query: $q) {
      count
      precision
    }
  }
`;

export const PRODUCT_PRIMARY_COLLECTION_QUERY = /* GraphQL */ `
  query ProductCollections($id: ID!) {
    product(id: $id) {
      id
      title
      vendor
      productType
      tags
      collections(first: 10) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  }
`;

export const SHOP_METAFIELD_QUERY = /* GraphQL */ `
  query ShopMetafield($namespace: String!, $key: String!) {
    shop {
      metafield(namespace: $namespace, key: $key) {
        id
        value
        jsonValue
      }
    }
  }
`;
