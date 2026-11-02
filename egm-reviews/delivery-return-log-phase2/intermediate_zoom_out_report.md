# Stage 8: Intermediate Zoom Out Review (egm-zoom-out, Opus)

**Target:** `design_draft.md` (full file, 956 lines at review time) · **Standard:** zoom-out-standard.md · **Context:** `zoom_out_report.md` (Stage 5) · **Date:** 2026-11-02
**Status:** resolved (fixes applied to `design_draft.md` before Stage 9)

## Resolution by the drafting session (Elephant)

| # | Finding | Resolution | Applied change |
|---|---|---|---|
| B1 | "`void_outflow` unchanged" is false: voiding an order after one of its restock returns was voided and compensated under-restores by the compensated amount; `reconcile_inventory` hides it | PROPOSE FIX (option a) | Verified with the reviewer's worked example (B=100, C=100; O −50 from B; R +10 to B; P −60 from B; void R → V −10 from C; void O restored 40 → 130, true 140). `void_outflow` now also voids this order's live compensating outflows (`outflows.void_return_id` → a voided restock return of this order): restores their deductions and marks them voided, inside the same lock order. Per-batch invariant holds (B = 100 − 60 = 40, C = 100), so `reconcile_inventory` and `recalculate_inventory_fifo` stay untouched. §6.3.3 added; §7, §8, decision 19, the RPC tests and rollout step 5 updated. |
| M1 | `expected_prior` checked per entry fails on the second entry of a two-entry save | PROPOSE FIX | The check runs once per outflow row per call, at that outflow's first entry that is not skipped by the idempotency rule, before anything of this call is inserted for it. "Coba lagi" resends the same ids with no client re-read (committed → all skipped; rolled back → fresh check); the re-read of §6.5.5 step 4 and file 15 is gone, consistent with decision 22. |
| M2 | The RPC voids one row while every caller voids a save group; the mismatch creates the partly-voided state, a client pre-check and an ordering rule | PROPOSE FIX | `void_return(p_return_id, p_reason)` keeps its signature and voids the row's whole save group (same `outflow_id`, `sku_code`, `created_at`) with one `record_order_outflows` call carrying one entry per row with a stock effect, all-or-nothing. The partly-voided state, the client stock pre-check, the writeoff → retakan → restock ordering and the stop-at-first-failure loop are removed. |
| M3 | The two-migration split no longer buys separate review, rollback or launch | PROPOSE FIX | One migration (`20261103000000_delivery_lines_void_return.sql`) with one `record_return` replacement, reviewed as a whole by `data-integrity-reviewer`; the rationale rows in §2, §6.2, §6.3, §7, §8, the plan and the checklist updated. Owner decision A is unchanged. |
| M4 | `tidak_balik` puts a warehouse outcome on the store-reason axis and drops Osave lines out of the claim flow | PROPOSE FIX | Reason removed; `NO_PHYSICAL_RETURN` is back to five; an orange line whose goods never reached the warehouse stays orange with a note; §3.3's orange signal retuned (N7). |
| N1 | `canVoidReturn` re-implements `canEditEntry` | PROPOSE FIX | `canEditEntry` compares minutes (48 × 60) so every caller matches the server; no new helper. |
| N2 | The same check at three layers, twice | PROPOSE FIX (partly) | `VOID_INSUFFICIENT_STOCK` and the client stock pre-check dropped; `INSUFFICIENT_STOCK` from `record_order_outflows` is mapped. The builder's `exceeds` result stays as the library's own invariant (it never silently cuts more than rounding), stated in one sentence. |
| N3 | Compensating outflows count as ordinary outflows in velocity, trend and assistant averages | PROPOSE FIX (accept) | Stated in §8 as a known, small effect, with the four readers named; not filtered in Phase 2. |
| N4 | Riwayat fetches the compensating outflows for nothing | PROPOSE FIX | The withdrawn-stock line is derived from the return row (product, quantity, `voided_at` WIB date); the extra query is gone. |
| N5 | Two types for one `returns` row | PROPOSE FIX | `ReturnRecord` (unused) is deleted; `ReturnRow` is the one type. |
| N6 | "One number" drift; column 10 conflict | PROPOSE FIX | §2 and §2.1 name "Butir diterima"; column 10 is in that line's unit with no cross-line equality claim. |
| N7 | Success signals not measurable as written | PROPOSE FIX | Signals restated as queries at the four-week review (warehouse-done physical-return lines per week; orange lines older than two days; Osave physical-return lines older than seven days without a ref). |
| N8 | Editorial drift in the plan and checklist | PROPOSE FIX | "Files 1–29 except 28"; the step 1 snapshots are compared in step 9; call signatures moved out of the feature sections. |

