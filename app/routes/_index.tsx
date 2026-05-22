import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

// Matches the standard Shopify Remix app template. When admin embeds the app
// it loads `<tunnel>/?shop=...&host=...&embedded=1` — we forward to /app which
// runs `authenticate.admin()` and triggers App Bridge's top-frame OAuth escape
// when no session exists.
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return redirect("/app");
}

export default function Index() {
  return null;
}
