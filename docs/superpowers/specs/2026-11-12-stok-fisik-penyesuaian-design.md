# Penyesuaian Stok Fisik: design

**Date:** 2026-11-12 · **Status:** approved by the owner in chat, spec for review

## Problem

EggKeep's book has drifted far from the physical counts on several products. The causes are unentered orders, duplicate inflows, unrecorded Kas Tunai and the thousands-dot bug (audit: `masuk-dot-audit.md`). EggKeep is in beta, so the owner wants one admin button that resets the book to the latest physical count instead of rebuilding each error.

## Owner decisions (2026-11-12)

1. **Target = JS + Loaded.** TST warehouse stock is not in EggKeep until it moves to JS. Loaded stock is still on the book because its deliveries are dated the count day.
2. **Today's count only.** The button refuses any count not dated today (WIB).
3. **Short stock goes to 0.** If a product must lose more than EggKeep holds, it drops to 0 and the shortfall is flagged.

## What the button does

The button sits on the Stok Fisik page, for admins only, on today's date. It covers each egg product that has a `js_warehouse` row in today's `stock_counts`, except RETAKAN children (`is_retakan`):

- `target` = JS + Loaded (a missing Loaded row counts as 0).
- `book_at_count` = EggKeep's stock at the close of yesterday, computed as `book_now − movements dated today or later`, where:
  - `book_now` = Σ `remaining_butir` of live inflows (the same pool FIFO draws from).
  - Movements = live inflows (+), live outflows (−) and `return_restocks` of returns on live outflows (+, by `return_date`). All are matched by product name and category `egg`.
  - Adjustment rows (`stock_adjustment_id` set) are **not** movements. They count as part of the book at count time.
  - "Today" is `(now() at time zone 'Asia/Jakarta')::date`. A movement whose `date` text is not a valid date counts as before the count.
- `delta` = `target − book_at_count`.
- `applied` = `delta` if ≥ 0, else `−min(−delta, book_now)`. `shortfall` = `applied − delta` (> 0 only when clamped).

The result after the button is `target + today's real movements`. Entries already made today survive.

**Why adjustments count as book at count time:** pressing again recomputes `delta` as 0, so a second press is a harmless no-op. A recount later the same day applies only the difference. Voiding an adjustment row in Activity brings its delta back. This replaces the "once per day" rule shown in chat: same safety, no extra state.

## Data

Migration `20261112000000_stock_adjustments.sql`:

- `stock_adjustments` (`id`, `count_date`, `applied_by uuid`, `applied_by_email`, `applied_at`, `lines jsonb`). `lines` holds every computed line, including zero and clamped ones. RLS: authenticated SELECT only. Rows are written by the RPC.
- `inflows.stock_adjustment_id` and `outflows.stock_adjustment_id` (nullable FK to `stock_adjustments`, partial index). Same pattern as `inflows.return_id` / `outflows.void_return_id`.

## Server functions

- `stock_count_adjustment_preview()`: stable, security invoker. Returns one row per covered product: `item_type_id, product, unit, physical_js, physical_loaded, target, book_at_count, book_now, delta, applied, shortfall`. It raises `NO_COUNT_TODAY` when today has no JS rows.
- `apply_stock_count_adjustment(p_expected jsonb)`: SECURITY DEFINER, all in one transaction. `p_expected` is `[{item_type_id, delta, applied}]` as the dialog showed it:
  1. `has_role(auth.uid(), 'admin')`, else `NOT_ADMIN`.
  2. `pg_advisory_xact_lock` so two admins can't double-apply.
  3. Recompute the preview. If a product is missing, or its `delta` or `applied` differs from `p_expected` by more than 0.0005, raise `PREVIEW_STALE`. If every `applied` is 0, raise `NOTHING_TO_ADJUST`.
  4. Insert the `stock_adjustments` row.
  5. For `applied > 0`: insert an inflow (date = today, `invoice_supplier` `PENYESUAIAN STOK FISIK`, `remaining = quantity`, `item_type_id`, `stock_adjustment_id`).
  6. For `applied < 0`: call `record_order_outflows` for the deduction, so FIFO lives in one place, then stamp `stock_adjustment_id` on the new outflow rows.
  7. One `activity_logs` row per line: `relatedEntryId`, `orderType: 'stock_adjustment'`, `stockAdjustmentId`, `client_id 'server:stock_adjustment'`. This makes each line voidable from Activity with the existing Void.
  8. Return the header id and lines.

