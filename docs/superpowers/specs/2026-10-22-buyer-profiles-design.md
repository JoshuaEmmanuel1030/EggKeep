# Buyer profiles: pinned SKUs + purchasing insights

**Date:** 2026-10-22
**Status:** Design — for spec review
**Builds on:** branch `feat/tablet-sidebar-activities` (per-buyer DCs `buyer_dcs`, Purchase Order naming, tablet sidebar shell, edit-order `correct_order`). `buyer_dcs` and `correct_order` are live in production.

## Problem

1. Building a Purchase Order (PO) means searching all 22 active SKUs every time, though each buyer only ever orders a few (OSAVE has used 7, Segari 11, CircleK 1). OSAVE never buys BK4AMTG or BK4T, yet they sit in the same list.
2. There is no place to see what a buyer usually orders, so the warehouse can't plan prep and egg purchasing ahead of their orders.

## Goal

Each buyer gets a **profile** in Catalog → Buyers with:
- a **pinned SKU list** (admins set it) that floats those SKUs to the top of the PO SKU dropdown for that buyer;
- **planning insights**: which days they order, what a typical order on that day looks like (SKUs to prep, eggs to buy), their most frequent SKUs, monthly volume per SKU, and day-of-month pattern.

## Decisions (agreed in brainstorming)

| Topic | Decision |
|---|---|
| Off-list SKUs | **Pin, don't hide.** Buyer's SKUs first under the buyer's name, all others below under "Other SKUs". Empty list → dropdown exactly as today. |
| Granularity | **Per buyer**, shared by all its DCs. |
| Filling the list | **Manual**, plus a "Suggest from history" button that ticks SKUs the buyer ordered; admin reviews and saves. |
| Insights purpose | **Planning** — what this buyer will likely order next / this week. |
| Layout | **Drill-down page inside the Buyers tab**; tablet landscape = list + profile side by side. |
| Permissions | Everyone can view profiles and insights; **admins only** edit the pinned list (and DCs/rename/delete as today). |
| Units | **Both**: SKU quantities in pack/box (prep) + egg totals per product in native unit, kg with `(≈ N butir)` (buy). |
| Approach | `buyers.pinned_sku_ids uuid[]` + read-only view `purchase_orders` + stats computed client-side in one pure module. |

## Invariants (what does NOT change)

- No change to stock, FIFO, `record_order_outflows`, `correct_order`, returns, or the outbox. Pins only reorder a dropdown; insights only read.
- Order payloads and `activity_logs.metadata` shape are unchanged.
- kg-native rule: egg totals stay in each product's native unit; butir is only an `≈` estimate via `butirEquivalent()`.
- Buyer and DC write access in the database stays as today (any signed-in user); admin-only editing is a UI gate, same as the existing DC and buyer edit buttons.

## Component 1 — DB migration (one file, additive)

File: `supabase/migrations/20261022010000_buyer_profiles.sql`. Apply via Supabase MCP `apply_migration` on `lgtixzpjbkzapecirbfj` **before** pushing any frontend that reads it. Then regenerate `src/integrations/supabase/types.ts`.

```sql
-- Buyer profiles: pinned SKUs + a one-row-per-order view for insights.
-- Additive only: one new column with a default, one new read-only view.

-- SKUs pinned to the top of this buyer's Purchase Order SKU dropdown.
-- pack_skus ids (rename-safe); ids of deleted/inactive SKUs are ignored on read.
alter table public.buyers
  add column if not exists pinned_sku_ids uuid[] not null default '{}';

-- One row per recorded Purchase Order. An order writes one activity_logs row per
-- egg/packaging/label/box entry, all with the same metadata except relatedEntryId.
-- Metadata has no order id and recorded_at differs by ~1 ms between an order's
-- rows, so each (category, product) row is numbered within its metadata group
-- (k): an order writes each product once, so two identical orders become k=1 and
-- k=2 instead of merging. Voided rows are excluded, so an edited order appears
-- once, as its replacement. egg_totals come from the live rows (not the
-- relatedProducts snapshot) so a single voided egg row drops out; order_lines
-- stay the as-ordered snapshot.
create view public.purchase_orders
with (security_invoker = true) as
select
  min(r.recorded_at) as recorded_at,
  r.m->>'buyerName'  as buyer_name,
  case when pg_input_is_valid(r.m->>'outflowDate', 'date')
       then (r.m->>'outflowDate')::date
       else (min(r.recorded_at) at time zone 'Asia/Jakarta')::date
  end                as outflow_date,
  r.m->>'dcId'       as dc_id,
  r.m->>'dcName'     as dc_name,
  r.m->>'invoiceRef' as invoice_ref,
  coalesce(r.m->'orderLines', '[]'::jsonb) as order_lines,
  coalesce(jsonb_agg(jsonb_build_object('product', r.product, 'quantity', r.quantity_butir))
             filter (where r.category = 'egg'), '[]'::jsonb) as egg_totals
from (
  select metadata - 'relatedEntryId' as m, category, product, quantity_butir, recorded_at,
         row_number() over (partition by metadata - 'relatedEntryId', category, product
                            order by recorded_at, id) as k
  from public.activity_logs
  where action_type = 'outflow'
    and voided_at is null
    and metadata->>'orderType' = 'quick_outflow'
    and coalesce(metadata->>'buyerName', '') <> ''
) r
group by r.m, r.k;

revoke all on public.purchase_orders from anon, authenticated;
grant select on public.purchase_orders to authenticated;
```

