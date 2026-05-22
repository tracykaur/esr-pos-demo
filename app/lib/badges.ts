import { ELKA } from "./constants";

export type Badge = "VIP" | "Concierge" | "Lapsed" | "Staff Pick";

export function tagsToBadges(tags: ReadonlyArray<string>): Badge[] {
  const out: Badge[] = [];
  const normalized = tags.map((tag) => tag.toLowerCase());
  if (normalized.includes(ELKA.tags.vip)) out.push("VIP");
  if (normalized.includes(ELKA.tags.concierge)) out.push("Concierge");
  if (normalized.includes(ELKA.tags.lapsed)) out.push("Lapsed");
  if (normalized.some((t) => t.startsWith(ELKA.tagPrefixes.staffPick))) {
    out.push("Staff Pick");
  }
  return out;
}

export function homeStoreHandleFromTags(
  tags: ReadonlyArray<string>,
): string | null {
  const prefix = ELKA.tagPrefixes.homeStore;
  const match = tags.find((t) => t.toLowerCase().startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

export function interestsFromTags(tags: ReadonlyArray<string>): string[] {
  const prefix = ELKA.tagPrefixes.interest;
  return tags
    .filter((t) => t.toLowerCase().startsWith(prefix))
    .map((t) => t.slice(prefix.length).toLowerCase());
}
