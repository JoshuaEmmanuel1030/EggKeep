# Stage 5: Initial Zoom Out Review (egm-zoom-out, Opus)

**Target:** `design_draft.md` (full file, 846 lines at review time) · **Standard:** zoom-out-standard.md · **Date:** 2026-11-02
**Status:** resolved (fixes applied to `design_draft.md` before Stage 6)

## Resolution by the drafting session (Elephant)

| # | Finding | Resolution | Applied change |
|---|---|---|---|
| M1 | `void_return` bundled with the root fix; CUJ 4 example blocked by the plausibility rule | PROPOSE FIX | Migration split into A (lines, egg outflow ids, `user_email`, catalog flags, expiry) and B (`void_return`, void columns, `inflows.return_id`, voided filters); both land before launch (owner decision A kept); rollback per migration. CUJ 4 rewritten around Pecah 712 (a typo the guards cannot catch). |
| M2 | `void_return` authorised only in the UI | PROPOSE FIX | Server check added: admin (`has_role`) or the return's author within 48 h, errors `NOT_ALLOWED` / `VOID_WINDOW_CLOSED`; `canEditEntry` stays as the UI mirror. |
| M3 | Two physical reasons on one SKU double-count | PROPOSE FIX | At most one physical-reason line per (faktur, SKU): enforced in the picker and by a partial unique index whose reason list mirrors `NO_PHYSICAL_RETURN` with a sync test (precedent `reconViewsSync.test.ts`); extra reasons go in the note (sheet Panduan rule 7). |
| M4 | Two admins editing the same line can restock twice | PROPOSE FIX | The claim "never a silent second restock" removed; a re-read of the SKU's returns immediately before the RPC refuses the save when returns appeared since the form loaded; the residual window is listed as a known limit (recovery: mismatch hint, Riwayat retur, `void_return`). |
| M5 | Klaim chip contradicts CUJ 6 and overlaps red; §1 billing motivation is Phase 3 | PROPOSE FIX | Red chip = "no ref" rows + their pecah total; Klaim chip = filter for the claim CSV showing rows and total pecah; CUJ 6 numbers fixed; §1 reworded (billing status is Phase 3). |
| M6 | `returns.delivery_line_id` has one reader | PROPOSE FIX | Column dropped (the brief had it as optional); verification query A now checks (`outflow_id`, `sku_code`) against the delivery's lines. |
| M7 | Import cost not matched by stated benefit | CONTEST (owner decision D, decision log 15) + PROPOSE FIX on wording and tooling | Import kept; benefit stated (October refs chased in-app, 50–60 fakturs need only the warehouse half, October history); hand CSV reader replaced by `exceljs` (N10); `import_key` dropped (N2); the script reads the catalog from the DB instead of copying the box rule. |
| M8 | "Diperiksa" tick has no reader; Catatan Kondisi conflict | PROPOSE FIX | `verified_by` / `verified_at`, the checkbox and the mutation dropped; "Catatan Kondisi" prints `note`; the import ignores the sheet's TRUE/FALSE. |
| N1 | Put the outflow id into `egg_totals` instead of a new aggregate | PROPOSE FIX | `egg_totals` objects gain `outflow_id`; it also supplies the sold native quantity the cap needs (the draft had not said where it came from). |
| N2 | `import_key` duplicates the natural key | PROPOSE FIX | Dropped; the import inserts with ignore-duplicates on (delivery, SKU, reason); `source` supports rollback. |
| N3 | Trigger, redundant index, wrong check rationale | PROPOSE FIX | Trigger and `delivery_lines_delivery_idx` dropped (client sets `updated_at` like Phase 1); rationale corrected ("a new reason must not need a migration"). |
| N4 | `pack_skus.unit_label` could be derived from `basePackCode` | CONTEST | Decision log #3 and §4.4: `N30B` is a 150-egg box with no base pack and no box mode, the exact 5× case; "pak × 150" is the wording that caused the sheet's unit errors. Column kept. |
| N5 | `inflows.return_id` backfill is a heuristic write to production | PROPOSE FIX | Backfill dropped; new retakan rows set `return_id`; `v_recon_ledger` keeps its join; legacy retakan voids hit `RETAKAN_INFLOW_MISSING`. |
| N6 | Error mappers re-derive `kind` | PROPOSE FIX | `returnErrorCode(result)` reads `ReturnSubmitResult.kind` for NETWORK and matches server prefixes only; `correctionErrorCode` untouched. |
| N7 | Per-attempt ids in the dialog change nothing | PROPOSE FIX | Dialog keeps `makeId()`; per-attempt ids only on the delivery line. |
| N8 | Unnamed reuse; one returns fetcher; `eggProduct` independent of capacity | PROPOSE FIX | `returnCode` / `ReturnBubble` / `ReturnCodeParts` named for every O/R/H display; `summarizeReturns` extracted from `usePriorReturns` and shared; one fetcher with `includeVoided`; `buildSkuEggMap` resolves `eggProduct` through the base pack regardless of capacity. |
| N9 | PostgREST embedding; fold hooks | PROPOSE FIX | `deliveries.select("*, delivery_lines(*)")`; line mutations live in `useDelivery.ts`. |
| N10 | Use `exceljs` | PROPOSE FIX | See M7. |
| N11 | Expiry resolver has unused levels | PROPOSE FIX | Two levels (keyword + SKU, keyword only) plus the default row; no keyword-less SKU rules, no tie-break. |
| N12 | `claim_ref_norm` empty-string case | PROPOSE FIX | Generated as `nullif(upper(btrim(claim_ref)), '')`; red tests `is null`. |
| N13 | Altitude and editorial items | PROPOSE FIX (all but two) | Signatures and exact strings moved to the implementation plan and locale items; `void_return` body kept as the contract (the task requires it to the `void_outflow` standard) with the property table trimmed to what the body does not show; chip counts, §2 list, item 8 Q&A, item 13 claim, rollout step 10, §1 dialog sentence, export header wording, the "selisih kurang" reader (the owner) fixed; claim CSV gets its own export button, independent of chips; the brief is committed with the spec. DECLINE: fixture lists in plan items 9–10 (they belong in the plan). CONTEST on moving the duplicate-ref warning out: decision log #6 (brief M1/D6) puts it in Phase 2; the non-goal was reworded to cover only *requiring* the ref. |

