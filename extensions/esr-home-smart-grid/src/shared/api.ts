import { BACKEND_URL } from "./config";
import type {
  ApiError,
  ApiResponse,
  ClientelingPayload,
  ClientelingSearchResult,
  ReachoutPayload,
} from "./types";

const REQUEST_TIMEOUT_MS = 10_000;

type ApiFailure = { ok: false; error: ApiError };

function isApiFailure(value: unknown): value is ApiFailure {
  return Boolean(value) && typeof value === "object" && "ok" in value && value.ok === false;
}

function timeoutError(label: string): ApiFailure {
  return {
    ok: false,
    error: {
      code: "INTERNAL",
      message: `${label} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`,
    },
  };
}

async function withTimeout<T>(label: string, promise: Promise<T>): Promise<T | ApiFailure> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ApiFailure>((resolve) => {
    timeoutId = setTimeout(() => resolve(timeoutError(label)), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Auth: every call passes a fresh session token in the Authorization header.
// `shopify.session.getSessionToken()` can resolve to undefined when the staff
// member lacks app permissions (per the Session API docs). The backend will
// reject with UNAUTHENTICATED, but we short-circuit here to avoid a network
// round-trip when the token is missing.
async function authedFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  let token: string | undefined;
  try {
    const tokenResult = await withTimeout("POS session token", shopify.session.getSessionToken());
    if (isApiFailure(tokenResult)) {
      return tokenResult;
    }
    token = tokenResult as string | undefined;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Could not obtain a session token from POS.",
        details: { reason: String(err) },
      },
    };
  }

  if (!token) {
    return {
      ok: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "This staff member does not have permission to use the ESR Clienteling app.",
      },
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }

  const fullUrl = path.startsWith("http") ? path : `${BACKEND_URL}${path}`;
  try {
    const fetchResult = await withTimeout(
      `Backend request to ${fullUrl}`,
      fetch(fullUrl, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }),
    );
    if (isApiFailure(fetchResult)) {
      return fetchResult;
    }
    const res = fetchResult as Response;
    const rawText = await res.text();
    let parsed: unknown = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object" && "ok" in (parsed as Record<string, unknown>)) {
      return parsed as ApiResponse<T>;
    }
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: `HTTP ${res.status} ${res.statusText} from ${fullUrl}`,
        details: {
          url: fullUrl,
          status: res.status,
          statusText: res.statusText,
          contentType: res.headers.get("content-type") ?? "(none)",
          bodyPreview: rawText.slice(0, 400),
        },
      },
    };
  } catch (err) {
    const e = err as { name?: string; message?: string; stack?: string };
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: `fetch threw: ${e.name ?? "Error"}: ${e.message ?? String(err)} (url=${fullUrl})`,
        details: {
          url: fullUrl,
          errorName: e.name,
          errorMessage: e.message,
          reason: String(err),
        },
      },
    };
  }
}

