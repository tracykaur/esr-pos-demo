# ESR Clienteling — Handoff

Updated: 2026-05-22

This handoff explains what the Elka Shopify POS clienteling app does, how it is wired, and the key implementation choices behind the current build.

## Snapshot

- Repo: `/Users/shannondutton/.cmux-runs/clienteling-20260519-090720/work/backend`
- Dev store: `YOUR-STORE.myshopify.com`
- Partner dashboard app: `esr-pos-demo`
- App handle: `esr-clienteling`
- Client ID: `6581aed86bdde374d8c04d295fa7f8a3`
- Local backend port: `5050`
- Current tunnel/backend URL: `https://street-algorithm-federation-vessels.trycloudflare.com`
- Latest released app version: `esr-clienteling-60`
- Current release note: appointment booking now searches/creates customers and separates booking from today/tomorrow views.

## Product Summary

The app gives Elka store staff a POS-native clienteling layer:

- Recognise VIP, Concierge, and Lapsed customers.
- Search and attach customers at the counter.
- Show customer context: orders, notes, sizing, contact preference, home store, last staff, last visit, interests, online signals, and next best actions.
- Capture notes, visit history, sizing, and preferred contact directly in POS.
- Add customer online-cart items to the POS cart.
- Identify customers interested in a product drop.
- Use ESR AI to recommend products, suggest next-best actions, explain perks, and draft outreach.
- Book and view in-person styling consultations from POS.
- Apply VIP/Concierge discounts through a Shopify Function.

## Active App Shape

The app now uses split POS UI extensions plus one Shopify Function. The old grouped `extensions/clienteling` folder still exists but is not the source of truth.

Active extension directories in `shopify.app.toml`:

| Directory | Staff-facing label | Target(s) | Purpose |
| --- | --- | --- | --- |
| `extensions/esr-home-smart-grid` | Clienteling | `pos.home.tile.render`, `pos.home.modal.render` | Home tile, customer search, full clienteling modal. |
| `extensions/esr-customer-details-action` | Client profile | `pos.customer-details.action.menu-item.render`, `pos.customer-details.action.render` | Customer details menu item and full profile/action modal. |
| `extensions/esr-customer-details-block` | Clienteling | `pos.customer-details.block.render`, `pos.customer-details.action.render` | Compact customer details card plus companion edit modal. |
| `extensions/esr-product-details-action` | Client outreach | `pos.product-details.action.menu-item.render`, `pos.product-details.action.render` | Product details action modal showing matched customers. |
| `extensions/esr-product-details-block` | Client interest | `pos.product-details.block.render` | Compact product-interest summary on product details. |
| `extensions/esr-ai-assistant` | ESR AI Assistant | `pos.home.tile.render`, `pos.home.modal.render` | AI sales assistant tile and modal. |
| `extensions/esr-ai-customer-coach-block` | ESR AI Coach | `pos.customer-details.block.render` | AI tips on customer details. |
| `extensions/appointment-booking-v2` | Appointments | `pos.home.tile.render`, `pos.home.modal.render` | Book consultations and view upcoming appointments using the CLI-scaffolded extension. |
| `extensions/vip` | VIP & Concierge perks | `cart.lines.discounts.generate.run`, `cart.delivery-options.discounts.generate.run` | Product, delivery, and gift discount function. |

### Production UI Copy Choice

Visible POS copy should not expose implementation terms. Avoid words like `block`, `extension`, `target`, `render`, `smart grid`, `init failed`, `render crashed`, and `No interest mapping` in staff-facing UI. Use staff-friendly labels such as `Clienteling`, `Client profile`, `Client interest`, `Interested clients`, and `Client profile unavailable`.

## Staff Workflows

### Clienteling Home Tile

1. Staff taps `Clienteling` on POS home.
2. They search a customer by name, phone, or email, or use the currently attached cart customer.
3. The modal shows customer status, spend/orders, notes, interests, sizing, preferred contact, home store, last staff, last visit, online signals, and next best actions.
4. Staff can:
   - attach the customer to the cart;
   - record a visit;
   - add a note;
   - update sizing/contact;
   - add online-cart items to the POS cart.