- `order_lines` items: `{ skuCode?, packQty?, eggProduct?, looseQty?, looseUnit?, labelSelection? }` (as written by `buildOrderMetadata`). For a Box SKU, `packQty` is the number of **boxes**.
- `egg_totals` items: `{ product, quantity }`, built from the live (non-voided) egg rows, where `quantity` is the native unit (kg for Negeri, butir otherwise).
- **Check after applying:** `select count(*) from purchase_orders` should equal `select count(distinct metadata - 'relatedEntryId')` over the same filter (166 on 2026-10-22).
- `security_invoker` means the view enforces `activity_logs`' existing read policy.
- ponytail: the view regroups all PO log rows on each query. At ~20k rows/year that's fine; add an expression index on `metadata->>'buyerName'` if the profile ever feels slow.

## Component 2 — Types and hooks

- `Buyer` (`src/types/quickOutflow.ts`): add `pinnedSkuIds?: string[]`. Optional, so existing `Buyer` literals still compile.
- `useBuyers` (`src/hooks/useBuyers.ts`): map `pinned_sku_ids` to `pinnedSkuIds`. Add a `setPinnedSkus` mutation (`{ id, skuIds }` updates `buyers.pinned_sku_ids`) that invalidates `["buyers"]`.
- New `src/hooks/usePurchaseOrders.ts`:
  - `usePurchaseOrders(buyerName)` reads `purchase_orders` where `buyer_name = buyerName` and `outflow_date >=` the 1st of the month 5 months ago (current month + 5 previous = 6 calendar months), ordered by `outflow_date`. It pages with `.range()` in steps of 1000 until a short page, so insights never silently undercount. Query key `["purchase_orders", buyerName]`.
  - `useBuyerOrderStats()` runs one query: `buyer_name, outflow_date` where `outflow_date >= today − 29`. It returns per-buyer `{ orders30d, lastOrderDate }` for the list cards.
  - Both are read-only and online-only. On error, the profile shows an inline "Couldn't load order history" message with Retry. The SKUs and DCs sections still work.

## Component 3 — PO SKU dropdown

File: `src/components/OrderLineItem.tsx`. The builder already passes `selectedBuyer`.

- `QuickOutflowBuilder` computes `pinnedSkuCodes: Set<string>` from the catalog `skus` (which carry `id`) and `selectedBuyer?.pinnedSkuIds`, and passes it to each `OrderLineItem`.
- Pure helper `groupSkusForBuyer(activeSkus, pinnedSkuCodes) → { pinned, others }` keeps catalog order inside each group.
- **Non-empty `pinned`:** render two `CommandGroup`s, headed with the buyer name and "Other SKUs". cmdk search filters across both.
- **Empty `pinned`** (no buyer, empty list, or every pinned SKU inactive or deleted): render one group, identical to today.
- Changing the buyer only reorders the dropdown. SKUs already chosen on lines are kept.
- `EditOrderDialog` has no SKU picker, so it is unchanged.

## Component 4 — Buyers tab: cards, drill-down, tablet split

File: `src/components/catalog/BuyerList.tsx` (reworked from table to cards). The dialogs it owns are kept.

- **Toolbar:** the search box and the admin-only "Add buyer" button stay as they are.
- **Card:**
  - Buyer name, plus DC badges.
  - "N orders in 30 days · last <date>", or "No orders in 30 days".
  - "N SKUs pinned", shown when the list is non-empty.
