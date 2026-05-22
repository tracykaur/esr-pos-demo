// Target: pos.home.modal.render
// The full-screen workflow modal launched from the smart-grid tile.
// Two screens, toggled by local state:
//   1. Search — search-field + results list
//   2. Detail — full clienteling card + Add note / Record visit / Attach actions
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import {
  api,
  describePosContext,
  formatError,
  gidToNumericId,
  readCurrentLocationId,
  readCurrentStaffId,
  toCustomerGid,
} from "./shared/api";
import { bannerHeadlineForBadges, bannerToneForBadges, badgeTone } from "./shared/badges";
import type { ClientelingPayload, ClientelingSearchResult } from "./shared/types";

type Screen =
  | { kind: "search" }
  | { kind: "detail"; payload: ClientelingPayload };

type CartCustomerShape = { customer?: { id?: number } | null; customerId?: number | null };
type SizingKey = "top" | "bottom" | "dress" | "shoe" | "bra" | "fit";
type PreferredContact = "sms" | "email" | "none";
type ProfileDraft = {
  sizing: Record<SizingKey, string>;
  preferredContact: PreferredContact;
};

const SIZING_FIELDS: Array<{ key: SizingKey; label: string; placeholder: string }> = [
  { key: "top", label: "Top", placeholder: "e.g. S / 8" },
  { key: "bottom", label: "Bottom", placeholder: "e.g. 10 / 30" },
  { key: "dress", label: "Dress", placeholder: "e.g. 8" },
  { key: "shoe", label: "Shoe", placeholder: "e.g. 39" },
  { key: "bra", label: "Bra", placeholder: "e.g. 12C" },
  { key: "fit", label: "Fit notes", placeholder: "e.g. relaxed, petite, long inseam" },
];

const CONTACT_OPTIONS: Array<{ value: PreferredContact; label: string }> = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "none", label: "Do not contact" },
];

function profileDraftFromCustomer(c: ClientelingPayload): ProfileDraft {
  return {
    sizing: {
      top: c.sizing?.top ?? "",
      bottom: c.sizing?.bottom ?? "",
      dress: c.sizing?.dress ?? "",
      shoe: c.sizing?.shoe ?? "",
      bra: c.sizing?.bra ?? "",
      fit: c.sizing?.fit ?? "",
    },
    preferredContact: c.preferredContact ?? (c.phone ? "sms" : c.email ? "email" : "none"),
  };
}

function compactSizing(sizing: Record<SizingKey, string>) {
  return Object.fromEntries(
    Object.entries(sizing).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value.length > 0),
  ) as Partial<Record<SizingKey, string>>;
}

function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "Not recorded";
}

function formatSpend(c: ClientelingPayload): string {
  if (!c.amountSpent) return "No spend";
  return `${c.amountSpent.currencyCode} ${c.amountSpent.amount}`;
}

function preferredContact(c: ClientelingPayload): string {
  if (c.preferredContact && c.preferredContact !== "none") return c.preferredContact;
  if (c.preferredContact === "none") return "Do not contact";
  return c.phone ? "sms" : c.email ? "email" : "Not set";
}

function staffBrief(c: ClientelingPayload): string {
  if (c.badges.includes("Concierge")) {
    const perks = c.entitlements.map((e) => e.label.toLowerCase()).slice(0, 2).join(", ");
    return `Recognise immediately. Confirm preferred contact, offer ${perks || "concierge perks"}, then add a visit note.`;
  }
  if (c.badges.includes("VIP")) {
    return "Recognise as VIP, review recent orders, and mention any relevant new drops.";
  }
  if (c.badges.includes("Lapsed")) {
    return "Treat as a win-back visit. Ask what changed and capture a useful follow-up note.";
  }
  return "Attach to cart, capture preferences, and build the clienteling profile from today's visit.";
}

function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <s-box padding="base" inlineSize="48%">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-icon type={icon} tone="info" />
        <s-stack direction="block" gap="none">
          <s-text tone="neutral" type="small">
            {label}
          </s-text>
          <s-text type="strong">{value}</s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function DetailLine({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <s-box padding="small">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-icon type={icon} tone="neutral" />
        <s-text tone="neutral">{label}</s-text>
        <s-text>{value}</s-text>
      </s-stack>
    </s-box>
  );
}