### Customer Details

On a POS customer details page:

- `Clienteling` block provides a compact profile summary.
- `ESR AI Coach` block gives concise AI guidance.
- `Client profile` action opens the full profile workflow.

Customer action capabilities:

- Profile/history/online/action tabs.
- Note capture.
- Visit recording.
- Cart attachment.
- Online-cart-to-POS-cart add.
- Sizing/contact form.

### Product Details

On a POS product details page:

- `Client interest` shows matched-interest counts and the reason this product maps to an audience.
- `Client outreach` opens a list of matched customers for staff follow-up.

Product matching uses real catalogue data where possible:

1. Primary mapped collection from `$app:esr.interest_map`.
2. Product title, product type, tags, vendor, and collections as fallback signals.
3. Customer interest tags and home-store context for matched lists.

### Appointments

The `Appointments` POS tile provides an MVP consultation calendar.

Current capabilities:

- Search existing Shopify customers by name, phone, or email.
- Create a new Shopify customer from the booking flow when needed.
- Assign each appointment to the selected or newly created customer.
- Use separate `Book appointment` and `Today & tomorrow` tabs.
- Select common time slots.
- Select consultation type: styling consult, VIP wardrobe refresh, Concierge fitting, alterations follow-up, or new-season preview.
- Capture appointment notes.
- View seven-day date buttons with appointment counts while booking.
- View today and tomorrow's upcoming consultations in a dedicated tab.

Storage choice:

- Appointments are stored as JSON in a shop metafield: `$app:esr.appointments`.
- This keeps the MVP simple and shared across POS devices for the app.
- It is not yet connected to Google Calendar, Shopify bookings, or an external scheduling system.

Key files:

- `app/routes/api.appointments.tsx`
- `app/routes/api.customer.create.tsx`
- existing `app/routes/api.customer.search.tsx`
- `extensions/appointment-booking-v2/src/Tile.jsx` — CLI scaffold; intentionally static so the POS tile cannot fail due to network/session-token calls.
- `extensions/appointment-booking-v2/src/Modal.jsx`
- `extensions/appointment-booking-v2/src/shared/config.js`

### ESR AI

The `ESR AI` POS tile opens an assistant with four modes:

| Mode | Backend mode | Purpose |
| --- | --- | --- |
| Clienteling | `CLIENTELING_COACH` | Next-best actions and what to say. |
| Perks | `PROMO_ADVISOR` | VIP/Concierge perk guidance without inventing discounts. |
| Products | `PRODUCT_EXPERT` | Real Elka catalogue product recommendations. |
| Outreach | `OUTREACH_DRAFT` | Short message draft using preferred channel/context. |

AI context includes attached customer, cart items, tags, spend/orders, last visit, sizing, preferred contact, VIP/Concierge rules, and real active Elka catalogue products.

AI product cards include:

- product image;
- title, product type, price;
- available variants;
- suggested size from saved customer sizing;
- disabled state for unavailable variants;
- direct add-to-cart via `shopify.cart.addLineItem(selectedVariantId, 1)`.

AI uses:

- `app/lib/llm.server.ts`
- `app/routes/api.ai-assistant.tsx`
- `app/routes/api.ai-context.tsx`
- `AI_PROXY_URL=https://proxy.shopify.ai`
- `AI_PROXY_TOKEN` in `.env` only; never print or commit the full token.

## Data Model

Shopify is the source of truth. SQLite/Prisma is session and lookup cache only.

### Prisma Tables

- `Session` — Shopify Remix session storage.
- `StaffMember` — cached staff names.
- `Location` — cached location names/handles.
- `SegmentCache` — cached segment IDs/names.

### Customer Tags

| Tag | Meaning |
| --- | --- |
| `vip` / `VIP` | VIP badge and VIP product discount eligibility. |
| `concierge` / `Concierge` | Concierge badge, VIP product discount eligibility, and free-delivery eligibility. |
| `lapsed` | Lapsed badge; removed by visit/order activity. |
| `demo-clienteling` | Seeded demo customer. |
| `home-store-<handle>` | Home store. Record visit updates this from current POS location. |
| `interest-<category>` | Product/clienteling interest. |
| `staff-pick-<staffId>` | Backend-derived staff-pick signal. |

