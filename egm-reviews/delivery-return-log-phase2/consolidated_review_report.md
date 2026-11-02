# Consolidated review report: Delivery & Return Log Phase 2 "Retur per faktur"

**Deliverable:** `docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md` (the content of `design_draft.md` v6; untracked, not committed: this session has no worktree)
**Brief:** `docs/superpowers/specs/2026-11-01-delivery-return-log-phase2-brief.md` (owner decisions A–D of 2026-11-02)
**Method:** EGM `egm-draft`, uninterrupted flow; every reviewer a fresh-context Opus subagent; the drafting session (Elephant) resolved each finding under the egm-resolve rules (CONTEST / ESCALATE / PROPOSE FIX / DECLINE; comprehension gaps never contested) and wrote every report.
**Date:** 2026-11-02

## 1. Stages and outcomes

| Stage | Reviewer(s) | Blocker / Major / Nit | Report | Outcome |
|---|---|---|---|---|
| 5 Zoom-out | egm-zoom-out | 0 / 6 / 5 | `zoom_out_report.md` | `delivery_line_id`, the reviewer tick, `import_key` and the RETAKAN backfill dropped; the one-physical-line-per-SKU rule added; concurrency limit written down |
| 6 Comprehension | egm-comprehension | 0 / 9 / 12 | `comprehension_report.md` | glossary, vocabulary tables, CUJ figures, `lebih` moved to non-physical, calendar-month expiry |
| 7 Critic | egm-design, egm-structural, egm-style | 1 / 23 / 44 | `critic_report.md`, `goldfish_review_report.md` | **Blocker D1**: a reversal-in-place void fails after the first FIFO sale → `void_return` became a compensating outflow through `record_order_outflows`; `expected_prior`; received-pieces field; per-line unit; narrowed lock; drop-nothing rollback |
| 8 Intermediate zoom-out | egm-zoom-out | 1 / 7 / 9 | `intermediate_zoom_out_report.md` | **Blocker**: `void_outflow` under-restored after a voided restock → `void_outflow` changed; void by save group; `expected_prior` once per outflow per call; one migration; `tidak_balik` dropped |
| 9 Implementation readiness | egm-implementation-readiness, egm-codebase-details, egm-style | 3 (distinct) / 50 / 73 | `implementation_readiness_report.md` | **Blockers**: per-batch accounting after void + re-record (both IR and CD) → signed restore in `void_outflow` with `VOID_BLOCKED`, `reconcile_inventory` unchanged, `recalculate_inventory_fifo` limit stated; `canEditEntry` is not the feed's guard → `useVoidEntry().canEdit`; rounding fires `exceeds` on valid maxima → one-piece tolerance and floored caps. Plan rewritten: 33 items in four buildable steps, an RPC test harness, types from a branch, every test with an expected result |

Counts are the reviewers' own; Stage 9's Blockers are five as reported and three distinct. Every Blocker and Major was resolved with a PROPOSE FIX applied to the draft; two Stage 7 structural findings were contested or declined on the repository's spec style (S2, S4, S17), two Nits declined at Stage 9 (ST-N53, the out-of-scope part of CD-N8). No finding was escalated: none required a decision the brief had not already given the owner, except the ones listed in §4.

## 2. How the design moved

The brief's mechanism for owner decision A was a reversal in place (`return_restocks` subtracted oldest-first, `RESTOCK_CONSUMED` otherwise). Three review stages turned that into the model the document now has:

1. **Stage 7** verified against `record_order_outflows` that sales take the oldest live batch, which is exactly where `record_return` restocks, so a reversal in place would fail within hours for Negeri. The void became a **compensating outflow** (the opposite movement, FIFO, tagged `outflows.void_return_id`), voiding a whole save group in one all-or-nothing call.
2. **Stage 8** showed that `void_outflow` then under-restores by the compensated amount when the order itself is voided, so `void_outflow` had to change after all.
3. **Stage 9** (two reviewers, four counterexamples) showed that letting the corrected return restock the same batch breaks the per-batch bound `void_outflow` and `recalculate_inventory_fifo` assume. The resolution is a **signed per-batch restore** (`deducted − Σ restocks, voided included + Σ compensating deductions`) over the union of the order's batches, which is the state in which the order, its returns and their voids never happened. It was checked against all four counterexamples (worked in §6.3.3 of the document and in RPC tests R13–R17); `reconcile_inventory`'s invariant holds unchanged; `recalculate_inventory_fifo` is left alone and its pre-existing sell-after-restock limit is written down instead of being claimed as a check.

