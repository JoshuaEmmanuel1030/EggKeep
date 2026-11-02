# Draft vs. brief reconciliation (egm-draft Step 6.1)

**Draft:** `design_draft.md` (this folder) → final `docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md`
**Brief:** `docs/superpowers/specs/2026-11-01-delivery-return-log-phase2-brief.md`
**Date:** 2026-11-02. Written by the drafting session; the owner decides each line below. The draft was not changed to match the brief on its own.

## Contradictions (the brief decided it one way, the draft another)

1. **Where the monthly "selisih kurang" figure lives.** Brief (M5, owner decision B): "a monthly selisih kurang figure in the export". Draft (§6.5.6, §6.6): the figure is the "Kurang" list chip's total (Σ quantity × pieces_per_unit over `kurang` lines for the selected range), not a cell in the CSV. Reason: the 21-column export is a flat per-line file with the sheet's fixed headers; a summary row would break the layout the brief wants kept verbatim, and the chip gives the number without a download. **Resolved 2026-11-02: the owner chose the export cell.** The 21-column log ends with a blank row and a summary row "Total selisih kurang (butir)" (§6.7.1); the Kurang chip keeps showing the same number on screen.

## Brief items the draft narrowed after the Stage 5 review (zoom-out, 2026-11-02)

- **`returns.delivery_line_id`** (brief D19 "may carry it at no extra risk"; parent task "optional"): **dropped**. Nothing reads it; the feed, the log, the caps and Riwayat retur key by (`outflow_id`, `sku_code`). Recorded in §7 of the draft.
- **Reviewer tick `verified_by` / `verified_at`** (brief D18 "at most one tick that locks nothing", N1 "keep or drop"): **dropped**. No flag, chip or export column reads it; the export's "Catatan Kondisi" prints the note.
- **One migration** (brief Staging step 1): **split into A (feature) and B (`void_return`)**, both before launch, so decision A is kept while each gets its own data-integrity review and rollback.
- **`void_return` "admin-gated in the UI like `void_outflow`"** (brief D19): the UI gate stays, and the server also checks admin-or-author-within-48h (`has_role`), the pattern `correct_order` uses. Stricter than the brief, not contrary to it.
- **`inflows.return_id` backfill** of the 65 existing RETAKAN inflows: **dropped** (heuristic write to production rows); legacy retakan returns cannot be voided (`RETAKAN_INFLOW_MISSING`).
- **`import_key`** (brief M10): **dropped**; the natural unique key (delivery, SKU, reason) is the idempotency key, `source` supports rollback. The import reads the sheet as `.xlsx` with the installed `exceljs`.
- **New rule not in the brief: one physical-return line per (faktur, SKU)**, enforced by the picker and a partial unique index. Without it the per-SKU derived warehouse figures would print on two lines and the Klaim pecah total would double-count. The sheet's own Panduan rule 7 says the same.
- **Concurrency**: the brief's "refuse a second save when returns already exist" stays, plus a re-read right before the RPC; the residual two-admin window is written down as a known limit rather than claimed closed.

## Brief items the draft narrowed after the Stage 6 review (comprehension, 2026-11-02)

