# Raw report: Migration & Rollout Safety Brainstormer (egm-implementation-readiness)

Agent id: a9aa6c5a0c6023763 · Mode: BRAINSTORM · Date: 2026-11-01 · Status: completed
Input: feature_concept.md, sheet_excerpts.md, worktree CLAUDE.md, the section 6 files and every returns/deliveries/expiry/correct_order/buyer_profiles migration. Text below is verbatim as handed back.

---

## Verdict

From the migration and rollout lens, the schema half of the hypothesis is cheap and reversible: one new table, one nullable column, one `create or replace` of `record_return` that mirrors the `sku_code` precedent in `supabase/migrations/20261008000000_returns_sku_code.sql`. The promise that "stock, the activity feed and the log agree" is not delivered by that link, though. The feed keys returns by `(outflow_id, sku_code)`; the link is written only by the new bundle; CLAUDE.md says a phone can run the old bundle indefinitely; and the 136 existing rows can never be back-linked from the client because `returns` has no update policy. So the log will disagree with the feed for every return that comes through the Activities dialog. The genuinely dangerous part is the launch-day import: `record_return` has no undo (returns are select-only, `return_restocks` FK blocks deletion, there is no `void_return`), so a mis-typed unit, a wrong PO on a shared invoice number, a remainder rule applied to a blank cell, or a re-run without deterministic ids writes permanent stock history. The brief must treat the import as a stock migration with pre-flight, dry-run, deterministic ids and a verification query, or drop the warehouse-count import and let admin re-enter the 15 to 31 Oct rows through the new UI, where the cap and the box math are in front of them.

Coverage note: I read every file in section 6 except `QuickOutflowBuilder.tsx` and `PickListDialog.tsx`, which I searched for the parts that matter here (`invoiceRef` is optional with placeholder `t.common.optional` at lines 604-615; `formatButir` at line 46). `GroupedActivityLog.tsx` was read in the return-related ranges (105-134, 360-432).

## Findings

