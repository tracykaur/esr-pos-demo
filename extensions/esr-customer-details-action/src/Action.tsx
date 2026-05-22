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
import type { ClientelingPayload } from "./shared/types";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; payload: ClientelingPayload }
  | { kind: "error"; message: string };

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
  return "Capture preferences, record this visit, and build the clienteling profile from today.";
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

const CustomerAction = () => {
  let customerGid: string;
  try {
    customerGid = toCustomerGid(shopify.customer.id);
  } catch (err) {
    return (
      <s-page heading="Client profile">
        <s-banner tone="critical" heading="Select a customer">
          <s-text>Open this from a customer profile to view clienteling details.</s-text>
        </s-banner>
      </s-page>
    );
  }

  const [state, setState] = useState<State>({ kind: "loading" });
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({
    sizing: { top: "", bottom: "", dress: "", shoe: "", bra: "", fit: "" },
    preferredContact: "none",
  });

  async function refresh() {
    setState({ kind: "loading" });
    const res = await api.getCustomer(customerGid);
    if (res.ok) {
      setState({ kind: "loaded", payload: res.data });
      setProfileDraft(profileDraftFromCustomer(res.data));
    } else setState({ kind: "error", message: formatError(res.error) });
  }

  useEffect(() => {
    refresh();
  }, [customerGid]);

  async function handleRecordVisit() {
    if (state.kind !== "loaded") return;
    const staffId = readCurrentStaffId();
    const storeId = readCurrentLocationId();
    if (!staffId || !storeId) {
      const missing = !staffId ? "staff member" : "store location";
      const detail = !storeId ? ` ${describePosContext()}` : "";
      setMessage(`Could not record visit: POS did not provide ${missing}.${detail}`);
      return;
    }
    const res = await api.recordVisit(state.payload.id, {
      staffId,
      storeId,
    });
    if (res.ok) {
      shopify.toast.show("Visit recorded");
      refresh();
    } else {
      setMessage(formatError(res.error));
    }
  }

  async function handleAddNote() {
    if (state.kind !== "loaded") return;
    const body = noteDraft.trim();
    if (!body) return;
    setSavingNote(true);
    const res = await api.addNote(state.payload.id, {
      body,
      storeId: readCurrentLocationId(),
      authorId: readCurrentStaffId(),
    });
    setSavingNote(false);
    if (res.ok) {
      shopify.toast.show("Note saved");
      setNoteDraft("");
      refresh();
    } else {
      setMessage(formatError(res.error));
    }
  }

  async function handleSaveProfile() {
    if (state.kind !== "loaded") return;
    setSavingProfile(true);
    const res = await api.updateProfile(state.payload.id, {
      sizing: compactSizing(profileDraft.sizing),
      preferredContact: profileDraft.preferredContact,
    });
    setSavingProfile(false);
    if (res.ok) {
      shopify.toast.show("Sizing and contact saved");
      refresh();
    } else {
      setMessage(formatError(res.error));
    }
  }

  async function handleAttachToCart() {
    if (state.kind !== "loaded") return;
    try {
      await shopify.cart.setCustomer({ id: gidToNumericId(state.payload.id) });
      shopify.toast.show(`Attached ${state.payload.displayName} to cart`);
    } catch (err) {
      setMessage(`Could not attach to cart: ${String(err)}`);
    }
  }

  async function handleAddOnlineCartToCart() {
    if (state.kind !== "loaded" || !state.payload.digital?.onlineCart) return;
    const items = state.payload.digital.onlineCart.items.filter((item) => item.variantId);
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
      setMessage(`Could not add online cart items: ${String(err)}`);
    }
  }

  if (state.kind === "loading") {
    return (
      <s-page heading="Client profile">
        <s-scroll-box>
          <s-box padding="base">
            <s-stack direction="block" gap="small">
            <s-spinner accessibilityLabel="Loading clienteling profile" />
            <s-text tone="neutral">Loading clienteling profile...</s-text>
            </s-stack>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  if (state.kind === "error") {
    return (
      <s-page heading="Client profile">
        <s-scroll-box>
          <s-banner tone="critical" heading="Couldn't load client profile">
            <s-text>{state.message}</s-text>
          </s-banner>
        </s-scroll-box>
      </s-page>
    );
  }

  const c = state.payload;
  const bannerTone = bannerToneForBadges(c.badges);
  const sizingPairs = Object.entries(c.sizing ?? {}).filter(([, value]) => Boolean(value));
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
          {message && (
            <s-banner tone="critical" heading="Something went wrong">
              <s-text>{message}</s-text>
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
                {c.badges.map((badge) => (
                  <s-badge key={badge} tone={badgeTone(badge)}>
                    {badge}
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
              <s-tab controls="profile">Profile</s-tab>
              <s-tab controls="note">Note</s-tab>
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
                  <s-section heading="Clienteling lenses">
                    <s-stack direction="inline" gap="small">
                      {segments.map((segment) => (
                        <s-badge key={segment.id} tone="info">
                          {segment.name}
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
                      {sizingPairs.map(([key, value]) => (
                        <s-badge key={key} tone="info">
                          {key}: {value}
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
                      {c.recentOrders.map((order) => (
                        <s-box key={order.id} padding="base">
                          <s-stack direction="inline" gap="base" alignItems="center">
                            <s-icon type="receipt" tone="neutral" />
                            <s-stack direction="block" gap="none">
                              <s-text type="strong">{order.name}</s-text>
                              <s-text tone="neutral">
                                {`${order.currency} ${order.total} · ${order.processedAt.slice(0, 10)} · ${order.location}`}
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

            <s-tab-panel id="profile">
              <s-stack direction="block" gap="base">
                <s-section heading="Sizing & contact">
                  <s-stack direction="block" gap="base">
                    <s-text tone="neutral">
                      Capture fit and contact preferences here so AI recommendations and staff handoffs can use the right customer context.
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
                    <s-button variant="primary" loading={savingProfile} onClick={handleSaveProfile}>
                      Save sizing & contact
                    </s-button>
                  </s-stack>
                </s-section>
              </s-stack>
            </s-tab-panel>

            <s-tab-panel id="note">
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
                      <s-button variant="secondary" onClick={handleRecordVisit}>
                        Record visit
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-section>

                {c.notes.length > 0 && (
                  <s-section heading={`Recent notes (${c.notes.length})`}>
                    <s-stack direction="block" gap="small">
                      {c.notes.map((note) => (
                        <s-box key={note.id} padding="small">
                          <s-stack direction="block" gap="none">
                            <s-text>{note.body}</s-text>
                            <s-text tone="neutral" type="small">
                              {note.authorId} · {note.createdAt.slice(0, 10)}
                            </s-text>
                          </s-stack>
                        </s-box>
                      ))}
                    </s-stack>
                  </s-section>
                )}
              </s-stack>
            </s-tab-panel>
          </s-tabs>

          <s-stack direction="inline" gap="small">
            <s-button variant="primary" onClick={handleRecordVisit}>
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
          </s-stack>
          </s-stack>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
};

export default async () => {
  render(<CustomerAction />, document.body);
};
