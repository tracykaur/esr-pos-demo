export const LOCATION_BY_ID_QUERY = /* GraphQL */ `
  query LocationById($id: ID!) {
    location(id: $id) {
      id
      name
    }
  }
`;