Tag casing matters in Shopify, so app logic normalizes display/logic and handles `vip`/`VIP`, `concierge`/`Concierge`.

### Customer Metafields

Namespace: `$app:esr`

| Key | Type / shape | Purpose |
| --- | --- | --- |
| `notes` | `list.metaobject_reference` | Clienteling note metaobjects. |
| `sizing` | JSON | `top`, `bottom`, `dress`, `shoe`, `bra`, `fit`. |
| `preferred_contact` | string | `sms`, `email`, or `none`. |
| `last_staff_id` | string | Staff member from last visit. |
| `last_visit_at` | datetime/string | Last recorded visit or order activity. |

### Shop Metafields

Namespace: `$app:esr`

| Key | Purpose |
| --- | --- |
| `interest_map` | Maps collection GIDs to product/clienteling interest categories. |
| `vip_perk_pct` | Mirror of the active VIP/Concierge product discount percentage. |
| `app_config` | Reserved for broader app/demo configuration. |
| `appointments` | MVP appointment calendar JSON for in-person consultations. |

### Discount Config Metafield

The automatic app discount stores config on the discount node:

- Namespace/key: `$app:config.config`
- Used by the `vip` Shopify Function.

## Backend Routes

All POS-facing API routes use `authenticatePos(request)`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/customer/search?q=...&limit=...` | POS customer search. |
| POST | `/api/customer/create` | Create a Shopify customer from appointment booking. |
| GET | `/api/customer/:id/clienteling` | Full clienteling payload. |
| POST | `/api/customer/:id/notes` | Create note metaobject and append to customer notes metafield. |
| POST | `/api/customer/:id/visit` | Record last staff/visit, remove `lapsed`, set home store. |
| POST | `/api/customer/:id/profile` | Save sizing and preferred contact. |
| GET | `/api/products/:id/concierge-reachout?locationId=...` | Product-to-interest matched customer list. |
| GET | `/api/segments/:id/members` | Segment member list. |
| POST | `/api/ai-assistant` | AI assistant response and product cards. |
| GET | `/api/ai-context` | Lightweight AI customer coach context. |
| GET | `/api/appointments` | Upcoming appointments and day counts. |
| POST | `/api/appointments` | Book a new consultation appointment. |
| POST | `/api/cron/lapsed` | Lapsed tag maintenance. |

Admin/discount routes:

| Path | Purpose |
| --- | --- |
| `/app/discounts/vip/new` | Create automatic VIP/Concierge app discount. |
| `/app/discounts/vip/:id` | Edit existing discount config. |

## VIP & Concierge Discount Function

Current function handle: `vip`.

Current behavior:

- `vip`/`VIP` OR `concierge`/`Concierge` → configured product percentage discount.
- `concierge`/`Concierge` → free delivery when enabled.
- Line with `_elka_gift=true` → 100% product discount.

Key implementation files:

- `extensions/vip/Cargo.toml`
- `extensions/vip/shopify.extension.toml`
- `extensions/vip/src/cart_lines_discounts_generate_run.graphql`
- `extensions/vip/src/cart_lines_discounts_generate_run.rs`
- `extensions/vip/src/cart_delivery_options_discounts_generate_run.graphql`
- `extensions/vip/src/cart_delivery_options_discounts_generate_run.rs`
- `extensions/vip/src/main.rs`

Important build/deploy choice:

- Use `shopify_function = "0.8.1"`.
- Use `graphql_client = "0.14.0"`.
- Build target is `wasm32-wasip1`.
- Wasm path is `target/wasm32-wasip1/release/vip.wasm`.

Do **not** revert to `shopify_function` 2.x / `wasm32-unknown-unknown` unless the local Shopify Function trampoline issue is solved. On this macOS environment, `shopify-function-trampoline-2.0.1` was killed with `SIGKILL`.

Discount creation choices:

- Admin route uses `functionHandle: "vip"`, not `functionId`.
- Admin route sends `discountClasses: ["PRODUCT", "SHIPPING"]`, which is required for discounts API functions.
- Admin routes query the real shop ID before writing shop metafields; do not hardcode `gid://shopify/Shop/1`.