**Guards** (`20261112000002_stock_adjustment_guards.sql`; old phone bundles still show the buttons, so the refusal is server-side):
- `correct_order` raises `IS_ADJUSTMENT` on an adjustment line. An edit would void it and re-record a plain outflow without `stock_adjustment_id`: a fake Kas Tunai sale, and the delta reopens.
- A `BEFORE INSERT` trigger on `returns` raises `IS_ADJUSTMENT` for an adjustment outflow. A restock would put stock above the count.
- The app hides Record return and Edit Kas on these lines. Void stays.

Nothing here touches `reconcile_inventory` or `recalculate_inventory_fifo`. The ledger invariant holds because the new rows are plain inflows, outflows and FIFO deductions.

## UI

- On `StockCount.tsx` (today, admin, at least one saved JS row, no unsaved edits): a destructive button labelled **Sesuaikan stok ke Stok Fisik**.
- A new `StockAdjustmentDialog.tsx`:
  - Shows the preview table: product, Stok Fisik (JS + Loaded), EggKeep at yesterday's close, change, EggKeep after, and a red flag on shortfall. Numbers are in native units, using the page's existing formatters.
  - The confirm button stays disabled until the admin types `SESUAIKAN`.
  - `PREVIEW_STALE` reloads the preview with a notice. `NOTHING_TO_ADJUST` shows an info toast.
  - On success it refreshes inventory and shows a toast.
- Activity needs no code change. The rows show `PENYESUAIAN STOK FISIK` as their supplier/customer, and adjustment outflows sit under Kastun in the feed (deliberate, v1).
- All strings go in `en.ts` and `id.ts`.

## Not a sale, not a receipt

- **Export Rekonsiliasi:**
  - `v_recon_ledger` gives adjustment rows jenis `penyesuaian` and a new signed column `penyesuaian` (+ in, − out). Their `masuk`, `keluar_*` and `retur` are null.
  - `v_recon_daily` sums `penyesuaian` into `stok_akhir`.
  - The client adds a **Penyesuaian** column to Harian, Transaksi and Ringkasan. `RECON_SCHEMA_VERSION` goes to 3, and `docs/spec-export-rekonsiliasi.md` §5 is updated.
- **Dashboard:** `averageDailyOutflow` and the 7-day trajectory skip rows with `stockAdjustmentId`. `useInventorySync` maps the column.
- **Out of scope** (still count adjustments as normal flow, follow-up):
  - the assistant Edge Function;
  - the unpushed Insight page;
  - old phone bundles, until they update. They show correct stock but distorted speed and trajectory.

## Testing

- **SQL:** `supabase/tests/stock_adjustment.sql`, run on a Supabase branch or local stack, never prod. It covers:
  - a plus line, a minus line and a clamped line;
  - a second press is `NOTHING_TO_ADJUST`;
  - a recount applies the difference;
  - voiding a line brings its delta back;
  - non-admin is refused; a stale preview is refused;
  - today's earlier entries survive;
  - `reconcile_inventory()` shows zero drift afterwards.
- **Vitest:**
  - dialog: preview render, confirm gated on `SESUAIKAN`, RPC called with the shown deltas, stale handling;
  - velocity and trajectory exclude adjustments;
  - recon builders place Penyesuaian;
  - `reconViewsSync` still passes.
- `npm run verify` before push.

## Rollout

Apply the migration first; it's backward compatible (new table, nullable columns, new functions, views gain a trailing column). Then push the frontend.

The first real use is the owner's choice: count in the morning, then press.

**Ship order.**
- Stok Fisik reads counts with `parseQtyInput` (ported from `claude/quirky-saha-97564d`). Before this branch a mistyped "12.000" saved as 12 only skewed the variance; now it would reset stock.
- Ship after the inventory paging fix (PR #23): `useInventorySync` stops at 1000 rows, so a + adjustment can be missing from the dashboard.

**Known limits (review 2026-11-12).**
- The cut-off is the date, not the moment of the count. Anything dated today counts as after the count. So count before the day's first delivery in or out, with trucks loaded the night before under Load. The dialog says so.
- A row dated before the count that is entered or voided after the press moves the book off the count. Nothing flags it; pressing again the same day fixes it.
- A + adjustment is a fresh batch dated today, so freshness and clearance signals restart for that stock.

The branch is cut from `main`. Unpushed `claude/quirky-saha-97564d` (StockCount.tsx) and open PR #23 (useInventorySync) touch the same files, so expect small conflicts.