## Reviewer report (verbatim)

ZOOM-OUT REVIEW, PASS 2: design_draft.md (Delivery & Return Log Phase 2, "Retur per faktur")

Target: C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md. I read all 957 lines.
Standard: zoom-out-standard.md (read). Persona: zoom_out.md (read). Prior report: zoom_out_report.md (read, including the Resolution table).
Code checked in: C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\

**Context check:** Passes. The objective and the reason for it are clear.

**Verdict:** REVISE. 1 Blocker, 4 Majors, 8 Nits.

**What holds up:**
- The compensating-outflow void reuses `record_order_outflows` correctly. Its jsonb keys (`id`, `product`, `category`, `quantity_butir`, `date`, `invoice_supplier`), the auth check, the FIFO lock order and the all-or-nothing `INSUFFICIENT_STOCK` all match `20260707000000_idempotent_order_outflows.sql:13–110`.
- "Why a compensating movement" (l.401) is a sound reason to reject the reversal in place.
- (c) "Butir diterima" is justified by the data. In sheet row 2610421, 6 and 30 boxes of N30 (150 eggs each) came back with 300 and 900 pecah, so OK + Pecah does not equal Qty × box size. "Tambah retur kedua" needs the field too.
- (c) The per-line unit for box SKUs is justified by 2610448 ("55" pak).
- (d) `lebih` is in the sheet's own Daftar pick list, so it is real vocabulary.
- (e) `shelf_months` costs one column and keeps the claim's Tgl Expired in line with the sheet. No Phase 1 code reads `expiry_rules` (only `types.ts` and an unused `ExpiryRule` type), so a nullable `shelf_days` cannot break old bundles.
- (f) The rewritten rollback (revoke, revert, leave data in place) is the right kind of simple, apart from Blocker 1 and Major 3.

Not re-raised, because the Resolution table marks them CONTEST or DECLINE: `unit_label` (N4), the import (M7), the fixture lists (N13), the duplicate-ref warning (N13).

---

## BLOCKER

**B1. "void_outflow unchanged, deliberately" is false. Voiding a PO after voiding one of its restock returns silently under-counts stock by the voided quantity.**
- **Severity:** Blocker
- **Affected Scope:**
  - §6.3.2 "Stock algebra" row (l.472)
  - §6.3.3 `void_outflow / reconcile_inventory / recalculate_inventory_fifo` row (l.486)
  - §7 "Adopted" row (l.685)
  - §8 Stock safety (l.711)
  - Decision 19 (l.748)
  - Rollback step 3 (l.950)
  - Verification plan, the `void_outflow` RPC test (l.902)
  - Rollout step 5 (l.939)
- **Simplicity Rationale:**
  - `void_outflow` restores `deducted − Σ return_restocks` per batch and counts every restock, voided or not (`20260904000000_returns.sql:219–223`). Under the new model the void's compensating outflow V stays live after the order is voided.
  - Worked example. Batches B = 100 (oldest) and C = 100, so stock is 200.
    - Order O takes 50 from B.
    - A restock R of 10 goes back to B.
    - A sale P of 60 takes it from B, which is now 0.
    - Voiding R writes V, which takes 10 from C (stock 90, correct).
    - Voiding O restores 50 − 10 = 40 to B. Stock is now 130.
    - The true figure is 140: O and R never happened, P did.
  - `reconcile_inventory` reports zero drift. Its invariant excludes O's restocks once O is voided and counts V as a normal outflow. So the loss is silent.
  - October had 41 voided POs (§7 l.691), so this sequence is plausible.
  - The plan's own test "total stock equals the pre-order level" (l.902) would fail.
  - Rollout step 5 performs exactly this sequence: void the return, then void the test PO. It is safe only because step 4 records Retak, not OK. The retakan case nets correctly; only restock breaks.
  - The adopted alternative's selling point ("leaves `void_outflow` … untouched") is what breaks. The fix is small, but it changes the contract the data-integrity reviewer reads. Two options:
    - (a) `void_outflow` also voids the live compensating outflows (`void_return_id` → its restock returns) and restores their deductions, reusing its own restore loop. `reconcile_inventory` and `recalculate_inventory_fifo` then stay untouched, which I checked against the invariant.
    - (b) The lazy version: `void_outflow` refuses with a new code when the outflow has a voided restock return, and the owner corrects it by hand. Rare.
  - Either way, fix l.472, l.486, l.685, l.950 and the l.902 test expectation.

