# Physical Stock Count — Design Spec

**Date:** 2026-08-20
**Status:** Approved for planning
**Author:** Joshua (with Claude)

## Problem

Accounting values JS's inventory as everything the business physically holds, but EggKeep today only reflects the JS-warehouse perpetual ledger (inflows − outflows). Three real pools of stock are unaccounted for in the app:

1. Stock physically in the **JS warehouse**.
2. Stock **pre-loaded onto trucks** the day before for today's deliveries.
3. Stock kept in a **second (TST) warehouse**, which the app has never tracked.

The boss wants a way to capture the true physical stock on hand each morning, split across those three locations — a physical count, deliberately separate from the in/out ledger. The purpose is quantity valuation (accounting applies pricing themselves, outside EggKeep).

## Goals

- A staffer can, each morning, record physical stock per product across three locations: **JS Warehouse · TST Warehouse · Loaded**.
- The app shows **total on hand** per product (JS + TST + Loaded) in the product's native unit.
- The app surfaces a **variance** between the physical JS count and EggKeep's system stock — turning the count into an accuracy check (data-entry accuracy is the company's stated #1 pain point).
- Daily counts are **kept as dated snapshots** so accounting can look back.

## Non-goals (first cut — deliberately deferred, not blocked)

- Rupiah valuation inside EggKeep (accounting values quantities externally).
- Offline capture (like the outflow outbox).
- Per-truck / per-driver / per-destination breakdown of the "Loaded" pool.
- Editing past days' counts.
- Counting non-egg categories (packaging/boxes/labels) — model is extensible to them, but eggs ship first.

## Navigation & placement

- **New routed page** at `/stock-count` (protected, same auth guard as `/`), rendered outside the tab bar. The tab bar (already 8 tabs) does not grow.
- **Entry point:** a 📋 icon button in the app **Header** (top-right, alongside export/logout), reachable from any screen. It carries a subtle amber dot when today's count has not been saved yet — a quiet reminder, no dashboard CTA card.
- The **Dashboard is unchanged.** Focus-egg stats remain the first substantial thing on it.
- The page has a back arrow returning to the Dashboard.
- `Header`'s `onExport` prop becomes optional so the count page can reuse the header shell without a CSV button.

This sets the pattern for future focused workflows: they become their own routed pages reached from the header, keeping the tab bar reserved for always-on operational surfaces.

## Data model

One new table, `stock_counts`. One row per **(date × location × product)**.

| column | type | notes |
|---|---|---|
| `id` | uuid PK, default `gen_random_uuid()` | |
| `count_date` | date, not null, default `current_date` | |
| `location` | text, not null | CHECK in (`js_warehouse`, `tst_warehouse`, `loaded`) |
| `item_type_id` | uuid, not null → `item_types(id)` | catalog link |
| `product` | text, not null | name snapshot (same pattern as `activity_logs`; names remain the operational key pre-UUID Stage C) |
| `category` | text, not null | `egg` for now; column is what makes it extensible |
| `quantity` | numeric, not null | **product's native unit** — kg for kg-eggs, butir otherwise. No kg↔butir conversion (mirrors `remaining_butir` semantics). |
| `system_qty` | numeric, nullable | ledger stock captured **at save time**, meaningful for `js_warehouse` rows only (see Variance) |
| `counted_by` | text | user email |
| `created_at` | timestamptz, default `now()` | |
| `updated_at` | timestamptz, default `now()` | |
| **unique** `(count_date, location, item_type_id)` | | enables upsert on re-save |

**Locations** are a checked text column plus a typed constant in code (`['js_warehouse','tst_warehouse','loaded']`), not a separate table. Adding a location later = edit the constant + CHECK. No locations table until per-location metadata is actually needed (YAGNI).

**No RPC.** Unlike outflows (which need atomic row-locked FIFO), a morning count is independent upserts. Saving the whole count is one batch `upsert` on the unique key. This never touches the outflow pipeline.

**Catalog config addition:** add `count_tolerance` (numeric, nullable) to `item_types`, editable per product in the Catalog dialog next to `low_stock_threshold` and `freshness_days`, in the product's native unit. Code-default fallback: kg products → `1`, butir products → `0` (exact).

## RLS

Mirror existing tables: authenticated users may `select` / `insert` / `update` `stock_counts`. No admin gate — any warehouse user can count. `UPDATE` policy includes `WITH CHECK`.

## Page behaviour

**Components:** a `StockCount` page + a `useStockCounts` hook (fetch-by-date, batch upsert). Reuses `useItemTypes` (product list), the dashboard's `stockSummary` (system stock), `getStockUnit`/native-unit helpers, the existing Indonesian decimal-comma parser (kg inputs), and `butirEquivalent` (cross-product totals).

**Load.** On open, pull today's rows and list every egg product. Each product shows three inputs prefilled from saved values, else blank. Blank = *not counted yet*; `0` = *counted, none there*.

**Edit + save.** Fill numbers → **Save** → one batch upsert on `(count_date, location, item_type_id)`. Re-saving the same day updates rows (editable all day). At save time, `js_warehouse` rows capture `system_qty` from the current ledger. Negative values blocked; kg inputs accept the decimal comma.

**Variance (JS only).** Per product, `Δ = physical JS − system_qty`. Only the JS location has a system counterpart; TST and Loaded show no variance and only add to the total. Rendering:
- `Δ = 0` → green "✓ cocok / matches"
- within tolerance → neutral
- outside tolerance → red with the signed number (e.g. `−40`)

Tolerance is `count_tolerance` per item (default kg→1, butir→0). While typing today, variance previews against the live ledger; once saved, it is pinned to the stored `system_qty` snapshot so history stays honest.

**Totals.** Per product: `Total on hand = JS + TST + Loaded` in native unit. Any cross-product grand total uses `butirEquivalent` — never a raw kg+butir sum.

**History.** A date picker at the top. Today = editable. Past dates load **read-only** as an audit snapshot, with variance drawn from stored `system_qty`.

**"Counted today" indicator.** The header dot clears once any `stock_counts` row exists for today's date.

## i18n

Every user-facing string added to both `src/locales/en.ts` and `src/locales/id.ts` (e.g. "Physical Stock" / "Stok Fisik", location labels, variance labels).

## Testing

Vitest coverage for the pure logic (the risk area):
- Variance computation, including per-item tolerance and the kg-default-1 / butir-default-0 fallbacks.
- Total-on-hand summation per product in native unit.
- Cross-product totals via `butirEquivalent` (no raw kg+butir sums).
- Decimal-comma parsing on kg inputs; negative-value rejection.

## Rollout

1. Apply the migration (new `stock_counts` table + RLS, `count_tolerance` column on `item_types`) via Supabase MCP **before** pushing frontend.
2. Verify gate: `npx tsc --noEmit -p tsconfig.app.json` + `npm test -- --run`.
3. Push frontend to `main` (Vercel auto-build).