**F1. [Blocker] The import is an irreversible bulk stock mutation with no undo path.**
Dimension: Migration & backward compatibility.
Hazard: `returns` has only a select policy (`C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260904000000_returns.sql` lines 39-42); `return_restocks.return_id references returns(id)` with no cascade (line 29); no `void_return` exists anywhere under `supabase\migrations\`. A restock line increments `inflows.remaining_butir` (`20261008000000_returns_sku_code.sql` line 153) and a retakan line inserts a live inflow (lines 119-122). Reversing a wrong import means hand SQL against `return_restocks`, `inflows.remaining_butir` (under the `inflows_remaining_bounds` check in `20260914010000_inflows_stock_invariants.sql`), the retakan inflows and the returns rows. The concept's section 3 treats this as a "transition" detail.
Requirement: the brief must mandate (a) a pre-flight `select * from reconcile_inventory()` that returns zero rows, else abort; (b) a `--dry-run` mode that prints, per sheet row, the matched PO, resolved `outflow_id`, native quantity, remaining cap and the action, reviewed by the owner before the live run; (c) deterministic line ids so a re-run is a no-op (F3); (d) the written rule that rollback never deletes `returns`, `return_restocks` or retakan `inflows`.

**F2. [Blocker] Shared invoice numbers route returns to the wrong outflow, silently.**
Hazard: `deliveries_invoice_ref_key` is unique on `invoice_ref_norm` (`20261029000001_deliveries.sql` line 29); three refs are shared by two POs each (concept section 2); `buildDeliveryItems` attaches the delivery to the first-recorded PO (`C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\deliveryFlags.ts` lines 63-73) and `useDelivery.ts` line 53 takes `pos[0]`. The cap is per outflow (`20261008000000` lines 72-76), so a return belonging to PO B is checked and restocked against PO A's batches, and passes whenever A sold enough.
Requirement: the import rejects any faktur with more than one live PO and lists it for admin. The UI refuses warehouse entry when `duplicatePos > 0` and shows both POs, until one is re-keyed (`correct_order`, within its 1-hour window) or voided. Void `TEST-Complete` and `TEST2` before launch so the verification set is clean.

**F3. [Major] No idempotency key for the import or for `delivery_lines`.**
Hazard: `record_return` skips a line only when its `id` already exists (`20261008000000` lines 59-61). Open question 2 proposes no DB unique on `delivery_lines`, so a re-run duplicates lines. `uuid` is not in `package.json` (only `@supabase/supabase-js`), so there is no v5 helper on hand.
Requirement: line id = `md5('import|' || invoice_ref_norm || '|' || sku_code || '|' || reason || '|' || disposition)::uuid` (deterministic, no extension); unique index on `delivery_lines (delivery_id, sku_code, reason)` with `on conflict do update`; the import pre-aggregates sheet rows that collapse to one key (faktur 2610421 "N 30" and "N30", both tukar guling). One RPC call per faktur, so a cap rejection rolls back only that faktur (the RPC is atomic per call) and the dry-run output names it.

**F4. [Major] The import must use typed pieces; never the UI's remainder rule, never box-derived pieces.**
Hazard: sheet row 2610448 NO10 "55" has OK 409 + pecah 141 = 550 = 55 x 10, so the 55 is packs, not boxes; 55 x 180 = 9,900 pieces would trip `RETURN_EXCEEDS_OUTFLOW` and roll back the whole call. 43 of the 108 return rows have "Butir OK" blank (e.g. 2610421 N 30, 6 boxes, pecah 300, OK blank): the Phase 2 rule "OK = quantity x eggs per unit - pecah" would restock 600 pieces nobody counted, permanently (F1). 27 rows lack "Tgl Barang Balik". The RPC accepts any historical `return_date` (line 30, used at lines 81 and 121) but never checks `v_line->>'product'` against `outflows.product` (lines 79-83), so a renamed catalog item would create a wrong RETAKAN child.
Requirement: import writes `restock` = Butir OK exactly as typed (blank = no row) and the pecah disposition = Butir Pecah as typed; store-side `qty_returned_pack` stored as typed but flagged in the dry-run where OK + pecah does not equal qty x capacity; `return_date` fallback order stated (Tgl Barang Balik, then Tgl Faktur Balik, then Tgl Kirim); `product` taken from `outflows.product` of the resolved outflow, and the outflow resolved from `activity_logs.metadata.relatedEntryId` for rows with that `invoiceRef`, `voided_at is null`, `category = 'egg'` (the `purchase_orders` view exposes no outflow ids; `src/lib/orderPayload.ts` line 102 is where the id is written).

**F5. [Major] Importing "Butir Pecah" as `retakan` mints RETAKAN stock that does not exist.**
Hazard: retakan inserts a live inflow on "<PRODUCT> (RETAKAN)" (`20261008000000` lines 119-122). The sheet's pecah eggs are broken and billed to Aryo (3,549 Osave pieces unbilled alone). Mapped to `retakan`, the RETAKAN child's on-hand grows by thousands of pieces, and F1 says it stays. The owner's own back-entry used retakan, so the practice has precedent, but it was never applied to this volume.
Requirement: the brief states the import disposition explicitly (`writeoff` is the no-stock option; `retakan` only if the eggs were physically kept) and the verification step records the expected RETAKAN delta before and after.

**F6. [Major] The `delivery_line_id` link does not make the log agree with the feed; old bundles guarantee divergence.**
Hazard: the feed keys returns by `activity_logs.metadata.relatedEntryId` -> `returns.outflow_id` and attributes per `sku_code` (`C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\GroupedActivityLog.tsx` lines 124-133; `src\hooks\usePriorReturns.ts` lines 44-60). The old `src\lib\returnRpc.ts` sends no `delivery_line_id`, and `nullif(v_line->>'delivery_line_id','')::uuid` yields null, which is safe for the DB but means every Activities-dialog return (and the 136 existing rows) shows as "awaiting warehouse" (orange) in the log while the feed and stock already show it. `returns` has no update policy, so the client can never back-fill the link.
Requirement: the log derives warehouse numbers by `(outflow_id in the PO's outflows, sku_code)` exactly as the feed does, with `delivery_line_id` at most as a tiebreaker for same-SKU multi-reason rows. If existing rows are to be linked, it is a one-off SQL in the migration, not client code. See alternative A for dropping the column entirely.

**F7. [Major] New bundle against old DB: silent link loss or hard failure, depending on save order.**
Hazard: if the frontend ships first, the old RPC body ignores the unknown jsonb key, so the return is recorded and the link is lost without error; the deliveries page's `delivery_lines` queries fail. `useOpenDeliveries` already hides on a missing view (`src\hooks\useDeliveries.ts` lines 103 and 127), which is the right degradation pattern.
Requirement: the Phase 2 save order is "upsert `delivery_lines` row, then `record_return`", so a missing schema fails before stock moves. The brief restates CLAUDE.md's "migration before push" with an explicit check the deployer runs: `select 1 from information_schema.columns where table_name = 'returns' and column_name = 'delivery_line_id'`.

**F8. [Major] The two-step save is not atomic.**
Hazard: the line upsert (PostgREST) and `record_return` (RPC) are separate transactions. A network drop or a cap rejection between them leaves a saved store-side line and no return.
Requirement: warehouse numbers are never stored on `delivery_lines` (derived from `returns` only, as the full spec section 4.4 already says); the orange flag is the recovery state; the return outbox (`src\lib\returnOutbox.ts`) is used only once the line id is known. A single `record_delivery_return` RPC that wraps both would be atomic, but it is a larger RPC change than the concept allows; the brief should say which it picks.

**F9. [Major] Box-to-pieces-to-native math would exist in three places.**
Hazard: the RPC only sees native `quantity`; every conversion is client-side. Today it lives in `RecordReturnDialog.tsx` lines 127-147 (box = base pack x `boxCapacityMap`) plus `src\lib\returnsCap.ts` (flat 15.5). The full spec section 4.7 adds a third copy in the `delivery_log` SQL view. A mismatch between the delivery form and the dialog gives either a rejected RPC or a return off by the box capacity.
Requirement: one pure lib function (`buildReturnLines`) extracted from the dialog and used by both entry points; no SQL copy of the constant (keep the export client-side as `src\lib\deliveryExport.ts` already does).

**F10. [Major] The rollback script must be written into the brief now.**
Requirement, in order: (1) revert the frontend (phones on the new bundle keep working as long as the schema stays); (2) `create or replace function record_return` with the full `20261008000000` body; (3) `alter table returns drop column delivery_line_id` (drops the FK with it); (4) `drop view open_delivery_items` and recreate the Phase 1 shape (columns cannot be removed with `create or replace view`; the badge hides itself during the gap); (5) `drop table delivery_lines`; (6) re-run the Phase 1 `expiry_rules` seed. Never touch `returns`, `return_restocks` or `inflows`: linked and imported returns become unlinked history that `reconcile_inventory()` (`20260914020000_reconcile_and_returns_aware_recalc.sql` lines 22-63) still validates.

**F11. [Major] `void_outflow` has no returns guard; `correct_order` does.**
Hazard: `correct_order` refuses with `HAS_RETURNS` after locking the outflow (`20261021020000_correct_order_guards.sql` lines 99-102) and is 1-hour windowed (lines 89-91), while returns arrive 1 to 3 days later, so edits after a linked return are effectively impossible and nothing dangles. `void_outflow` (`20260904000000` lines 185-230) restores only the un-returned remainder, which is correct, but leaves returns pointing at a voided outflow and the retakan inflow in place.
Requirement: Phase 2 suppresses orange/red flags when the PO is voided (Phase 1's `poMissing` pattern) and shows the returns as history. No change to `void_outflow`.

**F12. [Nit] Pre-loading delivery rows: the DB already permits them; do not close the door.**
Evidence: `deliveries` has no FK to a PO (`20261029000001` lines 10-27); the only blocker is the client rule at `src\hooks\useDelivery.ts` line 127.
Requirement: `delivery_lines` must not carry an `outflow_id` or a NOT NULL `qty_ordered_pack`; `sku_code` is free text validated in the UI against `pack_skus.code`; the Phase 2 flags are computed from `deliveries LEFT JOIN delivery_lines LEFT JOIN returns`, not from `purchase_orders` (the Phase 1 view is PO-driven and would never flag a pre-loading row).

**F13. [Nit] `expiry_rules` remap must be idempotent.**
Evidence: the table has no unique key and the seed duplicates on re-run (`20261029000002_expiry_rules.sql`); the Phase 1 report's F8 is still open.
Requirement: remap = `delete from expiry_rules` plus a full re-insert with EggKeep codes, and a unique index on `(coalesce(buyer_keyword,''), coalesce(sku_code,''))`; rollback = re-run the Phase 1 seed.

**F14. [Nit] The reconciliation export changes retroactively after the import.**
Evidence: `v_recon_ledger` dates restock/writeoff returns by `return_date` and matches retakan inflows by `created_at` (`20261029000000_recon_views.sql` lines 116 and 160).
Requirement: run the import before anyone re-reads the 23 to 31 Oct counts, and say in the brief that October's recon days will move. `stock_counts` writes no adjustments to `inflows` (nothing in `20260820000000_stock_counts.sql` touches them), so there is no double-absorption risk.

**F15. [Nit] A service-role script cannot call `record_return`.**
Evidence: `AUTH_REQUIRED` when `auth.uid()` is null (`20261008000000` lines 38-40).
Requirement: the script signs in as a real user (the owner); imported rows carry that `user_id`; the brief names it.

**F16. Rollout checklist the brief should carry (ordered).**
1. Pre-flight on production: `select * from reconcile_inventory()` returns 0 rows; void the two TEST POs; snapshot `select product, sum(remaining_butir) from inflows where voided_at is null group by 1` and `select count(*), sum(quantity) from returns`.
2. Apply the migration (additive): `delivery_lines` + unique index + RLS; `alter table returns add column delivery_line_id uuid references delivery_lines(id)` + index; `create or replace function record_return` (full body = `20261008000000` + the one column and the one `nullif(...)::uuid` value); `expiry_rules` remap; `open_delivery_items` with new flags appended at the end of the column list.
3. Old-bundle check: from a phone that has not updated, record a return via the Activities dialog; confirm the row has `delivery_line_id is null` and the feed shows it.
4. Push the frontend; wait for Vercel; tap the update toast on the office device.
5. Dry-run the import; the owner reviews the unmatched, duplicate-ref and over-cap list.
6. Live import; re-run immediately; confirm zero new rows in `returns` and `delivery_lines`.
7. Verification query (the one that proves stock, feed and log agree):
   ```sql
   -- A. every linked return is feed-attributable and belongs to its delivery's PO (expect 0 rows)
   select r.id from returns r
   join delivery_lines dl on dl.id = r.delivery_line_id
   join deliveries d on d.id = dl.delivery_id
   where r.sku_code is distinct from dl.sku_code
      or not exists (select 1 from activity_logs al
                     where al.action_type = 'outflow' and al.voided_at is null
                       and al.metadata->>'relatedEntryId' = r.outflow_id::text
                       and upper(btrim(al.metadata->>'invoiceRef')) = d.invoice_ref_norm);
   -- B. ledger consistent (expect 0 rows)
   select * from reconcile_inventory();
   -- C. every restock fully allocated (expect 0 rows)
   select r.id from returns r where r.disposition = 'restock'
     and r.quantity - coalesce((select sum(quantity_restored) from return_restocks where return_id = r.id), 0) > 1e-9;
   ```
   Plus, for the import only: per faktur, `sum(quantity x 15.5 for kg products, else quantity)` over its returns equals the sheet's Butir OK + Butir Pecah within rounding.
8. Rollback: F10, in that order.

## Strongest counter-argument to the hypothesis

Agreement between stock, feed and log is a property of reading the same key, not of adding a second one. The feed already reads `(outflow_id, sku_code)`; adding `delivery_line_id` creates a key that only the new bundle writes, so for the lifetime of any old bundle (indefinite), for the 136 existing rows, and for any return recorded from Activities, the log and the feed will disagree, which is the exact failure the hypothesis claims to remove. Meanwhile the hypothesis makes launch depend on an irreversible bulk stock mutation (roughly 21,000 pieces restocked into two-to-three-week-old batches, thousands of pieces minted as RETAKAN stock) that no RPC can undo. The riskiest part of Phase 2 is not the feature; it is the import, and the full spec's own Phase 4 (`2026-10-29-delivery-return-log-full.md` section 11) explicitly said "warehouse pieces are not imported into returns". The concept reverses that without saying why the earlier reasoning no longer holds.

## Simpler alternatives

**A. No `delivery_line_id`, no RPC change.** The log reads returns the way the feed does: resolve the PO's outflow ids from `activity_logs.metadata.relatedEntryId` (the detail already queries `activity_logs` by `invoiceRef` in `useDelivery.ts` lines 26-38) and attribute per `sku_code`. The only migration is `delivery_lines`; rollback is one `drop table`; old and new bundles write identical `returns` rows; the 136 existing rows and every Activities-dialog return are in the log automatically. Gives up: per-reason attribution when one SKU has two reason rows with a physical return (2610556 AMTG Kurang + Ditolak; Kurang has no warehouse side anyway), shown at SKU level instead.

**B. No warehouse-count import.** Import store-side lines and Aryo refs only (what the full spec's Phase 4 said). Admin re-enters the 15 to 31 Oct warehouse counts through the new UI (about 50 to 60 fakturs; the owner's back-entry already covers to 14 Oct), each passing through the cap, the live outflow resolution and the box math with a human looking at it. Gives up: an afternoon of typing, and the script, the deterministic ids, the AUTH_REQUIRED workaround and the dry-run tooling are never built.

**C. No `delivery_log` SQL view.** The Phase 1 export is already built client-side (`deliveryExport.ts`); fill columns 9 to 22 from the same list items. Gives up: nothing; it removes one DB object and the third copy of 15.5.

**D. Aryo ref as a text column on `delivery_lines`.** Phase 3's `return_claims` migration becomes `insert ... select distinct claim_ref` plus a backfill of `claim_id`; the text column can stay as a snapshot. Gives up: nothing in Phase 2.

## Open questions, from the rollout lens

- **Q1 (direct call vs dialog):** neither as stated. Extract the dialog's cap, shared-egg and box resolution into a pure lib and have the delivery form submit through the same `callRecordReturn` path (F9). The delivery form keeps its one-number shape; the second code path to the RPC is what must not exist. Opening the dialog prefilled would also need a new prop because its reset effect (`RecordReturnDialog.tsx` lines 245-257) wipes state on open.
- **Q2 (`delivery_lines` key):** add the DB unique on `(delivery_id, sku_code, reason)`. It is the idempotency key the import needs (F3) and a DB constraint beats UI-only merging. The import pre-aggregates sheet duplicates.
- **Q3 (Aryo ref):** text column now (alternative D). Creating `return_claims` with only `claim_ref` adds a FK and a second table to roll back for no Phase 2 benefit.
- **Q4 (script vs button):** script, with `--dry-run`, deterministic ids, owner sign-in (F15), one RPC call per faktur, and a printed exception list. A button ships one-off code into the bundle forever and cannot back-link existing `returns` rows either. If alternative B is taken, neither is needed.
- **Q6 (reasons with no warehouse side):** keep the line, skip the orange flag for `kurang`, `revisi_po`, `masih_ditanyakan`, `cancel`; this is pure UI, no schema effect.
- **Q7 (expiry remap):** an explicit remap with listed codes plus the unique index (F13), delivered as delete-and-reinsert so it is re-runnable. Prefix or contains matching would avoid the data migration but hides the mapping in code where a new SKU code silently changes behaviour.
