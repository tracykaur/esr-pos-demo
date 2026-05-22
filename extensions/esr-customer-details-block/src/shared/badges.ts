import type { Badge } from "./types";

export type BannerTone = "info" | "success" | "warning" | "critical";

// Banner colour follows the brief: gold/accent for concierge, neutral-info for
// VIP, plain (no banner) for everyone else. POS UI only exposes the canonical
// Polaris tones; "warning" is the closest visually-warm/gold available.
export function bannerToneForBadges(badges: Badge[]): BannerTone | null {
  if (badges.includes("Concierge")) return "warning";
  if (badges.includes("VIP")) return "info";
  if (badges.includes("Lapsed")) return "critical";
  return null;
}

export function bannerHeadlineForBadges(badges: Badge[], displayName: string): string {
  if (badges.includes("Concierge") && badges.includes("VIP")) {
    return `${displayName} — Concierge VIP`;
  }
  if (badges.includes("Concierge")) return `${displayName} — Concierge`;
  if (badges.includes("VIP")) return `${displayName} — VIP`;
  if (badges.includes("Lapsed")) return `${displayName} — Lapsed`;
  return displayName;
}

export function badgeTone(badge: Badge): "success" | "info" | "warning" {
  if (badge === "Concierge") return "warning";
  if (badge === "VIP") return "success";
  return "info";
}
