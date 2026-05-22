// Target: pos.product-details.block.render
// Shows "new drop reach-out" stats for the current product: which interest
// segment it maps to, how many customers in that segment shop this store,
// and a button to open the action modal listing the actual customers.
//
// Note: block targets disallow s-banner / s-spinner. Status messaging falls
// back to strong-toned text within an s-stack instead.
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import { api, formatError, readCurrentLocationId, toLocationGid, toProductGid } from "./shared/api";
import type { ReachoutPayload } from "./shared/types";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; payload: ReachoutPayload }
  | { kind: "unmapped" }
  | { kind: "error"; message: string };

function interestLabel(payload: ReachoutPayload): string {
  return payload.interestTag?.replace(/^interest-/, "") ?? "Unmapped";
}

function MiniMetric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <s-box padding="small" inlineSize="48%">
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

const Block = () => {
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
    <s-pos-block>
      <s-button
        slot="secondary-actions"
        disabled={state.kind !== "loaded" || state.payload.customers.length === 0}
        onClick={() => shopify.action.presentModal()}
      >
        View list
      </s-button>

      {state.kind === "loading" && <s-text tone="neutral">Loading reach-out matches…</s-text>}

      {state.kind === "unmapped" && (
        <s-stack direction="block" gap="small">
          <s-text type="strong" tone="info">
            No matched audience yet
          </s-text>
          <s-text tone="neutral">
            We don't have enough client interest data for this product yet.
          </s-text>
        </s-stack>
      )}

      {state.kind === "error" && (
        <s-stack direction="block" gap="small">
          <s-text type="strong" tone="critical">
            Client interest unavailable
          </s-text>
          <s-text tone="neutral">{state.message}</s-text>
        </s-stack>
      )}

      {state.kind === "loaded" && (
        <s-stack direction="block" gap="base">
          <s-box padding="base">
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-icon type="send" tone="info" />
                <s-text type="strong">Interested clients</s-text>
              </s-stack>
              <s-text tone="neutral">
                Prioritise local customers who already show interest in {interestLabel(state.payload)}.
              </s-text>
              <s-stack direction="inline" gap="small">
                <s-badge tone="info">{interestLabel(state.payload)}</s-badge>
                <s-badge tone="success">{state.payload.countAtLocation} local</s-badge>
                <s-badge tone="info">{state.payload.countTotal} nationwide</s-badge>
              </s-stack>
            </s-stack>
          </s-box>

          <s-stack direction="inline" gap="small">
            <MiniMetric icon="store" label="This store" value={`${state.payload.countAtLocation}`} />
            <MiniMetric icon="person" label="Nationwide" value={`${state.payload.countTotal}`} />
            <MiniMetric icon="list-bulleted" label="Visible list" value={`${state.payload.customers.length}`} />
            <MiniMetric icon="collection" label="Interest" value={interestLabel(state.payload)} />
          </s-stack>

          <s-text tone="neutral">
            Open the list to contact customers and capture notes against the visit.
          </s-text>
        </s-stack>
      )}
    </s-pos-block>
  );
};

export default async () => {
  render(<Block />, document.body);
};