---

## MAJOR

**M1. `expected_prior` is checked per entry, so the second entry of every two-entry save sees the first and fails. CUJ 1 cannot save as written.**
- **Severity:** Major
- **Affected Scope:**
  - §6.3.1 feature-migration change (2) (l.392)
  - CUJ 1 Then (l.182): "both carrying `expected_prior = 0`"
  - §6.5.5 step 2 (l.546), step 4 (l.548), "Double entry" (l.553)
  - Plan file 15 (l.834), file 19 (l.850)
  - Decision 22 (l.751)
- **Simplicity Rationale:**
  - `record_return` recomputes `v_returned` inside the per-entry loop, after the earlier entries of the same call were inserted (`20261008000000_returns_sku_code.sql:46, 72, 79`).
  - A restock of 70.19 plus a retakan of 11.10 on one outflow, both carrying `expected_prior = 0`: the second entry sees 70.19 and raises `PRIOR_MISMATCH`.
  - Rollout step 5 never performs a real warehouse save, so launch would not catch it. Only the branch test at l.902 might.
  - The client saw one prior sum per outflow per call, so check it once at that level:
    - compare at the first entry for each `outflow_id` in the call, or
    - subtract this call's own earlier inserts.
  - Also state that the check runs after the idempotency skip (l.59–61). Then "Coba lagi" can simply resend the same ids: committed entries are skipped and nothing fails. The re-read in §6.5.5 step 4 and in file 15 can then go. That re-read also contradicts decision 22 ("no client re-read").

**M2. The RPC voids one row while the UI voids one save group. The mismatch creates a partly-voided state, a client stock pre-check and an ordering rule that one group-level call removes.**
- **Severity:** Major
- **Affected Scope:**
  - §6.3.2 intro "voids one `returns` row per call" (l.399)
  - §6.5.7 (l.563–565)
  - §7 "One void call per save group: Set aside" (l.686)
  - Plan file 15 `voidSaveGroup` (l.834), file 17 "partly-voided message" (l.842), file 25 (l.874), file 27 runbook (l.882)
- **Simplicity Rationale:**
  - Every caller voids by save group (glossary l.92, CUJ 4, §6.5.7). No caller needs per-row voids.
  - Keep the signature `void_return(p_return_id, p_reason)` but void the row's whole save group: same `outflow_id`, `sku_code` and `created_at`, which is the document's own group key and is constant within one `record_return` transaction.
  - Make one `record_order_outflows` call with one entry per row that has a stock effect. It is all-or-nothing, so a void either fully happens or does not.
  - The §7 objection ("would take a set of ids") does not apply. What goes away:
    - the partly-voided paragraph and its locale strings
    - the client stock pre-check
    - the writeoff → retakan → restock ordering
    - the stop-at-first-failure loop
    - a runbook section
  - The server side gains a three-line loop.

**M3. The two-migration split no longer buys what the document says it does.**
- **Severity:** Major. The Resolution table adopted M1 as PROPOSE FIX; the rewritten rollback has since hollowed it out.
- **Affected Scope:**
  - §2 (l.24) "each gets its own review and rollback"
  - §6.2 (l.255–260)
  - §6.3 intro (l.388)
  - §7 "One migration" row (l.688)
  - §8 (l.711)
  - Plan 1a/1b (l.764–772)
  - Rollout step 2 (l.936)
  - Rollback (l.946–951)