- **Phone and portrait tablet:** tapping a card replaces the list with `BuyerProfile`, which has a back arrow. `selectedBuyerId` is local state in `BuyerList`.
- **Tablet landscape and desktop** (`useIsTabletLandscape()`): two columns. The card list on the left (~280px) stays visible, and the selected profile is on the right. With nothing selected, the right side shows "Pick a buyer".
- **Moved into the profile header:** edit (rename) and delete leave the cards. The existing rename warning, delete-with-undo flow and History dialog are reused unchanged.
- Phone width 375px must not scroll sideways. Long names truncate, following the e026cf6 fix.

## Component 5 — Profile sections

New `src/components/catalog/BuyerProfile.tsx`:

- **Header:** name, DC badges, the 30-day stats line, and a History button (existing `BuyerHistoryDialog`). Admins also get Edit and Delete.
- **Body:** shadcn `Tabs` with three sections: **Planning · SKUs · DCs**.

**Planning** (`src/components/catalog/BuyerPlanning.tsx`) renders the outputs of Component 6, top to bottom:
1. **Thin-data banner** (amber), shown when the history span is under 56 days: "Based on N weeks of history. Patterns firm up after ~8 weeks."
2. **Weeks with an order, by delivery day:** Mon–Sun rows with a bar for `weeksWithOrder / weeksAvailable`, plus "x/y · N orders". Days marked usual get emphasis. Tapping a row selects that weekday.
3. **Typical <weekday>:** two lists side by side on tablet, stacked on phone.
   - **Prep:** per SKU, the median quantity with a `pack`/`box` unit, plus "x/y" when the SKU appeared on only some of those days.
   - **Buy:** per egg product, the median native quantity; kg products get `(≈ N butir)`.
   - The default weekday is the next usual weekday from today, today included.
4. **Most frequent SKUs:** the top 5, each with its share of orders in the window.
5. **Per month:** rows are SKUs, then egg products; columns are calendar months, newest first, up to 6. The current month is labelled "so far". The table scrolls sideways inside its own wrapper, never the page.
6. **Day of month:** a 1–31 strip, shaded by how often an order fell on that date. Labelled "needs ~3 months of history" while the span is under 90 days.

- **Empty state** (no orders in the fetched range): "No Purchase Orders for <buyer> yet."
- **Loose-egg lines** (no SKU) count in Buy, egg totals and Per month egg rows, but not in Prep or the SKU rankings.

**SKUs** (`src/components/catalog/BuyerSkuPins.tsx`):
- **Admin:**
  - A checklist of all active SKUs in catalog order: code, name, and "N orders in 8 weeks".
  - **Suggest from history** ticks every SKU ordered in the last 56 days. It adds ticks and never removes them. Nothing is saved until **Save**.
  - **Cancel** discards edits. Leaving with unsaved ticks also discards them, with no prompt: there are at most 22 checkboxes.
- **Non-admin:** a read-only list of the pinned SKUs, or "No SKUs pinned — the order form shows all SKUs."

**DCs:** the DC badges, plus an admin-only "Manage DCs" button that opens the existing `BuyerDcsDialog`.

## Component 6 — Insight rules (`src/lib/buyerProfile.ts`, pure, no React)

Input: the buyer's orders (`outflow_date`, `order_lines`, `egg_totals`), the catalog SKUs (code → is box SKU), `today` (local yyyy-MM-dd), and `conversionMap` (for `≈ butir`). Dates are handled as yyyy-MM-dd strings. Weekdays come from `new Date(y, m − 1, d)`, so there are no timezone shifts.

- **Window W:** the 56 days ending on the **anchor**, which is the later of today and the latest delivery date. POs are sometimes entered before the delivery day. "Today" in the weekday rule below means the anchor. **Order-day:** a delivery date with at least one order. Several orders on one date (different stores or DCs) are summed per day before any median is taken.
- **Weekday pattern:** for each weekday `d`:
  - `available` = dates in `[max(W start, first order date in data), today)` with weekday `d`, plus today if today is an order-day.
  - `weeksWithOrder` = the order-days among those dates.
  - **Usual** when `available ≥ 1` and `weeksWithOrder / available ≥ 0.5`.