## Reviewer report (verbatim)

ZOOM-OUT REVIEW: design_draft.md (Delivery & Return Log Phase 2, "Retur per faktur")

Target: C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md (all 847 lines read)
Standard: C:\Users\Joshua\.claude\plugins\cache\egm\egm\0.1.0\resources\document_standards\zoom-out-standard.md (read), persona zoom_out.md (read)
Code checked in: C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\

**What the document proposes:** A "Retur" section on each faktur in /deliveries. It is backed by a new `delivery_lines` table that holds the store-side facts. A confirmed warehouse save goes through the existing `record_return`. Around that it adds a new `void_return` RPC, a `voided_at` filter in every reader of `returns`, list chips, exports in the sheet's layout, expiry defaults, and a one-time import of October's sheet rows.

**Is the objective clear:** Yes. Returns stopped reaching stock because the return dialog sits in the wrong place for admin. Moving entry onto the faktur fixes that and lets the sheet's store, warehouse and claim columns retire. One exception: the "unbilled" motivation in §1 is Phase 3 work (Major 5).

**Verdict:** REVISE. No Blockers, 8 Majors, 13 Nits. The context check passes. The core is sound and small: `record_return` stays the only path into stock, warehouse state is derived rather than stored, and the plan has no wrapper RPC, no `delivery_log` view and no outbox. The rejected alternatives in §7 are mostly well argued. Most of the extra weight comes from `void_return` and its fan-out, plus a few fields nothing reads.

**Reuse claims I checked, all accurate:**
- `RecordReturnDialog`: `skuMap` 127–147, reset effect 245–257, `setBucket` 286–307, `handleConfirm` 316–360.
- `void_outflow` at 20260904000000 lines 185–230.
- `correctionErrorCode` at orderCorrection.ts 48–55.
- `skuToEgg` at GroupedActivityLog 1061–1072.
- `canEditEntry`, `resolveBoxLine`, `checkSKUDependencies`, `customerLabel`, `useDuplicateOrderCheck`.
- `@radix-ui/react-collapsible` is installed; the return outbox replays only from Index.tsx; "pak" is at DeliveryDetail.tsx:206; the dialog has 14 tests; `pg_input_is_valid` is already used in views.

---

## MAJOR