- **`lebih` moved to the no-physical-return set** (the brief listed four reasons there: kurang, revisi_po, cancel, masih_ditanyakan). A surplus the store received was never deducted from stock, so a restock for it would inflate stock; it gets a hint like Kurang. October has no `lebih` row.
- **`expiry_rules.shelf_months` added** (the brief's seed used 30 days for "1 Bulan"). The sheet adds a calendar month (19/10 → 19/11, 31/10 → 30/11); the claim's Tgl Expired must match what Osave was told.
- **Voids act per save in the UI** (retakan first, then restock), with the half-voided state and its recovery written down; the RPC still voids one row per call.

## Brief items the draft changed after the Stage 7 review (design critic, structural, style; 2026-11-02)

- **`void_return` is a compensating stock movement, not a reversal in place.** The brief (D19) described reversing `return_restocks` oldest-first with `RESTOCK_CONSUMED` when the restored stock had since been consumed. The design critic verified that `record_order_outflows` sells from the oldest live batch first, which is exactly where `record_return` restocks, so a reversal in place would fail on the first sale after the restock (for Negeri, within hours) and owner decision A would be hollow. The draft now records the opposite movement as its own outflow through the existing `record_order_outflows` RPC (FIFO, tagged `outflows.void_return_id`), which succeeds whenever the product's stock covers the amount. Consequences: `void_outflow`, `reconcile_inventory` and `recalculate_inventory_fifo` are **unchanged** (a voided restock stays a physical fact), so the brief's "every reader of `returns` filters `voided_at is null`" now applies to business views (feed, caps, delivery page, assistant) and **not** to the stock-balance functions; `RESTOCK_CONSUMED` is replaced by `VOID_INSUFFICIENT_STOCK`. **Approved by the owner on 2026-11-02.**
- **`record_return` gains an optional `expected_prior` per return entry** (the non-voided sum the client saw, checked under the outflow lock). The brief wanted "refuse a second save when returns already exist" on the client; the server check also catches the Activities dialog, old bundles and outbox replays, which a client re-read cannot.
- **Two more non-physical reasons**: `lebih` (a surplus was never deducted, so a restock would inflate stock) and `tidak_balik` ("Tidak masuk gudang", closes an orange line whose goods never arrive). The brief's set had four.
- **"Butir diterima" (received pieces) on the warehouse side**, prefilled with line pieces minus prior pieces; OK = received − Pecah. The brief's "OK = quantity × eggs per unit − pecah" cannot express a partial sorting or goods that never all arrived (sheet 2610421).
- **Per-line unit for box SKUs** (box or pak), because Osave returns are sometimes counted in packs (sheet 2610448 NO10 "55" = 55 packs). The catalog `unit_label` is the default; the line snapshots the choice.
- **`expiry_rules.shelf_months`**: the sheet's "1 Bulan" is a calendar month, not 30 days.
- **The line lock narrowed**: once returns exist, only `sku_code` and the physical nature of the reason are locked; quantity, note, ref and expiry stay editable; deletion is allowed with a warning. The brief locked quantity, SKU and reason.
- **Rollback drops nothing** (revoke `void_return`, revert the frontend, keep every additive column and table). The brief's ordered drop list would break phones still on the new bundle and delete the only record of post-launch claims.
- **The inventory-assistant Edge Function** (`getReturnsTool`) is added to the readers that filter voided returns, with a deploy step; the brief's list did not name it.
- **Success signals** (§3.3) added with a four-week review date.

## Brief items the draft changed after the Stage 8 review (intermediate zoom-out, 2026-11-02)

- **`void_outflow` changes after all.** With compensating movements, voiding an order after one of its restock returns was voided would under-restore by the compensated amount (worked example in the draft's §6.3.3). `void_outflow` gains one loop that voids this order's live compensating outflows; `reconcile_inventory` and `recalculate_inventory_fifo` stay untouched.
- **`void_return` voids a whole save group** (every row one `record_return` call wrote for that outflow row and SKU) in one all-or-nothing call, not one row per call; the partly-voided state disappears.
- **`expected_prior` is checked once per outflow row per call**, at the first entry not skipped by the idempotency rule; "Coba lagi" resends the same ids with no client re-read.
- **One migration, not two.** The split bought nothing once the rollback dropped nothing and the frontend needed both halves; one `record_return` replacement, one `data-integrity-reviewer` pass.
- **`tidak_balik` dropped** (the sixth non-physical reason the Stage 6 draft had added): a warehouse outcome on the store-reason axis that would drop Osave lines out of the claim flow. The set is back to five (`kurang`, `lebih`, `revisi_po`, `cancel`, `masih_ditanyakan`).
- `canEditEntry` compares minutes; `ReturnRecord` (unused) is removed; `VOID_INSUFFICIENT_STOCK` dropped in favour of the inner RPC's `INSUFFICIENT_STOCK`.

## Brief items the draft changed after the Stage 9 review (implementation readiness, codebase details, style; 2026-11-02)

- **`void_outflow` changes more than "one loop".** Two reviewers showed independently that once `record_return`'s per-batch cap ignores voided restocks, a corrected return can restock a batch a voided restock still occupies, so today's "deducted − restocks, skip when ≤ 0" either inflates stock or trips `inflows_remaining_bounds` (four counterexamples, now the worked examples of §6.3.3). `void_outflow` now applies per batch `deducted − Σ restocks (voided included) + Σ deductions of this order's compensating outflows`, the state in which the order, its returns and their voids never happened, and refuses with `VOID_BLOCKED` when that would create or destroy stock (the eggs were sold on). `reconcile_inventory` stays unchanged and correct. `recalculate_inventory_fifo` stays unchanged but is no longer claimed as a check: it cannot rebuild a sale that consumed restocked eggs today, and that pre-existing limit is now written down (§8). Brief D19 named none of this; it follows from the compensating model adopted at Stage 7. **Approved by the owner on 2026-11-02 with decision 19.**
- **The UI gate for voiding a return is `useVoidEntry().canEdit`, unchanged.** `canEditEntry` (which the Stage 8 draft planned to switch to minutes) is not what the feed calls. The brief's "admin-gated in the UI like `void_outflow`" is kept as is; the sub-hour window in which the UI offers a void the server refuses is stated and messaged.
- **The import's rollback** deletes imported lines only, and the `deliveries` rows it created only when they carry no app line (the brief's "reversible by delete", narrowed so a post-launch claim ref is never deleted).
- **One PR in four buildable steps** (2a-1 to 2a-4) instead of one undivided phase; an RPC test script (`supabase/tests/phase2_returns.sql`) run on a Supabase branch before the migration is applied to production; the types regenerated from that branch.
- Smaller narrowings: "Butir diterima" must be ≥ 1 (`NO_ENTRIES` mapped); the shared lib's tolerance is one piece's worth, not 0.01 native, and the Retur section shows piece caps with `Math.floor`; `returns.reason` stores the reason code and `buyer_name` the PO's buyer; the feed's Edit pesanan guard reads `anyReturns` (voided included) so it keeps matching `correct_order`; `DEADLOCK` (40P01) mapped to "coba lagi"; both replaced views restated in full `with (security_invoker = true)`; the recon export client, its Retur and Faktur tabs and its drift test follow the view (`RECON_SCHEMA_VERSION` 2); a per-SKU unit rule (`piecesPerUnit`: N30B in box = 150); a first reader for `expiry_rules` (`useExpiryRules`).

## Additions (the draft decides something the brief did not raise, and it touches schema or an interface)

1. **`pack_skus.unit_label` (`'pak' | 'box'`)** (§6.2.5). The brief requires "a per-SKU unit word from the catalog (box / pak), not inferred from boxMode" (B3, D3) but did not name a column. The draft adds one, seeds the four box SKUs (`OSVN10B`, `OSVN10O`, `OSVKP6O`, `N30B`) and snapshots it on the line as `delivery_lines.unit_label`.
2. **`returns.user_email`** (§6.2.2), stamped by `record_return` from `auth.jwt()->>'email'`. The brief says paraf gudang = `returns.user_id`; the app has no profiles table, so the export's "Paraf Gudang" column needs a readable value. Old bundles get it too because the RPC sets it.
3. **`delivery_lines.quantity` allows 0** (`>= 0`, default 0) so a paper-only line with no quantity (sheet row 2610598, "Revisi PO", blank Qty Retur) can exist; the warehouse save requires `> 0`. The brief says "as typed" without a bound.
4. **`reason` is NOT NULL**, so the unique index is `(delivery_id, sku_code, reason)` without the brief's `coalesce(reason,'')`. Same key, no null case.
5. **`void_return` requires a non-empty reason (`REASON_REQUIRED`)**; `void_outflow` does not check. The UI asks for one in both cases.
6. **Which bodies change** (superseding the Stage 5 list, which had replaced `reconcile_inventory` and `recalculate_inventory_fifo` too): `record_return` (caps and `expected_prior`), `void_outflow` (signed restore, §6.3.3), `void_return` (new), and the `purchase_orders` and `v_recon_ledger` views restated in full. `reconcile_inventory`, `recalculate_inventory_fifo` and `correct_order` are untouched (decision log 20, 27). The brief's rule "every reader of `returns` filters `voided_at is null`" applies to business views only; the stock-balance functions must not filter (§6.3.4).
7. **Rollback drops nothing and rolls back no function body** (from Stage 7; the earlier "stop rule" that conditioned the rollback on whether any return had been voided is gone, because no body is ever reverted). The brief's ordered drop list is replaced.
8. **Per-attempt return-line ids also in `RecordReturnDialog`** (not only on the delivery line), so a dialog retry after a timed-out success is a no-op too.
9. **A "Kurang" list chip** (see contradiction 1) and the row-level "Diterima penuh" text.
10. **Who exports / pastes** (brief D12 asked the design doc to decide): the sheet stops for new rows on launch day; nothing is pasted back; the claim CSV is Novi's weekly download; the 21-column export is the owner's archive.
11. **The import also fills Phase 1 header fields** (driver by name, status, Tgl Faktur Balik, PIC) for fakturs with no `deliveries` row yet; the brief said "store-side rows, reasons, refs and expiry". Existing rows are untouched.
12. ~~`inflows.return_id` backfill of the 65 existing RETAKAN inflows~~ withdrawn at Stage 5 (see the first list above): new rows carry the id; legacy retakan returns are voided the same way through the compensating model (RPC test R10), so the backfill has no reader.

## Confirmed as decided by the brief (no divergence)

Decisions 1–19 and owner decisions A–D are carried as written; the decision log in the draft cites each. Open questions in the draft (§9) are the ones the brief left open (Family Mart flag, Astro "N 30", app admin roles, unmatched fakturs).

## Owner answers (2026-11-02)

1. Compensating-outflow void and signed `void_outflow` restore: approved.
2. Monthly selisih kurang: export summary row (brief's choice), chip kept as the on-screen view.
3. Family Mart: `requires_claim_ref` true, set by the migration with Osave.
4. Roles: Novi app admin; Yani and Dila ordinary users.
