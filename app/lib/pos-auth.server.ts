import { authenticate, unauthenticated } from "~/shopify.server";

// Single entry point for POS UI extension calls.
//
// `authenticate.public.pos(request)` validates the Bearer session-token JWT
// and returns `{ sessionToken, cors }`. It does NOT return an admin client —
// that's our job: extract the shop from `sessionToken.dest` and look up the
// stored offline session via `unauthenticated.admin(shop)`.
//
// The POS UI extension MUST send: `Authorization: Bearer <session-token>`
// where the token is obtained via `await shopify.session.getSessionToken()`
// inside the extension.

export async function authenticatePos(request: Request) {
  let sessionToken: { dest?: string };
  try {
    const result = await authenticate.public.pos(request);
    sessionToken = result.sessionToken as { dest?: string };
  } catch (err) {
    if (err instanceof Response) throw err;
    throw new Response(
      JSON.stringify({
        ok: false,
        error: { code: "UNAUTHENTICATED", message: "Invalid POS session token." },
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  const dest = sessionToken.dest;
  if (!dest) {
    throw new Response(
      JSON.stringify({
        ok: false,
        error: { code: "UNAUTHENTICATED", message: "POS session token missing dest claim." },
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  // dest is "https://<shop>.myshopify.com" — we need just the hostname.
  const shop = new URL(dest).hostname;

  // Offline session must exist in storage (created during app install OAuth).
  // If it doesn't, this throws and runRouteOp converts it to a 500 envelope.
  const { admin, session } = await unauthenticated.admin(shop);
  return { admin, session };
}
