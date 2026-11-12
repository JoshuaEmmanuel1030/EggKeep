# Penyesuaian Stok Fisik Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins one button on Stok Fisik that resets EggKeep's egg stock to today's physical count (JS + Loaded).

**Architecture:** A security-invoker SQL function computes each line. A SECURITY DEFINER RPC re-checks the preview and applies it atomically: an inflow for each increase, and a call to `record_order_outflows` for each decrease. A new `stock_adjustments` header is referenced by `stock_adjustment_id` on inflows/outflows. Reports exclude those rows from sales/receipts:
- recon views get a new `penyesuaian` column and jenis;
- the dashboard velocity and trajectory skip them.

**Tech Stack:** Postgres (Supabase), React/TS, vitest, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-12-stok-fisik-penyesuaian-design.md`

## Global Constraints

- **Target:** `target = JS + Loaded`. TST is ignored. Today only (`(now() at time zone 'Asia/Jakarta')::date`). A short line clamps to 0 with `shortfall` > 0.
- **Scope:** egg item types only, not `is_retakan`, not deleted, and only those with a `js_warehouse` row today.
- **Native units:** no kg↔butir conversion anywhere.
- **No client FIFO:** decreases go through `record_order_outflows`.
- **Stock readers don't filter voided returns:** stock computations must not filter `returns.voided_at`.
- **Text:** adjustment rows use `invoice_supplier = 'PENYESUAIAN STOK FISIK'`, and the confirm word is `SESUAIKAN` (not translated).
- **i18n:** every user-facing string goes in both `src/locales/en.ts` and `id.ts`.
- **Production:** never run SQL tests on production. The migration is applied to production only with the owner's explicit OK, and before the frontend push.

---

### Task 1: Migration — table, columns, preview and apply RPCs + SQL tests

**Files:**
- Create: `supabase/migrations/20261112000000_stock_adjustments.sql`
- Create: `supabase/tests/stock_adjustment.sql`

**Interfaces:**
- **Produces:** `public.stock_count_adjustment_preview()` returns a table with these columns:
  - `item_type_id uuid`, `product text`, `unit text`
  - `physical_js numeric`, `physical_loaded numeric`, `target numeric`
  - `book_at_count numeric`, `book_now numeric`
  - `delta numeric`, `applied numeric`, `shortfall numeric`
- **Produces:** `public.apply_stock_count_adjustment(p_expected jsonb) returns jsonb` (`{id, lines}`).
  - `p_expected` is `[{item_type_id, delta}]`.
  - Errors: `AUTH_REQUIRED`, `NOT_ADMIN`, `NO_COUNT_TODAY`, `PREVIEW_STALE`, `NOTHING_TO_ADJUST`.
- **Produces:** column `stock_adjustment_id uuid` on `inflows` and `outflows`, and the table `stock_adjustments`.

- [ ] **Step 1: Write the SQL test**

`supabase/tests/stock_adjustment.sql` runs in one transaction ending in `ROLLBACK`. It follows the `supabase/tests/phase2_returns.sql` pattern: temp id map, `pg_temp.as_user`, throwaway auth users, and `user_roles` admin for user `ADM`. Product `TEST ADJ P` (butir) gets:
- batches dated yesterday (100) and the day before (50);
- a sale dated yesterday (30) → book at close of yesterday = 120;
- a sale dated today (10) → book_now = 110;
- a count today: JS 90, Loaded 20 → target 110, delta −10, applied −10, after 100 (= 110 − 10 today).

Cases:
- **A1:** preview line matches the numbers above.
- **A2:** non-admin apply → `NOT_ADMIN`.
- **A3:** wrong expected delta → `PREVIEW_STALE`.
- **A4:** admin apply → one outflow with `stock_adjustment_id`, FIFO deduction from the oldest batch, an activity log with `orderType 'stock_adjustment'` + `relatedEntryId`, and `book_now` = 100.
- **A5:** apply again with the new preview → `NOTHING_TO_ADJUST`.
- **A6:** recount JS 95 → delta +5 → apply writes one inflow (5, remaining 5, adjustment id).
- **A7:** `void_outflow` on the A4 outflow → preview delta returns to −10 relative to the new state.
- **A8:** product `TEST ADJ Q` with count JS 500 vs book 40 → delta +460. Product `TEST ADJ R` with JS 0 vs book 40, minus an order of 15 today → delta −40 and book_now 25, so applied −25 and shortfall 15.
- **A9:** `reconcile_inventory()` has no `TEST ADJ%` rows.
- **A10:** no count today for a fresh admin run after deleting today's counts → `NO_COUNT_TODAY`.

- [ ] **Step 2: Write the migration** with the full SQL in the file (table + RLS select policy, two FK columns + partial indexes, preview function as `language sql stable`, apply function as `plpgsql security definer`, grants). The rules are in the spec "Server functions" section. The stale check compares deltas with a tolerance of 0.0005, because deltas round-trip through JS doubles.

- [ ] **Step 3: Run the test on a Supabase branch or local stack** (never production): `execute_sql` of the migration, then of the test file. Expect the run to finish without `A<n> failed`.

- [ ] **Step 4: Commit** `feat(stok-fisik): server-side Penyesuaian Stok Fisik RPCs`

### Task 2: Recon views + Export Rekonsiliasi column

**Files:**
- Create: `supabase/migrations/20261112000001_recon_penyesuaian.sql`
- Modify: `src/lib/reconExport.ts`, `src/lib/__tests__/reconExport.test.ts`, `src/lib/__tests__/reconXlsx.test.ts` (only if it asserts column counts), `docs/spec-export-rekonsiliasi.md` §5
- Modify: `src/integrations/supabase/types.ts` (`v_recon_ledger` / `v_recon_daily` gain `penyesuaian`)

**Interfaces:**
- **Consumes:** `inflows.stock_adjustment_id` and `outflows.stock_adjustment_id` (Task 1).
- **Produces:** `ReconLedgerRow.penyesuaian: number | null`, `ReconDailyRow.penyesuaian: number`, and jenis `"penyesuaian"`.

- [ ] **Step 1: Failing test:** in `reconExport.test.ts`, a ledger row with jenis `penyesuaian`, `penyesuaian: -25`, and a daily row with `penyesuaian: -25`. Assert:
  - Harian header includes `Penyesuaian` between `Retur Restock` and `Stok Akhir`, with cell −25;
  - Transaksi has `Penyesuaian` after `Retur`;
  - Ringkasan has `Total Penyesuaian` after `Total Retur Restock` and sums it;
  - `Versi skema` is 3.
- [ ] **Step 2: Run** `npm test -- --run src/lib/__tests__/reconExport.test.ts` and expect FAIL.
- [ ] **Step 3: Migration.** Restate `v_recon_ledger` from `20261103000000_delivery_lines_void_return.sql` §11 verbatim, except:
  - **Inflow branch:**
    - jenis `case when i.stock_adjustment_id is not null then 'penyesuaian' when rr.id is not null then 'return_retakan' else 'inflow' end`;
    - `masuk` null when adjustment;
    - new trailing movement column `penyesuaian` = `i.quantity_butir` when adjustment, else null.
  - **Outflow branch:**
    - jenis `'penyesuaian'` first when `o.stock_adjustment_id is not null`;
    - `keluar_po` / `keluar_tunai` null for it;
    - `penyesuaian` = `-o.quantity_butir`;
    - `tanpa_log` false for it.
  - **Returns and stock_count branches:** `null` for `penyesuaian`.
  - **Final select:** `m.penyesuaian` appended as the last column.

  Then restate `v_recon_daily` with `penyesuaian` summed in `sums`, carried in `roll`, included in `stok_akhir` and in `stok_awal`, and appended last. Re-grant as before.
- [ ] **Step 4: Code** — `reconExport.ts`:
  - add jenis `"penyesuaian"` to the type and `RECON_JENIS`, and the fields to both row interfaces;
  - Harian column `col("Penyesuaian","qty",13)` + cell `d.penyesuaian`;
  - Transaksi column after Retur + cell `r.penyesuaian`;
  - Ringkasan `Total Penyesuaian` (17) + accumulator;
  - `RECON_SCHEMA_VERSION = 3`.

  `docs/spec-export-rekonsiliasi.md` §5 lists the new columns.
- [ ] **Step 5: Run** the recon tests and `reconViewsSync`, and expect PASS. Apply the migration on the test branch and select one row from each view.
- [ ] **Step 6: Commit** `feat(recon): report Penyesuaian Stok Fisik as its own column`

### Task 3: Client types + dashboard excludes adjustments from flow

**Files:**
- Modify: `src/integrations/supabase/types.ts` (`inflows` / `outflows` Row/Insert/Update + `stock_adjustments` table + the two functions)
- Modify: `src/types/inventory.ts` (`stockAdjustmentId?: string` on `InflowEntry`, `OutflowEntry`)
- Modify: `src/hooks/useInventorySync.ts` (map `row.stock_adjustment_id ?? undefined`)
- Modify: `src/lib/inventory.ts` (`averageDailyOutflow` skips `o.stockAdjustmentId`)
- Modify: `src/components/InventoryDashboard.tsx` (trajectory skips adjustments; focus cards' in/out totals skip them, but the level line keeps them)
- Test: the existing inventory lib test file (`src/lib/__tests__/inventory*.test.ts`)

**Interfaces:**
- **Consumes:** the column from Task 1.
- **Produces:** `OutflowEntry.stockAdjustmentId`, `InflowEntry.stockAdjustmentId`.

- [ ] **Step 1: Failing test:** `averageDailyOutflow([{...sale 10}, {...adjustment 1000, stockAdjustmentId: "x"}], "P", 14, now)` returns `10/14`.
- [ ] **Step 2: Run it** and expect FAIL (`1010/14`).
- [ ] **Step 3:** In `averageDailyOutflow`, add `&& !o.stockAdjustmentId` to the filter. Then:
  - Trajectory: add `&& !i.stockAdjustmentId` / `&& !o.stockAdjustmentId` to the three filters.
  - `focusFlows`: the `dailyIn` / `dailyOut` filters skip adjustments. Add `dailyAdj` (adjustment inflows − adjustment outflows per day), and set `net = in − out + adj`, so the level line stays true.
- [ ] **Step 4:** `npx tsc --noEmit -p tsconfig.app.json` + the test, and expect PASS.
- [ ] **Step 5: Commit** `feat(dashboard): keep Penyesuaian Stok Fisik out of sales speed and trend`

### Task 4: Button + preview dialog

**Files:**
- Create: `src/lib/stockAdjustment.ts`
  - `AdjustmentLine` type
  - `fetchAdjustmentPreview(): Promise<AdjustmentLine[]>`
  - `applyAdjustment(lines): Promise<void>`
  - `adjustmentErrorCode(err): "PREVIEW_STALE" | "NOTHING_TO_ADJUST" | "NOT_ADMIN" | "NO_COUNT_TODAY" | null`
  - `CONFIRM_WORD = "SESUAIKAN"`
- Create: `src/components/StockAdjustmentDialog.tsx`
- Create: `src/components/__tests__/StockAdjustmentDialog.test.tsx`
- Modify: `src/pages/StockCount.tsx`, `src/locales/en.ts`, `src/locales/id.ts`

**Interfaces:**
- **Consumes:** both RPCs (Task 1).
- **Produces:** `<StockAdjustmentDialog open onOpenChange onApplied unitOf />`.

- [ ] **Step 1: Failing component test.** Mock `supabase.rpc`:
  - The preview returns two lines (one clamped).
  - The dialog renders product rows and the shortfall flag.
  - Confirm is disabled until the admin types `SESUAIKAN`.
  - Clicking calls `apply_stock_count_adjustment` with `p_expected = [{item_type_id, delta}]` in the shown order, then `onApplied` is called.
  - A `PREVIEW_STALE` error re-calls the preview.
- [ ] **Step 2: Run it** and expect FAIL (module missing).
- [ ] **Step 3: Implement.**
  - **lib:** thin rpc wrappers using `(supabase.rpc as any)` (repo pattern).
  - **Dialog:** shadcn `Dialog`, a table (product, Stok Fisik, EggKeep at yesterday's close, change, after = `book_now + applied`), the confirm input, and destructive confirm and cancel buttons. Toasts: success, nothing, stale (then reload), error.
  - **StockCount:**
    - `useUserRole().isAdmin`;
    - `savedDraft` snapshot set in the seeding effect;
    - `dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft)`;
    - the button shows when `isToday && isAdmin && records.some(r => r.location === "js_warehouse")`, is disabled when `dirty` (with a hint), and `onApplied` calls `refetch()` from `useInventorySync`.
  - **i18n keys** under `stockCount`:
    - `adjustButton`, `adjustSaveFirst`, `adjustTitle`, `adjustIntro`;
    - `adjustColPhysical`, `adjustColBook`, `adjustColChange`, `adjustColAfter`;
    - `adjustShortfall`, `adjustTypeToConfirm`, `adjustConfirm`, `adjustCancel`;
    - `adjustSuccess`, `adjustNothing`, `adjustStale`, `adjustNotAdmin`, `adjustNoCount`, `adjustError`, `adjustLoading`.
- [ ] **Step 4: Run** the component test and the `stockCount` tests, and expect PASS.
- [ ] **Step 5: Commit** `feat(stok-fisik): admin button to adjust stock to today's count`

### Task 5: Verify, review, PR

- [ ] `npm run verify` (Supabase ref guard + tsc + full vitest).
- [ ] Run a `data-integrity-reviewer` agent (model opus) on the branch diff, and fix confirmed findings.
- [ ] Update `CLAUDE.md` with a short "Penyesuaian Stok Fisik" section: RPC names, the `stock_adjustment_id` rule for business readers, and the recon column.
- [ ] Ask the owner before pushing and opening the PR, and separately before applying the two migrations to production (migrations first, then merge).
