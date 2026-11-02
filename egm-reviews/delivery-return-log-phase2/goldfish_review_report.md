# Goldfish Annotated Review Report (Stage 7 resolution)

Status: resolved (2026-11-02; all PROPOSE FIX edits applied to `design_draft.md` in one batch before Stage 8)

**Target:** `design_draft.md` (FeatureRange, lines 1–700 at review time) · **Findings:** `critic_report.md` (ids D*, S*, T*)

## Prioritized findings and resolutions

### Blocker

**D1** [`egm-design`] Restock voids usually fail; void order backwards; no way to lower stock.
*AI Suggestion:* **PROPOSE FIX** (design change). *Justification:* verified against `20260707000000_idempotent_order_outflows.sql` lines 78–86: sales take the oldest live batch, which is where `record_return` restocked. A reversal-in-place would fail on the first sale after the restock, so owner decision A would not be delivered. *Edit:* §6.3.2 rewritten: a void never rewrites stock history; it records the opposite movement through the existing `record_order_outflows` RPC (one outflow on the parent product for a restock, on the RETAKAN child for a retakan, FIFO oldest-first, dated the WIB day of the void, tagged `outflows.void_return_id`). It succeeds whenever the product's stock covers the amount (`VOID_INSUFFICIENT_STOCK` otherwise); `RESTOCK_CONSUMED` and `RETAKAN_INFLOW_MISSING` no longer exist. Consequences propagated: `void_outflow`, `reconcile_inventory` and `recalculate_inventory_fifo` are now **unchanged** (a voided restock stays a physical fact), `v_recon_ledger` shows the void movement, §6.5.7 void order and half-voided state rewritten, CUJ 4 rewritten, §7 alternatives added, rollback simplified.

### Major

