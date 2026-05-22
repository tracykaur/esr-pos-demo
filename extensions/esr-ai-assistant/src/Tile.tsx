import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

function countCartItems(): number {
  const cart = shopify.cart.current.value as unknown as { lineItems?: unknown[] };
  return cart?.lineItems?.length ?? 0;
}

function Tile() {
  const [count, setCount] = useState(countCartItems());
  useEffect(() => shopify.cart.current.subscribe(() => setCount(countCartItems())), []);
  return (
    <s-tile
      heading="ESR AI"
      subheading={count > 0 ? `${count} cart item${count === 1 ? "" : "s"} · ask AI` : "Styling, perks, outreach"}
      tone="accent"
      onClick={() => shopify.action.presentModal()}
    />
  );
}

export default async () => render(<Tile />, document.body);