## Demo Data / Seed Script

Run:

```sh
pnpm run seed
```

Seed script: `scripts/seed.ts`.

It currently:

- Loads active `Early Settler` products.
- Builds `$app:esr.interest_map` from real catalogue collections.
- Creates/updates eight demo customers.
- Adds `demo-clienteling`, VIP/Concierge/Lapsed, interest, and home-store tags.
- Writes sizing, preferred contact, and last visit metafields.
- Adds notes referencing real catalogue product titles.
- Cleans accidental tag inconsistencies for seeded demo customers.

Current seeded demo customers:

| Customer | Role |
| --- | --- |
| Ava Montgomery | VIP + Concierge |
| Mila Ashford | Concierge-only |
| Sienna Vale | VIP |
| Harper Quinn | VIP |
| Isla Rowe | Lapsed VIP |
| Zoe Bennett | VIP |
| Nina Hartley | Non-VIP demo customer |
| Lucy Carter | Concierge-only |

Data principle: demo product examples should reference real active Elka catalogue products, not fake/unavailable products.

## Online Signals and Recommendations

The customer payload includes catalogue-backed demo signals:

- browsing history;
- online cart;
- product recommendations;
- reservations;
- follow-up/message suggestions.

These are generated from real active Elka catalogue products in the backend. They are not yet real web-pixel or storefront event ingestion.

## Setup and Operations

### Local backend

```sh
cd /Users/shannondutton/.cmux-runs/clienteling-20260519-090720/work/backend
PORT=5050 pnpm run dev:local
```

### Cloudflare tunnel

```sh
cloudflared tunnel --url http://localhost:5050
```

### Sync a new tunnel URL

```sh
pnpm tunnel:sync https://YOUR-NEW-TUNNEL.trycloudflare.com
```

`scripts/sync-tunnel.ts` updates:

- `.env` `SHOPIFY_APP_URL`;
- `shopify.app.toml` `application_url`;
- `shopify.app.toml` OAuth redirect URLs;
- active POS extension `src/shared/config.ts` `BACKEND_URL` constants.

POS UI extensions run from Shopify CDN. Because the backend URL is bundled into each extension, random `trycloudflare.com` tunnel changes require a rebuild and deploy.

### Build and deploy

```sh
pnpm run build
pnpm shopify app deploy --allow-updates --message "Your deploy message"
```

Then fully close/reopen Shopify POS.

### Health checks

```sh
lsof -nP -iTCP:5050 -sTCP:LISTEN
curl -i --max-time 10 https://street-algorithm-federation-vessels.trycloudflare.com/
pnpm shopify app versions list
sqlite3 prisma/dev.db "select id, shop, name, handle from Location order by id;"
```

A healthy tunnel root usually returns an HTTP redirect to `/app`.

## Key Implementation Decisions

1. **Split POS extensions are the source of truth.** The old grouped `extensions/clienteling` folder remains on disk but should not be used for active work.
2. **Tunnel URL sync is scripted.** Use `pnpm tunnel:sync`, then build/deploy/reopen POS. Do not manually edit each extension config unless debugging.
3. **Concierge implies VIP product discount.** Concierge-only customers receive VIP percentage off and can also receive free delivery.
4. **Tag casing is normalized.** Shopify may display/store `VIP`; code handles both lower and upper-case customer tags.
5. **Catalogue-backed demo data only.** Demo customer browsing/cart/recommendation examples use real active Elka products.
6. **AI was selectively ported.** Only useful assistant/sales-coach concepts were reworked into Elka-native routes/extensions; Strand-specific services were not imported wholesale.
7. **AI recommendations are structured.** Backend returns product card data so POS can render images, variants, suggested sizes, and add-to-cart buttons.
8. **Direct add-to-cart is preferred.** No clean POS product deep-link API was used; cards call `shopify.cart.addLineItem` directly.
9. **Sizing/contact capture belongs in modal/action surfaces.** Customer details blocks remain compact; forms live in home/customer action modals.
10. **Production UI copy hides implementation details.** Staff should see business workflows, not extension/block/function terminology.
11. **VIP Function uses WASI.** This avoids local trampoline SIGKILL failures during Shopify CLI deploys.

