import prisma from "~/db.server";
import { deriveLocationHandle } from "./constants";

// Cached lookups for staff and locations. Populated by the seed script and
// refreshed on demand. Architect §5.3a: "resolves staff-name and
// location-name from cached lookups (staff: staffMembers(first:250) on app
// install; locations: locations(first:50) on app install) to avoid N+1".

export type StaffLookup = { id: string; name: string; email?: string | null };
export type LocationLookup = { id: string; handle: string; name: string };

export async function listStaff(shop: string): Promise<StaffLookup[]> {
  return prisma.staffMember.findMany({
    where: { shop },
    select: { id: true, name: true, email: true },
  });
}

export async function staffById(shop: string, id: string | null | undefined) {
  if (!id) return null;
  return prisma.staffMember.findUnique({ where: { id } });
}

export async function listLocations(shop: string): Promise<LocationLookup[]> {
  return prisma.location.findMany({
    where: { shop },
    select: { id: true, handle: true, name: true },
  });
}

export async function locationByHandle(shop: string, handle: string) {
  return prisma.location.findFirst({ where: { shop, handle } });
}

export function normalizeLocationGid(id: string | null | undefined) {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/Location/${trimmed}`;
}

export async function locationById(shop: string, id: string | null | undefined) {
  const gid = normalizeLocationGid(id);
  if (!gid) return null;
  return prisma.location.findUnique({ where: { id: gid } });
}

export async function upsertStaffMembers(
  shop: string,
  members: ReadonlyArray<{ id: string; name: string; email?: string | null }>,
) {
  await prisma.$transaction(
    members.map((m) =>
      prisma.staffMember.upsert({
        where: { id: m.id },
        create: { id: m.id, shop, name: m.name, email: m.email ?? null },
        update: { shop, name: m.name, email: m.email ?? null },
      }),
    ),
  );
}

export async function upsertLocations(
  shop: string,
  locations: ReadonlyArray<{ id: string; name: string; handle?: string }>,
) {
  await prisma.$transaction(
    locations.map((loc) => {
      const handle = loc.handle ?? deriveLocationHandle(loc.name);
      return prisma.location.upsert({
        where: { id: loc.id },
        create: { id: loc.id, shop, handle, name: loc.name },
        update: { shop, handle, name: loc.name },
      });
    }),
  );
}

export async function upsertSegmentCache(
  shop: string,
  segments: ReadonlyArray<{ id: string; name: string }>,
) {
  await prisma.$transaction(
    segments.map((s) =>
      prisma.segmentCache.upsert({
        where: { id: s.id },
        create: { id: s.id, shop, name: s.name },
        update: { shop, name: s.name },
      }),
    ),
  );
}

export async function segmentByName(shop: string, name: string) {
  return prisma.segmentCache.findFirst({ where: { shop, name } });
}
