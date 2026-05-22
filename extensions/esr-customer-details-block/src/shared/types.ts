// Mirrors backend/app/shared/types.ts (architect §2.7). Re-declared locally because
// the POS extension is a separate build artifact and cannot import from backend at build time.
// If you change a shape, also change the backend.

export type Badge = "VIP" | "Concierge" | "Lapsed" | "Staff Pick";

export type ClientelingSearchResult = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  badges: Badge[];
};

export type ClientelingEntitlement = {
  id: string;
  label: string;
  status: "active" | "attention";
  description: string;
};

export type CustomerInterest = {
  tag: string;
  label: string;
};

export type ClientelingNote = {
  id: string;
  body: string;
  authorId: string;
  storeId: string;
  createdAt: string;
};

export type DigitalClienteling = {
  browsingHistory: {
    id: string;
    title: string;
    category: string;
    lastViewedAt: string;
    viewCount: number;
    size: string;
    source: string;
    intent: "High" | "Medium" | "Low";
  }[];
  onlineCart: {
    id: string;
    itemCount: number;
    total: string;
    currency: string;
    updatedAt: string;
    items: { id: string; title: string; variant: string; variantId?: number; price: string }[];
  } | null;
  recommendations: {
    id: string;
    title: string;
    reason: string;
    action: string;
  }[];
  reservations: {
    id: string;
    title: string;
    status: string;
    location: string;
    expiresAt: string;
  }[];
  messageDrafts: {
    id: string;
    label: string;
    channel: "sms" | "email";
    body: string;
  }[];
  followUps: {
    id: string;
    priority: "high" | "medium" | "low";
    label: string;
    detail: string;
  }[];
};

export type ClientelingPayload = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  badges: Badge[];
  homeStore: { handle: string; name: string } | null;
  lastStaff: { id: string; name: string } | null;
  lastVisitAt: string | null;
  preferredContact: "sms" | "email" | "none" | null;
  sizing: Partial<Record<"top" | "bottom" | "dress" | "shoe" | "bra" | "fit", string>>;
  entitlements: ClientelingEntitlement[];
  interests: CustomerInterest[];
  amountSpent: { amount: string; currencyCode: string } | null;
  numberOfOrders: number;
  segments: { id: string; name: string }[];
  recentOrders: {
    id: string;
    name: string;
    total: string;
    processedAt: string;
    location: string;
  }[];
  notes: ClientelingNote[];
  digital?: DigitalClienteling;
};

export type ReachoutPayload = {
  productId: string;
  interestTag: string | null;
  segmentId: string | null;
  countAtLocation: number;
  countTotal: number;
  customers: ClientelingSearchResult[];
};

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "SEGMENT_NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "VALIDATION_FAILED"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL";

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