**M1. `void_return` and the `voided_at` fan-out are bundled with the root fix, and the CUJ meant to justify them would already be blocked by a cheaper guard**
- Severity: Major
- Affected Scope: §3 Goals l.40; §5 CUJ 4 l.158–162; §6.3.2–6.3.3 l.350–430; §6.5.3 l.473; Plan item 1 l.662–665; Rollback step 2 l.834.
- Simplicity Rationale:
  - The urgent problem in §1 is about 21,000 eggs that never got back into stock. Fixing it needs `delivery_lines`, `egg_outflows`, `user_email` and the save path.
  - `void_return` is the riskiest part of the change. It rewrites `record_return`, `void_outflow`, `reconcile_inventory`, `recalculate_inventory_fifo` and `v_recon_ledger`, changes `usePriorReturns`, backfills production inflows, makes old bundles disagree with the server, and adds a rollback trap: step 2 says that once any return has been voided you can only roll back the frontend.
  - All of that ships in one migration of 12 steps. A data-integrity finding on `void_return` therefore holds up the stock fix, and rollback is all-or-nothing.
  - The motivating example cannot happen as written. In CUJ 4, Pecah 1,720 against 1,260 returned pieces is refused by §6.5.3 ("Pecah > returned pieces" is blocked).
  - Fix: split into migration and PR A (lines plus warehouse save; the `record_return` change is only `user_email`) and B (`void_return`, `inflows.return_id`, all the `voided_at` filters), each with its own review and rollback. Both can still land before launch day, which keeps owner decision A. Rewrite CUJ 4 around an error the guards cannot catch: Pecah 712 instead of 172, the wrong disposition, or the wrong SKU on a shared egg.

**M2. `void_return` is authorised only in the UI, against the newest pattern for stock-changing RPCs**
- Severity: Major
- Affected Scope: §6.3.2 table, "Who may call" l.414; §8 "Who can write" l.612.
- Simplicity Rationale:
  - `correct_order` (20261021020000_correct_order_guards.sql lines 52, 86–90) already enforces "admin, or the author within the window" on the server, using the existing `public.has_role`.
  - Doing the same in `void_return` takes about four lines: `NOT_ALLOWED` when `v_ret.user_id <> v_user` and the user is not admin, and a window error after 48 h for non-admins.
  - As drafted, anyone signed in, including any warehouse phone, can reverse stock through the API. Deferring the check to "later" saves almost nothing and goes against "treat production data as sacred". `canEditEntry` stays as the UI mirror, the same way `canCorrect` mirrors `correct_order`.

**M3. Lines are keyed per reason, but warehouse state is derived per SKU, so two physical reasons on one SKU double-count**
- Severity: Major
- Affected Scope: §6.2.1 rules l.253, l.255, l.257; §6.5.1 SKU picker l.462; §6.6 table l.511–515; §6.7.1 Butir OK / Pecah / Tgl Barang Balik / Paraf Gudang l.535–539.
- Simplicity Rationale:
  - Lines are unique per (delivery, sku_code, reason). Everything on the warehouse side (done or not, OK/Pecah, return date, paraf, lock) is derived per (PO egg outflows, sku_code).
  - The picker still offers a second physical reason on the same SKU, for example P25 Pecah plus P25 Ditolak. In that case:
    - One save clears orange on both lines.
    - Both lines lock.
    - The 21-column export prints the SKU's Butir OK/Pecah on both rows.
    - The Klaim pieces total counts them twice.
  - This also blocks Phase 3, which needs pecah per line for billing.
  - Simplest fix, matching the sheet's own rule (Panduan rule 7): allow at most one physical-reason line per (faktur, SKU). Further reasons go in the note. Non-physical lines such as Kurang can sit next to it, which covers 2610382 and 2610556. Enforce it in the picker and with the existing unique-violation message.

**M4. "Never a silent second restock" does not hold when two admins edit the same existing line**
- Severity: Major
- Affected Scope: §6.5.5 step 6 l.488; §8 Concurrency l.615.
- Simplicity Rationale:
  - The unique index only stops two *new* lines. If two admins open the same orange line, both upserts land on the same id and succeed.
  - Each then calls `record_return` with its own per-attempt ids. The outflow lock puts the two calls in order but lets both through while under the cap, so the stock is restocked twice.
  - The lock-after-returns rule works only on what each screen loaded, which may be stale.
  - In a three-person office the cheapest honest fix is to drop the claim and list this as a known limit. The mismatch hint, Riwayat retur and `void_return` cover recovery.
  - If a real guard is wanted, M6 shows that the only thing that could give `delivery_line_id` a job is a server-side "one live return set per line unless second" check. Adding that check is extra complexity; it should be weighed, not assumed.

