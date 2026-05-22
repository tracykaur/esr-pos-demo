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

function interestLabel(payload: ReachoutPayload): string {
  return payload.interestTag?.replace(/^interest-/, "") ?? "Unmapped";
}

function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <s-box padding="base" inlineSize="48%">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-icon type={icon} tone="info" />
        <s-stack direction="block" gap="none">
          <s-text tone="neutral" type="small">
            {label}
          </s-text>
          <s-text type="strong">{value}</s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

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
            <s-box padding="base">
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-icon type="send" tone="info" />
                  <s-heading>Interested clients</s-heading>
                </s-stack>
                <s-text>
                  Start with customers linked to this store, then use the broader list for a
                  campaign follow-up.
                </s-text>
                <s-stack direction="inline" gap="small">
                  <s-badge tone="info">{interestLabel(state.payload)}</s-badge>
                  <s-badge tone="success">{state.payload.countAtLocation} local</s-badge>
                  <s-badge tone="info">{state.payload.countTotal} nationwide</s-badge>
                </s-stack>
              </s-stack>
            </s-box>

            <s-section heading="At a glance">
              <s-stack direction="inline" gap="small">
                <Metric icon="store" label="This store" value={`${state.payload.countAtLocation}`} />
                <Metric icon="person" label="Nationwide" value={`${state.payload.countTotal}`} />
                <Metric icon="collection" label="Interest" value={interestLabel(state.payload)} />
                <Metric icon="list-bulleted" label="Shown here" value={`${state.payload.customers.length}`} />
              </s-stack>
            </s-section>

            <s-section heading="Suggested workflow">
              <s-stack direction="inline" gap="small">
                <s-box padding="small" inlineSize="31%">
                  <s-stack direction="block" gap="small">
                    <s-icon type="store" tone="info" />
                    <s-text type="strong">Local first</s-text>
                    <s-text tone="neutral" type="small">Contact store-known customers before launch.</s-text>
                  </s-stack>
                </s-box>
                <s-box padding="small" inlineSize="31%">
                  <s-stack direction="block" gap="small">
                    <s-icon type="note" tone="info" />
                    <s-text type="strong">Add context</s-text>
                    <s-text tone="neutral" type="small">Record fit, size, or why they declined.</s-text>
                  </s-stack>
                </s-box>
                <s-box padding="small" inlineSize="31%">
                  <s-stack direction="block" gap="small">
                    <s-icon type="send" tone="info" />
                    <s-text type="strong">Broaden later</s-text>
                    <s-text tone="neutral" type="small">Use national count for campaign follow-up.</s-text>
                  </s-stack>
                </s-box>
              </s-stack>
            </s-section>

            <s-section heading="Matched customers">
              {state.payload.customers.length === 0 && (
                <s-text tone="neutral">No customers in this segment have shopped this store.</s-text>
              )}

              {state.payload.customers.map((c) => (
                <s-box key={c.id} padding="base">
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <s-icon type="person" tone="neutral" />
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
                  </s-stack>
                </s-box>
              ))}
            </s-section>
          </s-stack>
        )}
      </s-scroll-box>
    </s-page>
  );
};

export default async () => {
  render(<Modal />, document.body);
};
