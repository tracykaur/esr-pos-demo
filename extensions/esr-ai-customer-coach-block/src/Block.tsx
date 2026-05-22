import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import { postJson, toCustomerGid } from "./shared/api";

type State = { kind: "loading" } | { kind: "loaded"; name: string; tips: string[] } | { kind: "error"; message: string };

function Block() {
  const customerId = toCustomerGid(shopify.customer.id);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    postJson<{ displayName: string; tips: string[] }>("/api/ai-context", { customerId })
      .then((data) => !cancelled && setState({ kind: "loaded", name: data.displayName, tips: data.tips }))
      .catch((err) => !cancelled && setState({ kind: "error", message: err instanceof Error ? err.message : String(err) }));
    return () => { cancelled = true; };
  }, [customerId]);

  return (
    <s-pos-block>
      <s-section heading="ESR AI coach">
        {state.kind === "loading" && <s-spinner accessibilityLabel="Loading AI tips" />}
        {state.kind === "error" && <s-text tone="critical">{state.message}</s-text>}
        {state.kind === "loaded" && (
          <s-stack direction="block" gap="small">
            <s-text type="strong">Next best tips for {state.name}</s-text>
            {state.tips.slice(0, 4).map((tip) => <s-text key={tip}>• {tip}</s-text>)}
          </s-stack>
        )}
      </s-section>
    </s-pos-block>
  );
}

export default async () => render(<Block />, document.body);
