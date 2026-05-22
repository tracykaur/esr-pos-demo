// Target: pos.home.tile.render
// Smart-grid tile. Shows the attached customer's badge + name when a cart
// has a customer; otherwise prompts staff to tap and search.
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import { api, toCustomerGid } from "./shared/api";
import type { Badge } from "./shared/types";

type TileState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; displayName: string; badges: Badge[] }
  | { kind: "error"; message: string };

type CartCustomerShape = {
  customer?: { id?: number } | null;
  customerId?: number | null;
};

function readCustomerId(): number | null {
  const cart = shopify.cart.current.value as unknown as CartCustomerShape;
  return cart?.customer?.id ?? cart?.customerId ?? null;
}

function tileTone(state: TileState): "auto" | "neutral" | "accent" {
  if (state.kind !== "loaded") return "auto";
  if (state.badges.includes("Concierge")) return "accent";
  if (state.badges.includes("VIP")) return "accent";
  if (state.badges.includes("Lapsed")) return "neutral";
  return "auto";
}

function subheadingForLoaded(displayName: string, badges: Badge[]): string {
  if (badges.includes("Concierge")) return `Concierge VIP · ${displayName}`;
  if (badges.includes("VIP")) return `VIP · ${displayName}`;
  if (badges.includes("Lapsed")) return `Lapsed · ${displayName}`;
  if (badges.length === 0) return `Attached · ${displayName}`;
  return `${badges.join(" · ")} — ${displayName}`;
}

const Tile = () => {
  const [customerId, setCustomerId] = useState<number | null>(readCustomerId());
  const [state, setState] = useState<TileState>({ kind: "idle" });

  useEffect(() => {
    const unsubscribe = shopify.cart.current.subscribe(() => {
      setCustomerId(readCustomerId());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (customerId == null) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    api.getCustomer(toCustomerGid(customerId)).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setState({ kind: "loaded", displayName: res.data.displayName, badges: res.data.badges });
      } else {
        setState({ kind: "error", message: res.error.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  let subheading = "Search or attach a client";
  if (state.kind === "loading") subheading = "Loading customer…";
  else if (state.kind === "loaded") subheading = subheadingForLoaded(state.displayName, state.badges);
  else if (state.kind === "error") subheading = "Tap to search";

  return (
    <s-tile
      heading="Clienteling"
      subheading={subheading}
      tone={tileTone(state)}
      onClick={() => {
        shopify.action.presentModal();
      }}
    />
  );
};

export default async () => {
  render(<Tile />, document.body);
};