Other movements worth the owner's eye: the warehouse side gained a **"Butir diterima"** field (partial sortings, sheet 2610421); box SKUs got a **per-line unit** (box or pak, sheet 2610448); `record_return` gained **`expected_prior`** (double-entry caught on the server, not by a client re-read); `expiry_rules` gained **calendar months**; the rollback **drops nothing**; the **import** is store-side only with pure, tested rules; the monthly "selisih kurang" lives in a **list chip**, not an export cell.

## 3. Traceability: brief decisions → document

| Brief | Document | Status |
|---|---|---|
| D1 entry point, stock truth | §2, §6.1, decision 1 | as decided |
| D2 save shape | §6.5.1–6.5.5, decision 2 | as decided + received-pieces field |
| D3 units / B3 | §4.4, §6.2.5, §6.5.1–6.5.2, decision 3 | as decided + per-line unit, `piecesPerUnit` rule |
| D4 warehouse-done | §4.1, §6.2.1, decision 4 | as decided; `delivery_line_id` dropped |
| D5 one implementation / M2 | §6.4, items 3–6, 13, decision 5 | as decided; `exceeds` with one-piece tolerance |
| D6 outflow ids / M1 | §6.2.4, §6.10, item 27, decision 6 | as decided + duplicate-ref warning detail |
| D7 `delivery_lines` / M10 | §6.2.1, decision 7 | as decided + physical-line uniqueness; `import_key` dropped |
| D8 vocabulary | §4.2, decision 8 | as decided |
| D9 non-physical reasons / owner B | §4.3, §6.5.6, decision 9 | as decided + `lebih`; monthly figure = Kurang chip (reconciliation contradiction 1) |
| D10 claim ref | §6.2.6, §6.5.1, decision 10 | as decided |
| D11 flags / owner C | §6.6, decision 11 | as decided |
| D12 exports | §6.7, decision 12 | as decided; Full on the empty-faktur row |
| D13 errors, history | §6.5.5, §6.5.7, decision 13 | as decided + new void messages |
| D14 expiry / M13 | §6.2.7, §6.8, decision 14 | as decided + months, unique index |
| D15 import / owner D | §6.9, item 29, decision 15 | as decided; pure rules tested; rollback narrowed |
| D16 pre-loading | §6.2.1, §6.10, decision 16 | as decided |
| D17 order edit and void / N3 | §6.3.3, §6.3.4, decision 17 | **changed**: signed restore, `VOID_BLOCKED` |
| D18 paraf gudang / N1 | §2.1, §6.2.2, decision 18 | as decided; tick dropped |
| D19 `void_return` / owner A | §6.3.2, decision 19 | **changed mechanism**: compensating outflow, save-group void, server authorisation, one migration |
| N7 `invoiceRef` not required | §3.2, decision 23 | as analysed |
| N8 four sentences | §2.1 | restated |
| B3 live SKU rows | §4.4 | cited from `pack_skus` on 2026-11-02 |

## 4. Owner decisions (answered 2026-11-02: 1 approved; 2 export summary row; 3 Family Mart flagged; 4 Novi app admin, Yani and Dila users)

1. **Decision 19's mechanism** (compensating outflow + signed `void_outflow` restore + `VOID_BLOCKED`) instead of the brief's reversal in place. The promise is kept; the mechanism and its error cases differ. Reconciliation contradiction list: `draft_reconciliation.md`.
2. **Where the monthly "selisih kurang" figure lives**: the Kurang list chip (document) or a cell in the export (brief).
3. **Family Mart** `requires_claim_ref` (§9 item 1).
4. **App admin roles** for Yani, Dila, Novi (§9 item 2; Phase 1 Q9).

## 5. Recommended next steps

- Owner reads §6.3.2–6.3.3, §7 and §10 of the document, decides the four items above, and marks the Status line.
- Run `egm-review` on the final document once the owner's decisions are in (a fresh full review is cheaper than re-running the critic stages on a document that changed this much in §6.3).
- Implementation follows the plan's four steps; `data-integrity-reviewer` on item 1 and the RPC script (item 2) on a Supabase branch gate the migration (rollout step 2b).