- **Next likely day:** the first usual weekday, counting from today and including it. If no weekday is usual, the weekday with the most orders in W. If W has no orders, there is no typical section.
- **Typical day `d`:**
  - Prep: for each SKU, take the per-order-day summed `packQty` on the order-days of weekday `d`, then the median over the days the SKU appeared. Report `x` appeared of `y` order-days. Unit is `box` when the SKU has `basePackCode`, else `pack`. Sort by `x` desc, then median desc.
  - Buy: the same median over `egg_totals` per egg product, in native units.
- **Most frequent:** the share of orders in W whose lines contain the SKU. Top 5 by share; ties go to the larger total quantity.
- **Per month:** sums over the fetched range, bucketed by `outflow_date` month: SKU `packQty`, and egg `quantity` per product. Columns start at the first month with data (6 at most).
- **Day of month:** for each day 1–31, `order-days on that day / dates with that day number inside the span`. The span runs from the first order date in the data to today. For example, with a 30 Sep–22 Oct span, day 30 has denominator 1, because 30 Oct hasn't happened yet.
- **Thin data:** `spanDays` = today − first order date + 1. The banner shows when `spanDays < 56`; the day-of-month label shows when `spanDays < 90`.
- **Suggest:** the set of SKU codes that appear in order lines within W.
- **`groupSkusForBuyer`** (Component 3) lives in this file too.

## i18n

Every new string goes in both `src/locales/en.ts` and `id.ts`, under a new `buyerProfile` block:
- Section titles, plus the banner and empty-state copy.
- "Other SKUs", "Suggest from history", "Pick a buyer", and the stats lines.
- Units `pack` / `box`.
- Weekday names, from the app's existing date locale where one is available.

## Error handling and edge cases

- **Buyer renamed:** history is matched by the `buyerName` snapshot, so a rename hides past orders from the profile. The existing rename warning already says this. No change.
- **Pinned SKU later deleted or deactivated:** it is ignored by the dropdown and the checklist. Its id stays in the array, which is harmless and gets dropped on the next Save.
- **Offline:** the dropdown uses the cached buyers list; with no cache it behaves as today. The profile needs a connection, and its Planning section shows the load-error state while offline.
- **Concurrent edits:** last Save wins. That is acceptable for 9 buyers edited by admins.

## Testing

- **`src/lib/__tests__/buyerProfile.test.ts`** (vitest):
  - `groupSkusForBuyer`: empty list, inactive or unknown pins ignored, catalog order kept.
  - Weekday `available` logic, including today with and without an order.
  - Per-day summing before the median (two orders on one date).
  - Box vs pack unit, and native egg totals.
  - Frequency share and ties.
  - Month buckets and "so far".
  - Day-of-month denominators, thin-data thresholds, and Suggest within W only.
- **Migration check:** after applying, the view count matches the distinct-metadata count, and OSAVE's weekday counts match the brainstorming spot-check (Wed 4/4, 21 orders; Sun 0).
- **Manual checks:**
  - At 375px (phone): no sideways scroll on the list, profile or month table.
  - Tablet landscape split.
  - A non-admin sees read-only SKUs and no edit buttons.
  - The PO dropdown shows the two groups for OSAVE, and one group for a buyer with no pins.
- **Verify gate:** `npx tsc --noEmit -p tsconfig.app.json` and `npm test -- --run`. The repo has no `npm run verify` script.

## Rollout

1. Apply the migration and regenerate types. This is additive, so the current frontend is unaffected.
2. **Phase 1 — pins:**
   - The `useBuyers` mapping and mutation, `groupSkusForBuyer`, and the dropdown groups.
   - `usePurchaseOrders` plus the Suggest and order-count helpers.
   - `BuyerSkuPins`, opened in a dialog from a pin icon on the current Buyers table row, next to "Manage DCs".

   This ships the daily time-saver first.
3. **Phase 2 — profile:**
   - The card list, drill-down and tablet split.
   - `BuyerProfile` with Planning, SKUs and DCs, and the remaining insight rules.
   - The same `BuyerSkuPins` component moves into the SKUs tab, and the row's pin icon goes away.

Each phase can merge on its own.

## Out of scope

- Per-DC lists; hiding off-list SKUs; auto-maintained pins.
- Per-buyer packaging and box profiles (separate planned idea).
- A cross-buyer "this week's expected orders" view; prefilling a PO from the typical order.
- Importing older PO history from the "[JS Online] Daily Monitoring Stock" sheet. That would deepen insights, but it is its own project.
- Database-level admin-only enforcement for buyers, DCs or pins. Today's catalog is UI-gated, and changing that is a separate security decision.
