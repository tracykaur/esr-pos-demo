import { LOCATION_BY_ID_QUERY } from "~/graphql/locations";
import { gql } from "./admin.server";
import { deriveLocationHandle } from "./constants";
import {
  locationById,
  normalizeLocationGid,
  upsertLocations,
  type LocationLookup,
} from "./lookups.server";

type LocationByIdResponse = {
  location: { id: string; name: string } | null;
};

export async function freshLocationById(
  admin: unknown,
  shop: string,
  id: string | null | undefined,
): Promise<LocationLookup | null> {
  const gid = normalizeLocationGid(id);
  if (!gid) return null;

  try {
    const data = await gql<LocationByIdResponse>(admin, LOCATION_BY_ID_QUERY, { id: gid });
    if (data.location) {
      const location = {
        id: data.location.id,
        name: data.location.name,
        handle: deriveLocationHandle(data.location.name),
      };
      await upsertLocations(shop, [location]);
      return location;
    }
  } catch {
    // If Admin lookup fails, fall back to the local cache so POS actions still work.
  }

  return locationById(shop, gid);
}
