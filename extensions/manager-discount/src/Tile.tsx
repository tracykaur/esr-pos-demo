import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [hasCart, setHasCart] = useState(false);

  useEffect(() => {
    const unsub = shopify.cart.current.subscribe((cart) => {
      setHasCart((cart?.lineItems?.length ?? 0) > 0);
    });
    return () => unsub();
  }, []);

  return (
    <s-tile
      heading="Manager Discount"
      subheading={hasCart ? "Authorize discount" : "Add items first"}
      disabled={!hasCart}
      onClick={() => shopify.action.presentModal()}
    />
  );
}
