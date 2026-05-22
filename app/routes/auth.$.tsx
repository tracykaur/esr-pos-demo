import type { LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "~/shopify.server";

// Catch-all auth route — required by @shopify/shopify-app-remix's OAuth flow.
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}
