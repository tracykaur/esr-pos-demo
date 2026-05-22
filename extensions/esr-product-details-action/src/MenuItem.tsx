// Target: pos.product-details.action.menu-item.render
// Adds a "Reach out about this drop" entry to the product details action
// menu. Tapping it presents the companion modal (ProductAction.tsx).
import "@shopify/ui-extensions/preact";
import { render } from "preact";

const MenuItem = () => (
  <s-button onClick={() => shopify.action.presentModal()}>Reach out about this drop</s-button>
);

export default async () => {
  render(<MenuItem />, document.body);
};