export const api = {
  searchCustomers: (q: string, limit = 20) =>
    authedFetch<ClientelingSearchResult[]>(
      `/api/customer/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  getCustomer: (id: string) =>
    authedFetch<ClientelingPayload>(`/api/customer/${encodeGid(id)}/clienteling`),

  addNote: (id: string, body: { body: string; storeId: string; authorId: string }) =>
    authedFetch<{ id: string }>(`/api/customer/${encodeGid(id)}/notes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  recordVisit: (id: string, body: { staffId: string; storeId: string }) =>
    authedFetch<{ ok: true }>(`/api/customer/${encodeGid(id)}/visit`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateProfile: (
    id: string,
    body: {
      sizing: Partial<Record<"top" | "bottom" | "dress" | "shoe" | "bra" | "fit", string>>;
      preferredContact: "sms" | "email" | "none";
    },
  ) =>
    authedFetch<{
      sizing: Partial<Record<"top" | "bottom" | "dress" | "shoe" | "bra" | "fit", string>>;
      preferredContact: "sms" | "email" | "none";
    }>(`/api/customer/${encodeGid(id)}/profile`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getReachout: (productId: string, locationGid: string) =>
    authedFetch<ReachoutPayload>(
      `/api/products/${encodeGid(productId)}/concierge-reachout?locationId=${encodeURIComponent(locationGid)}`,
    ),
};

// Customer/product IDs in the POS context arrive as numbers; the backend
// uniformly accepts GIDs. We normalise to GIDs at the call site so the
// fetch paths match the architect's routes.
export function toCustomerGid(numericId: number | string): string {
  if (typeof numericId === "string" && numericId.startsWith("gid://")) return numericId;
  return `gid://shopify/Customer/${numericId}`;
}

export function toProductGid(numericId: number | string): string {
  if (typeof numericId === "string" && numericId.startsWith("gid://")) return numericId;
  return `gid://shopify/Product/${numericId}`;
}

export function toLocationGid(numericId: number | string | null | undefined): string {
  if (typeof numericId === "string" && numericId.startsWith("gid://")) return numericId;
  if (numericId == null || String(numericId).trim() === "") return "";
  return `gid://shopify/Location/${numericId}`;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object";
}

function readPath(root: unknown, path: string[]): unknown {
  let current = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function firstPresentString(values: unknown[]): string {
  const found = values.find((value) => value != null && String(value).trim().length > 0);
  return found == null ? "" : String(found);
}

export function readCurrentStaffId(): string {
  const pos = shopify as unknown as UnknownRecord;
  const session = shopify.session.currentSession as unknown;
  return firstPresentString([
    readPath(session, ["staffMemberId"]),
    readPath(session, ["userId"]),
    readPath(pos, ["staffMember", "id"]),
    readPath(pos, ["user", "id"]),
  ]);
}

export function readCurrentLocationId(): string {
  const pos = shopify as unknown as UnknownRecord;
  const session = shopify.session.currentSession as unknown;
  return firstPresentString([
    readPath(session, ["locationId"]),
    readPath(session, ["location", "id"]),
    readPath(pos, ["location", "id"]),
    readPath(pos, ["device", "locationId"]),
    readPath(pos, ["device", "location", "id"]),
  ]);
}

export function describePosContext(): string {
  const pos = shopify as unknown as UnknownRecord;
  const session = shopify.session.currentSession as unknown;
  const sessionKeys = isRecord(session) ? Object.keys(session).sort().join(", ") : typeof session;
  const topLevelKeys = Object.keys(pos).sort().join(", ");
  return `POS context missing location. session keys: ${sessionKeys || "(none)"}; shopify keys: ${topLevelKeys || "(none)"}`;
}

// Extract the numeric portion of a customer GID for shopify.cart.setCustomer({ id })
// which requires a numeric id.
export function gidToNumericId(gid: string): number {
  const tail = gid.split("/").pop() ?? "";
  const n = Number(tail);
  if (!Number.isFinite(n)) throw new Error(`Unparseable GID: ${gid}`);
  return n;
}

// Route paths URL-encode the full GID (which contains slashes) so the backend
// can match `/api/customer/:id/...` cleanly.
function encodeGid(gid: string): string {
  return encodeURIComponent(gid);
}

export function formatError(err: ApiError): string {
  switch (err.code) {
    case "UNAUTHENTICATED":
      return "Sign in required — ask a manager to grant app access.";
    case "NOT_FOUND":
      return "Customer not found.";
    case "SEGMENT_NOT_CONFIGURED":
      return "Reach-out segment is not set up in admin yet.";
    case "RATE_LIMITED":
      return "Too many requests — wait a moment and try again.";
    default: {
      const base = err.message || "Something went wrong.";
      if (err.details && typeof err.details === "object") {
        try {
          return `${base}\n${JSON.stringify(err.details, null, 2)}`;
        } catch {
          return base;
        }
      }
      return base;
    }
  }
}
