// Centralized constants — these are the contracts between this backend, the
// POS UI Extension (agent-3), and the Functions (agent-4). Changing any of
// these strings is a breaking change. See architect doc §2.

export const ELKA = {
  // Customer-level clienteling data — namespace resolves to the app's reserved
  // namespace at runtime ($app:esr -> app--<id>--clienteling).
  customerMetafieldNamespace: "$app:esr",
  customerMetafieldKeys: {
    notes: "notes",
    sizing: "sizing",
    lastStaffId: "last_staff_id",
    lastVisitAt: "last_visit_at",
    preferredContact: "preferred_contact",
  },

  // Shop-level configuration.
  shopMetafieldNamespace: "$app:esr",
  shopMetafieldKeys: {
    interestMap: "interest_map",
    vipPerkPct: "vip_perk_pct",
    appConfig: "app_config",
  },

  // Function-config metafield (the discount/customization owns it).
  functionConfigNamespace: "$app:config",
  functionConfigKey: "config",

  // Metaobject definition for notes (architect §2.3). Stored as $app:-prefixed
  // type so only this app can mutate it.
  noteMetaobjectType: "$app:esr_note",

  // Customer tags (architect §2.1).
  tags: {
    vip: "vip",
    concierge: "concierge",
    lapsed: "lapsed",
  },
  tagPrefixes: {
    homeStore: "home-store-",
    interest: "interest-",
    staffPick: "staff-pick-",
  },

  // Interest categories — these drive the segment names in §2.5 and the
  // collection-id -> interest tag mapping in $app:esr.interest_map.
  interestCategories: ["knitwear", "denim", "tailoring", "outerwear", "accessories"] as const,

  // Segment names (architect §2.5) — Sidekick refers to these verbatim, do not
  // change without also updating the Shop Brain doc in §6.1.
  segmentNames: {
    vipActive: "VIP — Active",
    concierge: "Concierge",
    lapsedVip: "Lapsed VIP",
    newDropPrefix: "New Drop — ",
  },

  // Lapsed cutoff (days).
  lapsedDays: 180,

  // Function handle (architect §3.1 & §7).
  vipDiscountFunctionHandle: "vip",
} as const;

export type InterestCategory = (typeof ELKA.interestCategories)[number];

export function homeStoreTagFor(locationHandle: string): string {
  return `${ELKA.tagPrefixes.homeStore}${locationHandle}`;
}

export function interestTagFor(category: InterestCategory | string): string {
  return `${ELKA.tagPrefixes.interest}${category}`;
}

export function staffPickTagFor(staffId: string): string {
  return `${ELKA.tagPrefixes.staffPick}${staffId}`;
}

export function deriveLocationHandle(locationName: string): string {
  // Locations don't expose a `handle` in the Admin API, so we slugify the name
  // and use that to form home-store-<handle> tags. Documented in seed script.
  return locationName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function newDropSegmentName(category: InterestCategory | string): string {
  const titled = category.charAt(0).toUpperCase() + category.slice(1);
  return `${ELKA.segmentNames.newDropPrefix}${titled}`;
}
