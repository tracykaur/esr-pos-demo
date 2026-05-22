import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [hasCart, setHasCart] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const unsubCart = shopify.cart.current.subscribe((cart) => {
      setHasCart((cart?.lineItems?.length ?? 0) > 0);
    });

    const unsubConn = shopify.connectivity.current.subscribe((conn) => {
      setIsConnected(conn.internetConnected === "Connected");
    });

    return () => {
      unsubCart();
      unsubConn();
    };
  }, []);

  return (
    <s-tile
      heading="Manager Discount"
      subheading={hasCart ? "Authorize discount" : "Add items first"}
      disabled={!hasCart || !isConnected}
      onClick={() => shopify.action.presentModal()}
    />
  );
}
