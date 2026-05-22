import "@shopify/ui-extensions/preact";
import { render } from "preact";

const MenuItem = () => (
  <s-button onClick={() => shopify.action.presentModal()}>Client profile</s-button>
);

export default async () => {
  render(<MenuItem />, document.body);
};