**M5. The Klaim chip's definition contradicts its own example and overlaps the red chip; the §1 billing motivation is out of scope**
- Severity: Major
- Affected Scope: §1 l.13; §2 l.25; §5 CUJ 6 l.173; §6.6 Klaim row l.515; Non-goals l.53; Plan item 9 `countPecahWithoutRef` l.700.
- Simplicity Rationale:
  - Line 515 says the total is pecah pieces on rows with no ref, "the sheet's counter 1". The sheet's counter 1 is a count of rows ("tanpa No. Retur: 18").
  - CUJ 6 expects "60 baris · 3.549 butir". Those are counters 2 and 3, the "belum ditagih" (unbilled) counters, which the non-goals push to Phase 3. §1 likewise motivates the work with eggs "nobody has billed", and Phase 2 does not fix billing.
  - A reader cannot tell which number to build.
  - Pecah pieces on rows with no ref is also the red chip's set of rows, counted in pieces instead of rows. That is two chips for one concept.
  - Fix: make Klaim a filter for the claim CSV showing rows and total pecah, and let the red chip carry "no ref". Fix the numbers in CUJ 6, and reword §1 so billing is clearly Phase 3.

**M6. `returns.delivery_line_id` is provenance with a single reader**
- Severity: Major
- Affected Scope: §6.2.2 l.259–271; §6.3.1 change 2 l.345; §6.4 `deliveryLineIdByRow?` l.439, l.443; Plan items 1, 5, 16; verification query A l.797–805; Rollback l.836.
- Simplicity Rationale:
  - The document says no state comes from this column. Riwayat retur matches by `sku_code`, so the only thing that reads it is verification query A.
  - Even so, it widens the stock RPC's input, `ReturnLineInput`, `returnRpc`, the input of the shared builder, an FK, an index and the rollback.
  - Drop it. Check A can be replaced by a unit test of the `egg_outflows` resolution, plus a query that every new return's (`outflow_id`, `sku_code`) matches a line on that PO's delivery.
  - Keep it only if M4's server-side guard is adopted, because then it does real work.

**M7. The import script's cost is not matched by the benefit the document states**
- Severity: Major. It is an owner decision (brief D), but the document's own wording undercuts it.
- Affected Scope: §6.9 l.557–571; §6.2.1 `source` / `import_key` l.232–233, l.241; CUJ 7; §7 "Start clean" l.597; Plan items 27 and 29; Rollout step 7.
- Simplicity Rationale:
  - §7 rates "start clean" as an acceptable fallback that gives up October history "that no Phase 2 report reads".
  - The import's remaining benefit is pre-filling store fields for the 50–60 fakturs from 15 to 31 October. Admin re-opens those through the UI anyway, and CUJ 1 enters both halves in one visit.
  - The cost:
    - A new script with a hand-written CSV reader.
    - Inline copies of `RETURN_REASONS` and the box rule. A `.mjs` script cannot import `src/lib/returnLines.ts`, so they become a second source of truth.
    - Two columns, an index, a report document, and handling for 13 unmatched, 3 shared and 10 non-PO rows.
  - Either state the concrete benefit (for example "Novi chases October refs in-app"), or start clean and re-enter 15–31 October with both halves. October's sheet rows already sit in the sheet, which stays as the record. If the import is kept, see N2 and N10.

**M8. The "Diperiksa" tick has no reader and conflicts with how the export uses the same sheet column**
- Severity: Major (YAGNI plus an internal contradiction)
- Affected Scope: §2.1 item 2 l.30; §6.2.1 `verified_by` / `verified_at` l.234–235; §6.9 step 6 l.568; §6.7.1 Catatan Kondisi l.534; Plan item 15 `setVerified`; decision 18.
- Simplicity Rationale:
  - Nothing reads `verified_by`: no flag, no chip, no export column. Novi's check runs through the Klaim and red chips (§6.7.3).
  - The import treats the sheet's TRUE/FALSE "Catatan Kondisi" checkbox as "verified", yet the 21-column export prints `note` text under that same "Catatan Kondisi" header.
  - Drop both columns, the checkbox and the mutation, and define one meaning for Catatan Kondisi. If a reviewer tick is ever needed, it is one additive column.

---

## NIT