- **Simplicity Rationale:**
  - **Separate rollback:** gone. The rollback drops nothing and leaves both function bodies in place. Revoking `void_return` works just as well from one migration.
  - **Decoupled launch:** gone. Both migrations are applied in the same rollout step, "the frontend needs both", and the plan ships one PR.
  - **Separate review:** backwards. Only 1b goes to `data-integrity-reviewer` (l.388, l.936), yet 1a also replaces the stock RPC `record_return`, and that is where M1's defect sits.
  - What remains is the cost: two full `record_return` bodies in back-to-back migrations, and three versions for a reviewer to diff.
  - Fix: either merge into one migration with one `record_return` replacement and one review, or keep two files with every `record_return` change in one of them, review both, and correct the stated rationale in all four places.

**M4. `tidak_balik` puts a warehouse outcome on the store-reason axis. Using it drops the line from the claim flow and erases the reason the claim depends on.**
- **Severity:** Major
- **Affected Scope:**
  - §4.3 (l.148, l.150)
  - §6.2.1 partial index (l.288)
  - §6.5.6 (l.557)
  - Glossary "Claim rows" (l.100)
  - §6.6 red rule (l.581)
  - Decision 9 (l.738)
  - Plan files 10, 19, 25 (l.814, l.850, l.874)
- **Simplicity Rationale:**
  - The reason was added "by this document". No sheet row, no Daftar entry ("—" on import) and no owner decision backs it.
  - Changing an Osave `pecah` line to `tidak_balik` to clear orange makes it non-physical. That removes it from red (`needsClaimRef`), from the Klaim chip and from the claim CSV, and the export's Alasan Retur stops saying Pecah. Yet the Osave return number and the claim to Aryo still exist.
  - It cannot be made correct inside the reason model, because it overwrites the very reason that claim membership is derived from.
  - It also lengthens the list that is coupled to a migration (the partial index plus the sync test).
  - Drop it from Phase 2. An orange line whose goods never reached the warehouse is truthfully orange; admin notes why. If the case shows up in practice, model it as a warehouse outcome rather than a reason, in its own change.
  - If §3.3's "orange below 10" signal is what motivated it, tune the signal instead (see N7).

---

## NIT