| Id | Reviewer | Suggestion | Justification and edit |
|---|---|---|---|
| D2 | design | PROPOSE FIX | `buildReturnLines` returns `{ok:false, kind:'exceeds', product, exceedsBy}` beyond 0.01 native; the Retur section blocks before the confirmation on egg-level remaining (all SKUs, null-SKU returns included); the 15.5 vs catalog `eggs_per_unit` dependency added to §8 with a line hint when the live factor differs. |
| D3 | design | PROPOSE FIX | Return-entry id lifecycle defined (new after success, after any void, whenever the SKU's loaded returns change); after a NETWORK failure the warehouse inputs freeze and "Coba lagi" re-reads first: own ids present → success with the stored numbers; absent → resend the same ids. |
| D4 | design | PROPOSE FIX | "Butir diterima" field (pieces received this sorting, default = line pieces − prior), OK = diterima − Pecah; blocks on cumulative total > line pieces; `expected_prior` on the RPC replaces the client re-read (see D11). |
| D5 | design | PROPOSE FIX | Per-line unit for box SKUs (box or pak, snapshot); received-pieces field (above); whole-number pieces enforced; import resolves the unit from OK + Pecah and lists the rest. |
| D6 | design | PROPOSE FIX | Rollback rewritten: revoke `void_return` first, revert the frontend, leave every additive column, table and view in place (new-bundle phones keep working); no function body is rolled back; `delivery_lines` exported before any later cleanup drop. |
| D7 | design | PROPOSE FIX | `getReturnsTool` filter added to §6.3.3, file 30 (edge function) and a `deploy_edge_function` rollout step. |
| D8 | design | PROPOSE FIX | Lock narrowed to `sku_code` and the physical / non-physical nature of the reason; quantity, note, ref, expiry editable; delete allowed with a warning (returns become "retur tanpa baris"). |
| D9 | design | PROPOSE FIX | Import: same (SKU, reason) rows merged (quantities summed, notes joined; 2610421 corrected), row-by-row inserts with a pre-read and a collision list, blank Qty Retur derived from Qty Diterima for non-physical reasons, refs normalised, matching before the customer skip, the sheet's OK / Pecah / Tgl Barang Balik written into the note. |
| D10 | design | PROPOSE FIX | Per-product precondition (no manual correction since 15 Oct), one route per product, selisih compared first. |
| S1 | structural | PROPOSE FIX | Every placeholder wrapped in a code span. |
| S2 | structural | CONTEST | The repository's spec style (`2026-10-29-delivery-return-log-design.md` §9) places Open questions after Alternatives and Risks, and this document follows it; the deviation from the template is now stated in the status block. |
| S3 | structural | PROPOSE FIX | The duplicate-ref warning is its own Goals bullet. |
| T1 | style | PROPOSE FIX | "one delivery line per (SKU, reason)". |
| T2 | style | PROPOSE FIX | "136 `returns` rows on 75 outflow rows". |
| T3 | style | PROPOSE FIX | PO line definition covers loose-egg PO lines. |
| T4 | style | PROPOSE FIX | "store-side record"; "claim" reserved for flagged buyers. |
| T5 | style | PROPOSE FIX | Where ids live stated (`useRef`, not `delivery_lines`). |
| T6 | style | PROPOSE FIX | "app admin" everywhere the role is meant. |
| T7 | style | PROPOSE FIX | "warehouse-done" / "orange" / "red" defined in §4.1 and used throughout. |
| T8 | style | PROPOSE FIX | "save group" defined and used. |
| T9 | style | PROPOSE FIX | One unit for the red count; "shared invoice refs". |
| T10 | style | PROPOSE FIX | "caps unchanged" replaced by what changes. |
| T11 | style | PROPOSE FIX | Superseded by D1 (void order no longer depends on which call "can fail"). |
| T12 | style | PROPOSE FIX | `void_return` argument restated from §1's counts. |
| T13 | style | PROPOSE FIX | "two admins type rows". |

### Nit

| Id | Suggestion | Edit |
|---|---|---|
| D11 | PROPOSE FIX | `expected_prior` adopted in `record_return` (optional per entry; old bundles do not send it; the Retur section always does); egg-level prior returns incl. null-SKU shown in the confirmation. |
| D12 | PROPOSE FIX | UI compares minutes (`canVoidReturn`, 48 × 60) so it matches the server. |
| D13 | PROPOSE FIX | Already-voided check runs under the lock before authorisation. |
| D14 | PROPOSE FIX | `void_return` no longer orders inflows itself; the FIFO order of `record_order_outflows` (`date`, `created_at`, no `id` tie-breaker) is noted as pre-existing. |
| D15 | PROPOSE FIX | `v_recon_ledger`: return rows take `voided_at = o.voided_at`; retakan match prefers `i.return_id`. |
| D16 | PROPOSE FIX | Assumption stated; the server cap uses `outflows.quantity_butir` and messages carry the server's numbers. |
| D17 | PROPOSE FIX | CUJ 4 and CUJ 6 figures restated from the app's rules; Family Mart noted. |
| D18 | PROPOSE FIX | Qty Diterima rule per reason, with sheet rows. |
| D19 | PROPOSE FIX | Split rationale: separate review and rollback only. |
| D20 | PROPOSE FIX | `user_email` backfill from `auth.users` in the feature migration. |
| D21 | PROPOSE FIX | Stated: a new non-physical reason needs a migration. |
| D22 | PROPOSE FIX | Reason `tidak_balik` ("Tidak masuk gudang") closes an orange line whose goods never arrive. |
| D23 | PROPOSE FIX | Tgl Barang Balik min = Tgl Kirim. |
| D24 | PROPOSE FIX | §3.3 Success signals with a review date. |
| D25 | PROPOSE FIX | Fallback for POs without a faktur number named in §6.7.3. |
| S4 | DECLINE | Problem before Overview is the repository's style. |
| S5 | PROPOSE FIX | Goals / Non-goals / Success signals numbered 3.1–3.3. |
| S6 | PROPOSE FIX | Metadata as a bulleted list; precedence rule moved to the blockquote. |
| S7 | PROPOSE FIX | "Adopted per line" row moved from §7 to §10. |
| S8, S9 | PROPOSE FIX | Diagram and mockup redrawn, ASCII only. |
| S10 | PROPOSE FIX | `-- excerpt` comments on fragment fences. |
| S11 | PROPOSE FIX | Export headers as numbered tables. |
| S12 | PROPOSE FIX | List styles aligned; the lock rule moved out of the numbered save sequence. |
| S13 | PROPOSE FIX | One heading suffix convention ("— feature migration" / "— void migration"); brief citations in text only. |
| S14 | PROPOSE FIX | Brief link text; `feature_concept.md` located in `egm-reviews/delivery-return-log-phase2/`. |
| S15 | PROPOSE FIX | Glossary rows for butir, pak / box, Osave, DC; Phase 1 terms as table rows; reasons defined once in §4.3. |
| S16 | PROPOSE FIX | Answered question moved to §10; the dry-run action item to the rollout checklist. |
| S17 | DECLINE | The template heading is kept at the boundary. |
| T14–T27 | PROPOSE FIX (most) | Terminology, qualifiers, informal wording, synonyms, filler, grammar and range notation applied; repetition reduced where a cross-reference suffices. DECLINE: T23 (repetition in the decision log is by design); T24 partially (the Phase 1 terms became table rows, the four-case sentence a list). |

## Later stages

- **Stage 8** (intermediate zoom-out): findings and resolutions in `intermediate_zoom_out_report.md` (status: resolved).
- **Stage 9** (implementation readiness, codebase details, style): the three verbatim reports, the consolidated ids (IR-*, CD-*, ST-*) and every resolution are in `implementation_readiness_report.md` (status: resolved; 3 distinct Blockers fixed, all Majors fixed, Nits applied except ST-N53 and the out-of-scope part of CD-N8). The resulting draft is v6, copied unchanged (except the Status line) to `docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md`.
