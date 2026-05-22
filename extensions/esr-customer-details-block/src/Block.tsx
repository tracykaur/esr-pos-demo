// Target: pos.customer-details.block.render
// Read-mostly card on the Customer Details screen: colour-coded headline,
// badges, sizing, segments, recent orders, recent notes, plus two
// no-input actions (Record visit, Reach out).
//
// Note: this block target accepts only a narrow set of components — no
// s-banner, s-spinner, s-text-area or s-text-field. The colour-coded
// "banner" is rendered as a strong-toned headline. There's no inline
// note-entry here because text-input components aren't permitted in
// customer-detail block targets; staff capture notes from the Home tile
// modal (HomeModal.tsx) which lives in a target that supports s-text-area.
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
  if (c.badges.includes("Concierge")) return "Concierge visit: confirm perks, record context, and make the handoff feel personal.";
  if (c.badges.includes("VIP")) return "VIP visit: review orders and mention relevant drops.";
  if (c.badges.includes("Lapsed")) return "Win-back visit: capture what changed and follow up.";
  return "Build the profile from today's visit.";
}

function MiniMetric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <s-box padding="small" inlineSize="48%">
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

const Block = () => {
  // Surface the failure visibly instead of dying silently if shopify.customer
  // is missing on mount (e.g. POS API shape change between target versions).
  let customerGid: string;
  try {
    customerGid = toCustomerGid(shopify.customer.id);
  } catch (err) {
    return (
      <s-pos-block>
        <s-stack direction="block" gap="small">
          <s-text type="strong" tone="critical">Client profile unavailable</s-text>
          <s-text tone="neutral">Open this panel from a customer profile.</s-text>
        </s-stack>
      </s-pos-block>
    );
  }
  const [state, setState] = useState<State>({ kind: "loading" });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function refresh() {
    setState({ kind: "loading" });
    try {
      const res = await api.getCustomer(customerGid);
      if (res.ok) setState({ kind: "loaded", payload: res.data });
      else setState({ kind: "error", message: formatError(res.error) });
    } catch (err) {
      setState({
        kind: "error",
        message: `Could not refresh client profile: ${String(err)}`,
      });
    }
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
      const message = `Could not record visit: POS did not provide ${missing}.${detail}`;
      setErrorMessage(message);
      shopify.toast.show(message);
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
      setErrorMessage(formatError(res.error));
    }
  }

  function handleReachOut() {
    if (state.kind !== "loaded") return;
    const { preferredContact, phone, email } = state.payload;
    if (preferredContact === "none" || (!phone && !email)) {
      shopify.toast.show("This customer has opted out or has no contact details on file.");
      return;
    }
    const channel = preferredContact ?? (phone ? "sms" : "email");
    const target = channel === "sms" ? phone : email;
    shopify.toast.show(`Reach out via ${channel}: ${target ?? "—"}`);
  }

  async function handleAttachToCart() {
    if (state.kind !== "loaded") return;
    try {
      await shopify.cart.setCustomer({ id: gidToNumericId(state.payload.id) });
      shopify.toast.show(`Attached ${state.payload.displayName} to cart`);
    } catch (err) {
      const message = `Could not attach to cart: ${String(err)}`;
      setErrorMessage(message);
      shopify.toast.show(message);
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
      const message = `Could not add online cart items: ${String(err)}`;
      setErrorMessage(message);
      shopify.toast.show(message);
    }
  }

  if (state.kind === "loading") {
    return (
      <s-pos-block>
        <s-text tone="neutral">Loading Elka clienteling…</s-text>
      </s-pos-block>
    );
  }

  if (state.kind === "error") {
    const lines = state.message.split("\n");
    return (
      <s-pos-block>
        <s-stack direction="block" gap="small">
          <s-text type="strong" tone="critical">
            Couldn't load client profile
          </s-text>
          {lines.map((line, i) => (
            <s-text key={i} tone="neutral">
              {line || " "}
            </s-text>
          ))}
        </s-stack>
      </s-pos-block>
    );
  }

  const c = state.payload;
  const bannerTone = bannerToneForBadges(c.badges);
  const headlineTone: "warning" | "info" | "critical" | "neutral" =
    bannerTone === "warning"
      ? "warning"
      : bannerTone === "info"
        ? "info"
        : bannerTone === "critical"
          ? "critical"
          : "neutral";
  const sizingPairs = Object.entries(c.sizing ?? {}).filter(([, v]) => Boolean(v));
  const entitlements = c.entitlements ?? [];
  const segments = c.segments ?? [];
  const interests = c.interests ?? [];
  const reachoutDisabled = c.preferredContact === "none" || (!c.phone && !c.email);
  const homeStore = c.homeStore?.name ?? "Group-wide";
  const latestOrder = c.recentOrders[0];
  const latestNote = c.notes[0];
  const digital = c.digital;
  const latestView = digital?.browsingHistory[0];
  const topRecommendation = digital?.recommendations[0];

  return (
    <s-pos-block>
      <s-stack direction="block" gap="base">
        {errorMessage && <s-text tone="critical">{errorMessage}</s-text>}

        <s-box padding="base">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-icon
                type={c.badges.includes("Concierge") ? "star-filled" : "person-filled"}
                tone={headlineTone}
              />
              <s-text type="strong" tone={headlineTone}>
                {bannerHeadlineForBadges(c.badges, c.displayName)}
              </s-text>
            </s-stack>
            <s-text tone="neutral">{staffBrief(c)}</s-text>
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

        <s-section heading="At a glance">
          <s-stack direction="inline" gap="small">
            <MiniMetric icon="money" label="Lifetime" value={formatSpend(c)} />
            <MiniMetric icon="order" label="Orders" value={`${c.numberOfOrders ?? 0}`} />
            <MiniMetric icon="store" label="Home" value={homeStore} />
            <MiniMetric icon="phone-out" label="Contact" value={preferredContact(c)} />
          </s-stack>
          <s-text tone="neutral">
            Last visit: {formatDate(c.lastVisitAt)} · Last staff: {c.lastStaff?.name ?? "Not recorded"}
          </s-text>
          {latestOrder && (
            <s-text tone="neutral">
              Latest order: {latestOrder.name} · {latestOrder.currency} {latestOrder.total}
            </s-text>
          )}
        </s-section>

        {entitlements.length > 0 && (
          <s-section heading="Next best actions">
            <s-stack direction="inline" gap="small">
              {entitlements.slice(0, 3).map((entitlement) => (
                <s-box key={entitlement.id} padding="small">
                  <s-text
                    type="strong"
                    tone={entitlement.status === "attention" ? "warning" : "info"}
                  >
                    {entitlement.label}
                  </s-text>
                </s-box>
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

        {latestNote && (
          <s-section heading="Latest note">
            <s-box padding="small">
              <s-stack direction="inline" gap="small">
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

        {digital && (
          <s-section heading="Online signals">
            <s-stack direction="block" gap="small">
              {latestView && (
                <s-box padding="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-icon type="view" tone={latestView.intent === "High" ? "warning" : "info"} />
                    <s-stack direction="block" gap="none">
                      <s-text type="strong">{latestView.title}</s-text>
                      <s-text tone="neutral" type="small">
                        {`${latestView.viewCount} online views · size ${latestView.size} · ${latestView.intent} intent`}
                      </s-text>
                    </s-stack>
                  </s-stack>
                </s-box>
              )}
              {digital.onlineCart && (
                <s-box padding="small">
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-icon type="cart" tone="info" />
                      <s-text type="strong">
                        {`${digital.onlineCart.itemCount} online cart items · ${digital.onlineCart.currency} ${digital.onlineCart.total}`}
                      </s-text>
                    </s-stack>
                    <s-button
                      variant="secondary"
                      disabled={!digital.onlineCart.items.some((item) => item.variantId)}
                      onClick={handleAddOnlineCartToCart}
                    >
                      Add online cart
                    </s-button>
                  </s-stack>
                </s-box>
              )}
              {topRecommendation && (
                <s-box padding="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-icon type="product" tone="info" />
                    <s-stack direction="block" gap="none">
                      <s-text type="strong">{topRecommendation.title}</s-text>
                      <s-text tone="neutral" type="small">{topRecommendation.action}</s-text>
                    </s-stack>
                  </s-stack>
                </s-box>
              )}
            </s-stack>
          </s-section>
        )}

        <s-stack direction="inline" gap="small">
          <s-button variant="primary" onClick={() => shopify.action.presentModal()}>
            Edit profile / notes
          </s-button>
          <s-button variant="secondary" onClick={handleRecordVisit}>
            Record visit
          </s-button>
          <s-button variant="secondary" onClick={handleAttachToCart}>
            Attach to cart
          </s-button>
          <s-button
            variant="secondary"
            disabled={reachoutDisabled}
            onClick={handleReachOut}
          >
            Reach out
          </s-button>
        </s-stack>
      </s-stack>
    </s-pos-block>
  );
};

// Wrapper that renders a visible fallback if Block throws synchronously
// on mount — otherwise the block disappears with no clue what failed.
const SafeBlock = () => {
  try {
    return <Block />;
  } catch (err) {
    return (
      <s-pos-block>
        <s-stack direction="block" gap="small">
          <s-text type="strong" tone="critical">Client profile unavailable</s-text>
          <s-text tone="neutral">Close and reopen the customer profile, then try again.</s-text>
        </s-stack>
      </s-pos-block>
    );
  }
};

export default async () => {
  render(<SafeBlock />, document.body);
};