**N1. `canVoidReturn` re-implements `canEditEntry`.**
- **Affected Scope:** §6.3.2 "UI mirror" row (l.474); plan file 7 (l.802); file 17 (l.842).
- `src/lib/activityGrouping.ts:29–41` already exists. Its comment reads "Edit/void window: admins always; owners within 48h of creation", and it takes the same parameters.
- The Resolution table's M2 row said "`canEditEntry` stays as the UI mirror". The draft has drifted from that.
- If minute precision matters (`differenceInHours` truncates, so the UI can offer a void for up to 59 minutes after the server's 48-hour cut-off), fix it once in `canEditEntry` so every caller benefits.

**N2. The same check exists at three layers, twice.**
- **Affected Scope:** §6.3.2 SQL l.445–451 and error row l.471; §6.5.7 l.563; §6.4 l.496; §6.5.5 step 2 l.546; plan file 4 l.790.
- **Void stock:**
  - the client's `inflows` sum
  - `VOID_INSUFFICIENT_STOCK`, an unlocked pre-sum
  - `record_order_outflows`'s own `INSUFFICIENT_STOCK: % is short %` (`20260707000000…:102–106`)
  - Drop `VOID_INSUFFICIENT_STOCK` and map `INSUFFICIENT_STOCK`; "left" is the quantity minus the shortfall. M2 removes the client pre-check.
- **Return cap:**
  - the §6.5.3 block
  - the builder's `{kind:'exceeds'}`, which the document itself calls unreachable in both callers (l.546, l.790)
  - the server
  - The `exceeds` variant adds a result type and a test for a branch no caller reaches.

**N3. The new kind of `outflows` row was audited against `returns` readers only.**
- **Affected Scope:** §6.3.2 "Dashboard and feed" row (l.473); §6.3.3 (l.478–489).
- These readers count V as an ordinary outflow:
  - `InventoryDashboard.tsx:161` (`averageDailyOutflow` velocity)
  - `InventoryTrendLineChart.tsx:73`
  - `inventory-assistant/index.ts:74–79, 212–215` (monthly averages)
  - `tools.ts:233–242, 296–303` (`listTransactions`, `sumMovements`)
- A restock never appears as an inflow, so its void appears as a phantom outflow. The effect is small and rare.
- Fix: one sentence accepting it, or `.is("void_return_id", null)` in those readers (the column is already indexed).

**N4. "Riwayat retur" fetches the compensating outflows, although the returns row already holds everything the display needs.**
- **Affected Scope:** §6.5.7 (l.561); plan file 15 (l.834); file 17 (l.842).
- "ditarik dari stok 2 Nov: 712 butir NEGERI BIASA (RETAKAN)" comes straight from the return row: product (+ " (RETAKAN)" for a retakan), quantity, and the WIB date of `voided_at`. The two "nothing withdrawn" cases are a writeoff and a restock on a voided PO, which `poState` already knows.
- The extra `outflows where void_return_id in (…)` query can go.

**N5. Two types for one `returns` row.**
- **Affected Scope:** plan file 5 (l.794), file 6 (l.798).
- `ReturnRecord` (`src/types/returns.ts:32`) has no users today. File 5 extends it, while file 6 creates a new snake_case `ReturnRow` with the same columns. Keep one: either delete `ReturnRecord` or use it.

**N6. Inputs and units have drifted from the feature text.**
- **Affected Scope:** §2.1 item 1 (l.32); §2 (l.22); §6.7.1 column 10 (l.608).
- §2.1 item 1 still says "There is no third input. The warehouse types one number". "Butir diterima" is now typed (prefilled) and OK = diterima − Pecah. §2 l.22 does not list it.
- Column 10 promises both "in the line's unit" and "the same value on every line of one SKU". Those conflict once a Kurang line in boxes sits next to a Pecah line in paks.

**N7. §3.3 success signals that cannot be measured as written.**
- **Affected Scope:** §3.3 (l.70).
- "`returns` rows per week ≥ about 25 physical-return rows": one save writes one or two `returns` rows, so this compares different units. Count warehouse-done physical-return lines (or save groups) instead.
- "Orange on any day below 10": the chip has no history. State the query, for example lines older than 2 days that are not warehouse-done.
- "No. Retur within 7 days of Tgl Kirim": nothing timestamps when `claim_ref` was set, and `updated_at` is overwritten by any edit. Measure at the review instead: Osave physical-return lines older than 7 days with no ref = 0.

**N8. Editorial drift in the plan and checklist.**
- **Affected Scope:** l.760 vs l.884; rollout step 1 (l.935); §6.5.5 step 2 (l.546); §6.3.2 (l.474).
- "Phase 2a = files 1a–30" includes file 28, which is marked 2b.
- The rollout step 1 snapshots (inflow totals, 136 returns, 65 RETAKAN inflows) have no later step that compares against them. Either name the comparison or drop them.
- Call signatures sit in feature sections: `callRecordReturn({ returnDate, buyerName, reason, lines })` at l.546 and `canVoidReturn(createdAt, …)` at l.474. Leave them to the plan.

---

## Files relevant to this review
- C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260904000000_returns.sql (`void_outflow` restore rule, B1)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260914020000_reconcile_and_returns_aware_recalc.sql (reconcile invariant that hides B1)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261008000000_returns_sku_code.sql (per-entry `v_returned`, M1)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260707000000_idempotent_order_outflows.sql (reuse confirmed; `INSUFFICIENT_STOCK`, N2)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261029000000_recon_views.sql (`tanpa-log` and outflow classification)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\activityGrouping.ts (`canEditEntry`, N1)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\types\returns.ts (unused `ReturnRecord`, N5)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\usePriorReturns.ts
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\InventoryDashboard.tsx, src\components\InventoryTrendLineChart.tsx, supabase\functions\inventory-assistant\index.ts, supabase\functions\inventory-assistant\tools.ts (outflow readers, N3)
- C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\sheet_excerpts.md (2610421 and 2610448 evidence; Daftar list includes Lebih and not tidak_balik)
