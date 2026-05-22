// Target: pos.product-details.action.render
// Full-screen modal listing the customers in the interest segment matched to
// the current product, sorted by last order date (backend handles sorting).
// Opened from ProductBlock's "View list" button or the action menu item.
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import { api, formatError, readCurrentLocationId, toLocationGid, toProductGid } from "./shared/api";
import { badgeTone } from "./shared/badges";
import type { ReachoutPayload } from "./shared/types";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; payload: ReachoutPayload }
  | { kind: "unmapped" }
  | { kind: "error"; message: string };

const Modal = () => {
  const productGid = toProductGid(shopify.product.id);
  const locationGid = toLocationGid(readCurrentLocationId());
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    api.getReachout(productGid, locationGid).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        if (res.data.interestTag == null) setState({ kind: "unmapped" });
        else setState({ kind: "loaded", payload: res.data });
      } else {
        setState({ kind: "error", message: formatError(res.error) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [productGid, locationGid]);

  return (
    <s-page heading="Client interest">
      <s-scroll-box>
        {state.kind === "loading" && (
          <s-stack direction="block" gap="small">
            <s-spinner accessibilityLabel="Loading reach-out matches" />
            <s-text tone="neutral">Loading customers…</s-text>
          </s-stack>
        )}

        {state.kind === "unmapped" && (
          <s-banner tone="info" heading="No matched audience yet">
            <s-text>
              We don't have enough client interest data for this product yet.
            </s-text>
          </s-banner>
        )}

        {state.kind === "error" && (
          <s-banner tone="critical" heading="Couldn't load matched clients">
            <s-text>{state.message}</s-text>
          </s-banner>
        )}

        {state.kind === "loaded" && (
          <s-stack direction="block" gap="base">
            <s-banner tone="info" heading={`${state.payload.countAtLocation} at this store · ${state.payload.countTotal} nationwide`}>
              <s-text>
                Matched interest: {state.payload.interestTag?.replace(/^interest-/, "") ?? "—"}
              </s-text>
            </s-banner>

            {state.payload.customers.length === 0 && (
              <s-text tone="neutral">No customers in this segment have shopped this store.</s-text>
            )}

            {state.payload.customers.map((c) => (
              <s-box key={c.id} padding="base">
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="small">
                    <s-text type="strong">{c.displayName}</s-text>
                    {c.badges.map((b) => (
                      <s-badge key={b} tone={badgeTone(b)}>
                        {b}
                      </s-badge>
                    ))}
                  </s-stack>
                  <s-text tone="neutral">
                    {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}
                  </s-text>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-scroll-box>
    </s-page>
  );
};

export default async () => {
  render(<Modal />, document.body);
};