function ActionPrompt({ icon, label, detail }: { icon: string; label: string; detail: string }) {
  return (
    <s-box padding="small" inlineSize="31%">
      <s-stack direction="block" gap="small">
        <s-icon type={icon} tone="info" />
        <s-text type="strong">{label}</s-text>
        <s-text tone="neutral" type="small">
          {detail}
        </s-text>
      </s-stack>
    </s-box>
  );
}

function readAttachedCustomerId(): number | null {
  const cart = shopify.cart.current.value as unknown as CartCustomerShape;
  return cart?.customer?.id ?? cart?.customerId ?? null;
}

const Modal = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientelingSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [screen, setScreen] = useState<Screen>({ kind: "search" });
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({
    sizing: { top: "", bottom: "", dress: "", shoe: "", bra: "", fit: "" },
    preferredContact: "none",
  });

  // If a customer is already attached to the cart, jump straight to their detail screen.
  useEffect(() => {
    const attachedId = readAttachedCustomerId();
    if (attachedId == null) return;
    loadDetail(toCustomerGid(attachedId));
  }, []);

  // Debounce search input — 200ms idle window before hitting backend.
  useEffect(() => {
    if (screen.kind !== "search") return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      const res = await api.searchCustomers(trimmed);
      setSearching(false);
      if (res.ok) {
        setResults(res.data);
        setErrorBanner(null);
      } else {
        setResults([]);
        setErrorBanner(formatError(res.error));
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, screen.kind]);

  async function loadDetail(customerGid: string) {
    setErrorBanner(null);
    const res = await api.getCustomer(customerGid);
    if (res.ok) {
      setScreen({ kind: "detail", payload: res.data });
      setNoteDraft("");
      setNoteOpen(false);
      setProfileOpen(false);
      setProfileDraft(profileDraftFromCustomer(res.data));
    } else {
      setErrorBanner(formatError(res.error));
    }
  }

  async function handleAddNote() {
    if (screen.kind !== "detail") return;
    const body = noteDraft.trim();
    if (!body) return;
    setSavingNote(true);
    const res = await api.addNote(screen.payload.id, {
      body,
      storeId: readCurrentLocationId(),
      authorId: readCurrentStaffId(),
    });
    setSavingNote(false);
    if (res.ok) {
      shopify.toast.show("Note saved");
      setNoteDraft("");
      setNoteOpen(false);
      // Refresh detail so the new note appears at the top.
      loadDetail(screen.payload.id);
    } else {
      setErrorBanner(formatError(res.error));
    }
  }

  async function handleRecordVisit() {
    if (screen.kind !== "detail") return;
    const staffId = readCurrentStaffId();
    const storeId = readCurrentLocationId();
    if (!staffId || !storeId) {
      const missing = !staffId ? "staff member" : "store location";
      const detail = !storeId ? ` ${describePosContext()}` : "";
      setErrorBanner(`Could not record visit: POS did not provide ${missing}.${detail}`);
      return;
    }
    const res = await api.recordVisit(screen.payload.id, {
      staffId,
      storeId,
    });
    if (res.ok) {
      shopify.toast.show("Visit recorded");
      loadDetail(screen.payload.id);
    } else {
      setErrorBanner(formatError(res.error));
    }
  }

  async function handleSaveProfile() {
    if (screen.kind !== "detail") return;
    setSavingProfile(true);
    const res = await api.updateProfile(screen.payload.id, {
      sizing: compactSizing(profileDraft.sizing),
      preferredContact: profileDraft.preferredContact,
    });
    setSavingProfile(false);
    if (res.ok) {
      shopify.toast.show("Sizing and contact saved");
      setProfileOpen(false);
      loadDetail(screen.payload.id);
    } else {
      setErrorBanner(formatError(res.error));
    }
  }

  async function handleAttachToCart() {
    if (screen.kind !== "detail") return;
    try {
      const numericId = gidToNumericId(screen.payload.id);
      await shopify.cart.setCustomer({ id: numericId });
      shopify.toast.show(`Attached ${screen.payload.displayName} to cart`);
    } catch (err) {
      setErrorBanner(`Could not attach to cart: ${String(err)}`);
    }
  }

  async function handleAddOnlineCartToCart() {
    if (screen.kind !== "detail" || !screen.payload.digital?.onlineCart) return;
    const items = screen.payload.digital.onlineCart.items.filter((item) => item.variantId);
    if (items.length === 0) {
      shopify.toast.show("No online cart variants available to add");
      return;
    }
    try {
      for (const item of items) {
        await shopify.cart.addLineItem(item.variantId!, 1);
      }
      shopify.toast.show(`Added ${items.length} online cart item${items.length === 1 ? "" : "s"}`);
    } catch (err) {
      setErrorBanner(`Could not add online cart items: ${String(err)}`);
    }
  }

  // ───── Search screen ─────
  if (screen.kind === "search") {
    return (
      <s-page heading="Clienteling">
        <s-scroll-box>
          <s-box padding="base">
            <s-stack direction="block" gap="base">
            {errorBanner && (
              <s-banner tone="critical" heading="Something went wrong">
                <s-text>{errorBanner}</s-text>
              </s-banner>
            )}
            <s-search-field
              placeholder="Search by name, phone, or email"
              value={query}
              onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
            />
            {searching && <s-spinner accessibilityLabel="Searching" />}
            {!searching && results.length === 0 && query.trim().length >= 2 && (
              <s-text tone="neutral">No customers match "{query.trim()}".</s-text>
            )}
            {results.map((r) => (
              <s-clickable key={r.id} onClick={() => loadDetail(r.id)}>
                <s-box padding="base">
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small">
                      <s-text type="strong">{r.displayName}</s-text>
                      {r.badges.map((b) => (
                        <s-badge key={b} tone={badgeTone(b)}>
                          {b}
                        </s-badge>
                      ))}
                    </s-stack>
                    <s-text tone="neutral">
                      {[r.phone, r.email].filter(Boolean).join(" · ") || "No contact details"}
                    </s-text>
                  </s-stack>
                </s-box>
              </s-clickable>
            ))}
            </s-stack>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  // ───── Detail screen ─────
  const c = screen.payload;
  const bannerTone = bannerToneForBadges(c.badges);
  const sizingPairs = Object.entries(c.sizing ?? {}).filter(([, v]) => Boolean(v));
  const entitlements = c.entitlements ?? [];
  const segments = c.segments ?? [];
  const interests = c.interests ?? [];
  const orderCount = `${c.numberOfOrders ?? 0} orders`;
  const homeStore = c.homeStore?.name ?? "Group-wide";
  const latestOrder = c.recentOrders[0];
  const latestNote = c.notes[0];
  const digital = c.digital;

  return (
    <s-page heading={c.displayName}>
      <s-scroll-box>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
          {errorBanner && (
            <s-banner tone="critical" heading="Something went wrong">
              <s-text>{errorBanner}</s-text>
            </s-banner>
          )}

          <s-box padding="base">
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-icon
                  type={c.badges.includes("Concierge") ? "star-filled" : "person-filled"}
                  tone={bannerTone ?? "info"}
                />
                <s-heading>{bannerHeadlineForBadges(c.badges, c.displayName)}</s-heading>
              </s-stack>
              <s-text>{staffBrief(c)}</s-text>
              <s-stack direction="inline" gap="small">
                {c.badges.map((b) => (
                  <s-badge key={b} tone={badgeTone(b)}>
                    {b}
                  </s-badge>
                ))}
                {c.preferredContact && c.preferredContact !== "none" && (
                  <s-badge tone="info">Prefers {c.preferredContact}</s-badge>
                )}
              </s-stack>
            </s-stack>
          </s-box>

          {entitlements.length > 0 && (
            <s-section heading="Next best actions">
              <s-stack direction="inline" gap="small">
                {entitlements.slice(0, 3).map((entitlement) => (
                  <ActionPrompt
                    key={entitlement.id}
                    icon={
                      entitlement.id.includes("delivery")
                        ? "delivery"
                        : entitlement.id.includes("tailoring")
                          ? "edit"
                          : entitlement.id.includes("early")
                            ? "star-circle"
                            : "phone-out"
                    }
                    label={entitlement.label}
                    detail={entitlement.status === "attention" ? "Needs follow-up" : "Available now"}
                  />
                ))}
              </s-stack>
            </s-section>
          )}

          <s-tabs defaultValue="brief">
            <s-tab-list>
              <s-tab controls="brief">Brief</s-tab>
              <s-tab controls="history">History</s-tab>
              <s-tab controls="online">Online</s-tab>
              <s-tab controls="notes">Notes</s-tab>
            </s-tab-list>

            <s-tab-panel id="brief">
              <s-stack direction="block" gap="base">
                <s-section heading="At a glance">
                  <s-stack direction="inline" gap="small">
                    <Metric icon="money" label="Lifetime" value={formatSpend(c)} />
                    <Metric icon="order" label="Orders" value={orderCount} />
                    <Metric icon="store" label="Home store" value={homeStore} />
                    <Metric icon="phone-out" label="Contact" value={preferredContact(c)} />
                  </s-stack>
                  <s-divider />
                  <s-stack direction="block" gap="small">
                    <DetailLine icon="location" label="Recognition" value="Group-wide across Elka stores" />
                    <DetailLine icon="clock" label="Last visit" value={formatDate(c.lastVisitAt)} />
                    <DetailLine icon="person" label="Last staff" value={c.lastStaff?.name ?? "Not recorded"} />
                    {latestOrder && (
                      <DetailLine
                        icon="receipt"
                        label="Latest order"
                        value={`${latestOrder.name} · ${latestOrder.currency} ${latestOrder.total}`}
                      />
                    )}
                  </s-stack>
                </s-section>

                {segments.length > 0 && (
                  <s-section heading={`Clienteling lenses (${segments.length})`}>
                    <s-stack direction="inline" gap="small">
                      {segments.map((s) => (
                        <s-badge key={s.id} tone="info">
                          {s.name}
                        </s-badge>
                      ))}
                    </s-stack>
                  </s-section>
                )}

                {interests.length > 0 && (
                  <s-section heading="Product interests">
                    <s-stack direction="inline" gap="small">
                      {interests.map((interest) => (
                        <s-badge key={interest.tag} tone="info">
                          {interest.label}
                        </s-badge>
                      ))}
                    </s-stack>
                  </s-section>
                )}

                {sizingPairs.length > 0 && (
                  <s-section heading="Sizing">
                    <s-stack direction="inline" gap="small">
                      {sizingPairs.map(([k, v]) => (
                        <s-badge key={k} tone="info">
                          {k}: {v}
                        </s-badge>
                      ))}
                    </s-stack>
                  </s-section>
                )}
              </s-stack>
            </s-tab-panel>

            <s-tab-panel id="history">
              <s-stack direction="block" gap="base">
                <s-section heading="Recent orders">
                  {c.recentOrders.length > 0 ? (
                    <s-stack direction="block" gap="small">
                      {c.recentOrders.map((o) => (
                        <s-box key={o.id} padding="base">
                          <s-stack direction="inline" gap="base" alignItems="center">
                            <s-icon type="receipt" tone="neutral" />
                            <s-stack direction="block" gap="none">
                              <s-text type="strong">{o.name}</s-text>
                              <s-text tone="neutral">
                                {`${o.currency} ${o.total} · ${o.processedAt.slice(0, 10)} · ${o.location}`}
                              </s-text>
                            </s-stack>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  ) : (
                    <s-text tone="neutral">No recent orders.</s-text>
                  )}
                </s-section>

                {digital && (
                  <s-section heading="Recently viewed online">
                    <s-stack direction="block" gap="small">
                      {digital.browsingHistory.slice(0, 3).map((item) => (
                        <s-box key={item.id} padding="base">
                          <s-stack direction="inline" gap="base" alignItems="center">
                            <s-icon type="view" tone={item.intent === "High" ? "warning" : "neutral"} />
                            <s-stack direction="block" gap="none">
                              <s-text type="strong">{item.title}</s-text>
                              <s-text tone="neutral">
                                {`${item.category} · ${item.viewCount} views · size ${item.size} · ${item.source}`}
                              </s-text>
                            </s-stack>
                            <s-badge tone={item.intent === "High" ? "warning" : "info"}>
                              {item.intent} intent
                            </s-badge>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  </s-section>
                )}
              </s-stack>
            </s-tab-panel>

            <s-tab-panel id="online">
              {digital ? (
                <s-stack direction="block" gap="base">
                  {digital.onlineCart && (
                    <s-section heading="Online cart">
                      <s-box padding="base">
                        <s-stack direction="block" gap="small">
                          <s-stack direction="inline" gap="small" alignItems="center">
                            <s-icon type="cart" tone="info" />
                            <s-text type="strong">
                              {`${digital.onlineCart.itemCount} items · ${digital.onlineCart.currency} ${digital.onlineCart.total}`}
                            </s-text>
                            <s-badge tone="success">Resume in POS</s-badge>
                          </s-stack>
                          {digital.onlineCart.items.map((item) => (
                            <s-text key={item.id} tone="neutral">
                              {`${item.title} · ${item.variant} · ${digital.onlineCart?.currency} ${item.price}`}
                            </s-text>
                          ))}
                          <s-button
                            variant="primary"
                            disabled={!digital.onlineCart.items.some((item) => item.variantId)}
                            onClick={handleAddOnlineCartToCart}
                          >
                            Add these items to cart
                          </s-button>
                        </s-stack>
                      </s-box>
                    </s-section>
                  )}

                  <s-section heading="Recommended now">
                    <s-stack direction="block" gap="small">
                      {digital.recommendations.map((rec) => (
                        <s-box key={rec.id} padding="base">
                          <s-stack direction="inline" gap="base" alignItems="center">
                            <s-icon type="product" tone="info" />
                            <s-stack direction="block" gap="none">
                              <s-text type="strong">{rec.title}</s-text>
                              <s-text tone="neutral">{rec.reason}</s-text>
                            </s-stack>
                            <s-badge tone="info">{rec.action}</s-badge>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  </s-section>

                  {digital.reservations.length > 0 && (
                    <s-section heading="Reservations">
                      <s-stack direction="block" gap="small">
                        {digital.reservations.map((reservation) => (
                          <s-box key={reservation.id} padding="base">
                            <s-stack direction="inline" gap="base" alignItems="center">
                              <s-icon type="clipboard-checklist" tone="success" />
                              <s-stack direction="block" gap="none">
                                <s-text type="strong">{reservation.title}</s-text>
                                <s-text tone="neutral">
                                  {`${reservation.status} · ${reservation.location} · until ${reservation.expiresAt.slice(0, 10)}`}
                                </s-text>
                              </s-stack>
                            </s-stack>
                          </s-box>
                        ))}
                      </s-stack>
                    </s-section>
                  )}

                  <s-section heading="Message drafts">
                    <s-stack direction="block" gap="small">
                      {digital.messageDrafts.map((draft) => (
                        <s-box key={draft.id} padding="base">
                          <s-stack direction="inline" gap="base">
                            <s-icon type={draft.channel === "sms" ? "phone-out" : "email"} tone="info" />
                            <s-stack direction="block" gap="none">
                              <s-text type="strong">{draft.label}</s-text>
                              <s-text tone="neutral">{draft.body}</s-text>
                            </s-stack>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  </s-section>
                </s-stack>
              ) : (
                <s-text tone="neutral">No online activity available.</s-text>
              )}
            </s-tab-panel>

            <s-tab-panel id="notes">
              <s-stack direction="block" gap="base">
                {latestNote && (
                  <s-section heading="Latest note">
                    <s-box padding="base">
                      <s-stack direction="inline" gap="base">
                        <s-icon type="note" tone="info" />
                        <s-stack direction="block" gap="none">
                          <s-text>{latestNote.body}</s-text>
                          <s-text tone="neutral" type="small">
                            {latestNote.authorId} · {latestNote.createdAt.slice(0, 10)}
                          </s-text>
                        </s-stack>
                      </s-stack>
                    </s-box>
                  </s-section>
                )}
                <s-section heading={`Recent notes (${c.notes.length})`}>
                  {c.notes.length > 0 ? (
                    <s-stack direction="block" gap="small">
                      {c.notes.map((n) => (
                        <s-box key={n.id} padding="small">
                          <s-stack direction="block" gap="none">
                            <s-text>{n.body}</s-text>
                            <s-text tone="neutral" type="small">
                              {n.authorId} · {n.createdAt.slice(0, 10)}
                            </s-text>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  ) : (
                    <s-text tone="neutral">No notes yet.</s-text>
                  )}
                </s-section>
              </s-stack>
            </s-tab-panel>
          </s-tabs>

          {noteOpen ? (
            <s-section heading="Add note">
              <s-stack direction="block" gap="small">
                <s-text-area
                  label="Private note"
                  placeholder="What did you learn about this customer?"
                  value={noteDraft}
                  onInput={(event) =>
                    setNoteDraft((event.currentTarget as HTMLTextAreaElement).value)
                  }
                />
                <s-stack direction="inline" gap="small">
                  <s-button
                    variant="primary"
                    loading={savingNote}
                    disabled={!noteDraft.trim()}
                    onClick={handleAddNote}
                  >
                    Save note
                  </s-button>
                  <s-button
                    variant="secondary"
                    onClick={() => {
                      setNoteOpen(false);
                      setNoteDraft("");
                    }}
                  >
                    Cancel
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          ) : profileOpen ? (
            <s-section heading="Sizing & contact">
              <s-stack direction="block" gap="base">
                <s-text tone="neutral">
                  Capture the customer’s fit profile once, then AI recommendations can preselect the right apparel variant.
                </s-text>
                <s-stack direction="inline" gap="small">
                  {CONTACT_OPTIONS.map((option) => (
                    <s-button
                      key={option.value}
                      variant={profileDraft.preferredContact === option.value ? "primary" : "secondary"}
                      onClick={() =>
                        setProfileDraft((current) => ({
                          ...current,
                          preferredContact: option.value,
                        }))
                      }
                    >
                      {option.label}
                    </s-button>
                  ))}
                </s-stack>
                <s-stack direction="inline" gap="small">
                  {SIZING_FIELDS.map((field) => (
                    <s-box key={field.key} inlineSize={field.key === "fit" ? "98%" : "31%"}>
                      <s-text-field
                        label={field.label}
                        placeholder={field.placeholder}
                        value={profileDraft.sizing[field.key]}
                        onInput={(event) => {
                          const value = (event.currentTarget as HTMLInputElement).value;
                          setProfileDraft((current) => ({
                            ...current,
                            sizing: { ...current.sizing, [field.key]: value },
                          }));
                        }}
                      />
                    </s-box>
                  ))}
                </s-stack>
                <s-stack direction="inline" gap="small">
                  <s-button variant="primary" loading={savingProfile} onClick={handleSaveProfile}>
                    Save sizing & contact
                  </s-button>
                  <s-button
                    variant="secondary"
                    onClick={() => {
                      setProfileOpen(false);
                      setProfileDraft(profileDraftFromCustomer(c));
                    }}
                  >
                    Cancel
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          ) : (
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                onClick={() => {
                  setNoteOpen(true);
                  setProfileOpen(false);
                }}
              >
                Add note
              </s-button>
              <s-button
                variant="secondary"
                onClick={() => {
                  setProfileDraft(profileDraftFromCustomer(c));
                  setProfileOpen(true);
                  setNoteOpen(false);
                }}
              >
                Update sizing/contact
              </s-button>
              <s-button variant="secondary" onClick={handleRecordVisit}>
                Record visit
              </s-button>
              <s-button variant="secondary" onClick={handleAttachToCart}>
                Attach to cart
              </s-button>
              {digital?.onlineCart && (
                <s-button
                  variant="secondary"
                  disabled={!digital.onlineCart.items.some((item) => item.variantId)}
                  onClick={handleAddOnlineCartToCart}
                >
                  Add online cart
                </s-button>
              )}
              <s-button
                variant="secondary"
                onClick={() => setScreen({ kind: "search" })}
              >
                Back to search
              </s-button>
            </s-stack>
          )}
          </s-stack>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
};

export default async () => {
  render(<Modal />, document.body);
};
