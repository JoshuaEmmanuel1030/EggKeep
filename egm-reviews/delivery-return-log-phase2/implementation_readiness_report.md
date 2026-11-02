# Stage 9: Implementation Readiness Test (egm-implementation-readiness, egm-codebase-details, egm-style; all Opus)

**Target:** `design_draft.md`, DetailedRange lines 766–956 (of 956 at review time), plus every claim about current code the plan relies on · **Standard:** implementation-readiness-standard.md for the first two · **Date:** 2026-11-02
**Reviewer status:** egm-implementation-readiness completed (1 Blocker, 17 Major + 1 unnumbered Major, 12 Nit) · egm-codebase-details completed (3 Blocker, 17 Major, 8 Nit) · egm-style completed (0 Blocker, 16 Major, 53 Nit, 3 content observations)
**Status:** resolved (fixes applied to `design_draft.md`; the review ends here, uninterrupted flow)

## Resolution by the drafting session (Elephant)

Ids: IR-* implementation readiness, CD-* codebase details, ST-* style.

### Blockers

| Id | Finding | Resolution | Applied change |
|---|---|---|---|
| IR-B1, CD-B1 | After a void and a re-recorded restock, the per-batch bound `Σ restocks ≤ deducted` no longer holds; `void_outflow`'s "deducted − Σ all restocks, skip if ≤ 0" plus restoring the compensating outflow inflates stock or trips `inflows_remaining_bounds`; `recalculate_inventory_fifo` can abort | PROPOSE FIX | The accounting is restated and verified against all four counterexamples (IR example 1 and 2, CD's with V on C and with V on B): `record_return` keeps `v_already` = restocks of **non-voided** returns per batch (so the corrected return can re-enter the original batch) and `v_total_restored` likewise; `void_outflow` applies, per batch in the **union** of the order's deducted batches, its restocks' batches (voided returns included) and its compensating outflows' batches, the signed amount `deducted_b − Σ restocks_b(all returns of O) + Σ deductions_b(compensating outflows of O's voided restocks)`, which is exactly "as if O, its returns and its compensations never happened", and marks those compensating outflows voided; a batch that would go below zero (phantom eggs already sold on) raises `inflows_remaining_bounds`, mapped as `VOID_BLOCKED`, owner handles. `reconcile_inventory` is unchanged and its invariant holds before and after (worked through in §6.3.3). `recalculate_inventory_fifo` is unchanged, but the claim that it reproduces remainders is withdrawn: it already cannot rebuild "sell after restock" today (pre-existing, stated in §8); V2 is the correctness check. Both examples are in the RPC test script. |
| CD-B2 | `canEditEntry` is not the feed's guard (unused outside its test); the feed uses `useVoidEntry().canEdit`; minutes still leave a sub-minute gap | PROPOSE FIX | The UI gate for "Batalkan retur ini" is `useVoidEntry().canEdit` (the feed's real guard); no change to `activityGrouping.ts`; the ≤ 1 h window in which the UI may offer a void the server refuses is stated, and the mapped `VOID_WINDOW_CLOSED` message covers it. Glossary corrected. |
| CD-B3, IR-M6 | The piece cap rounds up to 0.5 piece above the native remainder, so "exceeds beyond 0.01 native" fires on valid maximum entries; the dialog has no handling for it; 0.01 is a float comparison | PROPOSE FIX | The builder's tolerance is one piece in the egg's native unit (`piecesToNative(1, unit) + 1e-9`); below it the running remainder clamps silently as today, above it `exceeds` is returned; the Retur section's displayed caps use `Math.floor` (`capPieces`) so a typed maximum never exceeds; the dialog maps `exceeds` to its existing over-max hint; ids are resolved before the builder runs; the unresolved toast keeps the row label. Tests restated (exceed by 0.05 kg → clamped; by 0.5 kg → `exceeds`). |

### Major

| Id | Finding | Resolution | Applied change |
|---|---|---|---|
| IR-M1, CD-M1 | Recon export client and its drift test missing; view SQL specifics open | PROPOSE FIX | File 28 added: `src/lib/reconExport.ts` (`ReconJenis` / `RECON_JENIS` / `RECON_FLAGS` gain `retur_batal`, `retur-batal`, `retur-dibatalkan`; Retur tab includes `retur_batal`; Faktur tab's Retur column skips rows flagged `retur-dibatalkan`; `RECON_SCHEMA_VERSION` bumped), `reconViewsSync.test.ts` re-pointed at the new migration file; the view edits are itemised (sign of `qty`, nulled `keluar_*`, `outflow_id` / `return_id` / `disposisi` of a `retur_batal` row, a new `dibatalkan` CTE column, the retakan branch). |
| IR-M2, CD-M2 | `create or replace view` resets options | PROPOSE FIX | Both view replacements restate the full definition with `with (security_invoker = true)` and an unchanged column list; stated in §6.2.4 and file 1. |
| IR-M3, CD-M3, CD-M4 | List / flag / export data structures undefined; `egg_totals` not selected; `rowToDelivery` drops embedded lines; `buildDeliveryItems` call sites; kg → pieces conversion inputs | PROPOSE FIX | Types and signatures defined in files 8 and 9 (`LineReturnSummary`, `DeliveryLineView`, `LineSummary`, `buildDeliveryItems(pos, deliveries, lines, returns, requiresRefByBuyer, unitByProduct)`, `summarizeLines`, filter keys); `PO_COLUMNS` / `PoRow` add `egg_totals`; `fetchDeliveriesInRange` returns lines separately; per-bucket conversion then sum (as `ReturnBubble`); `unitByProduct` from `useItemTypes().conversionMap`; the two existing test call sites updated. |
| IR-M4 | A voided PO has no `egg_totals` | PROPOSE FIX | `fetchDeliveryDetail` derives `eggOutflowIds` from the live PO or, when `poState = voided`, from the voided `activity_logs` rows' `relatedEntryId` (the `voidedPoState` query selects `metadata`). |
| IR-M5, CD-M11, ST-O1 | The feed's `hasReturns` would ignore voided returns while `correct_order` counts them | PROPOSE FIX | `OutflowReturns` gains `anyReturns` (voided included); `canCorrect.hasReturns` reads it; `usePriorReturns` fetches with `includeVoided` and summarises live sums plus `anyReturns`. |
| IR-M7, CD-M6 | `INSUFFICIENT_STOCK` number is native; prescribed wording wrong; void messages reuse edit-dialog strings | PROPOSE FIX | The message names the product (parsed with one regex) and no number; new locale keys for the void `NOT_ALLOWED` / `VOID_WINDOW_CLOSED`; `VOID_BLOCKED` and `DEADLOCK` (40P01 → "coba lagi") added to the void mapper. |
| IR-M8, CD-M14 | `void_outflow` lock order; `v_entries` order; deadlock claim overstated | PROPOSE FIX | `void_outflow` locks O, then the compensating outflows' rows, then the union of batches in one sorted pass (`date`, `created_at`, `id`); `void_return` builds its entries ordered by product; the deadlock statement is narrowed to "same ordering clause; the missing `id` tie-breaker in `record_order_outflows` leaves a theoretical cycle, mapped to a retry". |
| IR-M9, CD-M5 | Duplicate-ref warning underspecified | PROPOSE FIX | File 25 specifies the second unwindowed query, the new fields on `OrderToCheck` / `DuplicateMatch`, the same-batch check, the locale key under `outflow`, and the pure-function test. |
| IR-M10, CD-M9, CD-M16 | Missing files: `src/types/catalog.ts`, an `expiry_rules` reader, `BuyerList` / `addBuyer`, recon export, RPC test script, `Deliveries.tsx` placeholder, `PO_COLUMNS`, `duplicateOrder.ts`, the agent file | PROPOSE FIX | All added (files 8, 11, 22, 23, 28, 30, 31, 32); `outflowCalculator.ts` dropped from file 21; `buildSkuEggMap` takes `src/types/catalog.ts`'s `PackSKU`. |
| IR-M11, CD-M13 | RPC tests have no harness and do not gate the migration | PROPOSE FIX | File 30: `supabase/tests/phase2_returns.sql`, with setup (a test egg product and two batches, two existing user ids), `set local role authenticated` + `request.jwt.claims`, back-dated `created_at`, every case as a `do $$ … raise exception $$` assertion, run on a Supabase branch (`create_branch`) or a local stack; rollout step 2b. |
| IR-M12 | Types regeneration is circular with `npm run verify` | PROPOSE FIX | Types are generated against the branch after the migration is applied there and committed in the PR; production apply at step 3. |
| IR-M13, ST-M15, ST-O2 | Step 9 stock equation not executable | PROPOSE FIX | Equation removed; V2 and the per-faktur check are the correctness checks; the step 1 snapshot is the owner's reference. |
| IR-M14 | One phase for 28 files | PROPOSE FIX | 2a split into 2a-1 (migration + RPC script), 2a-2 (pure libs + tests), 2a-3 (hooks + UI), 2a-4 (catalog, duplicate check, exports, script, docs). |
| IR-M15 | Expiry test contradicts the seed | PROPOSE FIX | Sayurbox P25 21 Oct + 21 days → 11 Nov; Astro default 22 → 12 Nov. |
| IR-M16 | Full on the empty-faktur row | PROPOSE FIX | Columns 9–11 and 13–21 blank; column 12 filled. |
| IR-M17, CD-M15 | Import: no tests, `.env` loading, Status Kirim map, NOT NULL columns, rollback deletes app rows, environment | PROPOSE FIX | Pure rules in `scripts/lib/sheetImportRules.mjs` tested by vitest; `node --env-file=.env` (Node ≥ 20.6) and the script builds its own client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` and asserts the project ref; Status Kirim map; `deliveries` NOT NULL columns from the PO; capacity rows asserted present; rollback deletes imported lines only and the created deliveries only when they carry no other line, by the owner in SQL. |
| IR "also Major" | What goes into `returns.reason` / `buyer_name` | PROPOSE FIX | `reason` = the reason code; `buyer_name` = `po.buyerName`. Stated in §6.5.5; the assistant shows raw codes (CD-N8 accepted). |
| CD-M7 | The dialog refactor changes uncovered behaviour | PROPOSE FIX | File 4 states: a box SKU with no capacity keeps today's fallback (the box row's own fields, so a native-unit row still appears); ids resolved before the builder; the unresolved toast keeps the row label; `piecesPerBox: null` handling. |
| CD-M8 | The `pieces_per_unit` rule is not stated | PROPOSE FIX | §6.5.1: unit box → `piecesPerBox` when set, else `piecesPerPak` (that is `N30B`'s 150); unit pak → `piecesPerPak`; a box-mode SKU with no capacity cannot be typed in box. |
| CD-M10 | A save with "Butir diterima" 0 and Pecah 0 reaches `NO_ENTRIES` | PROPOSE FIX | "Butir diterima" must be ≥ 1; `NO_ENTRIES` added to the mapped codes. |
| CD-M12 | Test infrastructure for the new component test | PROPOSE FIX | File 19 lists the mocks (`useDelivery`, `useDeliveryReturns`, `usePackSKUs`, `useItemTypes`, `useAuth`, `useUserRole`, `useVoidEntry`, `sonner`), a `QueryClientProvider` wrapper helper (`src/test/renderWithQuery.tsx`, new), and the three existing mock factories of `@/hooks/usePriorReturns` that must export the new names. |
| CD-M17 | 0.01 float boundary | PROPOSE FIX | Superseded by the one-piece tolerance with `1e-9` epsilon. |
| ST-M1–M16 | Phase and deploy verbs; migration count; long sentences; fixtures without expected results; "through"; confirmation text; "line"; "delivery-line save"; "non-admin"; "return" vs save group; `canEditEntry` and `isAdmin`; "edit guard"; "four box SKUs"; V1 pass condition; step 9; "instead of" | PROPOSE FIX | All applied (the confirmation string is now one template, CUJ 1 and the test cite it). |

### Nit

IR-N1–N12, CD-N1–N8, ST-N1–N53: applied where the change was a sentence or a name (`create or replace`, the idempotency claim withdrawn, transaction note, `PRIOR_MISMATCH` checked first, ids pinned while frozen, `shelfDays` nullable, `basePackCode ?? code`, entries ordered by product, step 4 exact inputs, rollback of `v_recon_ledger`, `useItemTypes` in `useOrderReturns`, both colours shown, same SKU summed, "Anda", `kind` at `SKUDialog.tsx:38`, `listTransactionsTool` / `sumMovementsTool`, `getReturnsTool`'s totals / schema enum / filter, PLAN.md's location-based table, the badge's `staleTime`, `ensureDelivery` with `ignoreDuplicates`, `isAdmin` prop, query key, items 28 / 29 swapped, numbering, units, jargon, copy consistency). DECLINE: ST-N53 (the EGM provenance line stays, as in the template); CD-N8 beyond a note (mapping reason codes in the assistant is out of scope).

## Reviewer reports (verbatim)

### egm-implementation-readiness

## Implementation readiness review: `design_draft.md`, DetailedRange (lines 766–952)

**Verdict: FAIL.** The plan breaks the Zero-Decision Rule: 1 Blocker, 17 Major, 12 Nit.

**What I read.** The persona file, the Implementation Readiness Standard and the whole target (lines 1–957). Against `main-ro` I read these in full:
- CLAUDE.md
- the migrations: returns, returns_sku_code, idempotent_order_outflows, reconcile_and_returns_aware_recalc, inflows_stock_invariants, recon_views, buyer_profiles, correct_order_guards, deliveries, expiry_rules
- RecordReturnDialog.tsx and its test, returnRpc.ts, types/returns.ts, usePriorReturns.ts, returnsCap.ts, useRecordReturn.ts
- types/deliveries.ts, deliveryFlags.ts, useDeliveries.ts, useDelivery.ts, DeliveryDetail.tsx, Deliveries.tsx, deliveryExport.ts
- usePackSKUs.ts, SKUDialog.tsx, useBuyers.ts, catalogDependencies.ts, useDuplicateOrderCheck.ts
- reconViewsSync.test.ts, orderGroupingSync.test.ts

I read these in part: GroupedActivityLog.tsx, activityGrouping.ts, orderCorrection.ts, outflowCalculator.ts, reconExport.ts, tools.ts, the locales, and the Phase 1 spec (headings only). I did not read the brief or any brainstorm or report file.

---

### BLOCKER

**B1. Restoring stock after a void and re-record can create stock or fail outright**
- **Scope:** File 1 steps (8) and (9) (line 775); §6.3.1 change 3 (line 388); §6.3.3 (lines 481–483); Verification (line 901).
- **Cause.** Change 3 removes voided restocks from `v_already`, the per-batch cap. So a replacement restock R2 can go into the same batch as the voided R. Then all restocks into a batch, live and voided, can add up to more than the order took from that batch.
  - `void_outflow`'s existing loop computes `deducted − Σ all restocks` and skips negative results (`if v_restore <= v_eps then continue`).
  - The new step then puts back all of the compensating outflow V's deductions.
- **Example 1 (stock created from nothing).**
  - O takes 5 from batch B1 and 45 from B2.
  - R restocks 10: +5 into B1, +5 into B2.
  - The void writes V, −10.
  - R2 restocks 10: B1's live-only cap is 0 used, so +5 into B1 and +5 into B2.
  - `void_outflow(O)`: B1 computes 5 − 10 and is skipped. B2 gets 45 − 10 = 35. V's 10 comes back.
  - Result: B1 holds 5 more than it should. Stock is inflated and `reconcile_inventory` reports drift.
- **Example 2 (the order can no longer be voided).**
  - Batch B has 100. O takes 100. R restocks 100. V takes 100 back out of B. R2 restocks 100.
  - `void_outflow(O)`: B computes 100 − 200 and is skipped. Putting back V's 100 makes B = 200.
  - That breaks `inflows_remaining_bounds`, so the PO cannot be voided.
  - `recalculate_inventory_fifo` Step 3.5 also adds R + R2 = 200 into B and aborts on the same constraint.
- **Why it matters.** It disproves the plan's claims that `reconcile_inventory` and `recalculate_inventory_fifo` need no change (lines 382, 483). It also makes "record_return after a void accepts the same quantity again" (line 901) unsafe.
- **Guidance.** The plan has to choose the per-batch accounting. Two options:
  - (a) Keep `v_already` counting every restock, voided ones included, so restocks into a batch never exceed what O took from it. Exclude voided rows only from `v_returned` and `v_total_restored`. Document that re-recording close to a full return can then raise `RESTOCK_UNALLOCATED`, and change the verification line to match.
  - (b) Redefine `void_outflow` to apply a signed per-batch amount, `deducted_b − Σ all restocks_b + Σ V_b`, with a stated rule for when it is feasible.
  - Either way, add both examples to the RPC tests.

---

### MAJOR

**M1. Reconciliation export code and its drift test are missing from the file list, and the view change has no SQL**
- **Scope:** File 1 step (11); §6.3.4 `v_recon_ledger` row (line 494); File 27.
- **Missing files:**
  - `reconViewsSync.test.ts` reads `20261029000000_recon_views.sql`. It must check the new migration, or it keeps passing while the live view drifts.
  - `src/lib/reconExport.ts` (`ReconJenis`, `RECON_JENIS`, `RECON_FLAGS`) needs `retur_batal`, `retur-batal` and `retur-dibatalkan`. If the flags are added there, the drift test fails against the old file.
- **Client export tabs:**
  - The Retur tab filters `jenis.startsWith("return_")`, so `retur_batal` rows never show there.
  - The Faktur tab's Retur column adds up `return_restock` rows by `outflow_id`, so a voided restock is still counted.
- **The view SQL leaves these open:**
  - For a `retur_batal` row: the sign of `qty`, whether `keluar_tunai` is nulled, and whether `outflow_id`/`return_id` carry the original outflow and `void_return_id`. The outflow branch emits `o.id, o.id` today.
  - `retur-dibatalkan` needs a new column in the movements CTE. `voided_at` cannot be reused, or `v_recon_daily` drops the row.
  - Whether a retakan return row (it comes from the inflow branch) gets the flag.
- **Guidance:** give the full replacement SQL and list the reconExport, reconXlsx and test changes.

**M2. `create or replace view` resets view options**
- **Scope:** File 1 steps (7) and (11); §6.2.4 excerpt (lines 324–331).
- Postgres replaces a view's options list on CREATE OR REPLACE, even when the new list is empty. If `with (security_invoker = true)` is left out, `purchase_orders` and `v_recon_ledger` silently run with the owner's rights and bypass the caller's RLS.
- The plan shows only an excerpt for `purchase_orders`.
- **Guidance:** require the full definition including `with (security_invoker = true)`. Note that grants are kept and the column list must be unchanged.

**M3. List, flag and export data structures are named but not defined, and cannot work as described**
- **Scope:** Files 8, 9, 12, 13 (lines 809, 813, 825, 829); §6.7.1 columns 15, 17–19.
- `returnsForSku(summary, …)` is said to return "first date, latest email from `summarizeReturns` output". `summarizeReturns` only carries sums ("reproduces today's `bySku` sums", line 817). Dates and emails need the raw rows.
- `itemToLogRow(item)` gets only the item. The fields `DeliveryListItem` gains (`lines`, `lineSummary`, `requiresClaimRef`) carry no per-line OK/Pecah pieces, return date or `user_email`.
- These are open for the implementer to design: the type of `lineSummary`; the signatures of `buildDeliveryItems` and `summarizeLines`; the new filter keys in `DeliveryListFilters`.
- `nativeToPieces` needs the egg's unit, which none of the pure signatures receive.
- **Guidance:** give TypeScript signatures for all of these, a per-line derived record (for example `{okPieces, pecahPieces, firstReturnDate, lastUserEmail}`), and say where the unit or `conversionMap` comes in.

**M4. Voided PO: no source for its egg outflow ids**
- **Scope:** Files 14, 15, 17; §6.5.7 and §6.5.8 (line 575).
- The `purchase_orders` view drops voided rows, so `po` is null when `poState = "voided"`. That leaves no `eggTotals` and no outflow ids.
- So "delivery lines and returns render as history" and Riwayat retur cannot list returns. The "ditarik dari stok" rule for "a restock on a voided PO" cannot run either.
- **Guidance:** say how the voided outflow ids are found, for example voided `activity_logs.metadata.relatedEntryId` matched by `invoiceRef`, as `voidedPoState` already does in `useDelivery.ts`.

**M5. The order-edit guard becomes looser than the server**
- **Scope:** File 6 (line 801); §6.3.4 table (rows `usePriorReturns` and `correct_order`).
- `GroupedActivityLog.tsx:376–381` decides `hasReturns` from `returnsMap[...].total`. If `usePriorReturns` drops voided rows, an order whose only return was voided offers "Edit pesanan", and `correct_order` then refuses with `HAS_RETURNS`, because it counts voided rows (line 495).
- This contradicts the plan's own rule that the UI mirrors the server.
- **Guidance:** feed `hasReturns` from `includeVoided: true`, or state the mismatch on purpose.

**M6. Rounding: the "exceeds" result will fire on valid maximum entries, and the dialog has no handling for it**
- **Scope:** Files 2, 3, 4 (lines 782, 788, 793); §6.4 (line 503); §6.5.3 and §6.5.5 step 2.
- `nativeToPieces` rounds to the nearest piece, so a piece cap can sit up to 0.5 piece above the native remainder: 5 kg × 15.5 = 77.5, which rounds to 78 pieces, which converts back to 5.03 kg. The dialog test at line 325 pins exactly that cap.
- With "exceeds when clamped by more than 0.01", typing the shown maximum returns `{ok:false, kind:'exceeds'}`. That holds in the dialog (which today silently clamps) and in the Retur section. So "both callers block before reaching it" is false.
- The 0.01 boundary is also a floating-point comparison: in the "exceed the cap by 0.01" test, 10.00 − 5.01 is slightly off in float.
- The plan does not say:
  - what the dialog shows on `exceeds`;
  - how the dialog's async fallback `findRelatedEntryId` (line 327) runs before the pure builder;
  - that the unresolved toast now gets the egg `product` instead of `row.label`.
- **Guidance:**
  - use `Math.floor` for caps shown in pieces, or set the tolerance to 0.5 piece in native units plus an epsilon;
  - define the dialog's `exceeds` path;
  - say that ids are resolved before the builder is called.

**M7. Void error handling is left to the implementer, and the prescribed wording is wrong**
- **Scope:** Files 2, 15, 25; §6.5.7 (line 570).
- `INSUFFICIENT_STOCK` → "Stok `<product>` kurang `<n>` butir" needs the product and shortfall parsed from the server text `INSUFFICIENT_STOCK: % (%) is short % butir/pcs`. That shortfall is native (kg for RETAKAN children) and needs converting with the product's unit. Neither the regex nor the conversion is specified.
- "`NOT_ALLOWED` / `VOID_WINDOW_CLOSED` → the same wording the edit dialog uses" points at `editErrWindow`, which says 'Batas waktu ubah 1 jam sudah lewat.', and `editErrNotAllowed`, which talks about editing "pesanan". Both are wrong for a 48-hour return void.
- **Guidance:** define the parse rule and give new locale keys.

**M8. The `void_outflow` addition breaks the lock order**
- **Scope:** File 1 step (9); §6.3.3 (line 483); §6.3.2 table, "Lock order".
- Locking O's batches in (`date`, `created_at`) order and then V's batches in that order is not one globally sorted acquisition. A concurrent `record_order_outflows` locks all of the product's live batches in date order, so a deadlock is possible.
- The plan also does not say to lock V's `outflows` rows, or whether voided inflows are skipped (`i.voided_at is null`) as the existing loop does.
- **Guidance:** give the SQL: one `for update of i` over the union of O's and V's batches, ordered, then the per-source updates.

**M9. Duplicate-ref warning (file 24) is underspecified**
- **Scope:** File 24 (line 873); §6.10.
- `useDuplicateOrderCheck` queries only rows inside `DUPLICATE_WINDOW_MINUTES`. An "any date" ref match needs a second query, and its shape is not given: `purchase_orders` with a case-insensitive exact match, or `activity_logs` `metadata->>invoiceRef`.
- `OrderToCheck` has no `invoiceRef`. `DuplicateMatch` carries the submitted order's buyer and date, but the new sentence needs the existing PO's.
- The locale key belongs under `outflow`, which file 25 does not list.
- Two queued orders in the same batch that share a ref are not covered.
- No test is listed.

**M10. Files the plan must touch but does not list**
- `src/types/catalog.ts`: `PackSKU` and `PackSKUInput` are the types `usePackSKUs` and `SKUDialog` use. File 21 lists `outflowCalculator.ts`, which has a separate `PackSKU`. The zod schema in `SKUDialog` and the `addSKU`/`updateSKU` payloads also need `unitLabel`.
- An `expiry_rules` reader: no hook or query reads the table today, and the plan names none.
- `src/components/catalog/BuyerList.tsx` and `useBuyers.addBuyer`: the create path never writes `requires_claim_ref`.
- `src/lib/reconExport.ts` and `reconViewsSync.test.ts` (see M1).
- An RPC test script file (see M11).
- `Deliveries.tsx`: the `placeholder` object (lines 69–71) must gain `lines`. File 20 does not say so.
- `PO_COLUMNS` and the `PoRow` Pick type in `useDeliveries.ts` must add `egg_totals`.

**M11. The RPC tests cannot be run as written and do not gate the migration**
- **Scope:** Verification, "RPC tests" (line 901); Rollout steps 2–3.
- There is no harness. Unstated:
  - whether branching is available, or how to make the "copy";
  - how to run as a signed-in non-admin user (`set local role authenticated` plus `request.jwt.claims` with `sub` and `email`); otherwise `auth.uid()` is null and every call raises `AUTH_REQUIRED`;
  - how to backdate `created_at` for the 48-hour cases;
  - how to set up the batches of the worked example.
- There is no committed SQL file, and the tests are not a checklist step before `apply_migration`.
- "`recalculate_inventory_fifo` … reproduces the same remainders" is not true per batch even today: Step 3.5 adds restocks back after all deductions. It holds only for per-product totals, and recalc rebuilds every `fifo_deductions` row.
- **Guidance:** commit `supabase/tests/void_return.sql` with setup, statements and expected results, and make running it rollout step 2b.

**M12. Rollout order is circular**
- **Scope:** Rollout steps 2–3; File 29 (line 893).
- Step 2 requires `npm run verify` green before step 3 applies the migration. But file 29 regenerates types from the live project, which needs the migration applied, and drops the `as any` casts. Without that, `supabase.from("delivery_lines")` fails `tsc`.
- **Guidance:** state the order. Either generate types from a branch, or keep casts until after step 3 and regenerate in a follow-up commit.

**M13. The step 9 stock check is not executable**
- **Scope:** Rollout step 9 (line 943).
- "Stock now = snapshot + Σ pieces restocked − Σ compensating outflows" leaves out every sale and inflow between step 1 and step 9, which are days apart because step 8 covers 50–60 fakturs. It also mixes pieces with native units and ignores RETAKAN child products.
- "`count(*)` = 136 + rows written since launch" checks nothing.
- **Guidance:** define the expected value per product as snapshot + inflows − live outflows + restocks since the snapshot, or rely on V2 plus a per-product restock delta.

**M14. One implementation phase for 28 files**
- **Scope:** Plan header (line 768).
- Phase 2a holds the migration, three RPCs, the lib, hooks, UI, exports, the import script and the edge function, with no checkpoints in between.
- The standard requires incremental, buildable, testable phases. For example:
  - 2a-1: migration plus RPC tests;
  - 2a-2: libs and their tests (files 2, 3, 9–12);
  - 2a-3: hooks and UI;
  - 2a-4: catalog, duplicate check, exports, script.

**M15. Expiry test contradicts the seed**
- **Scope:** File 11 (line 821); §6.2.7 (lines 364–375).
- "Astro P25 21 Oct + 21 days → 11 Nov" is wrong against the seed. The seed has no Astro P25 row, so the Astro default of 22 days gives 12 Nov. The 21-day P25 rule belongs to Sayurbox.
- **Guidance:** fix the case, or state that the fixture rules differ from the seed.

**M16. Export: Full column contradicts the empty-faktur row**
- **Scope:** File 12; §6.7.1 (line 600 vs column 12 at line 615).
- "A faktur with no lines is one row with columns 9–21 blank", but column 12 Full is "Ya when Terkirim and no line has quantity > 0". That is exactly the no-line case.
- **Guidance:** say which rule wins.

**M17. Import script gaps, and its rollback can delete post-launch work**
- **Scope:** File 26 (line 881); §6.9; Rollback step 5.
- There are no automated tests for the pure rules: sheet-code resolution, unit resolution, merge, derived quantity, reason map.
- Not specified:
  - how Node reads `.env` (there is no `dotenv`; the step 7 command has no `--env-file=.env`);
  - how Status Kirim strings other than "Terkirim" map;
  - where the NOT NULL `deliveries` columns come from (`buyer_name`, `delivery_date`, `invoice_ref`).
- Rollback step 5 deletes `source = 'sheet_import'` lines and the imported deliveries, which cascades to app-created lines on those deliveries. That loses claim_refs and edits admin made after launch, contradicting step 4's rationale. Deleting deliveries also needs owner SQL, because there is no delete policy.

**Also Major: what the Retur section writes into `returns`**
- **Scope:** §6.5.5 step 2; File 15.
- Not specified: whether `record_return`'s `reason` is the code (`pecah`), the label, or the note, and whether `buyerName` is the plain buyer or `customerLabel`. Both are stored in production rows and shown in Riwayat retur, the feed and the assistant.

---

### NIT

1. File 1 step (10) says `create function`; the §6.3.2 snippet says `create or replace`. "A re-run is idempotent" (line 355) is false: `add column`, `add constraint` and `create unique index` have no `if not exists`.
2. Wrap the migration explicitly in one transaction, or re-run the `user_email` backfill after step (8). Otherwise an old-bundle return written mid-migration fails step 3's "expect 0". That check also fails for any return whose auth user was deleted.
3. §6.3.1: say whether `PRIOR_MISMATCH` is checked before `RETURN_EXCEEDS_OUTFLOW` (it should be, so the user sees "reload" rather than "exceeds"). Also say whether an entry without the key marks the outflow as checked.
4. Return-entry id lifecycle (line 550): "fresh ids whenever the SKU's loaded returns change" conflicts with "same ids on Coba lagi" if a background refetch lands while inputs are frozen. Pin the ids while frozen. The server's `expected_prior` still prevents a double return.
5. CUJ 1's confirmation text ("Terjual 15.480 butir · Sudah diretur 0") differs from the §6.5.4 template (", sudah diretur `<prior>` butir (`<priorOtherSku>` di SKU lain)").
6. `ExpiryRule.shelfDays` must become `number | null`. `resolveShelfLife` callers must pass `basePackCode ?? code` for non-box SKUs.
7. Build `void_return`'s entries in a deterministic order (for example by product) rather than by `returns.id`, to keep lock order stable inside `record_order_outflows`. Also, the claim that the missing `id` tie-breaker is "harmless" is weak: inflows written in one transaction share `created_at`.
8. `editWindowHoursRemaining` still counts hours while `canEditEntry` moves to minutes.
9. Rollout step 4, "1 box, Retak 10": the dialog takes pieces per bucket, so give the exact inputs.
10. Rollback does not cover reverting `v_recon_ledger`, which changes historical daily balances, or a forward-fix path if a defect is found in the replaced stock RPC bodies.
11. File 7: `buildSkuEggMap(...).eggProduct` on a Record is a type error. `useOrderReturns` must add `useItemTypes()` for `boxCapacityMap`. Also unstated: what the dialog does when `piecesPerBox` is null (today it falls back to the box row's own fields).
12. Unstated small UI and process details:
    - which wins when a row is both orange and red;
    - how the SKU picker shows the same SKU on two PO lines (summed?);
    - when ReturnHistory shows "Anda";
    - `.claude/agents/data-integrity-reviewer.md` is "committed with this document" but is not in the file list.

---

**Paths cited:**
- `C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260904000000_returns.sql` (void_outflow, lines 210–226)
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261008000000_returns_sku_code.sql` (v_already, lines 146–151)
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260914010000_inflows_stock_invariants.sql`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260914020000_reconcile_and_returns_aware_recalc.sql` (Step 3.5)
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\__tests__\reconViewsSync.test.ts` (line 12)
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\reconExport.ts` (lines 10–30, 197, 287)
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\GroupedActivityLog.tsx` (lines 376–381)
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\__tests__\RecordReturnDialog.test.tsx` (line 325)
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDuplicateOrderCheck.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\types\catalog.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDelivery.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\pages\Deliveries.tsx` (lines 69–71)

### egm-codebase-details

Codebase Details Goldfish: REVIEW of the Detailed Implementation Plan in design_draft.md (lines 766–957), plus every claim about current code that it relies on

Inputs read in full: persona `C:\Users\Joshua\.claude\plugins\cache\egm\egm\0.1.0\agents\codebase_details.md`, standard `C:\Users\Joshua\.claude\plugins\cache\egm\egm\0.1.0\resources\document_standards\implementation-readiness-standard.md`, target `C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md` (all 957 lines), and `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\CLAUDE.md`. Every code path below is under `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\`, and I give it in full. I did not read the brief, any `*_brainstorm.md` file or any `*_report.md` file.

**Verdict: FAIL.** There are 3 Blockers, 16 Majors and 8 Nits.

---

## BLOCKERS

### B1. Change 3 breaks the per-batch restock bound that `void_outflow` and `recalculate_inventory_fifo` depend on

**Affected scope:**
- Plan item 1, steps (8) and (9).
- §6.3.1 change 3 and §6.3.3.
- §6.3 intro ("their invariant holds as it is"), the §7 "Adopted" row, and Rollback step 3.
- The Verification plan's claim that `recalculate_inventory_fifo` "reproduces the same remainders".
- Code:
  - `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260904000000_returns.sql:218–225`
  - `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260914020000_reconcile_and_returns_aware_recalc.sql:113–127`
  - `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260914010000_inflows_stock_invariants.sql:11–13`

**What the code does today:**
- `void_outflow` restores `quantity_deducted − Σ return_restocks` for each batch and skips the batch when that is ≤ 0: `if v_restore <= v_eps then continue`. This is only correct while Σ restocks ≤ the outflow's deduction from that batch.
- `recalculate_inventory_fifo` step 3.5 depends on the same bound. Its own comment says "each restock's recorded batch was deducted by at least that much".
- The constraint `inflows_remaining_bounds` enforces `remaining_butir <= quantity_butir`.

**What change 3 does:** it drops voided returns from `v_total_restored` and `v_already`. A corrected return (R2) can then restock the same batches a second time while the voided restock's `return_restocks` rows stay in place. The bound no longer holds, and the plan's own scenario breaks it: CUJ 4 (void, then save again), followed by voiding the PO (§6.10).

**Counterexample with `void_outflow`:**
1. Batches B = 100 and C = 100.
2. Order O takes 50 from B (B = 50).
3. Restock R puts 50 back into B (B = 100).
4. A sale takes 100 from B (B = 0).
5. `void_return` voids R. Its compensating outflow V takes 50 FIFO from C (C = 50).
6. The corrected return R2 restocks 50 into B. This is allowed because R is now excluded (B = 50).
7. Voiding O: the existing loop computes 50 − (50 + 50) < 0 and skips B. The new loop gives V's 50 back to C (C = 100).

Stock is now 150 where 100 is true. `reconcile_inventory` flags +50 on B. If V had landed on B instead, the restore pushes B over `quantity_butir`, the check constraint fails, and the PO cannot be voided at all.

**Two more consequences:**
- **`recalculate_inventory_fifo` aborts.** After CUJ 4, if O had drained its oldest batch, the rebuild re-deducts V elsewhere. Step 3.5 then adds R + R2 to that batch (35.35 + up to the deduction), which exceeds its intake and trips the check constraint.
- **A live R2 can be refused.** If V landed on a batch older than O's first batch, R2 can push O's batch over its intake. The error is a raw `inflows_remaining_bounds` failure (23514), and no error mapping covers it.

**Gap in the test plan:** it covers the §6.3.3 worked example and "record_return after a void accepts the same quantity again" separately. It never tests the two together.

### B2. Contradicts the code: `canEditEntry` is not the Activities feed's edit/void guard

**Affected scope:**
- §4.1 glossary, the §6.3.2 "UI mirror" row, and plan item 7.
- Code:
  - `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\activityGrouping.ts:30–41`
  - `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useVoidEntry.ts:17–38`
  - `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\GroupedActivityLog.tsx:344–346`

**What the code actually does:**
- No production code calls `canEditEntry`. It is referenced only by `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\__tests__\activityGrouping.test.ts`.
- The feed's guard is `isEditable` → `useVoidEntry().canEdit`. That is a separate copy of the rule (`differenceInHours(now, created) <= 48`), with `getEditWindowHours` next to it.
- The name `canEditEntry` inside GroupedActivityLog.tsx (lines 1330, 1407, 1476) is a local boolean, not this function.

**Consequences:**
- Item 7's switch to minutes does not change the feed at all.
- If the plan meant to align the feed with the server, `useVoidEntry.ts` has to be modified, and it is not in the target list.
- Even in minutes, `differenceInMinutes` truncates seconds. Up to 59 s past 48 h, the UI still offers a void that the server's `created_at < now() - interval '48 hours'` refuses. "Never offers a void the server refuses" is therefore not true.

### B3. Contradicts the code: "Both callers block before reaching" an `exceeds` result

**Affected scope:**
- §6.4 (return-entry building), §6.5.5 step 2 ("cannot happen after the blocks of §6.5.3"), and plan items 2 and 4.
- Code:
  - `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\RecordReturnDialog.tsx:229–232, 286–307, 347`
  - `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\returnsCap.ts:17–24`

**What the code actually does:**
- The dialog's per-bucket clamp works in pieces against `nativeToPieces(native)`, which uses `Math.round`.
- With 5 kg left, the clamp allows round(77.5) = 78 pieces. `piecesToNative(78)` is 5.03 kg, which is over the cap by 0.03, more than 0.01.
- Today `Math.min(want, eggRemaining)` at line 347 quietly trims that excess.

**Consequences:**
- Under the plan, the dialog gets `{ok:false, kind:'exceeds'}` for a value its own clamp accepted. The plan gives the dialog no handling or message for that case.
- §6.5.3's block `diterima > nativeToPieces(remaining)` has the same rounding, so the delivery save can also hit `exceeds` whenever the remaining cap × 15.5 has a fractional part ≥ 0.5.

---

## MAJOR

### M1. Recon export client and its drift guard are missing from the target list

**Affected scope:** plan items 1(11) and 27; §6.3.4 (`v_recon_ledger` row).
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\reconExport.ts:10–29, 197, 287`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\__tests__\reconViewsSync.test.ts:12, 31–44`

**Discrepancy:**
- The new jenis `retur_batal` and the new flags `retur-batal` and `retur-dibatalkan` have to be added to `ReconJenis`, `RECON_JENIS` and `RECON_FLAGS`.
- The drift guard reads the fixed file `20261029000000_recon_views.sql`. Once the client lists are updated, the guard fails against that old SQL. Pointed at the old file, it never checks the new view.
- The Retur tab filters `jenis.startsWith("return_")`, so `retur_batal` rows silently drop out of it.
- Neither file is listed. Whether `RECON_SCHEMA_VERSION` should change is not decided.

### M2. Replacing the two views can silently drop `security_invoker`

**Affected scope:** §6.2.4 excerpt; plan items 1(7) and 1(11).
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261022010000_buyer_profiles.sql:18–19`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261029000000_recon_views.sql:60–61`

**Discrepancy:** both views are `with (security_invoker = true)`. As far as I know, Postgres's `CREATE OR REPLACE VIEW` replaces the view's options rather than keeping them; I could not test this here. The excerpt and the plan never say to restate `security_invoker = true`. Without it, the views would run with the owner's rights and bypass the RLS on `activity_logs`, `returns` and the other underlying tables.

### M3. How the delivery data reaches the client is not specified

**Affected scope:** plan items 8, 13 and 14; §6.2.4 ("zero extra queries").
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDeliveries.ts:15–20, 22–51, 93`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDelivery.ts:43–45`

**Discrepancy:**
- `PO_COLUMNS` and the `PoRow` Pick do not include `egg_totals`, so neither delivery query reads it today. The plan only says `rowToPo` maps it.
- `rowToDelivery` throws away an embedded `delivery_lines(*)`, and `Delivery` has no lines field. How lines get to `DeliveryListItem.lines` is unspecified.
- `buildDeliveryItems` gains parameters without a defined signature. It has 2-argument call sites in two test files: `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\__tests__\deliveryFlags.test.ts:93, 106, 112, 122, 134` and `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\__tests__\deliveryExport.test.ts:48`. `tsconfig.app.json` includes `src`, so `npm run verify` type-checks those tests.

### M4. `deliveryFlags.ts` cannot convert kg to pieces with the inputs the plan gives it

**Affected scope:** plan item 9 (`pecahPieces = nativeToPieces(retakan + writeoff)`), plan item 12 (export columns 17–18).
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\returnsCap.ts:22–24`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\GroupedActivityLog.tsx:1020–1027`

**Discrepancy:**
- `nativeToPieces(native, unit)` needs each egg product's unit. `summarizeLines` and `buildDeliveryItems` receive no conversion or unit map.
- Converting the sum (as the plan does) rounds differently from `ReturnBubble`, which converts each bucket and then sums. The chip and export totals can differ by one from the feed bubble.

### M5. The duplicate-ref warning does not fit the existing duplicate check

**Affected scope:** plan item 24; §6.10.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDuplicateOrderCheck.ts:10–22, 32–39`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\duplicateOrder.ts:21`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\QuickOutflowBuilder.tsx:430–441, 773–775`

**Discrepancy:**
- The query only looks at orders recorded in the last `DUPLICATE_WINDOW_MINUTES = 15` minutes.
- `OrderToCheck` has no `invoiceRef`.
- `DuplicateMatch` returns the submitted order's own buyer and date plus `minutesAgo`, and the dialog renders `duplicateLine` with `{minutes}`.
- A match on "any date" needs a second, unwindowed query, new fields, and the matched PO's buyer and date. None of that is specified. The case of two queued orders in one batch sharing a ref is also unspecified.

### M6. The `INSUFFICIENT_STOCK` number is in kg and the plan prints it as pieces

**Affected scope:** CUJ 4, §6.5.7, and plan items 15 and 25.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260707000000_idempotent_order_outflows.sql:102–107`

**Discrepancy:**
- The server message is `INSUFFICIENT_STOCK: % (%) is short % butir/pcs`, and the number is in the product's native unit. For NEGERI BIASA (RETAKAN) that is kg, even though the text says "butir/pcs".
- The plan's message "kurang 212 butir" needs that number parsed and converted with `nativeToPieces` and the product's unit. The plan does not specify the parsing or the conversion.

### M7. The dialog refactor changes behaviour the 14 tests do not cover

**Affected scope:** plan item 4.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\RecordReturnDialog.tsx:136–145, 184–200, 326–333`

**Discrepancy:**
- Today, a box SKU with no configured capacity or missing base pack falls back to the box row's placeholders (empty egg). Such a row does not "cover" its egg, so a native-unit row appears for that egg.
- `buildSkuEggMap` returns the base pack's egg with `piecesPerBox: null`. The plan says neither what the dialog does with `null` (sold pieces, cap) nor how the covered-egg set changes.
- The async `findRelatedEntryId` fallback inside the loop has to move before the pure builder. The plan does not say so.
- The "unresolved" toast currently names the row label (the SKU code). The builder reports the egg product instead.
- I confirmed the 14 existing tests in `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\__tests__\RecordReturnDialog.test.tsx`. None of them exercises these paths.

### M8. The rule for `pieces_per_unit` is never stated

**Affected scope:** plan items 2, 16 and 26; §4.4.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\GroupedActivityLog.tsx:1069`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\RecordReturnDialog.tsx:136`

**Discrepancy:**
- `N30B` has `unit_label = 'box'` but no box mode, so its `piecesPerBox` is `null`. Its 150 pieces per unit are in `piecesPerPak`.
- The plan never gives the rule that maps (unit choice, box-mode SKU) to `pieces_per_unit`. This is exactly the SKU behind the 5× errors.
- The two existing maps also define "box SKU" differently: `skuToEgg` uses `basePackCode` only, the dialog uses `basePackCode && boxMode`.

### M9. Nothing loads the expiry rules

**Affected scope:** plan items 8, 11 and 16; §6.8.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\types\deliveries.ts:37–43`

**Discrepancy:**
- No file in `src` queries `expiry_rules` today. Only the generated types and the unused `ExpiryRule` type mention it.
- The plan adds a pure resolver but no hook, query key or row mapping that loads the rules.
- `ExpiryRule.shelfDays: number` has to become nullable once `shelf_days` drops `not null`.

### M10. A save with no returned pieces reaches `record_return` and fails with an unmapped code

**Affected scope:** §6.5.3, §6.5.5 and §6.4 (error code list).
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261008000000_returns_sku_code.sql:41–44`

**Discrepancy:** Pecah "0" counts as filled, and nothing blocks "Butir diterima" = 0. That combination builds no return entries, so `record_return` raises `NO_ENTRIES`. That code is not in the mapped list, and no block prevents the case.

### M11. The edit guard and `correct_order` will disagree after a void

**Affected scope:** §6.3.4 (`usePriorReturns` row and `correct_order HAS_RETURNS` row), plan item 6.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\GroupedActivityLog.tsx:376–381`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261021020000_correct_order_guards.sql:100–102`

**Discrepancy:** with the voided filter, `hasReturns` is false for an order whose only return was voided, so "Edit pesanan" shows. `HAS_RETURNS` still counts voided rows, so the server refuses the edit. The plan says both "the edit guard inherits the filter" and "voided returns stay blocking". The implementer has to pick one.

### M12. Test infrastructure for the new component test is unspecified

**Affected scope:** plan items 6, 13 and 19.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\__tests__\RecordReturnDialog.test.tsx:15–56`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\__tests__\GroupedActivityLog.returns.test.tsx:28`, `GroupedActivityLog.editButton.test.tsx:22`, `RecordReturnDialog.test.tsx:52`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDeliveries.ts:10–12`

**Discrepancy:**
- There is no shared test helper. Component tests render without a `QueryClientProvider` and mock each hook module with its own factory.
- Three of the factories above (`GroupedActivityLog.returns`, `GroupedActivityLog.editButton`, `RecordReturnDialog`) mock `@/hooks/usePriorReturns` with only `usePriorReturns`. Calling the new `summarizeReturns` or `fetchReturnsForOutflows` exports through those mocks would throw vitest's "No export defined on mock" error.
- File 19 needs, at minimum: a QueryClient wrapper or mocks for `useDelivery`, `useDeliveryReturns`, `usePackSKUs`, `useItemTypes`, `useAuth`, `useUserRole` and `sonner`, plus a way to handle the transitive import of `GroupedActivityLog` (for `ReturnCodeParts`), which pulls in `useVoidEntry` and the Supabase client. None of this is stated.

### M13. The RPC test plan has no harness

**Affected scope:** Verification plan, "RPC tests on a Supabase branch".

**Discrepancy:**
- The repo has no `supabase/tests` folder and no seed file.
- In the SQL editor `auth.uid()` is null, so every call raises `AUTH_REQUIRED` unless `request.jwt.claims` and the role are set.
- The `NOT_ALLOWED` and 48-hour cases need two users and back-dated `created_at` values.
- The fixtures (batches B and C, users) and the setup steps are not specified.

### M14. The "never deadlock" claim is overstated

**Affected scope:** the §6.3.2 lock-order row and §6.3.3.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260707000000_idempotent_order_outflows.sql:78–86`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260904000000_returns.sql:146–153, 210–217`

**Discrepancy:**
- `record_order_outflows` locks every live batch of the product that still has stock. `record_return` and `void_outflow` lock only the outflow's deducted batches. So "the order record_return and void_outflow also take" is not the same set.
- `v_entries` is ordered by `returns.id`, which is random, so parent and RETAKAN products are locked in arbitrary order.
- The new `void_outflow` loop locks the compensating outflows' batches in a second sorted pass after the order's batches.
- Either can deadlock against a concurrent multi-product sale. The resulting 40P01 error is not mapped.

### M15. The import script's environment is unspecified

**Affected scope:** §6.9 and plan item 26.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\integrations\supabase\client.ts:5–20`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\scripts\supabase-project-ref-guard.cjs:68–73, 116–151`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\outflowCalculator.ts:73–85`

**Discrepancy:**
- `client.ts` reads `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` and uses `localStorage`, so a Node script cannot import it.
- Node does not load `.env` on its own, and there is no `dotenv` dependency. The loading method (`--env-file` or manual parsing) is undecided.
- The ref guard checks `VITE_SUPABASE_PROJECT_ID` and the CLI temp files, not the URL the script will use. Passing the guard does not prove the script writes to `lgtixzpjbkzapecirbfj`.
- The app overlays the hardcoded `BOX_CAPACITIES` with the database values. The script reads only the database values, so the two can disagree.

### M16. Wrong `PackSKU` file in the target list

**Affected scope:** plan items 2 and 21.
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\types\catalog.ts:1–23`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\outflowCalculator.ts:6–15`

**Discrepancy:**
- The `PackSKU` and `PackSKUInput` that `usePackSKUs` and `SKUDialog` use live in `src/types/catalog.ts`, which is not listed.
- The listed `outflowCalculator.ts` holds a second, separate `PackSKU`.
- Which one `buildSkuEggMap(skus: PackSKU[])` takes is undecided.

### M17. The 0.01 boundary in the test spec is not defined for floating point

**Affected scope:** plan items 2 and 3.

**Discrepancy:**
- Plan item 3 asks for a case "exceeds the cap by 0.01 → clamped without an `exceeds` result".
- In floating point, 998.72 − 998.71 = 0.010000000000047748, which is greater than 0.01. A plain `> 0.01` check returns `exceeds` and the mandated test fails.
- No epsilon or rounding rule is specified.

---

## NITS

- **N1.** `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\catalog\SKUDialog.tsx`: the `kind` enum is on line 38, not 39–48 (those lines are eggsPerPack through the refines). `kind` is derived from `basePackCode` at line 93 and is not stored.
- **N2.** `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\functions\inventory-assistant\tools.ts`:
  - The functions §8 calls `listTransactions` and `sumMovements` are actually named `listTransactionsTool` (line 226) and `sumMovementsTool` (line 263).
  - `getReturnsTool` already counts `retakan` dynamically (lines 346–349). The real gaps are the initial `{restock, writeoff}` totals object, the input-schema enum `["restock","writeoff"]` (line 129) and the filter (line 340), none of which the plan mentions.
- **N3.** `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\docs\uuid-migration\PLAN.md:270–272` classifies code locations with W/R/D/S. It does not classify columns as S/R. Plan item 27's column entries do not fit that table.
- **N4.** §6.2.7 says the migration is re-runnable ("a re-run is idempotent"). `add column shelf_months`, `add constraint` and `create unique index` have no `if not exists`, so a re-run fails. The insert also has no `on conflict`.
- **N5.** §7 says the badge is "polled every 30 s". `useOpenDeliveries` sets `staleTime: 30_000` and no `refetchInterval` (`C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDeliveries.ts:126`).
- **N6.** `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDelivery.ts:130–142`:
  - With an empty patch, `ensureDelivery`'s upsert still sends `pic: savedBy`. On a conflict this overwrites the `pic` of a row someone created a moment earlier.
  - Returning the row id needs an added `.select("id")`.
- **N7.** Two lifecycle details are undecided:
  - The "returns key" to invalidate (items 14 and 15) has no defined query key.
  - Item 17 uses `useUserRole().isAdmin` although `DeliveryDetail` already receives `isAdmin` (`C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\deliveries\DeliveryDetail.tsx:27`).
- **N8.** `returns.reason` will start storing reason codes such as `tukar_guling` where it holds free text today. The assistant tool and other readers will show the raw code.

---

## Claims I confirmed against the code

All paths are under `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\`.

**`src/components/RecordReturnDialog.tsx`:**
- Lines 316–360 (the resolution loop), 245–257 (the reset effect) and 286–307 (the clamp).

**`src/components/GroupedActivityLog.tsx`:**
- Lines 1061–1072 (`skuToEgg`).

**`src/components/deliveries/DeliveryDetail.tsx`:**
- Line 206 (every PO line says "pak").

**Migrations under `supabase/migrations/`:**
- `20260904000000_returns.sql` lines 185–230 and 219–223.
- `20260707000000_idempotent_order_outflows.sql` lines 78–86.
- The `egg_totals` definition in `20261022010000_buyer_profiles.sql` (lines 31–32).
- `20261008000000_returns_sku_code.sql` is the newest `record_return` body.
- `20261021020000_correct_order_guards.sql`: the `has_role` call, the author check and `HAS_RETURNS`.
- `20261029000000_recon_views.sql`: return rows carry `voided_at` null, and the timestamp rule for retakan inflows.
- `20260820000001_stock_counts_delete_policy.sql` exists.
- The `box_capacities` column, `pack_skus.base_pack_code` and `pack_skus.box_mode` exist.

**`src/types/returns.ts`, `src/lib/returnRpc.ts`, `src/hooks/usePriorReturns.ts`:**
- `ReturnRecord` exists and is unused.
- `callRecordReturn` and `classifyOutflowError` exist.
- `usePriorReturns` has no chunking and no voided filter.

**`src/lib/outflowCalculator.ts`:**
- Line 178.

**Other:**
- `src/components/InventoryDashboard.tsx` line 161 and `src/components/InventoryTrendLineChart.tsx` line 73.
- The CHUNK = 100 pattern in `useDeliveryStatuses`.
- `src/lib/catalogDependencies.ts` `checkSKUDependencies`.
- The outbox replay is mounted only in `src/pages/Index.tsx`.
- `exceljs` ^4.4.0, `date-fns` ^3.6.0, `@supabase/supabase-js`, `@radix-ui/react-collapsible` and `src/components/ui/collapsible.tsx` all exist.
- The npm scripts `dev`, `build`, `lint`, `test`, `verify` and `supabase-ref-guard` exist.
- `src/components/__tests__/RecordReturnDialog.test.tsx` has exactly 14 tests.
- `src/lib/__tests__/returnsCap.test.ts` pins 15.5.
- `src/integrations/supabase/types.ts` has no `returns` table yet.
- `useUserRole`, `useBuyers` and `stockHintDitolak` exist.
- The four Osave box capacities match the hardcoded baseline.
- The expected 14 rows of the `expiry_rules` seed add up.

### egm-style

Style review of the DetailedRange (lines 766–957, "## Detailed Implementation Plan" to the end of the file) in C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md

**Inputs read:** the persona file (C:\Users\Joshua\.claude\plugins\cache\egm\egm\0.1.0\agents\style.md), the whole DetailedRange, the §4 glossary (lines 72–175), and the sections the plan cross-references (§5, §6.2.5–6.2.7, §6.3.3–6.4, §6.5–6.10, §8–§10). No style standard was supplied beyond the persona. I did not change any quoted Indonesian copy. Where two pieces of copy conflict, I flag the conflict and leave the choice to the author. No files were written.

**Verdict: Revise.** 0 Blocker, 16 Major, plus the Nits below.

---

## Major

**M1. Phase and deploy verbs ("ship", "merge", "push") are inconsistent**
- **Scope:** lines 768, 774, 900, 903, 936, 939.
- **Quotes:**
  - "shipped as one PR after the migration is applied" (768)
  - "before the frontend push; reviewed … before merge" (774)
  - "Verify gate before every push" (900; this means git push)
  - "(the frontend push)" (903)
  - "Push the frontend" (939)
- **Rationale:** Four verbs cover at least two events: a git push to a branch, and the merge to main that Vercel deploys. The 2a PR also merges at rollout step 5, which line 768 places in Phase 2b, so the two phases are not sequential.
- **Replacement for 768:** "Phase **2a** = the code PR: items 1–27 and 29. Phase **2b** = launch day: the rollout checklist below and item 28. The 2a PR is reviewed at rollout step 2 and merged at step 5, after the migration is applied at step 3."
- **Then:**
  - 774 → "before the PR is merged (rollout step 5)"
  - 903 → "(the merge to main)"
  - 939 → "**Merge the PR to main**"
  - Keep "push" only for git push (line 900).

**M2. File 1's Type / Scope line miscounts the migration**
- **Scope:** item 1, line 774.
- **Quote:** "additive columns and tables plus two function replacements, one new function and one view replacement"
- **Rationale:** The list below it has two view replacements: (7) `purchase_orders` and (11) `v_recon_ledger`. It has one new table. Item (6) is not additive: it drops NOT NULL, deletes rows and re-inserts them.
- **Replacement:** "Postgres migration: one new table (`delivery_lines`), new columns on six existing tables, an `expiry_rules` re-seed, two function replacements, one new function and two view replacements."

**M3. Some sentences are too long to carry out as instructions**
Each of these packs many steps or test cases into one sentence joined by semicolons.
- **Line 775:** about 200 words, eleven migration steps. Make it a numbered sub-list with one statement per step, and move "Header comment lists…" to its own bullet.
- **Line 788:** seven test cases. Use one bullet per case, each in the form "input → expected".
- **Line 817:** thirteen fixtures. One bullet per fixture.
- **Line 853:** fourteen cases. One bullet per case.
- **Line 901:** about 17 RPC cases in one bullet. Make it a numbered sub-list (R1–R17), each "action → expected result", so the run can be ticked off.
- At Nit level, the same fix applies to 801, 809, 813, 841, 877, 935, 939 and 942.

**M4. Some test fixtures have no expected result**
- **Scope:** items 10 and 12, lines 817 and 825.
- **Quotes:**
  - "2610421 (one merged tukar guling line, 36 boxes, with ref)"
  - "masih_ditanyakan chip"
  - "Qty Diterima for … lebih"
  - "Full rule"
- **Rationale:** A case with no expected outcome cannot be run or checked.
- **Replacements:**
  - "2610421 (…) → <expected flags>". The author has to fill this in; the document does not state it.
  - "a `masih_ditanyakan` line → `unresolved` true, counted by the Masih ditanyakan chip"
  - "lebih → `packQty + quantity`"
  - "Full: "Ya" when Terkirim and no line has `quantity > 0`, else "Tidak""

**M5. "through" can be read as a range of fields**
- **Scope:** item 2, line 781.
- **Quote:** "`eggProduct` through `basePackCode` when set (else the SKU's own)"
- **Rationale:** Right after a type listing `{eggProduct; piecesPerPak; piecesPerBox; basePackCode}`, "eggProduct through basePackCode" reads as "all four fields".
- **Replacement:** "`eggProduct` = the base pack's egg product when `basePackCode` is set, else the SKU's own"

**M6. The confirmation text conflicts with CUJ 1 and §6.5.4**
- **Scope:** item 19, line 853.
- **Quote:** "confirmation text for CUJ 1 is exactly "7 box × 180 = 1.260 butir · Diterima 1.260 · Pecah 172 → Retakan · OK 1.088 → masuk stok""
- **Rationale:** There are three versions of this text:
  - CUJ 1 (line 181) adds " · Terjual 15.480 butir · Sudah diretur 0".
  - The §6.5.4 template (line 544) continues ". Terjual … butir, sudah diretur … butir (…). Tgl Barang Balik …."
  - Line 853 stops at "masuk stok".
  
  Because the plan says "exactly", the test contract contradicts the spec. The copy is left unchanged here.
- **Replacement for the plan wording:** first align CUJ 1 and §6.5.4 on one string, then write "confirmation text for CUJ 1 equals the §6.5.4 template filled with CUJ 1's values". If only the prefix is meant to be checked, write "begins with "…"".

**M7. "line" used for the wrong glossary term**
- **Scope:** lines 788, 825, 841.
- **Line 788:** "a full-line Negeri return of 15,480 pieces against 998.71 kg sold fits". This means the PO line, not the delivery line.
  → "a Negeri return of the PO line's full sold quantity (15,480 pieces against 998.71 kg sold) fits the cap"
- **Line 825:** "on the physical line and blank on a Kurang line of the same SKU"
  → "on the physical-return line and blank on the non-physical (`kurang`) line of the same SKU"
- **Line 841:** "its one-physical-line rule"
  → "the one-physical-return-line-per-SKU rule (§4.3)"

**M8. "delivery-line save" is ambiguous**
- **Scope:** Manual verification, line 902.
- **Quotes:**
  - "the Activities card shows the bubble under the right SKU after a delivery-line save"
  - "makes a pending delivery-line save fail with `PRIOR_MISMATCH`"
- **Rationale:** A delivery-line save can be store-only (§6.5.5). A store-only save calls no RPC, shows no bubble and cannot return `PRIOR_MISMATCH`.
- **Replacements:**
  - "after a warehouse save, the Activities card shows the bubble under the delivery line's SKU"
  - "makes a warehouse save from a form loaded before that return fail with `PRIOR_MISMATCH`"

**M9. "non-admin" collides with the glossary's "admin"**
- **Scope:** line 901 (twice) and line 902.
- **Rationale:** In the glossary, "admin" alone means office admin. The office admins are exactly the users who lack the app admin role, so "non-admin" reads as "not an office admin".
- **Line 901:**
  - "a non-admin voiding another user's return → `NOT_ALLOWED`" → "a user without the app admin role voiding another user's save group → `NOT_ALLOWED`"
  - "a non-admin after 48 h" → "that user voiding their own save group after 48 h"
- **Line 902:** "a non-admin cannot void another user's return or one older than 48 h" → "a user without the app admin role cannot void another user's save group, or their own after 48 h"

**M10. "return" used where the void target is a save group**
- **Scope:** lines 901 and 939.
- **Rationale:** `void_return` voids a save group (glossary). The step-4 test return writes two rows.
- **Line 939:** "Then void that return from Riwayat retur" → "Then void that save group from Riwayat retur ("Batalkan retur ini")"
- **Line 901:** "`void_return` on either row of the group" → "on either row of the save group"

**M11. "and" reads as two required conditions**
- **Scope:** item 17, line 845.
- **Quote:** ""Batalkan retur ini" shown by `canEditEntry` and `useUserRole().isAdmin`"
- **Rationale:** Read literally, the button is hidden from authors who are not app admins, even within 48 h. `canEditEntry` already covers "app admins always, the author within 48 hours" (glossary line 121).
- **Replacement:** "shown when `canEditEntry` allows it (§6.5.7), with the app admin flag taken from `useUserRole().isAdmin`"

**M12. "the edit guard" names the wrong guard**
- **Scope:** item 6, line 801.
- **Quote:** "Feed bubbles, the dialog cap and the edit guard inherit the filter."
- **Rationale:** The glossary defines `canEditEntry` as "the feed's edit / void guard". This sentence means `hasReturns` (§6.3.4). "inherit the filter" is also vague.
- **Replacement:** "Feed bubbles, the dialog cap and the Edit pesanan guard (`hasReturns`) therefore exclude voided returns." See observation O1.

**M13. "the four box SKUs" is factually wrong**
- **Scope:** line 940 (rollout step 6) and line 775 item (4).
- **Quotes:** "confirm `unit_label` on the four box SKUs" and "+ the four updates (§6.2.5)"
- **Rationale:** N30B is "not a box-mode SKU" (§4.4). §6.2.5 has one update statement that covers four SKUs.
- **Replacements:**
  - Line 940: "confirm `unit_label = box` on OSVN10B, OSVN10O, OSVKP6O and N30B in Catalog → SKU"
  - Line 775: "+ the `unit_label = 'box'` update for OSVN10B, OSVN10O, OSVKP6O, N30B (§6.2.5)"

**M14. V1's pass condition cannot be verified**
- **Scope:** line 903.
- **Quote:** "V1 expects only rows admin recognises"
- **Rationale:** This is a subjective pass condition.
- **Replacement:** "V1 lists returns recorded since launch with no matching delivery line (Activities dialog, old bundle). The office admin adds each missing delivery line; V1 is then re-run and must return 0 rows."

**M15. Step 9 contradicts itself on units and uses the wrong start point**
- **Scope:** rollout step 9, line 943.
- **Quote:** "stock now = the snapshot + Σ pieces restocked by the re-entry (in native units) − Σ compensating outflows since launch; `count(*) from returns` = 136 + the rows written since launch"
- **Rationale:**
  - "Σ pieces … (in native units)" is self-contradictory: Negeri's native unit is kg.
  - The snapshot is taken at step 1, but "launch" is step 5. The step-4 test rows fall between the two, so the count check is off by those rows.
- **Replacement:** "per egg product, stock now = the step 1 snapshot + Σ native quantity restocked by the re-entry − Σ compensating outflows since the snapshot; `count(*) from returns` = 136 + the rows written since the snapshot". See observation O2.

**M16. The scope of "instead of" is ambiguous**
- **Scope:** item 18, line 849.
- **Quote:** "the PO line list shows `unit_label` instead of a fixed "pak" and the piece equivalent"
- **Rationale:** It can be read as replacing both the "pak" and the piece equivalent.
- **Replacement:** "the PO line list shows each SKU's `unit_label` (replacing the fixed "pak") and adds its piece equivalent"

---

## Nit

**Numbering and structure**
- **N1 (lines 768, 817, 937, 941):** Item 28 (Phase 2b) sits among the 2a items, which forces the wording "files 1 to 29 except 28".
  - Swap items 28 and 29, write "2a = items 1–28; 2b = item 29", and update "file 29" (937) and "file 28" (941).
  - "file N" often covers up to three files (items 7, 10, 21, 22, 27, 29). Define it once: "Items are numbered; 'file N' below means item N."
  - Line 817: "migration 1" → "file 1".
- **N2 (line 768):** Delete "(the migration, the lib, the UI, the exports, the script, the edge function)". It leaves out tests, types, locales and docs, and "the lib" is vague. "Each file is marked Create or Modify;" repeats the headings; keep only "No file is deleted."
- **N3 (line 933):** "— phase 2b" → "— Phase 2b", to match line 768.
- **N4:** Items 1–4 have a "Type / Scope" bullet and items 5–29 do not. Use it everywhere or nowhere.
- **N5 (lines 936, 940):** "§9 Q2" / "§9 Q1": §9 numbers its items "1." and "2." with no Q. Either label them Q1/Q2 in §9 or cite "§9 item 2".

**Units and numbers**
- **N6 (lines 782, 788, 853):**
  - "clamped by more than 0.01 native" and "exceeds by 0.5 native" → "0.01 in the egg's native unit".
  - "one kg egg" → "one kg-native egg product".
  - "restock 70.19, retakan 11.1" → add "kg".
  - "11.1 kg" here vs "11.10 kg" in CUJ 1: pick one precision.
- **N7 (line 788):** "returns 180 / 10 / NEGERI BIASA" → "piecesPerBox 180, piecesPerPak 10, eggProduct NEGERI BIASA".

**Jargon and abbreviations**
- **N8:**
  - "qty × ppu" (817) → "`quantity × pieces_per_unit`"
  - "unref'd" (817) → "with no `claim_ref`"
  - "one blank-tailed row" (825) → "one row with columns 9–21 blank (§6.7.1)"
  - "same `classifyOutflowError` split" (797) → "same `classifyOutflowError` network/server classification"
  - "row-by-row inserts with a pre-read" (881) → "inserts one delivery line at a time after reading the faktur's existing lines (§6.9 step 8)"
  - "green" (936) → "passes"
  - "Deployer check" (937) → "Post-apply check"
  - "incl." (841, 853, 877) → "including"
  - "the jenis `retur_batal`" (885) → "the `jenis` value `retur_batal`"

**Overloaded terms**
- **N9, "ref" has two meanings:** it means the invoice ref at 939 and 941, and the claim ref at 817 and 833.
  - "with ref" / "without ref" → "with a claim ref" / "without a claim ref"
  - `setClaimRefForDelivery(deliveryId, ref)` → `(deliveryId, claimRef)`
  - "V1 can exclude the ref" → "exclude `<test_ref>`"
  - "fix the ref" → "fix the PO's No. Faktur"
  - The `<ref>` inside the copy at line 873 stays as written.
- **N10, "live" used to mean non-voided:**
  - "summarizeReturns of the live ones" (837) → "of the non-voided ones"
  - "the restock row stays live too" (901) → "stays non-voided"
  - "every live restock" (918) → "every non-voided restock"
- **N11, "flag" used for the buyer setting:**
  - "the buyer flag map" (813) and "`useBuyers` for the flag map" (829) → "the `requires_claim_ref` map by buyer"
  - "buyer not flagged" (817) → "buyer without `requires_claim_ref`"
- **N12, "line" used for on-screen text or a colour:**
  - "the "ditarik dari stok" line" (845, 877, 939) → "the "ditarik dari stok" text"
  - "row summary line" (857) → "row summary text" (§6.6's term)
  - "has an orange line" (849) → "has a delivery line that is not warehouse-done (orange)"
  - "one card per line" (902) → "one card per delivery line"
  - V1 comment (906–907) "its line" / "adds the line" → "delivery line"
- **N13, colours as nouns:** "no orange" (817, 939) and "clears the orange" (902) → "no orange flag" / "clears the orange flag".
- **N14, "return entry":**
  - "set on every entry of a product" (782) → "on every return entry of that egg product"
  - Line 782: the field `pieces: boolean` clashes with the unit word "pieces" → `inPieces: boolean`.

**Copy consistency (copy itself unchanged)**
- **N15:** Line 817 quotes "tanpa baris", but §6.5.7 and line 853 use "retur tanpa baris". Quote it in full.
- **N16:** The checkbox copy "Perlu No. Retur (klaim telur pecah)" (865) differs from "Perlu No. Retur" (877, 940). The author should say whether the short form is a separate label.

**Precision, item by item**
- **N17, item 1 (775):**
  - "delete, unique index, re-insert" → "delete the seed rows, create the unique index, re-insert the seed"
  - "which filter and which must not" → "which filter `voided_at is null` and which must not"
- **N18, item 5 (797):** "the one row type" → "the only row type".
- **N19, item 6 (801):** `Record<outflowId, OutflowReturns>` → `Record<string, OutflowReturns>` keyed by outflow id.
- **N20, item 7 (805):**
  - `buildSkuEggMap(skus, boxCapacityMap).eggProduct` → `buildSkuEggMap(skus, boxCapacityMap)[sku].eggProduct`
  - "so the UI never offers a void the server refuses" is an absolute claim → "so the UI's 48 h cut-off matches the server's minute-level check"
- **N21, item 9 (813):**
  - "first date" → "earliest return date" (as in §6.7.1)
  - `isFull` here vs `full` in §6.6: use one name
- **N22, item 11 (821):**
  - "from the data row" → "from the default (null, null) row"
  - "local-date arithmetic" → state what the test asserts
- **N23, item 12 (825):**
  - "`piecesRetak` removed" names a `DeliveryLogRow` field, not a header (item 8 already covers it). Drop it here.
  - "OK / Pecah" → the exact headers "Butir OK (ke stok)" / "Butir Pecah"
  - "file header per §6.7.1" → "the source-file header comment per §6.7.1", if that is what is meant (it can be confused with the CSV header row)
- **N24, item 14 (833):**
  - "invalidation adds the returns key" → name the query key
  - Add "`ensureDelivery` implements §6.5.5 step 1" (§6.5.5 says the row is created through `save`)
- **N25, item 18 (849):**
  - "in the Retur header" → "in the Retur section header"
  - "the existing banners cover `poState` and `duplicatePos` as before" understates the change; see O3
- **N26, item 19 (853):**
  - "`recordLineReturn` receives two return entries" → "`callRecordReturn` receives two return entries"
  - "renders locked with "Tambah retur kedua" and prefills…" → "renders locked; tapping "Tambah retur kedua" unlocks it and prefills…"
- **N27, item 20 (857):** "five new list chips with counts" → "five new list chips per §6.6". The Kurang chip shows pieces, not a count.
- **N28, item 21 (861):** `src/lib/outflowCalculator.ts` is listed in the heading, but no change is assigned to it.
- **N29, item 24 (873):** "equals the order being submitted" → "equals the submitted order's No. Faktur".
- **N30, item 25 (877):**
  - "are the Indonesian" → "are the Indonesian text"
  - "Every key in both files." → "Add every key to both files."
  - "claim CSV name" → "claim CSV filename"
- **N31, item 26 (881):**
  - "Proposed changes: §6.9, with" → "Implement §6.9:"
  - "the report writer" → "writes the report committed as file 28"
- **N32, item 27 (885):**
  - "(S)" → "(class S)"
  - "the compensating movement" → "the compensating outflow"
  - "the manual correction" → name it (the owner's correction after the next count, §8)

**Verification plan**
- **N33 (897–900):** If `npm run verify` already runs build, tsc, test and lint, the first three bullets repeat it. List once what verify runs. (Not checked; it is outside the supplied context.)
- **N34 (901):**
  - "against a copy" → "against a copy of production"
  - "through the new body" → "through the new `record_return`"
  - "a legacy retakan return (no `return_id`)" → "(its child inflow has no `return_id`)"
  - "marked voided with no outflow" → "with no compensating outflow"
- **N35 (902):**
  - "the server refuses when forced" → "the server refuses a direct RPC call"
  - "keeps the list scroll" → "keeps the list scroll position"
  - "the export opens" → "the 21-column log opens"
- **N36 (903):** "`<test_ref>` is the test faktur of step 4" → "the No. Faktur of the step 4 test PO".
- **N37 (931):** "Plus, per faktur … within rounding": the tolerance is not quantified. → "Per-faktur check: … equal the sheet's Butir OK + Butir Pecah within <N> pieces".

**Rollout**
- **N38 (935):**
  - The snapshot SQL fragments have no `select` and no `group by` product.
  - "(expect 136 rows)" → "(expect `count` = 136)"
- **N39 (936):** "confirm them" → say how (for example, `has_role` per user).
- **N40 (937):**
  - The first two checks have no expected result → add "(expect 1 row)" to each.
  - "(expect 4 box)" → "(expect `box` = 4)"
- **N41 (938):**
  - "a small test PO" → "a test PO"
  - "the office device" → "an office device"
  - "from a phone that has not updated" → "from any phone (all run the Phase 1 bundle until step 5)". At step 4 no Phase 2 build exists yet.
- **N42 (939):**
  - "wait for Vercel" → "wait until the Vercel deployment is Ready"
  - "1 box, Pecah" → "reason Pecah" (so it is not confused with the Pecah count field)
  - "saving the warehouse side without "Tambah retur kedua" is locked" → "the warehouse inputs stay locked until "Tambah retur kedua" is tapped"
  - "so no test stock remains and V1 can exclude the ref" → "so the test movements net to zero". V1 already excludes `<test_ref>` in its SQL.
- **N43 (940):** "if wanted" → "if the owner decides to (§9 item 1)".
- **N44 (941):**
  - "(13)", "(3)", "(7)" → "(13 expected)" and so on
  - "live run" → give the command without `--dry-run`
- **N45 (942):**
  - "about 50 to 60" → "50 to 60 (estimate)"
  - "re-enters through CUJ 2" → "re-enters with CUJ 2's warehouse save"
- **N46 (944):**
  - "Switch" → "Retire the sheet"
  - "the sheet stops for new rows" → "office admins stop adding rows to the sheet"

**Rollback**
- **N47 (946):** "nothing is dropped" → "no table or column is dropped". Step 5 deletes rows.
- **N48 (948):** "stops every phone, old bundle or new, from voiding, before anything else" → "stops all voids." Old bundles have no void action, and "before anything else" repeats "ordered".
- **N49 (949):**
  - "Phones on the Phase 2 bundle keep working" overstates; after step 1 their void action fails. → "keep working except voiding (step 1)"
  - Split out "the Phase 1 page", which refers to the reverted bundle.
- **N50 (950):** "are correct whether or not any return was voided" → cite §6.3.3 rather than asserting it.
- **N51 (951):**
  - "the only record of the store-side claims" collides with the glossary's "Claim" → "the only store-side record (quantities, reasons, No. Retur OSV)"
  - "has been seen on" → "runs"
  - "every office device" → "every device"
- **N52 (952):** "The import is plain data: … reverses it on its own." → "To reverse the import, run `delete from delivery_lines where source = 'sheet_import'`, then delete the `deliveries` rows file 28 lists as created." The second delete statement is also missing.
- **N53 (956):** "*Drafted with EGM*" is a tool credit, not content. Delete it.

---

## Content issues outside style (for you to route)

- **O1. Edit guard vs server check (item 6, §6.3.4, decision 20).** The client's `hasReturns` guard will ignore voided returns, while `correct_order`'s `HAS_RETURNS` still counts them. The UI can then offer Edit pesanan that the server refuses, which is the opposite of the goal item 7 states.
- **O2. Step 9's stock equation (line 943)** ignores sales, new POs and other movements between the snapshot and the check. It only holds if nothing else moves stock in that window.
- **O3. Unassigned behaviour (items 16 and 18).** §6.5.8's per-line "tidak cocok dengan PO" case (a SKU not on the live PO) and §6.10's shared-ref refusal that names both POs are not assigned to any plan item.