## Known Limitations / Technical Debt

- Real online browsing/cart/reservation ingestion is not implemented; current signals are catalogue-backed demo data.
- There is no full staff outreach task queue with assignment/completion status yet.
- Tailoring, transfers, and some Concierge perks are currently prompts/manual workflows, not fulfilled by a dedicated operations system.
- Project-wide `pnpm run typecheck` can be noisy due to retired extension files and POS JSX typings. `pnpm run build` is the reliable validation command.
- Shared POS code is duplicated across split extensions. Keep `src/shared/api.ts`, `types.ts`, `badges.ts`, and `config.ts` aligned when changing payloads.
- `extensions/clienteling/dist/clienteling.js` contains old bundled code and should not be used for debugging active POS behavior.
- No automated POS UI tests exist yet.

## Recommended Next Work

1. Validate VIP/Concierge automatic discount behavior end-to-end in online checkout and POS checkout.
2. Decide which Concierge perks become automated workflows vs staff prompts.
3. Add real storefront/event ingestion for browsing, carts, reservations, and wishlists if needed beyond demo.
4. Add a proper admin configuration page for interest map, perk rules, and demo-data setup.
5. Evolve appointment booking into a real calendar integration if needed: Google Calendar, staff calendars, reminders, rescheduling, cancellation, and availability rules.
6. Add staff outreach task workflow: create task, assign staff/store, mark complete, log note.
6. Clean up or exclude retired `extensions/clienteling` from typechecking once no longer needed.
7. Add smoke tests for backend routes and critical payload shaping.

## Files Most Likely to Matter

Backend:

- `app/routes/api.customer.$id.clienteling.tsx`
- `app/routes/api.customer.$id.profile.tsx`
- `app/routes/api.customer.$id.notes.tsx`
- `app/routes/api.customer.$id.visit.tsx`
- `app/routes/api.products.$id.concierge-reachout.tsx`
- `app/routes/api.ai-assistant.tsx`
- `app/routes/api.ai-context.tsx`
- `app/lib/llm.server.ts`
- `app/lib/badges.ts`
- `app/lib/constants.ts`
- `app/graphql/customer.ts`
- `app/graphql/segments.ts`

POS extensions:

- `extensions/esr-home-smart-grid/src/Modal.tsx`
- `extensions/esr-customer-details-action/src/Action.tsx`
- `extensions/esr-customer-details-block/src/Block.tsx`
- `extensions/esr-customer-details-block/src/EditAction.tsx`
- `extensions/esr-product-details-action/src/Action.tsx`
- `extensions/esr-product-details-block/src/Block.tsx`
- `extensions/esr-ai-assistant/src/Modal.tsx`
- `extensions/esr-ai-customer-coach-block/src/Block.tsx`
- `extensions/appointment-booking-v2/src/Modal.jsx`

Scripts/config:

- `scripts/seed.ts`
- `scripts/sync-tunnel.ts`
- `shopify.app.toml`
- `.env.example`
- `README.md`

Function:

- `extensions/vip/**`

## Safe Demo Recovery Checklist

If the demo breaks:

1. Start backend: `PORT=5050 pnpm run dev:local`.
2. Start tunnel: `cloudflared tunnel --url http://localhost:5050`.
3. Sync URL: `pnpm tunnel:sync https://NEW.trycloudflare.com`.
4. Build: `pnpm run build`.
5. Deploy: `pnpm shopify app deploy --allow-updates --message "Update tunnel URL"`.
6. Reopen Shopify POS.
7. If data looks stale, run `pnpm run seed`.
8. If AI fails, confirm `.env` has `AI_PROXY_TOKEN` without printing the token.
