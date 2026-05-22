import { json } from "@remix-run/node";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL";

// POS UI extensions run on cdn.shopify.com and fetch our tunnel — cross-origin.
// Allow any origin in dev; the only auth is the Bearer session token.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
  "Access-Control-Max-Age": "600",
};

function mergeHeaders(init?: ResponseInit): ResponseInit {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return { ...init, headers };
}

export function errorJson(
  code: ErrorCode,
  message: string,
  init: ResponseInit & { details?: unknown } = {},
) {
  const status =
    init.status ??
    ({
      BAD_REQUEST: 400,
      UNAUTHENTICATED: 401,
      NOT_FOUND: 404,
      VALIDATION_FAILED: 422,
      RATE_LIMITED: 429,
      UPSTREAM_ERROR: 502,
      INTERNAL: 500,
    } satisfies Record<ErrorCode, number>)[code];
  const { details, ...rest } = init;
  return json(
    { ok: false, error: { code, message, details } },
    mergeHeaders({ ...rest, status }),
  );
}

export function okJson<T>(data: T, init?: ResponseInit) {
  return json({ ok: true, data }, mergeHeaders(init));
}