**N1. Add the outflow id to `egg_totals` instead of a parallel `egg_outflows` aggregate**
- Affected Scope: §6.2.4 l.282–295; Plan items 8 and 13.
- `purchase_orders.egg_totals` is already `jsonb_agg({product, quantity}) filter (category = 'egg')` (20261022010000_buyer_profiles.sql l.31–32). Adding an `outflow_id` key there needs no new column and no new type. The only readers, buyerProfile.ts and usePurchaseOrders.ts, ignore the extra key.
- It also supplies the outflow's sold native quantity, which `buildReturnLines` needs for `remainingNativeByProduct`. The document never says where the delivery page gets that number.

**N2. `import_key` duplicates the natural key**
- Affected Scope: §6.2.1 l.233, l.241; §6.9 l.571.
- `"<invoice_ref_norm>|<sku_code>|<reason>"` is the same tuple as the unique index on (delivery_id, sku_code, reason). Even the "N 30" vs "N30" typo collides on both equally.
- Upsert on the existing key with ignore-duplicates; `source` alone supports rollback.

**N3. Extra schema on `delivery_lines`: a trigger, an index and a check rationale**
- Affected Scope: §6.2.1 l.227, l.238, l.242, l.244–247; Plan item 15; Rollback step 6.
- Nothing reads `updated_at`, and Phase 1 sets it from the client (useDelivery.ts l.115). A new `set_updated_at()` trigger function is a second pattern for no reader.
- `delivery_lines_delivery_idx` is already covered by the leading column of the unique index.
- "No check constraint (old-bundle rule)" does not apply: old bundles cannot write `delivery_lines` at all.

**N4. `pack_skus.unit_label` is a catalog column, a snapshot column and a SKUDialog select for a display word on four SKUs**
- Affected Scope: §6.2.5 l.297–304; Plan item 22; decision 3.
- The inline piece equivalent (§6.5.2) already guards against the 5× N30B/N30O mistake.
- Derive the word as `basePackCode ? 'box' : 'pak'` and accept that N30B shows "pak × 150 = … butir". Add the column if admins actually misread it.

**N5. The `inflows.return_id` backfill is a heuristic write to 64 production rows**
- Affected Scope: §6.2.3 l.280; §6.3.3 `v_recon_ledger` row l.426; Rollout step 3.
- It serves only voiding legacy retakan returns and re-keying a ledger join that already works. New retakan rows still match by timestamp in the same transaction.
- Set `return_id` for new rows only and leave the `v_recon_ledger` retakan join as it is. Legacy rows hit `RETAKAN_INFLOW_MISSING`, which is already specified.

**N6. Error-code helpers re-derive what already exists**
- Affected Scope: §6.4 `returnErrorCode` / `voidReturnErrorCode` l.440–441.
- `callRecordReturn` already returns `kind: "network" | "server"` through `classifyOutflowError`. Use that for NETWORK and match only the server prefixes.
- One generic `matchErrorCode(message, codes)` can serve `correctionErrorCode` and both new mappers.

**N7. Per-attempt ids in the dialog change nothing**
- Affected Scope: §6.4 l.443; Plan item 4 l.680.
- The dialog already queues the same input, ids included, on a network failure (RecordReturnDialog.tsx l.376–385), and a server rejection writes nothing.
- The ref-based ids matter only on the delivery line, which has no outbox. Leave the dialog's `makeId()` alone and avoid touching a component with 14 tests.

**N8. Reuse that is not named, plus one behaviour change in the extraction**
- Affected Scope: §6.4 l.438; §6.5.1 "Sudah diretur" l.464; §6.5.5 step 3 toast l.485; §6.5.7; Plan items 7, 9, 16.
- Name `returnCode`, `ReturnBubble` and `ReturnCodeParts` (activityGrouping.ts, GroupedActivityLog.tsx) for every O/R/H display, so no second formatter appears.
- `usePriorReturns` is today the only client reader of `returns`. The plan adds two more (`fetchReturnsForOutflows` and `useDeliveryReturns`) plus `returnsForSku`. Pull its `bySku` aggregation out as a pure function and share one fetcher, using `includeVoided` only for Riwayat.
- `buildSkuEggMap` could call `resolveBoxLine`, so the box arithmetic has one home.
- Today's `skuToEgg` resolves `eggProduct` through the base pack whether or not a box capacity is configured. The dialog's rule falls back to the empty placeholder when capacity is missing, so a straight swap changes feed attribution in that case. Keep `eggProduct` independent of capacity.

