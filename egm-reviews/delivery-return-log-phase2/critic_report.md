# Stage 7: Critic Review (egm-design, egm-structural, egm-style; all Opus)

**Target:** `design_draft.md`, FeatureRange lines 1–700 (of 893 at review time) · **Standard:** feature-spec-standard.md for design and structural · **Date:** 2026-11-02
**Reviewer status:** egm-design completed (1 Blocker, 9 Major, 15 Nit) · egm-structural completed (0 Blocker, 3 Major, 14 Nit) · egm-style completed (0 Blocker, 13 Major, 14 Nit)
**Resolution:** `goldfish_review_report.md` (Status: resolved; fixes applied to `design_draft.md` before Stage 8)

## Consolidated findings (ids used in the resolution report)

| Id | Reviewer | Severity | Scope | One-line summary |
|---|---|---|---|---|
| D1 | design | Blocker | §6.3.2, §6.5.7, CUJ 4, §7, §8 | FIFO sells the oldest batches first, so a restocked batch is drained by the next sale and a restock void usually hits `RESTOCK_CONSUMED`; the void order (retakan first) makes the half-voided state the common case; owner decision A is largely not delivered; no mechanism to lower stock. |
| D2 | design | Major | §6.4, §6.5.3, §6.5.5, §4.4 | The shared lib silently clamps over-cap entries (not only rounding); the delivery line checks line pieces against SKU sold pieces, ignoring prior returns; the 15.5 vs catalog-factor dependency is not a listed risk. |
| D3 | design | Major | §6.4, §6.5.5, CUJ 4 | Return-entry id lifecycle unspecified: stale ids after a void make the RPC a silent no-op; edited values after a timeout are "treated as success". |
| D4 | design | Major | §6.5.5, §6.2.1, §6.5.3 | "Tambah retur kedua" has no coherent arithmetic (OK = whole line − Pecah); the re-read rule matches the prior returns that caused the lock. |
| D5 | design | Major | §2, §4.3, §4.4, §6.5.2, §6.9 | Single-input model cannot express "fewer eggs arrived than the faktur says" (sheet 2610421) or Osave returns counted in packs (2610448 NO10 = 55 packs); fractional pieces. |
| D6 | design | Major | §6.2, §8, rollback | Rollback is racy (phones on the new bundle keep calling `void_return` after the count check), breaks new-bundle phones by dropping columns, and drops `delivery_lines`, the only record of post-launch store-side claims. |
| D7 | design | Major | §3, §6.3.3 | `supabase/functions/inventory-assistant/tools.ts` `getReturnsTool` reads `returns` with no void filter; Edge Functions deploy separately; no rollout step. |
| D8 | design | Major | §6.2.1, CUJ 5, §6.5.5 | The edit lock ties store-side facts to stock rows someone else may have recorded (old bundle), and office admin may not be able to void them. |
| D9 | design | Major | §6.9, CUJ 7, §4.3 | Import: 2610421 is two "tukar guling" rows on one SKU (same reason), which the collapse rule misses and ignore-duplicates would silently drop; a partial index cannot be an upsert target; blank Qty Retur rows import as 0; refs not `btrim`med; rows skipped by customer before matching. |
| D10 | design | Major | CUJ 7, §6.10, §7, rollout 8 | UI re-entry of October counts double-counts if the owner already corrected stock after the 23–31 Oct counts; the two routes are mutually exclusive per product. |
| D11 | design | Nit | §6.5.5, §7, §8 | The main double-entry path is the Activities dialog, not two admins; null-SKU returns are invisible to the re-read; an `expected_prior` check in `record_return` was not considered. |
| D12 | design | Nit | §6.3.2 | UI window (`differenceInHours <= 48`, up to 48h59m) differs from the server's 48h. |
| D13 | design | Nit | §6.3.2 | Authorisation runs before the already-voided no-op, so a retried void can fail. |
| D14 | design | Nit | §6.3.2 | (`date`, `created_at`) is not a total order; add `id` as tie-breaker. |
| D15 | design | Nit | §6.3.3, §6.2.3 | `v_recon_ledger`: return rows on voided outflows already overstate; retakan match should use `return_id` when present. |
| D16 | design | Nit | §6.2.4 | `egg_totals.quantity` is `activity_logs.quantity_butir`, not `outflows.quantity_butir`. |
| D17 | design | Nit | CUJ 6, CUJ 7, CUJ 4, §9 | CUJ figures conflict with the sheet (rows vs fakturs, FamilyMart in the Klaim tab, Yani's admin role pending). |
| D18 | design | Nit | §6.7.1 | Qty Diterima rule does not match the sheet for Pecah rows (sheet shows shipped qty). |
| D19 | design | Nit | §7, §6.2 | Split-migration rationale overstates: the frontend needs the void columns anyway. |
| D20 | design | Nit | §6.2.2, §6.7.1 | The 136 existing rows print a blank Paraf Gudama. |
| D21 | design | Nit | §6.2.1 | A new non-physical reason does need a migration (partial index predicate). |
| D22 | design | Nit | §6.6, §6.5.8 | A physical line whose goods never reach the warehouse stays orange forever. |
| D23 | design | Nit | §6.5.1 | Tgl Barang Balik allows dates before Tgl Kirim. |
| D24 | design | Nit | §1, §3 | No success signal for adoption. |
| D25 | design | Nit | §3, §6.7.3 | POs with no faktur number have no place for their No. Retur OSV after the sheet stops. |
| S1 | structural | Major | many | Bare `<placeholder>` tags render as HTML and vanish. |
| S2 | structural | Major | §9 | Open Questions sits out of template order. |
| S3 | structural | Major | §3 | The duplicate-ref warning is stated only inside Non-goals. |
| S4–S17 | structural | Nit | — | Problem/Overview order; Goals/Non-goals unnumbered H3; metadata block; Alternatives "Adopted" row and no Pros; diagram misalignment; mockup frame; `sql` fence fragments; `|`-joined header lists; list-style inconsistencies; heading suffix convention; brief link text and `feature_concept.md` location; glossary placement and missing rows (butir, pak/box, Osave, DC); answered open questions; unnumbered boundary H2. |
| T1–T13 | style | Major | — | "One delivery line per PO line" contradicts the model; "136 lines"; PO line definition excludes loose-egg lines; "claim" has two meanings; where client ids live; bare "admin"; six names for warehouse-done; "save" overloaded; rows vs fakturs vs refs; "caps unchanged" is false; "the call that can fail" unsupported; `void_return` argument predicts the future; "three typists". |
| T14–T27 | style | Nit | — | Unqualified "line"; "physical line" forms; source line numbers next to "line"; subjective qualifiers; "off by up to a day"; dry-run counts; informal wording; synonyms; filler; repetition; long sentences; grammar; range notation. |

## Reviewer reports (verbatim)

### egm-design

# Design Critic review: Delivery & Return Log Phase 2 (FeatureRange, lines 1–700)

**Target:** C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md
**Standard:** C:\Users\Joshua\.claude\plugins\cache\egm\egm\0.1.0\resources\document_standards\feature-spec-standard.md
**Code root:** C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\

I read the persona, the standard, the whole target, CLAUDE.md, the sheet excerpts, and every listed code and migration file. The review is complete. I did not write or change any file.

## Standard compliance

All the core questions are answered:
- **Problem:** §1.
- **Goals and non-goals:** §3.
- **Architecture and data flow:** §6.1–§6.10, including the write order and what each failure leaves behind.
- **Alternatives with reasons:** §7, broad and specific.
- **Risks and limits:** §8, §6.5.5 "Known limit", §6.10.

The Alternatives Rule is met. The problems are in a few load-bearing assumptions, listed below.

## What checks out (verified against code)

- **Lock order.** `void_return`, `record_return` and `void_outflow` all lock the outflow row first. The `returns` row is locked only after it, and neither of the other two locks `returns` rows. So same-outflow calls serialise and cannot deadlock.
- **Void algebra.**
  - Void-after-outflow-void (no stock change) is correct.
  - Outflow-void-after-return-void (needs the new `voided_at` filter in `v_already`) is correct.
  - Both match the `reconcile_inventory` invariant once the filter is added.
- **CUJ 1 arithmetic.** 1,088/15.5 → 70.19; 172/15.5 → 11.10; `nativeToPieces` round-trips to 1,088 and 172.
- **Rounding.** The dialog's running remainder clamps each bucket, so rounding can never exceed the cap.
- **Code citations.** Correct:
  - `RecordReturnDialog` line ranges.
  - `void_outflow` at lines 185–230.
  - `DeliveryDetail.tsx:206`.
  - `canEditEntry`, `stockHintDitolak`, the `useDeliveryStatuses` chunk of 100.
  - `pg_input_is_valid`, which is already used in `20261029000000_recon_views.sql`.
  - The `egg_totals` readers ignore extra keys.
  - `exceljs`, `date-fns` and `@radix-ui/react-collapsible` are installed.
  - The cited function bodies are the latest ones.

---

## Findings

### 1. Blocker: voiding a restock will usually fail, and the void order is backwards
- **Affected scope:**
  - §6.3.2 lines 395–410 and 436.
  - §6.5.7 lines 524–526.
  - §7 line 633 ("the half state is rare (the restocked batch sold within 48 hours)").
  - CUJ 4 line 173.
  - §8 line 657.
- **Finding:**
  - **Restock voids hit `RESTOCK_CONSUMED`.** `record_return` puts restocked eggs back into the outflow's original batches, oldest first. Those were the oldest live batches when the order was sold. `record_order_outflows` (`20260707000000_idempotent_order_outflows.sql` lines 78–86) sells from the oldest batch with stock left. So the next sale of that product takes the restocked eggs first. For NEGERI BIASA, which sells many times a day, the batch drops below `quantity_restored` within hours. After that, `void_return` refuses the restock with `RESTOCK_CONSUMED`. That is the normal case, not a rare one.
  - **Retakan voids are the less likely to fail.** The RETAKAN inflow is the newest batch of its product, so it is sold last.
  - **The void order therefore causes the problem.** "Retakan first, restock second" means the call that usually succeeds runs first, and the one that usually fails runs second. The half-voided state becomes the common outcome.
  - **Owner decision A is largely not delivered.** It exists so admin can fix a wrong save "instead of the owner in SQL". In practice it works only until the next sale of that product.
  - **There is no named way to lower stock.** The fallback ("owner manual correction after the next count") has no stated mechanism for reducing stock. A manual outflow would appear in the reconciliation ledger as a cash sale.
- **Recommendation:**
  - Restate the realistic success window: until the next sale of that product.
  - Reverse the order (restock first), so the likely failure leaves nothing changed.
  - Add a §7 alternative: void a consumed restock with a compensating oldest-first deduction recorded as its own movement. That keeps `reconcile_inventory` at zero and always succeeds while product stock ≥ the amount.
  - Name the owner's downward-correction mechanism.
  - Fix the CUJ 4 recovery. Its shortfall (540 OK) can be re-recorded additively through the dialog. Only an overstated part needs the owner.

### 2. Major: the shared library silently clamps over-cap entries, so the confirmation can show numbers that are never recorded
- **Affected scope:**
  - §6.4 line 461 (running remainder) and line 464 ("the server cap is the guard").
  - §6.5.3 line 495.
  - §6.5.5 step 5 line 511.
  - §4.4 line 147.
- **Finding:**
  - **The clamp is not limited to rounding.** The extracted rule (`handleConfirm`, lines 344–358) does `Math.min(want, eggRemaining)` and silently drops a bucket that reaches 0. Buckets run restock first, so Pecah is the one cut or dropped.
  - **The dialog guards this; the delivery line does not.** The dialog also has `setBucket` to stop over-typing. The delivery line's only block is quantity × pieces-per-unit > SKU sold pieces, which ignores prior returns. Prior returns come from the same SKU ("Tambah retur kedua"), the sibling SKU on a shared egg, or untagged (null-SKU) returns.
  - **Result:**
    - The server never sees the excess.
    - The mapped `RETURN_EXCEEDS_OUTFLOW` message is effectively unreachable.
    - The confirmed arithmetic ("Pecah 172 → Retakan") may not be what is stored. Pecah drives the Aryo claim.
  - **The cap depends on a coincidence.** Outflows convert at the catalog `eggs_per_unit` (`outflowCalculator.ts` line 178, editable in Catalog). Returns convert at a flat 15.5. A full-line return fits only while the two happen to be equal. If the owner edits the factor, the silent clamp starts firing. This is not listed as a risk.
- **Recommendation:**
  - `buildReturnLines` should report clamping beyond rounding, e.g. `{ok:false, exceedsBy}` when the excess is more than 0.02 native.
  - The delivery line should block when pieces > `nativeToPieces(remaining)` (egg level, all SKUs, null-SKU included), before the confirmation.
  - Add the 15.5 versus catalog-factor dependency to §8, with a test or runtime check.

### 3. Major: when return-entry ids are created and reused is unspecified, which can turn a save into a silent no-op or keep the wrong numbers
- **Affected scope:**
  - §6.4 line 464.
  - §6.5.5 steps 2 and 4 (lines 508, 510).
  - CUJ 4 line 172 ("then types Pecah 172 and saves again").
- **Finding:**
  - **Stale ids after a void.** `record_return` skips any id that already exists, voided or not (`20261008000000_returns_sku_code.sql` line 59). The pre-RPC re-read reads only non-voided rows. If the same form instance (the "per form attempt" ref) is reused after a void (CUJ 4), the re-read finds nothing. The RPC is then called with the old ids, the server skips them, and the UI shows "Retur tercatat" with nothing recorded.
  - **Edited values after a timeout.** After a NETWORK failure the doc keeps typed values editable. If the first attempt had actually committed (712 Pecah) and the user corrects Pecah to 172, step 2 sees its own ids, "treats as success", and skips the RPC. Stock keeps 548 OK + 712 R. The total is unchanged, so the mismatch hint does not fire.
- **Recommendation:**
  - Define the id lifecycle: new ids after every success and after every void.
  - When the re-read finds the attempt's own ids, compare the stored quantities and dispositions with the form. On a difference, say so and require a void.
  - Alternatively, freeze the warehouse inputs after a NETWORK failure until the re-read resolves.

### 4. Major: the second sorting event ("Tambah retur kedua") has no coherent arithmetic
- **Affected scope:**
  - §6.5.5 step 6 line 512.
  - §6.2.1 line 268 (quantity locked).
  - §6.5.3 line 495.
  - §6.5.5 step 2 line 508.
- **Finding:**
  - **OK is computed from the whole line.** The warehouse side has one input (Pecah) and OK = quantity × pieces-per-unit − Pecah. For goods back over two days, the line quantity is the whole store-side return and is locked once returns exist.
    - On day 1 that formula restocks the whole quantity, including what has not arrived.
    - On day 2 the same formula records the whole line again.
  - **"Pecah > returned pieces" has no defined basis for a second save.**
  - **The re-read rule mixes old and new returns.** "Any other row means someone else recorded a return since the form loaded" also matches the prior returns that caused the lock in the first place.
- **Recommendation:**
  - Add a "Butir diterima (kali ini)" input for second and partial sortings, defaulting to (line pieces − prior pieces).
  - Make OK = that value − Pecah, and block when the cumulative total exceeds line pieces.
  - Compare the re-read against the set of rows seen at form load, not "any row".

### 5. Major: the single-input model (OK = line pieces − Pecah, box-only units) does not fit the sheet's own data
- **Affected scope:**
  - §2 line 21.
  - §2.1 line 31.
  - §4.3 line 116.
  - §4.4 lines 131–134.
  - §6.5.2 line 491.
  - §6.9 step 5 line 603.
  - Decision 2 line 676.
- **Finding:**
  - **The sheet lets OK + Pecah fall below the returned content.** Its yellow rule flags only "more than the returned packs' content". The excerpts show such rows:
    - 2610421 "N 30": 6 boxes × 150 = 900, Pecah 300, OK blank.
    - The reason "Pecah 19, kurang 2".
  - **Phase 2 would restock eggs that never arrived.** Under Phase 2 the gap is restocked automatically. There is no way to record "fewer eggs arrived than the faktur says", for example eggs used at TST. Imported `lainnya` lines would over-restock on re-entry.
  - **Osave returns come in packs, not only boxes.** 2610448 NO10 "55" is 55 packs (409 + 141 = 550). With `OSVN10O` locked to box × 180, that is 3.0556 boxes. The quantity becomes fractional and pieces become non-integer. For butir-native eggs that means fractional-egg returns.
  - **Unresolved.** The doc flags the import's unit doubt but never says what the fix is.
- **Recommendation:**
  - Let a line's unit be "pak" (base pack eggs) for box SKUs. `unit_label` and `pieces_per_unit` are already per-line snapshots, so this costs little.
  - Add an optional received-pieces override, defaulting to qty × pieces-per-unit.
  - Block pieces that are not whole numbers.
  - Document the unit-doubt remedy for the import.

### 6. Major: the rollback is racy, breaks phones still on the new bundle, and deletes data that exists nowhere else
- **Affected scope:**
  - §6.2 line 232 and §8 line 662.
  - Context, outside the FeatureRange: Detailed Implementation Plan, Rollback lines 880–889 (steps 1–5).
- **Finding:**
  - **The stop-rule check is racy.** Step 1 (revert the frontend) does not stop phones on the new bundle; CLAUDE.md says PWAs run indefinitely. They can still call `void_return` after the step-2 count check and before step 3 drops `returns.voided_at`. That is exactly the drift the stop rule exists to prevent.
  - **Steps 3 and 5 break new-bundle phones** (the doc says they "keep working while the schema stays", but these steps remove it):
    - New-bundle `usePriorReturns` sends `.is("voided_at", null)`. Against a dropped column the query errors and returns nothing. Feed bubbles vanish, the dialog's client-side cap becomes looser than the server's, and "Edit pesanan" is offered on orders that have returns.
    - The `/deliveries` embed of `delivery_lines(*)` fails, taking the Phase 1 page with it.
    - SKU and buyer saves that write the dropped columns fail.
  - **Step 5 is not safe for data.** It is labelled "always safe", but it drops `delivery_lines`. Since the sheet stops on launch day, that table is the only record of post-launch store-side claims (No. Retur OSV, reasons).
- **Recommendation:**
  - Make step 1 "revoke execute on `void_return`" (or drop it) before the count.
  - Leave the additive columns, tables and views in place on rollback. Drop them only once no new-bundle clients remain, or never.
  - Export `delivery_lines` (the 21-column CSV) before any drop.

### 7. Major: one reader of `returns` is missing from "every reader filters `voided_at is null`"
- **Affected scope:** §3 Goals line 42; §6.3.3 lines 442–454; §6.1 lines 212–218; §8.
- **Finding:** `supabase/functions/inventory-assistant/tools.ts` lines 325–363 (`getReturnsTool`) reads `returns` with no void filter. The assistant will report voided returns as real. Edge Functions deploy separately (CLAUDE.md), and the rollout has no Edge Function step.
- **Recommendation:**
  - Add the filter: `.is("voided_at", null)`.
  - Add it to the §6.3.3 table.
  - Add a `deploy_edge_function` step after the void migration.
  - Optionally include `retakan` in that tool's disposition totals while there; it is already missing.

### 8. Major: the edit lock ties store-side facts to stock rows that someone else may have recorded
- **Affected scope:** §6.2.1 line 268; CUJ 5 lines 175–179; §6.5.5 step 6 line 512.
- **Finding:** Quantity, SKU and reason become read-only (and the line undeletable) once any non-voided return exists for the SKU. This happens even if that return came from an old bundle or the Activities dialog before the line existed (CUJ 5).
  - A store-side typo saved after such a return can then be fixed only by voiding the return.
  - Office admin is not the author and may not be app admin (§9 Q3), so they cannot do that void.
  - Given finding 1, the void will often fail anyway.
- **Recommendation:**
  - Lock only `sku_code` and whether the reason is physical, since changing those orphans returns.
  - Keep `quantity` (and switching between physical reasons) editable, and rely on the existing mismatch hint.

### 9. Major: the import silently drops colliding rows, misdescribes 2610421, and leaves gaps in its rules
- **Affected scope:**
  - §6.9 lines 591–607, especially lines 599–604 and 607.
  - CUJ 7 lines 187–191.
  - §4.3 line 123.
- **Finding:**
  - **2610421 is misdescribed and would lose data.**
    - Line 602 calls it "two physical reasons". Both sheet rows are "tukar guling", 6 and 30, with Pecah 300 and 900.
    - The collapse rule as written does not trigger.
    - "Ignoring duplicates on the two unique indexes" would silently drop the second row (30 / 900) from the red chips and the claim CSV.
  - **The duplicate handling as written cannot work.** A PostgREST upsert targets one conflict key, and a partial index cannot be targeted. A violation of `delivery_lines_physical_key` raises 23505 and fails the batch instead of being ignored.
  - **Rows with blank Qty Retur lose their quantity.** 2610448 N30 and 2610598 KpO6 have Qty Diterima but no Qty Retur. They import as quantity 0, so the Kurang total under-counts and the export's Qty Diterima is wrong.
  - **Matching is weaker than Phase 1's.** It is "exact case-insensitive" without btrim, while Phase 1 normalises with `upper(btrim())`.
  - **Rows are skipped too early.** Step 1 skips rows by customer name before matching the ref. Sushitoku 2610304 has an EggKeep-format ref and may be a real PO.
- **Recommendation:**
  - Pre-read existing lines and insert row by row, listing every collision instead of ignoring it.
  - Define how quantities merge for same-SKU, same-reason pairs.
  - For non-physical reasons, derive quantity = PO packQty − Qty Diterima when Qty Retur is blank.
  - Match on normalised refs before skipping by customer.
  - Put the sheet's OK/Pecah figures in the line note (or the dry-run report shown next to the line) so admin can check them before confirming. The post-hoc per-faktur check comes too late if the void then fails.

### 10. Major: re-entering October counts has the same double-count risk the doc used to reject the script import
- **Affected scope:** CUJ 7 line 191; §6.10 line 617; §7 line 636; Non-goals line 53. Context: rollout step 8 offers both routes "either way".
- **Finding:** §7 rejects the scripted warehouse import partly because it "restocks into consumed batches that the physical counts already dispute". UI re-entry with October dates has the same effect on stock. If the owner has already corrected stock after the 23–31 Oct counts, re-entry double-counts, and nothing checks for this. The two routes ("re-enter" versus "one manual inflow per product") are mutually exclusive per product, but the doc does not say so.
- **Recommendation:**
  - Add a precondition: per product, no manual correction since 15 Oct.
  - Compare the current physical-count difference (selisih) with the sheet's October OK total before re-entering.
  - Choose one route per product, not "either way".

### 11. Nit: the concurrency limit is understated, and a cheaper server guard was not considered
- **Affected scope:** §6.5.5 line 514; §7 line 627; §8 line 659.
- **Finding:**
  - **Two admins is not the main double-entry path.** The likelier one is the Activities dialog (new or old bundle, or an outbox replay) recording the same physical return as a delivery line. The re-read does not cover that.
  - **Untagged returns are invisible at the line.** Null-SKU returns on the same egg row (very old bundles, loose rows) are ignored by both the re-read and the mismatch hint.
- **Recommendation:**
  - Add this §7 alternative: an optional `expected_prior` key in `record_return`, i.e. the (outflow, SKU) non-voided sum the client saw, checked under the outflow lock. It needs no line id, has one comparison, and old bundles do not send it.
  - At minimum, show egg-level prior returns, including null-SKU ones, in the confirmation.

### 12. Nit: the void window differs between UI and server
- **Affected scope:** §6.3.2 line 384; line 438.
- **Finding:** `canEditEntry` uses `differenceInHours(...) <= 48`, which truncates, so it allows up to 48h59m. The server refuses after exactly 48h. For about an hour the button shows but the void fails.
- **Recommendation:** Compare minutes in the UI or document the gap.

### 13. Nit: an idempotent retry can fail on authorisation
- **Affected scope:** §6.3.2 lines 380–393; line 435.
- **Finding:** The authorisation and window checks run before the "already voided → return" no-op. A retried void after the window, or by a non-author, raises `VOID_WINDOW_CLOSED` / `NOT_ALLOWED` instead of no-op.
- **Recommendation:** Check `voided_at` first, under the lock.

### 14. Nit: the "identical order → no deadlock" claim needs a tie-breaker
- **Affected scope:** §6.3.2 lines 389–400; line 434.
- **Finding:** Ordering by (`date`, `created_at`) is not total. Two RETAKAN inflows written by one `record_return` call for shared-egg SKUs have identical keys.
- **Recommendation:** Add `i.id` as the final sort key in `void_return`, and note it for the other functions.

### 15. Nit: `v_recon_ledger` changes should go one step further
- **Affected scope:** §6.3.3 line 450; §6.2.3 line 291.
- **Finding:**
  - Return rows on voided outflows already count as `retur` in `v_recon_daily` while the outflow is excluded. This is a pre-existing overstatement.
  - The RETAKAN match by timestamp and quantity misattributes identical same-transaction returns.
- **Recommendation:** Since the void migration replaces this view anyway:
  - Use `coalesce(r.voided_at, o.voided_at)`.
  - Match on `i.return_id` when it is present.

### 16. Nit: the `egg_totals` quantity comes from a different table than the server cap
- **Affected scope:** §6.2.4 lines 295, 306.
- **Finding:** `egg_totals.quantity` is `activity_logs.quantity_butir`, not `outflows.quantity_butir`, which is what the server cap uses. The two are written from the same client payload but nothing guarantees they match. The doc calls it the outflow row's sold quantity.
- **Recommendation:** State the assumption, or expose the outflow's own quantity.

### 17. Nit: CUJ figures conflict with the sheet and with §9
- **Affected scope:** CUJ 6 lines 184–185; CUJ 7 line 191; CUJ 4 line 172 against §9 Q3 line 668; §6.6 line 545; §9 Q1 line 666.
- **Finding:**
  - The sheet's "18" is rows without a return number, not fakturs. The chip counts fakturs.
  - The pecah totals exist only after re-entry.
  - CUJ 4 assumes Yani is app admin; Q3 says the role is pending.
  - The sheet's Klaim tab includes a FamilyMart row (2610397, FMI-2610005), so the claim CSV (Osave-only by default) will not reproduce "60 rows / 3,549".
- **Recommendation:** Restate the CUJ expectations from the app's rules, or tick Family Mart by default.

### 18. Nit: the export's Qty Diterima rule does not match the sheet for Pecah rows
- **Affected scope:** §6.7.1 line 562.
- **Finding:** For 2610319 N10 the sheet has Qty Diterima 86 (the shipped quantity). The rule packQty − quantity gives 79. For Kurang and Ditolak rows the sheet subtracts. A faktur with two lines on one SKU also gives two different Qty Diterima values.
- **Recommendation:** Define the rule per reason and cite the sheet rows.

### 19. Nit: the split-migration rationale overstates its benefit
- **Affected scope:** §7 line 631; §6.2 line 227.
- **Finding:** §7 says a held void migration would not hold up the stock fix. But the frontend needs the void columns (`usePriorReturns` filter, "Riwayat retur"), so a held void migration holds the whole launch either way.
- **Recommendation:** State that the split buys separate review and rollback only, or make the frontend tolerate a missing `voided_at`.

### 20. Nit: existing returns will print a blank Paraf Gudang
- **Affected scope:** §6.2.2 line 282; §6.7.1 line 571.
- **Finding:** The 136 existing rows get no `user_email`, so their Paraf Gudang prints blank.
- **Recommendation:** Add a one-line backfill from `auth.users` inside the security-definer migration, or say they stay blank.

### 21. Nit: adding a new non-physical reason does need a migration
- **Affected scope:** §6.2.1 line 244 against lines 255–258.
- **Finding:** "A new reason must not need a migration" is only true for physical reasons. A new non-physical reason needs the partial-index predicate changed, otherwise it raises 23505.
- **Recommendation:** Say so.

### 22. Nit: some lines can stay orange forever
- **Affected scope:** §6.6 line 541; §6.5.8.
- **Finding:** A physical line whose goods never reach the warehouse (used or sold at TST) has no way to close and stays orange permanently.
- **Recommendation:** Add a "tidak masuk gudang" close action, or tell admin to change the reason.

### 23. Nit: return dates are not bounded below
- **Affected scope:** §6.5.1 line 486.
- **Finding:** Tgl Barang Balik allows dates before Tgl Kirim.
- **Recommendation:** Set the input's minimum to the delivery date.

### 24. Nit: no measure of success
- **Affected scope:** §1, §3.
- **Finding:** The stated problem is adoption (Phase 1 left one test row), but the spec defines no adoption or success signal and no fallback if admins keep using the sheet.
- **Recommendation:** Add, for example, "returns per week since launch", "orange count trend" and "sheet rows after launch = 0", with a review date.

### 25. Nit: what happens to POs with no faktur number after the sheet stops
- **Affected scope:** §3 Non-goals line 63; §6.7.3 line 585; Phase 1 Q2 says making the faktur number required "gates retiring the sheet".
- **Finding:** After the one-hour edit window, a PO with no faktur number has no place to record its No. Retur OSV or reason, and the sheet is gone.
- **Recommendation:** Name the fallback, e.g. the Activities dialog's reason text, or retain those rows elsewhere.

---

**Key files:**
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260707000000_idempotent_order_outflows.sql (oldest-first selling, finding 1)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\RecordReturnDialog.tsx lines 316–360 (silent clamp, finding 2)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261008000000_returns_sku_code.sql line 59 (id skip, finding 3)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\functions\inventory-assistant\tools.ts lines 325–363 (unfiltered reader, finding 7)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\outflowCalculator.ts line 178 (catalog factor, finding 2)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\activityGrouping.ts line 40 (window mismatch, finding 12)
- C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\sheet_excerpts.md (2610421, 2610448, 2610319, FamilyMart Klaim row)

### egm-structural

STRUCTURAL REVIEW: design_draft.md, FeatureRange lines 1–700 (up to the line before `## Detailed Implementation Plan` at line 701)

Status: complete. I read the persona, the Target Standard (feature-spec-standard.md), the template (design_doc.md), the house-style spec (2026-10-29-delivery-return-log-design.md) and the full target (lines 701–894 for context only).

Verdict: no Blockers. 3 Major, 14 Nit. Every element the template and standard require is present. The main problems are one rendering defect, one section out of order and one goal filed under Non-goals.

---

## 1. Heading map (FeatureRange)

- H1 (line 1): title
- H2 `## 1. Problem` (11)
- H2 `## 2. Overview` (19)
  - H3 2.1 (27)
- H2 `## 3. Scope` (36)
  - H3 Goals (38)
  - H3 Non-goals (51)
- H2 `## 4. Vocabulary` (65)
  - H3 4.1 to 4.4 (67, 97, 107, 125)
- H2 `## 5. Critical user journeys` (149)
  - H3 CUJ 1 to CUJ 7 (151 to 187)
- H2 `## 6. Technical plan` (193)
  - H3 6.1, 6.2
    - H4 6.2.1 to 6.2.7
  - H3 6.3
    - H4 6.3.1 to 6.3.3
  - H3 6.4, 6.5
    - H4 6.5.1 to 6.5.8
  - H3 6.6, 6.7
    - H4 6.7.1 to 6.7.3
  - H3 6.8, 6.9, 6.10
- H2 `## 7. Alternatives considered` (620)
- H2 `## 8. Non-functional requirements, risks and limits` (653)
- H2 `## 9. Open questions` (664)
- H2 `## 10. Decision log` (671)
- `---` (699), then H2 `## Detailed Implementation Plan` (701), containing H3 `### Verification plan` (835)

**Nesting:** no skipped levels anywhere. Every H4 sits under an H3 and every H3 under an H2. Numbering runs without gaps: §1 to §10, 4.1 to 4.4, 6.1 to 6.10, 6.2.1 to 6.2.7, 6.3.1 to 6.3.3, 6.5.1 to 6.5.8, 6.7.1 to 6.7.3.

**Required elements, all present:**

| Required element | Section |
|---|---|
| Overview | §2 |
| Problem | §1 |
| Goals | §3 H3 |
| Non-Goals | §3 H3 |
| Open Questions | §9 |
| CUJs, each with Given/When/Then | §5 (all seven) |
| Technical Plan, with diagram | §6 |
| Alternatives Considered | §7 (28 rows) |
| Non-Functional Requirements, merged with the standard's Risks & Mitigations | §8 |
| Detailed Implementation Plan | line 701 |
| Verification Plan | H3 inside the Detailed Implementation Plan, as the template has it |

Extra sections (§4 Vocabulary, §10 Decision log) are allowed.

**Tables:** 157 lines start with `|`. I counted the pipes on each line with anchored regexes; every line is accounted for:

| Section | Lines | Columns | Header + separator + body rows |
|---|---|---|---|
| §4.1 | 69–93 | 2 | 1 + 1 + 23 |
| §4.2 | 99–103 | 6 | 1 + 1 + 3 |
| §4.3 | 109–121 | 4 | 1 + 1 + 11 |
| §4.4 | 129–143 | 8 | 1 + 1 + 13 |
| §6.3.2 | 432–440 | 2 | 1 + 1 + 7 |
| §6.3.3 | 444–454 | 2 | 1 + 1 + 9 |
| §6.6 | 539–546 | 3 | 1 + 1 + 6 |
| §6.7.1 | 558–573 | 2 | 1 + 1 + 14 (covers all 21 columns) |
| §7 | 622–651 | 3 | 1 + 1 + 28 |
| §10 | 673–697 | 4 | 1 + 1 + 23 |

Every table has a header row and a separator row, and every row has the same number of cells as its separator. No table row contains an escaped pipe or a pipe inside a code span. Every table has a blank line before and after it.

**Code fences:** 10 fences in range, each opened with a language tag and closed: 197/221 text, 236/260 sql, 272/280 sql, 286/289 sql, 297/304 sql, 310/313 sql, 319/322 sql, 330/349 sql, 368/428 sql, 472/481 text.

**Links:** six `[text](target)` links (lines 4, 6 four times, 95).
- Five point to files that exist in main-ro `docs/superpowers/specs/`: `-full.md`, `-design.md` (twice), `per-sku-returns`, `buyer-profiles`.
- The brief link (line 6) is not in main-ro. It is explicitly marked "committed together with this file", and the file exists untracked in the main checkout's specs folder.
- All 50+ `§` cross-references in range resolve, including those into the full spec (§4.3, §4.4, §4.7, §5.2, §11) and Phase 1 §5.5.
- Plain-path references also exist: `docs/spec-export-rekonsiliasi.md`, `docs/uuid-migration/PLAN.md`, `docs/OPERATIONS.md`, and `.claude/agents/data-integrity-reviewer.md` (the last marked as committed alongside).

---

## 2. Findings

### MAJOR

**M1. Bare angle-bracket placeholders render as HTML or disappear**
- **Severity:** Major
- **Affected Scope:**
  - §4.1 line 84 and §4.2 line 102 (`<PRODUCT>`)
  - §6.2.1 line 266
  - §6.5.1 line 483
  - §6.5.2 line 491
  - §6.5.3 lines 495, 497
  - §6.5.4 line 501
  - §6.5.5 lines 508, 509, 511
  - §6.6 table lines 541–545
- **Discrepancy & Rationale:**
  - Placeholders such as `<n>`, `<p>`, `<SKU>`, `<qty>`, `<unit>`, `<pieces>`, `<ppu>`, `<pecah>`, `<ok>`, `<date>`, `<code>` and `<unit word>` are outside code spans. In CommonMark/GFM they are valid inline HTML tags.
  - On GitHub the unknown ones are stripped. So the §6.5.4 confirmation template, `**<qty> <unit> × <ppu> = <pieces> butir** · Pecah <pecah> …`, renders as roughly "** ×  =  butir** · Pecah  …", and chip labels such as "Gudang belum · <n>" lose their counts.
  - `<code>` (line 483) and `<p>` (lines 542, 544, 545, inside table cells) are real HTML elements. They open an unclosed code span or a paragraph inside the cell and change the markup around them.
  - Rendering is also inconsistent: `<pieces_per_unit>` (line 491) and `<Retakan|Hancur>` (line 501) are not valid tag names, so they survive as literal text next to placeholders that vanish.
  - These strings are the screen texts that test file 19 asserts verbatim, so losing them on render is a real information loss.
  - The house-style spec wraps placeholders in backticks (Phase 1 spec lines 44 and 189: `` `<buyer> <dc>` ``, `` `/deliveries?invoice=<ref>` ``).
  - Fix: wrap each placeholder template in a code span, or escape as `&lt;n&gt;`.

**M2. Open Questions sits out of template order**
- **Severity:** Major
- **Affected Scope:** `## 9. Open questions` (line 664)
- **Discrepancy & Rationale:**
  - The template orders Overview, Problem, Goals, Non-Goals, **Open Questions**, CUJs, Technical Plan, Alternatives, NFR.
  - The draft puts Open Questions after Alternatives (§7) and NFR (§8), four places later than the template position.
  - The caller set order as a compliance criterion. This is the largest displacement in the document, and it means a reader meets the unresolved items (Family Mart flag, Q9 admin roles, the 13 unmatched fakturs) only after the whole design.
  - The house-style spec also puts Open questions at §9, which explains the choice, but it is still a deviation from the template.
  - Fix: move it to sit directly after §3 Scope (before or after §4 Vocabulary). That renumbers §4 to §8 and every `§` reference to them, so a cheaper option is to state the deviation explicitly in the preamble.

**M3. An in-scope deliverable is stated only inside the Non-goals list**
- **Severity:** Major
- **Affected Scope:** §3 Non-goals, line 63; §3 Goals, lines 40–49
- **Discrepancy & Rationale:**
  - Line 63 ends with "The duplicate-ref *warning* at PO entry is in scope (brief D6, §6.10)".
  - That work is Detailed Implementation Plan file 24 (`useDuplicateOrderCheck`, `QuickOutflowBuilder`), but no Goals bullet mentions it. The Goals line 44 covers only the warehouse-save refusal.
  - The template defines Goals as "the absolute criteria for success", so a reader checking scope from Goals misses a change to the PO-entry path.
  - Fix: move the sentence into Goals as its own bullet.

### NIT

**N1. Problem and Overview order is swapped**
- **Severity:** Nit
- **Affected Scope:** §1 (line 11), §2 (line 19)
- **Discrepancy & Rationale:** The template orders Overview then Problem. Here Problem comes first, as in the house style. It is an adjacent swap, so both stay easy to find.

**N2. Goals and Non-goals are demoted and unnumbered**
- **Severity:** Nit
- **Affected Scope:** §3, lines 38 and 51; §2.1, line 27
- **Discrepancy & Rationale:**
  - The template has Goals and Non-Goals as H2. Here they are H3 under `## 3. Scope`.
  - They are also the only unnumbered H3s under a numbered H2 (compare 2.1, 4.1, 6.1). Either number them 3.1 and 3.2, or note the deviation.
  - §2 has a lone child subsection (2.1 with no 2.2).

**N3. Metadata block formatting**
- **Severity:** Nit
- **Affected Scope:** Lines 3–7
- **Discrepancy & Rationale:**
  - The lines have no blank lines, list markers or hard breaks between them, so they render as one run-on paragraph.
  - The template uses a bulleted Author / Status / Date list followed by a `---` rule. The house style does the same as this draft, hence Nit.
  - "Status:" carries more than a status: the template's status value, phase-1 live date and a precedence rule ("this document wins"). "Draft (EGM review in progress)" is not one of the template values (Draft | Proposed | In Review | Approved). The precedence rule belongs in the line-9 blockquote.
  - The template's `---` separators before and after NFR are also absent. Only line 699 has one.

**N4. Alternatives table: Verdict column mixes kinds, no Pros column**
- **Severity:** Nit
- **Affected Scope:** §7, lines 622–651
- **Discrepancy & Rationale:**
  - The table format matches the house style (Phase 1 §12.1), and the standard's rule that each rejected option has documented reasons is met.
  - But the Verdict column mixes Rejected, Set aside (627, 633, 646), Deferred (650), Acceptable fallback (638) and **Adopted per line** (629). An adopted option is part of the design, not a rejected alternative; it belongs in §6 or §10.
  - The template's Pros / Cons / Reason structure is collapsed into a single "Why" column. Several rows (637, 642, 647, 649) state no pro for the alternative.

**N5. Data-flow diagram misalignment**
- **Severity:** Nit
- **Affected Scope:** §6.1 diagram, lines 202, 206, 207
- **Discrepancy & Rationale:**
  - Line 202's right border `│` is one column short of lines 201 and 203–205.
  - Line 206's text runs through the right branch's vertical, so that connector is missing on that line.
  - Line 207's second `│` is one column right of the `┬` on line 205 and the `▼` on line 208.

**N6. Layout mockup frame does not close**
- **Severity:** Nit
- **Affected Scope:** §6.5.1 mockup, lines 473–480
- **Discrepancy & Rationale:**
  - The top border (473) is wider than the bottom (480, 85 characters).
  - Lines 474, 475, 478 and 479 run past the bottom border and have no right edge.
  - The wastebasket emoji (U+1F5D1) on line 473 renders double-width in monospace, which shifts the line further. Use an ASCII marker such as `[x]` or `[hapus]`.

**N7. `sql` fences contain elisions and fragments**
- **Severity:** Nit
- **Affected Scope:** Lines 297–304, line 369
- **Discrepancy & Rationale:**
  - Lines 297–304 are a fragment ("inner select gains:").
  - Line 369 has `returns void … as $$`.
  - Both are labelled `sql` but will not parse. Acceptable as contract text, but a comment such as `-- excerpt` or `-- attributes per §6.3 intro` would make that explicit.

**N8. Verbatim header lists use `|` as a separator**
- **Severity:** Nit
- **Affected Scope:** §6.7.1 line 556; §6.7.2 line 579; §6.7.1 table row line 560
- **Discrepancy & Rationale:**
  - The headers are called "verbatim", and test file 12 asserts the header string exactly. Yet they are written as one code span joined by ` | `, which the reader cannot tell apart from content or from the CSV separator. A numbered list or a table would be unambiguous.
  - In the §6.7.1 table, row "1–8" is keyed by column index while rows 9–21 are keyed by header name, and no row carries its column number, although the prose says "columns 9–21 blank".

**N9. List-style inconsistencies**
- **Severity:** Nit
- **Affected Scope:** §8 line 662; §6.9 line 605; §6.5.5 line 512
- **Discrepancy & Rationale:**
  - §8: every bullet leads with `**X.**` except the last, `**Rollout and rollback**:`.
  - §6.9: items 1–6 lead with bold text, item 7 does not.
  - §6.5.5: the numbered list is a save sequence, but step 6 is a lock-state rule, not a step. It belongs in a paragraph after the list.

**N10. Inconsistent heading suffixes and citations**
- **Severity:** Nit
- **Affected Scope:** Headings at lines 234, 270, 284, 293, 357, 364, 442
- **Discrepancy & Rationale:**
  - The migration tag is written four ways: "— feature migration" (234, also with two em dashes), "(feature); … (void) (brief D19)" (270, with double parentheses), ": one change in the feature migration, two in the void migration" (357), "(void migration and its frontend)" (442).
  - Brief citations appear in some H3/H4 headings and not others. One convention is needed, for example `— feature migration · brief D7`.
  - Line 223 also cites `"Alternatives" below` by name where everywhere else uses `§7`.

**N11. Link text and an unresolvable source location**
- **Severity:** Nit
- **Affected Scope:** Lines 6 and 29
- **Discrepancy & Rationale:**
  - The brief link's text is its raw filename; the other links use descriptive text ("full spec", "Phase 1 as built").
  - `feature_concept.md` is placed "in the brief's folder" (lines 6, 29). Once the brief is committed to `docs/superpowers/specs/`, that is wrong: the file exists only in the untracked `egm-reviews/delivery-return-log-phase2/` and is not marked as committed alongside.
  - It is a code span, not a link, and §2.1 restates the four sentences, so this stays a Nit. Either commit the file or give its real location.

**N12. Glossary placement and format**
- **Severity:** Nit
- **Affected Scope:** §4, lines 65–95
- **Discrepancy & Rationale:**
  - Vocabulary comes after §1–§3, which already use its terms (faktur, PO, outflow, Retakan, Pecah, `record_return`).
  - The core unit word "butir", plus "pak"/"box", "Osave" and "DC", have no glossary entry.
  - The "Phase 1 terms used below" (line 95) are a second glossary in one dense paragraph rather than table rows.
  - The "Reasons" row (line 85) duplicates §4.3, which has no meaning column. Moving those definitions into §4.3 would give one source.

**N13. Open questions holds non-questions**
- **Severity:** Nit
- **Affected Scope:** §9, items 2 and 4 (lines 667, 669)
- **Discrepancy & Rationale:**
  - Item 2 is already answered ("resolved per PO by the import; both get 21 days").
  - Item 4 is an action item for after the dry run.
  - The template says to remove answered questions. Move item 2 to §10 and item 4 to the rollout checklist.

**N14. Unnumbered H2 at the range boundary**
- **Severity:** Nit
- **Affected Scope:** Line 701 (boundary, outside the range)
- **Discrepancy & Rationale:** `## Detailed Implementation Plan` follows the numbered §1–§10 without a number. Defensible because it matches the template heading, but it breaks the numbering pattern the range sets up.

---

## Files

- Target: C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md
- Standard: C:\Users\Joshua\.claude\plugins\cache\egm\egm\0.1.0\resources\document_standards\feature-spec-standard.md
- Template: C:\Users\Joshua\.claude\plugins\cache\egm\egm\0.1.0\skills\egm-draft\references\design_doc.md
- House style: C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\docs\superpowers\specs\2026-10-29-delivery-return-log-design.md
- Brief (untracked, link target): C:\Users\Joshua\JS\EggKeep\docs\superpowers\specs\2026-11-01-delivery-return-log-phase2-brief.md
- `feature_concept.md`'s actual location: C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\feature_concept.md

### egm-style

Style review of the design draft, REVIEW mode. Verdict: no Blockers, 13 Major findings, 14 Nit findings.

Target: C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md, lines 1–699 (everything before `## Detailed Implementation Plan` at line 701).
Standard: only the persona at C:/Users/Joshua/.claude/plugins/cache/egm/egm/0.1.0/agents/style.md. No other standard was supplied. I read the persona and the whole target range, so the review is complete.
House rule: quoted Indonesian screen text is product copy. No replacement below changes it.

## BLOCKER

None.

## MAJOR

M1. "One delivery line per PO line" contradicts the data model
- Severity: Major
- Scope: §2 Overview, line 21; §3 Goals, line 40.
- Rationale: The glossary (line 79) and the schema (§6.2.1, line 234) define a delivery line as one row per (delivery, SKU, reason). §4.3 (line 123) allows a non-physical line, such as Kurang, next to the physical-return line on the same SKU. Line 495 also adds up several PO lines with the same code. So a single PO line can have more than one delivery line, and the Goals list states the wrong rule.
- Fix, line 21: "with one delivery line per returned PO line" → "with one delivery line per (SKU, reason) on the faktur".
- Fix, line 40: "One delivery line per PO line on the delivery detail:" → "Delivery lines on the delivery detail, one per (SKU, reason), at most one physical-return line per SKU:".

M2. "136 lines" fits none of the three defined terms
- Severity: Major
- Scope: §1 Problem, line 13.
- Rationale: "lines" here means `returns` rows. It is not a delivery line, a PO line or a return entry. §6.10 (line 615) and §7 (line 626) call the same set "the 136 existing rows". "75 outflows" also differs from the glossary term "outflow row".
- Fix: "136 lines on 75 outflows" → "136 `returns` rows on 75 outflow rows".

M3. The glossary definition of "PO line" leaves out loose-egg lines, but the text uses them
- Severity: Major
- Scope: §4.1, line 77, compared with lines 61, 179, 483, 585, 615.
- Rationale: Line 77 says "A PO line is one pack SKU with a pack quantity in that order". Yet line 61 and line 483 say "loose-egg (non-SKU) PO lines", and lines 179 and 585 shorten this to "a loose line". Under the glossary's own definition, a loose-egg PO line cannot exist.
- Fix, line 77: "A PO line is one product line of that order: a pack SKU with a pack quantity (`order_lines[]`), or a loose-egg (non-SKU) line in native units." Also state where loose-egg lines are stored.
- Fix, lines 179 and 585: "a loose line" → "a loose-egg PO line".

M4. "Claim" has two meanings
- Severity: Major
- Scope: §4.1, line 79, compared with lines 17, 25, 45, 545, 579.
- Rationale: The glossary calls every delivery line "the store-side claim". Elsewhere, "claim rows", the "Klaim" chip and the "claim CSV" mean only the Osave subset, meaning buyers with `requires_claim_ref` and a physical-return line. A Kurang line on an Astro faktur is a "claim" under line 79 but not a claim row under line 545.
- Fix, line 79: "the store-side claim" → "the store-side record of that SKU and reason". Keep "claim" for the Osave/`requires_claim_ref` subset only.

M5. It is unclear where the client-generated ids live
- Severity: Major
- Scope: §6.1, line 223; §6.4, line 464.
- Rationale: Line 223 says "the delivery line (it carries the client-generated id)", and the next sentence is about return-entry ids. Line 464 says "Return-entry ids on the delivery line are generated once per form attempt (a ref)". Both read as if `delivery_lines` stores the return-entry ids, but the schema in §6.2.1 has no such column. "(a ref)" also clashes with "invoice ref" and "claim ref".
- Fix, line 223: "the delivery line (it carries the client-generated id)" → "the delivery line (upserted on its client-generated `id`)".
- Fix, line 464: "Return-entry ids on the delivery line are generated once per form attempt (a ref) and reused on retry" → "The Retur section generates return-entry ids once per save attempt, holds them in a React `useRef` (not in `delivery_lines`), and reuses them on retry".

M6. Bare "admin" is used where the glossary requires "app admin"
- Severity: Major
- Scope: lines 84, 220, 232, 315, 632, 656, 693; possibly line 57.
- Rationale: Line 73 says "'Admin' alone means office admin; 'app admin' means the EggKeep admin role." The authorisation statements break that rule. Read literally, "admin-only is a UI gate" (line 656) means "office-staff-only", which is a different security statement.
- Fixes:
  - Line 84: "when an admin had soft-deleted it" → "when an app admin had soft-deleted it".
  - Line 220: "(admin / author ≤ 48 h" → "(app admin / author ≤ 48 h".
  - Line 232: "admin-only actions are UI gates" → "app-admin-only actions are UI gates".
  - Line 315: "(admin UI gate)" → "(app-admin UI gate)".
  - Line 656: "admin-only is a UI gate" → "app-admin-only is a UI gate".
  - Lines 632, 656, 693: "admin-or-author" → "app-admin-or-author".
  - Line 57: "an admin "Import dari sheet" button" → state which role the button is for.

M7. One derived state has six names
- Severity: Major
- Scope: line 25 "warehouse not done"; line 212 "warehouse done"; line 264 "Warehouse saved ="; line 526 "warehouse-done"; line 679 ""Warehouse entry exists""; lines 223 and 510 "the orange state"; line 541 `awaitingWarehouse`.
- Rationale: These are all the same derived condition. A fresh reader cannot tell whether they differ. Line 505, "The warehouse side counts as filled", is a different concept (form input state) and needs its own distinct name. The glossary also does not define the colour names "orange" and "red", which appear about 25 times.
- Fix: Add two glossary rows:
  - "Warehouse-done: a physical-return line whose SKU has a non-voided `returns` row on the PO's egg outflow rows. Its absence is the orange flag (`awaitingWarehouse`)."
  - "Red: the `needsClaimRef` flag."
- Then use those terms throughout:
  - Line 25: "warehouse not done" → "awaiting warehouse".
  - Line 264: "Warehouse saved =" → "Warehouse-done =".
  - Line 679: ""Warehouse entry exists"" → ""Warehouse-done"".

M8. "Save" means both the Simpan action and a group of `returns` rows
- Severity: Major
- Scope: lines 172, 173, 366, 439, 522, 526, 633.
- Rationale: "store-only saves" (line 505) is the Simpan action. "the save of 2 Nov" (line 172), "grouped into **saves**" (line 522) and "Half-voided save" (line 526) are groups of `returns` rows sharing `outflow_id`, `sku_code` and `created_at`. Line 439 calls the same group a "save group". Line 173 uses an unquoted Indonesian noun: "the retur stays half voided".
- Fix: Define "save group" in §4.1 as the rows one `record_return` call writes. Then:
  - Line 172: "on the save of 2 Nov" → "on the save group of 2 Nov".
  - Line 366: "the rows of one save" → "the rows of one save group".
  - Line 522: "grouped into **saves**" → "grouped into **save groups**".
  - Line 526: "**Half-voided save**" → "**Half-voided save group**".
  - Line 633: "One void call per save" → "One void call per save group".
  - Line 173: "the retur stays half voided" → "the save group stays half-voided".

M9. The count of rows missing a return number switches between rows, fakturs and refs
- Severity: Major
- Scope: lines 184 (chip text), 191, 548, 593, 638; line 48.
- Rationale:
  - Line 191 says "October's 18 rows without a return number" and line 593 says "October's 18 Osave rows". The chip in line 184 counts "18 faktur". Line 548 says "Red counts a line, not a faktur; the chip count is fakturs." Both counts can only be 18 if no faktur has two flagged lines; the document should say so or use one unit.
  - Line 638's "18 open refs" means the opposite of what is meant: these rows have no ref.
  - Line 48's "refs" is ambiguous between invoice refs and claim refs.
- Fixes:
  - Lines 191, 593, 638: use one unit, e.g. "October's 18 fakturs with a physical-return line and no No. Retur OSV".
  - Line 548: "Red counts a line, not a faktur; the chip count is fakturs." → "The red flag is evaluated per delivery line; the chip counts fakturs with at least one flagged line."
  - Line 48: "reasons, refs and expiry dates" → "reasons, No. Retur OSV values (`claim_ref`) and expiry dates".
  - Lines 190, 611, 669: use one form, "shared invoice refs".

M10. The text says caps are unchanged, but the design changes them
- Severity: Major
- Scope: §2, line 23; §8, line 655.
- Rationale: Line 23 says "What is not new: no change to how POs, outflows, FIFO deduction, caps or `correct_order` work", and line 655 says "`record_return` (unchanged math)". But §6.3.1 makes caps exclude voided returns, and §6.3.3 changes `void_outflow`, `reconcile_inventory`, `recalculate_inventory_fifo` and `v_recon_ledger`. "What is new on the stock side is one RPC" understates the void migration.
- Fix, line 23: "The stock side gains one RPC, `void_return`, plus the void columns and a `voided_at is null` filter in every reader of `returns` (§6.3.3), so caps exclude voided returns. How POs, outflows and FIFO deduction are recorded, and `correct_order`, are unchanged."
- Fix, line 655: "(unchanged math)" → "(cap logic unchanged except that voided returns are excluded)".

M11. "The call that can fail" is unsupported and contradicts the next paragraph
- Severity: Major
- Scope: §6.5.7, line 524.
- Rationale: The text says "the RETAKAN batch is the one more likely to have been sold on, so the call that can fail runs before anything changes". "More likely" has no data behind it. Both calls can fail with `RESTOCK_CONSUMED` (lines 404–406 and 416–418), and line 526 describes the restock call failing. The SQL gives an objective reason instead: the retakan void needs an untouched batch, while the restock void only needs the batch to hold at least the restored amount.
- Fix: "The retakan call runs first because its check is stricter: it fails after any sale from the RETAKAN batch (§6.3.2), while the restock call fails only when a batch drops below the restored amount. If the retakan call fails, nothing has changed; if the restock call fails, the save group is half-voided (below)."

M12. The argument for `void_return` predicts the future and contradicts §1
- Severity: Major
- Scope: §7, line 630.
- Rationale: "Admin typing 100+ rows a month will mistype in week one" is a prediction no one can check. "is the pattern that made the sheet win over Phase 1" gives a different cause than §1 (line 15), which says nobody switched because Phase 1 digitised two columns that carry almost no information.
- Fix: "Admin typed 178 rows between 12 and 31 October (§1), so typing errors are expected; without a void, each wrong count is a permanent stock delta only the owner can fix in SQL."

M13. "Three typists" contradicts the glossary
- Severity: Major
- Scope: §7, line 627.
- Rationale: Line 73 says "Dila and Yani type the rows; Novi checks". The decision to accept the two-admin race rests on this number.
- Fix: "the office has three typists" → "two admins type rows (Dila, Yani)". The word "rare" in the same row is covered under N5.

## NIT

N1. Other unqualified or misleading uses of "line"
- Severity: Nit
- Scope and fixes:
  - Line 17: "the return lines" → "delivery lines".
  - Line 43: "used by the dialog and the delivery line" → "used by `RecordReturnDialog` and the Retur section (`DeliveryReturnLines.tsx`)".
  - Line 56: "a `status` column on lines; stored pieces or warehouse dates on lines" → "... on `delivery_lines`" (both places).
  - Line 105: "a `pecah` reason line" → "a delivery line with reason `pecah`".
  - Line 147: "a full-line return fits the cap" → "a return of a PO line's full sold quantity fits the cap".
  - Line 155: "under the OSVN10B line" → "under the OSVN10B PO line".
  - Line 483: "the PO's pack-SKU lines" → "the PO's pack-SKU PO lines".
  - Lines 485, 522, 537, 659, 675: "every existing line", "under the lines", "with their lines embedded", "Unique indexes on lines", "lines never feed stock" → "delivery line(s)".
  - Lines 461 and 508: "input row" is not defined. Define it as "one row of the return-entry builder's input: one SKU or loose-egg row".

N2. "physical line" and "physical-return line" are two forms of one term that the glossary never defines
- Severity: Nit
- Scope: "physical-return line" at lines 41, 123, 266, 483; "physical line" at lines 264, 268, 541, 542, 545, 567–571, 681; "non-physical line" at lines 123 and 264.
- Fix: Add one glossary row and use one pair throughout: "physical-return line" and "non-physical line".

N3. Source-code line numbers sit next to the domain word "line"
- Severity: Nit
- Scope: lines 315, 366, 461, 624.
- Fixes:
  - Line 315: "`DeliveryDetail.tsx` line 206" → "`DeliveryDetail.tsx:206`".
  - Line 366: "lines 185–230" → "`20260904000000_returns.sql:185–230`".
  - Line 461: "(lines 316–360)" → "`RecordReturnDialog.tsx:316–360`".
  - Line 624: "(lines 245–257)" and "(286–307)" → "`RecordReturnDialog.tsx:245–257`" and "`:286–307`". The file name is currently missing, and "every PO line" sits in the same sentence.

N4. Subjective or unverifiable qualifiers
- Severity: Nit
- Fixes:
  - Line 63: "It is cheap and not gating this merge, because" → "It does not gate this merge:".
  - Line 646: "The SKU rows are cheap once re-keyed and change" → "Once re-keyed, the SKU rows need no extra code and change".
  - Line 451: "so the case is theoretical" → "so the case needs a return recorded within one hour of the PO".
  - Line 694: "one-hour window makes the case theoretical" → "the case needs a return within the one-hour edit window".
  - Line 627: "reverses the rare double" → "reverses a double restock".
  - Line 633: "the half state is rare (the restocked batch sold within 48 hours)" → "the half state needs the restocked batch to be sold within 48 hours".
  - Line 628: "for no gain" → "with no added guarantee".
  - Line 629: "for a one-tap gain" → "to save one tap per line".
  - Line 637: "and will be pressed twice" → "and needs its own guard against repeat runs".
  - Line 641: "keep the badge lit for weeks over a backlog only office admin acts on, at the list" → "keep the badge on for as long as the backlog lasts, although only office admin acts on it, from the list".
  - Line 291: "for a void nobody has asked for" → "for a void that has not been requested".
  - Line 635: "returns nobody has asked to void" → "returns no one has requested to void".
  - Line 611: "raises the cost of a shared ref from "confusing list" to "wrong stock"" → "makes a shared ref block the warehouse save for both POs". These quotes are English, not product copy.
  - Line 632: "four lines of plpgsql stop any signed-in phone" → "an admin-or-author check in the function stops any signed-in client". The check in lines 374–387 is longer than four lines.

N5. "Off by up to a day" is wrong
- Severity: Nit (factual)
- Scope: §6.2.7, line 328.
- Rationale: 30 days against one calendar month differs by 2 days in February. For example, 31 Jan + 30 days = 2 Mar, while 31 Jan + 1 month = 28 Feb.
- Fix: "off by up to a day" → "off by up to two days (February)".

N6. The dry-run counts cannot be checked against §1
- Severity: Nit
- Scope: CUJ 7, line 190, compared with line 15.
- Rationale: "108 matched fakturs, 13 unmatched, 3 shared refs, 10 non-PO rows" mixes fakturs, refs and rows, and does not add up to §1's 131 fakturs.
- Fix: State all four in fakturs and give the total of 131.

N7. Informal wording, metaphors and undefined coined terms
- Severity: Nit
- Fixes:
  - Line 4: "this document wins" → "this document takes precedence".
  - Line 15: "speaks butir and three buckets" → "takes quantities in butir across three buckets".
  - Line 187: "October comes across" → "October import".
  - Lines 184, 324, 593: "chases" / "chased" / "chase" → "follows up".
  - Line 306: "without walking `activity_logs` by name" → "without searching `activity_logs` by product name".
  - Line 315: "is a box to admin and the 5× case the sheet's unit errors came from" → "is counted in boxes by admin, and the sheet's 5× unit errors came from this SKU".
  - Line 518: "so it gets closed" → "so it is resolved".
  - Line 548: "Chips OR together with" → "Chips combine with OR logic with".
  - Line 600: "Sanity:" → "Check:".
  - Line 635: "fail loud" → "fail with `RETAKAN_INFLOW_MISSING`".
  - Line 636: "mints RETAKAN stock" → "creates RETAKAN stock".
  - Lines 60, 267, 690: "keeps that door open", "Pre-loading door" → "stays compatible with", "Pre-loading compatibility". Also define "pre-loading" in §4.1.
  - Lines 23 and 693: "behind the feature migration" → "after the feature migration".
  - Line 25: "The export is fixed to" → "The export uses".
  - Line 631: "the stock fix" (never defined) → "the feature migration".
  - Line 642: "a transition layout" → "the sheet's column layout".
  - Line 659: "the lock-after-returns rule" (coined) → "the line lock of §6.2.1".

N8. Synonyms used for the same thing
- Severity: Nit
- Scope and fixes:
  - "faktur detail" (line 17) vs "delivery detail" (lines 40, 466): pick one.
  - "(faktur, SKU, reason)" (line 234) vs "(delivery, SKU, reason)" (lines 41, 681): pick one.
  - "both halves" (lines 40, 470, 676) vs the glossary's "store side / warehouse side": use "both sides".
  - "two-admins window" (line 627) vs "two-admin window" (lines 659, 696): pick one spelling.
  - "sync" (line 25) vs "synchronisation" (line 34): pick one.
  - "this file" (line 6), "this spec" (line 93), "this document" (elsewhere): use "this document".
  - "butir", "pieces" and "eggs" all mean single eggs in the prose (lines 21, 40, 47, 486, 491). Add a glossary row "butir: pieces (single eggs)" and use "pieces" in prose and "butir" only in screen text.
  - "chip" means both reason chips in the form (lines 123, 154, 484) and list filter chips (lines 25, 45, 541–545). Write "reason chip" and "list chip".

N9. Filler and repetition within a sentence or section
- Severity: Nit
- Fixes:
  - Line 33: "Its readers are the claim CSV ... and the 21-column export. Nothing else in the app reads it." → "Only the claim CSV ... and the 21-column export read it."
  - Line 223: "which is exactly the orange state" → "which is the orange state".
  - Line 357, heading: drop ", nothing else". Line 362 already says the rest is unchanged.
  - Line 454: drop "Safe direction; documented limit." or replace it with "The tighter cap is the safe direction."
  - Line 6: "(brainstorm of 2026-11-01 on the brainstorm input `feature_concept.md`, ..." → "(brainstorm of 2026-11-01 on `feature_concept.md`; ...".
  - Line 593: "The record of October stays the sheet; the import copies, it does not move." → "The sheet remains the system of record for October; the import copies rows and deletes nothing from it."
  - Line 351: "its "+1 bulan" is the default row, data, not a hardcoded fallback" → "its +1 month comes from the default row in the data, not from a hardcoded fallback".

N10. The same statements repeat across sections
- Severity: Nit
- Scope:
  - The sheet stops for new rows / no sync: lines 7, 25, 34, 583, 686.
  - No reviewer tick: lines 32, 56, 640, 692.
  - Why there is no `delivery_line_id`: lines 54, 282, 626, 679.
- Rationale: Repetition in the §10 decision log is by design. The prose sections should state each point once and cite the section elsewhere. Suggestion: keep §2.1 item 4, §6.2.2 and §7, and shorten lines 25, 32 and 583 to cross-references.

N11. Sentences too long to read in one pass
- Severity: Nit
- Scope and fixes:
  - Line 95 (Phase 1 terms, about 190 words): convert to glossary rows.
  - Line 585 (one sentence of about 170 words covering four cases): convert to a four-item list.
  - Line 604 (step 6, about 150 words): split into sub-bullets for `deliveries` and `delivery_lines`.
  - Line 6 (the "Builds on" header): move the citation convention ("brief D7 cites ...") to its own line.

N12. Grammar and fragments
- Severity: Nit
- Fixes:
  - Line 4: "Phase 1 is live since" → "Phase 1 has been live since".
  - Line 13: "the Osave return numbers that bill broken eggs" → "the Osave return numbers used to bill broken eggs".
  - Line 17: "makes the warehouse count typed there the stock return" → "records the warehouse count typed there as the stock return".
  - Line 78: "the row `returns` key on" → "the row that `returns` rows key on".
  - Line 123: "Four chips (...) plus "Lainnya…" opening the full list (brief N4)." has no verb → "The form shows four reason chips (...) and "Lainnya…", which opens the full list (brief N4)."
  - Line 556, the English file-header comment: "headers are the sheet's row 2 so the file reads like the sheet admin used until launch; the month-end archive." → "Headers are row 2 of the sheet admin used until launch. This file is the month-end archive."
  - Line 223: "(brief D5, "Alternatives" below)" → "(brief D5, §7)".
  - Line 291: "and the owner handles it" → "and the owner corrects stock manually after the next count".

N13. Ranges are written two ways
- Severity: Nit
- Scope: "15 to 31 October" (lines 25, 191) vs "15–31 October" (line 617); "about 50 to 60" (line 191) vs "50–60" (lines 593, 638); "1 to 16 days" (line 646).
- Fix: Use one form, either the en dash or "to", throughout the prose.

N14. The "Builds on" and "Status" header lines (lines 4 and 6) mix three self-references, already counted in N8. No further action beyond N8.