**N9. Platform features and file count**
- Affected Scope: Plan items 13, 14, 15.
- `delivery_lines` has an FK to `deliveries`, so PostgREST embedding (`deliveries.select("*, delivery_lines(*)")`) replaces `fetchLinesForDeliveries`, its chunking, and the extra detail query.
- The `useDeliveryLines` mutations invalidate the same keys as `useDelivery.save` and can live in useDelivery.ts, which saves a file.

**N10. If the import stays, use what is installed**
- Affected Scope: §6.9 l.559.
- `exceljs` is already a dependency and reads CSV and xlsx in Node. Reading the sheet as xlsx also avoids decimal-comma and "1.000" parsing. That removes the hand-written "30-line RFC 4180 reader".

**N11. The expiry resolver handles more cases than the data has**
- Affected Scope: §6.8 l.555; Plan item 11.
- Level 3 (no keyword, SKU match) and the longest-keyword tie-break match no seed row and no rule in the sheet. The sheet's rule is "item rule beats general rule; keyword in customer name".
- Two levels plus the default row are enough.

**N12. `claim_ref_norm`**
- Affected Scope: §6.2.1 l.230; §6.6 l.512, l.515.
- The generated column exists mostly for the Phase 3 backfill. `upper(btrim(''))` is `''`, not null, so the red rule "claim_ref_norm null" misses a field that was cleared to an empty string.
- Trim and uppercase on save, and test `coalesce(claim_ref,'') = ''`.

**N13. Altitude, editorial artefacts and a few stray facts**
- Affected Scope:
  - §6.2.1 trigger SQL l.244–247
  - §6.3.2 full plpgsql l.354–405 (it repeats the property table at l.407–416)
  - §6.4 parameter-level signatures
  - §6.5.5 exact Indonesian strings l.487
  - Plan items 9 and 10 (helper names and fixture lists)
  - Plan item 8 self-Q&A l.696 ("Remove the unused ExpiryRule? No…")
  - Plan item 21 says "four new chips" and lists five l.748
  - §2 l.25 lists four chips, while §6.6 adds Kurang
  - §6.7.1 l.524: "delete when the sheet is retired", but the sheet stops on launch day and §6.7.3 calls the export the owner's permanent archive
  - Plan item 21: export content depends on the Klaim chip, which breaks Phase 1 §5.5 ("whatever chips or search are set")
  - Rollout step 10 l.829: removing a review worktree in a feature checklist
  - Plan item 13 l.716: "empty array when the column is absent" is wrong (PostgREST errors on an unknown select column) and unneeded, since migrations apply first
  - §1 l.15: the dialog does have a free-text reason field (RecordReturnDialog.tsx l.525–536); what it lacks is a fixed list and the OSV ref
  - §6.5.6 l.492 and §6.6 Kurang chip: nobody is named as the user of the "selisih kurang" monthly figure
  - The ~60 "brief Dx/Mx/Nx" citations point at docs/superpowers/specs/2026-11-01-delivery-return-log-phase2-brief.md, which is not on main and is untracked in the working tree
  - Plan item 25 / §6.10 l.575: the duplicate-invoiceRef warning in `QuickOutflowBuilder` / `useDuplicateOrderCheck` belongs to the same Phase 1 Q2 scope that l.61 declares a non-goal. Move it to that PR so this feature does not touch the PO-entry path.
- Rationale:
  - Move code bodies, strings and fixtures into the migration, the locale files and the plan, and keep the design at the level of contracts. The `void_return` property table is the contract; keeping the body as well invites the two to drift.
  - Either commit the brief with the spec, or make sure the decision log (§10) is self-sufficient. It nearly is.
  - Fix the editorial items in passing.

---

## Files relevant to this review
- C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261021020000_correct_order_guards.sql (server-side author/admin pattern, M2)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261022010000_buyer_profiles.sql (`egg_totals`, N1)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261029000000_recon_views.sql (retakan timestamp join, N5)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\RecordReturnDialog.tsx (outbox already keeps ids, N7; reason field, N13)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\returnRpc.ts and src\lib\outflowOutbox.ts (`kind` classification, N6)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\usePriorReturns.ts, src\components\GroupedActivityLog.tsx l.997–1084, src\lib\activityGrouping.ts (reuse, N8)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDelivery.ts (client-set `updated_at`, N3)
- C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\sheet_excerpts.md (Klaim counters, M5; Panduan rule 7, M3; Catatan Kondisi checkbox, M8)
