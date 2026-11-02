# Raw report: Long-Term Tech Debt & Coupling Brainstormer (egm-structural)

Agent id: aa980f2f7fa703232 · Mode: BRAINSTORM · Date: 2026-11-01 · Status: completed
Input: feature_concept.md, sheet_excerpts.md, worktree CLAUDE.md, docs\uuid-migration\PLAN.md, the section 6 files and both Phase 1 Goldfish reports. Text below is verbatim as handed back.

---

# Goldfish report: Long-Term Tech Debt & Coupling, Delivery & Return Log Phase 2

Read in full: the concept, sheet_excerpts.md, CLAUDE.md, docs/uuid-migration/PLAN.md, both delivery specs, all Phase 1 code and migrations listed in section 6, the returns pipeline (dialog, hooks, RPC, cap, outbox, types, 20260904 and 20261008 migrations), correct_order and its guards, void_outflow, the purchase_orders view, catalogDependencies, SKU catalog code paths, activityGrouping, GroupedActivityLog, usePriorReturns, and both Phase 1 Goldfish reports. Review is complete; nothing required was unreadable.

## 1. Verdict

The hypothesis is right about the shape (one line per PO SKU x reason, warehouse count as a split of a known total, stock through `record_return`, no sync) and wrong about what it costs to make that line the stock-bearing entry point. The returns pipeline was built for the owner's occasional back-entry: it is append-only, has no void or edit path, resolves outflows by walking activity logs by name, and keeps its cap, box-SKU, shared-egg and kg conversion rules inside one dialog component. Phase 2 moves 100+ entries a month onto it, typed by admin, with a derived "OK = total minus pecah" that restocks hundreds of eggs per line, and the hypothesis says nothing about undoing a wrong save. Add to that a stock-bearing chain hung off a user-typed text key that is already duplicated three times, a new SKU-code name pointer the UUID plan does not inventory, a badge view that would have to join lines and returns through the activity-log regrouping, and an export that claims to be the sheet's layout but is not. Each of these is fixable in the brief with a small rule; none is fixable after launch without SQL surgery. The brief must settle the correction path, the single implementation of return resolution, the ambiguity rule for duplicate refs, and derived-not-stored line state before anything is built.

## 2. Findings

### F1. The warehouse save is irreversible and the store side is not; the brief names no correction path
- Severity: Blocker
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: `returns` has only a SELECT policy (`C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260904000000_returns.sql` lines 38-42). There is no `void_return`, no update, no delete anywhere in the repo (grep for `void_return`, `delete from returns`, `from("returns").delete` finds nothing). `record_return` skips a line whose id already exists (`...\20261008000000_returns_sku_code.sql` lines 59-61), so resubmitting is a no-op and "fixing" a count means appending another row; counts can only go up. Meanwhile `deliveries` rows are last-write-wins and editable forever (`src\hooks\useDelivery.ts` save mutation). Phase 2 puts both halves on one line: the store-side quantity and reason stay editable, the warehouse-side numbers they were derived from cannot be changed. The concept's own data says all 136 returns ever were entered by the owner in one careful sitting (section 2); admin typing 108 return rows a month will mistype within the first week (1720 for 172 pecah restocks 1,548 fewer eggs and cannot be undone in the app).
- Evidence: concept section 3 ("that entry is the stock return", "OK ... editable"); section 3 rules ("the only RPC change is persisting delivery_line_id").
- Requirement for the brief: name the correction path for a wrong warehouse save before Phase 2 is designed. Two honest options: (a) a `void_return(p_return_id, p_reason)` RPC that reverses `return_restocks` oldest-first with the same lock order as `void_outflow`, voids the retakan inflow it created, and marks the return voided; or (b) declare the warehouse save a confirmed, one-way action, keep an owner SQL runbook, and freeze the store-side quantity and reason of a line once returns exist against it. Option (a) has the lower two-year cost (admin self-serves; the owner stops doing SQL); option (b) is the ponytail minimum if (a) is out of scope, but then the brief must say so in writing. Either way: once `returns` rows exist for a line, its `quantity`, `sku_code` and `reason` are read-only in the UI, and the line shows the linked return totals next to the paper number.

### F2. "Call record_return directly" duplicates the one implementation of cap, box-SKU, shared-egg, kg and outbox rules
- Severity: Major
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: the rules CLAUDE.md calls load-bearing live only inside `RecordReturnDialog.tsx`: box-SKU egg resolution via `basePackCode` x `boxCapacityMap` (lines 127-147), outflow-id resolution through `findRelatedEntryId` (lines 263-276), shared-egg combined cap (lines 283-307), running native budget on submit with pieces-to-kg clamp (lines 316-360), and the network/server split that feeds `enqueueReturn` (lines 371-388). An inline "pecah only, OK = remainder" form needs every one of these (two Osave lines on one faktur can share an egg; Negeri lines convert at flat 15.5 and a full-box return can exceed the cap if the catalog factor differs). Writing them twice means every cap or unit bug is fixed twice for two years, and the two entry points drift.
- Evidence: concept section 5 question 1; `src\components\RecordReturnDialog.tsx` as cited; `src\lib\returnsCap.ts` line 12.
- Requirement for the brief: exactly one implementation of return-line resolution (SKU to egg product and pieces-per-unit including boxes; egg product to outflow id; remaining cap per egg across lines; pieces to native; submit with outbox fallback), used by both the Activities dialog and the delivery line. The UI can differ; the core cannot. Either extract it from the dialog into a hook/lib in the same PR, or open the existing dialog prefilled and locked to one SKU. The brief must also state how the delivery detail obtains outflow ids: `purchase_orders` exposes no activity-log or outflow ids (`...\20261022010000_buyer_profiles.sql` lines 18-43; `PO_COLUMNS` in `src\hooks\useDeliveries.ts` line 20). Cheapest: extend the view (additive) with `egg_outflows jsonb` = `jsonb_agg(product, metadata->>'relatedEntryId') filter (where category='egg')`, so the delivery page gets a UUID link to outflows without re-implementing `findRelatedEntryId`.

### F3. The stock-bearing chain hangs off a text key that is already ambiguous, and the ambiguous case silently picks a PO
- Severity: Major
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: `deliveries` is keyed on `invoice_ref_norm` (`...\20261029000001_deliveries.sql` lines 12-13, 29). Three invoice numbers are already shared by two POs (concept section 2). Phase 1 handles this cosmetically: the list marks the later-recorded PO as `duplicateInvoice` (`src\lib\deliveryFlags.ts` lines 63-86) and the detail uses `pos[0]` (`src\hooks\useDelivery.ts` lines 45-56). In Phase 2 that choice decides which outflow gets restocked. `correct_order` can fix a ref only within 60 minutes (`src\lib\orderCorrection.ts` line 6), so a duplicate found when the faktur comes back a day later is permanent. `delivery_lines` keyed by `(delivery_id, sku_code, reason)` then inherits the ambiguity: the line belongs to "whichever PO the text resolves to today".
- Evidence: concept section 4 ("No. Faktur required", not unique); section 2 ("Three invoice numbers are shared by two POs each").
- Requirement for the brief: (1) the warehouse save refuses when `duplicatePos > 0` (fail loud, point admin to the Activities card for that PO, which still works per PO); (2) new tables reference `deliveries.id`, never `invoice_ref_norm`, so the text key stays confined to the header row; (3) a duplicate-ref warning at PO entry in `QuickOutflowBuilder` (the `useDuplicateOrderCheck` hook already exists; add an invoice-ref match), because Phase 2 raises the cost of a shared ref from "confusing list" to "wrong stock". Do not add a PO-picker UI; do not merge.

### F4. `delivery_lines.sku_code` is a new name pointer outside the UUID plan, and the SKU rename guard is a non-check
- Severity: Major
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: `pack_skus.code` is editable in the catalog (`src\components\catalog\SKUList.tsx` lines 127-129, `SKUDialog.tsx` line 36) behind `checkSKUDependencies`, which only runs `outflows.invoice_supplier ilike %code%` (`src\lib\catalogDependencies.ts` lines 12-32), so it never finds the real dependents: `activity_logs.metadata.orderLines[].skuCode`, `returns.sku_code`, `item_types.box_capacities` keys, and now `delivery_lines.sku_code` and `expiry_rules.sku_code`. PLAN.md says the newer SKU-code-keyed code is "not yet inventoried" (lines 3-8) and Stage C re-keys `item_types` names only; it neither fixes nor breaks SKU-code pointers. The warehouse pre-fill ("quantity x eggs per unit") and the export unit both resolve the code against the live catalog, so a renamed code or a changed box capacity (Osave moves from 18 to 20 packs per box) silently changes what an old line means.
- Evidence: concept section 3 step 1 ("in the PO line's own unit ... from the PO's skuCode"); section 1 ("Box capacities live in item_types.box_capacities keyed by SKU code").
- Requirement for the brief: treat `delivery_lines.sku_code` as a snapshot of the PO line (same class as `returns.sku_code` and `activity_logs.product`), never a foreign key; store `pieces_per_unit integer` on the line at store-side save so the pre-fill, the display and the export of an old faktur never depend on the catalog later; declare `pack_skus.code` immutable once used (same rule CLAUDE.md already applies to box names) or make `checkSKUDependencies` count `delivery_lines` and `returns` by code; add the new columns to PLAN.md's inventory with their class (delivery_lines.sku_code = S snapshot; expiry_rules match = R pattern over live codes).

### F5. Extending `open_delivery_items` entrenches a badge that regroups every outflow row on every page
- Severity: Major
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: the view is driven from `purchase_orders` (`...\20261029000001_deliveries.sql` lines 50-66) and the Header fetches it on every page (`src\hooks\useDeliveries.ts` lines 109-130). Its only consumer counts `invoice_not_back`. The full spec plans to add `awaiting_warehouse`, `needs_claim_ref` and `count_mismatch` to it (full spec lines 194-199), which means joining `delivery_lines` and `returns` into a per-line view over a jsonb regrouping, changing the grain, and keeping the flag logic in SQL and in `deliveryFlags.ts` (the Phase 1 C6 finding, now times three).
- Evidence: concept section 3 ("Flags on the list and badge: orange ... red ..."); Phase 1 design spec section 13 and intermediate report N7.
- Requirement for the brief: replace, do not extend. The badge reads tables only: `deliveries` (invoice_not_back) and `delivery_lines` left join `returns` on `delivery_line_id` (orange, red). Drop the "PO still live" refinement from the badge (a voided-after-logged faktur is rare and visible in the list) and delete `open_delivery_items`. Flag logic lives once, in `deliveryFlags.ts`; any SQL that exposes line facts for the badge exposes `reason`, `claim_ref`, `has_returns`, `buyer_name` as columns and lets the client classify. If a classification must exist in SQL too, add a sync test that reads the migration, as `reconViewsSync.test.ts` already does for the recon map (CLAUDE.md line 48).

### F6. The export is not the sheet's layout, and the layout is about to be defined twice
- Severity: Major
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: `DELIVERY_LOG_COLUMNS` (`src\lib\deliveryExport.ts` lines 23-46) has 22 columns; the sheet has 21 (`sheet_excerpts.md` line 9). Nine headers differ ("SKU" vs "Item", "(Pak)" vs "(pack)", "Alasan" vs "Alasan Retur", "Keterangan Kondisi" vs "Catatan Kondisi", "Tgl Kembali Gudang" vs "Tgl Barang Balik", "Expired" vs "Tgl Expired", "No. Klaim" vs "No. Retur ARYO", "Status Klaim" vs "Status Tagihan") and "Butir Retak" is inserted at column 18, so pasting into the sheet shifts every column after it. The full spec adds a `delivery_log` SQL view with the same 22 columns (full spec lines 187-192): a second copy of a layout whose only stated purpose is "Novi's checking habit survives" during a transition that ends when the sheet is retired.
- Evidence: concept section 3 ("Export: the sheet's 22 columns"); Phase 1 design spec section 9 Q8 (headers never checked).
- Requirement for the brief: the export is a transition artefact, marked as such in the file header ("sheet layout; delete when the sheet is retired") and owned by exactly one definition: the TypeScript column list, no `delivery_log` view. Match the sheet exactly: 21 columns, the sheet's header strings, `Butir Pecah` = retakan + writeoff, `Butir OK` = restock; the O/R/H split stays in the app feed. Resolve Q8 now from `sheet_excerpts.md` line 9 rather than carrying it a third phase.

### F7. Line state must be derived from row existence; the full spec stores copies that will drift
- Severity: Major
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: the full spec's `delivery_lines` carries `warehouse_checked_by` (a copy of `returns.user_id`), `expected_expiry` and `claim_id` (lines 117-136), and the hypothesis adds "store-side saved", "warehouse-side saved", "diperiksa", orange and red. If any of these become columns there is a four-state machine (none, store, warehouse, verified) with cross-cutting exits (non-physical reasons, PO voided, PO corrected, outbox replay pending) that the UI and the import must both keep in step. The offline outbox makes this concrete: a warehouse save that fails on the network is queued; the returns rows do not exist until replay, so any stored "warehouse saved" flag would lie.
- Evidence: concept section 3 ("The user who saves is the paraf gudang. Novi's verification is a diperiksa tick"); full spec section 4.3.
- Requirement for the brief: facts as columns: `delivery_id`, `sku_code` (snapshot), `pieces_per_unit` (snapshot), `quantity` (paper, PO unit), `reason`, `note`, `claim_ref`, `expected_expiry` (computed then user-edited, so a fact), `verified_by`, `verified_at`, timestamps. Everything else derived and never stored: store-side saved = row exists; warehouse saved = exists returns with `delivery_line_id`; paraf gudang = `returns.user_id`; Tgl Barang Balik = min(`returns.return_date`); OK/pecah = sums; orange, red, Full. No `status` column on lines. Write order on the warehouse save: line row first (it carries the id), then one `record_return` call per line with the line's reason as the RPC header reason.

### F8. The one-time import's warehouse half is the largest stock mutation this feature performs, with no undo
- Severity: Major
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: importing "the warehouse counts as returns rows dated by Tgl Barang Balik" means ~21,000 Butir OK restocked into October FIFO batches plus ~76 retakan inflows (concept section 2), through the same append-only pipeline as F1, while the 23-31 Oct physical counts already show system stock above counted for two products. The sheet's item spellings must be mapped per faktur to the PO's actual `skuCode` (OSV "N10" is `OSVN10B` on one faktur and might be `N10B` on another), so the mapping is per-row judgement, not a dict.
- Evidence: concept section 3 ("Transition: a one-time import ... and the warehouse counts as returns rows"); section 2 live-data table.
- Requirement for the brief: two separately decided steps. Step 1 imports store-side lines, reasons, Aryo refs and expiry (pure data, reversible by delete). Step 2 posts warehouse counts to stock only after the owner reconciles against the physical counts, with deterministic client line ids (e.g. UUID v5 of faktur + item + reason + disposition) so a re-run is a no-op and a bad batch can be identified. The import is a script in `scripts/`, run once, with its sheet-to-code mapping inside the script and nowhere in the app.

### F9. Aryo reference: text on the line is the lowest two-year cost; the brief should say why and normalize it
- Severity: Nit
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: `Status Tagihan` has never been filled (0 of 178 rows); one ref spans several lines and fakturs (OSV-2610055; FMI-2610005 for FamilyMart). A `return_claims` table now adds a find-or-create upsert in the save path, a unique index, and a "pick existing claim" UI for a status nobody records. Putting the ref on `returns` is wrong twice: 18 lines have no ref at warehouse time, and a line splits into up to three returns rows. The feared Phase 3 migration is ten lines of SQL (`insert into return_claims select distinct upper(trim(claim_ref)), buyer ...; update delivery_lines set claim_id = ...`) and may never be needed.
- Evidence: concept section 5 question 3; section 4 ("Status Tagihan has never been filled").
- Requirement for the brief: `delivery_lines.claim_ref text` plus a generated `claim_ref_norm` (upper, trim) so the red flag and any grouping are deterministic now and the Phase 3 backfill is mechanical. No claim table until a status exists.

### F10. Expiry rules: pattern match on the base pack code, no remap table, default is data
- Severity: Nit
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: the seed's item values are N15, N 30, AMTG, P 25, KP 6, N4 (`...\20261029000002_expiry_rules.sql` lines 28-39). They are families, not SKUs: "N 30" means both N30B and N30O. A remap table or a code list in the rule copies the catalog into a second place that must be edited every time a SKU is added (OSV box variants already exist). The table has no unique key, so re-seeding duplicates rows (Phase 1 F8, still open).
- Evidence: concept section 5 question 7; section 2 ("Osave has no rule (default 30 applies)").
- Requirement for the brief: the resolver matches when the normalized rule value (upper, spaces stripped) is contained in the normalized base pack code (after box resolution: `basePackCode ?? code`). That bridges all six seed spellings with zero new tables (N30 in N30B/N30O, AMTG in BK4AMTG, KP6 in KP6B/KP6O/OSVKP6O via base, P25, N15, N4). Rename the column to `sku_match` while nothing reads it. "Osave default 30" lives in the seed's `(null, null, 30)` row; the resolver has no hardcoded fallback and returns null when no row matches. Add a unique index on `(coalesce(buyer_keyword,''), coalesce(sku_match,''))`.

### F11. correct_order is already guarded; void_outflow is not and should not be; the brief should state both
- Severity: Nit
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: `correct_order` locks the outflow row then raises `HAS_RETURNS` (`...\20261021020000_correct_order_guards.sql` lines 97-102), and the feed hides Edit when `returnsMap[...].total > 0` (`src\components\GroupedActivityLog.tsx` lines 376-381). `void_outflow` restores only the not-yet-returned remainder per batch and leaves `returns` in place (`...\20260904000000_returns.sql` lines 185-230). So Phase 2 needs no new SQL guard. The one gap is a store-side line saved before a `correct_order` within the hour: the line's `sku_code` may not exist on the corrected PO's `order_lines`.
- Requirement for the brief: state that a void after linked returns keeps the returns and shows "PO dibatalkan" (Phase 1 behaviour), that correct_order stays blocked by returns, and that the detail must render a line whose SKU is not on the live PO (no crash, no hide), reusing the Phase 1 "tidak cocok dengan PO" banner.

### F12. Vocabulary collision: sheet "Pecah" versus app "Retak"
- Severity: Nit
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: the hypothesis maps the sheet's Butir Pecah to `retakan` (the app's "Retak", R) and also says "retak optional", while `writeoff` is "Hancur" (H). The line reason `pecah` is unrelated to the disposition. Two years of maintainers will read "pecah" and reach for writeoff.
- Requirement for the brief: one vocabulary table: inputs OK / Retak / Hancur map to restock / retakan / writeoff; the sheet column "Butir Pecah" equals retakan + writeoff; the reason list is a separate enum. Both locales use the app's words on the line and the sheet's words only in the export header.

### F13. "Delivery record before loading": the minimum is three negatives
- Severity: Nit
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: honouring the rule by adding a "to pack" status and nullable PO links now builds a state nobody uses. What actually blocks a pre-loading row later is `invoice_ref not null` plus the unique index (`...\20261029000001_deliveries.sql` lines 12-13, 29) and `useDelivery.ts` line 127 ("Cannot create a delivery without a live PO"), all of which a later migration can relax (partial unique index) without touching Phase 2 tables.
- Requirement for the brief: new tables reference `deliveries.id` only; no NOT NULL on anything known only at loading (no `outflow_id` on lines); no new status value; the warehouse save is the only step that requires a live PO. Nothing else.

### F14. `(delivery_id, sku_code, reason)` uniqueness: use the database
- Severity: Nit
- Dimension: Long-Term Tech Debt & Maintainability
- Coupling / brittleness: "enforce in the UI only" (full spec line 137) means the import, a double-tap and two admins can create duplicate lines, and "merge in the UI" is permanent code for a data error.
- Requirement for the brief: `unique (delivery_id, sku_code, coalesce(reason,''))`. A second physical return of the same SKU and reason is a second `returns` row on the same line (already the design).

## 3. Strongest counter-argument to the hypothesis

The hypothesis assumes the delivery line can become the stock-return entry point with "no change to the returns pipeline except one column". But the pipeline's contract is append-only with no reversal, resolution by name through the feed's activity logs, and all entry rules inside one dialog; it was used exactly once, by the owner, as a batch back-entry. Moving the entry to admin, per line, with a computed restock, without a void path and without a shared core, does not make stock, feed and log agree; it makes the first typo a permanent disagreement that only SQL can fix, and it duplicates the rules that keep returns within the cap. The sheet never fed stock and admin never used the dialog; the data supports "admin types paper numbers" far more than "admin posts stock".

## 4. Simpler alternatives

A. Paper first, post later. `delivery_lines` hold qty, reason, pecah, OK, expiry, Aryo ref as paper numbers (editable, no stock). A "Posting ke stok" action per faktur (or per day) builds `ReturnLineInput[]` from the lines and calls the existing dialog core once, writing `delivery_line_id`. Until posted, every mistake is an edit; the import is pure data; the export fills from lines; stock accuracy arrives at posting. Gives up: real-time stock on save (which has been zero since 14 Oct anyway) and adds one tap. Gains: F1 solved without a new RPC, F2 reduced to one consumer, F8 becomes safe. This is the lowest-risk Phase 2 and still "one place".

B. Keep the hypothesis, open the existing `RecordReturnDialog` prefilled and locked to one SKU instead of an inline form. Gives up: the pecah-only form shape. Gains: zero duplicated cap/unit/outbox logic; `void_return` is still needed for F1.

C. Delete rather than extend: no `delivery_log` view, no `open_delivery_items`, badge and flags from tables plus `deliveryFlags.ts`. Gives up nothing visible.

## 5. Recommendations on section 5 open questions

1. Direct versus dialog: direct form is fine only if the resolution/cap/conversion/submit core is extracted and shared (F2). If that is not in scope, open the dialog prefilled. Extend `purchase_orders` with egg outflow ids so the delivery page never walks activity logs by name.
2. Keying: DB unique on `(delivery_id, sku_code, coalesce(reason,''))`; no UI merge code (F14).
3. Aryo reference: text on `delivery_lines` with a normalized generated column; no `return_claims` until a status is used (F9).
4. Import: a script, run once, idempotent through deterministic return-line ids; store-side data first, warehouse-to-stock as a separate decision (F8). No admin button.
5. Tukar guling: record the return, write the note; no replacement link column. The replacement is a new PO and already visible by buyer and date.
6. Kurang / Revisi PO / Masih ditanyakan: the line exists with no warehouse side; the orange rule skips them; the non-physical set is one TypeScript constant in `deliveryFlags.ts` (F5, F7). State that "kurang" never adjusts stock.
7. Expiry remap: no code list; substring match on the normalized base pack code; default row is data; unique index (F10).

## Phase 1 leftovers: keep, replace, delete

- `open_delivery_items`: delete; badge from tables (F5).
- `deliveryFlags.ts`: keep as the single flag source; add line flags.
- Header badge: keep; change its query.
- `expiry_rules` seed: keep rows; rename column to `sku_match`; pattern semantics; unique index (F10).
- Export columns 9-22: fill, but cut to the sheet's 21 with exact headers; drop `piecesRetak` from `DeliveryLogRow`; mark the file as transition (F6).
- `useDelivery.ts` snapshot refresh-on-save: do not extend the pattern to lines.
- `delivery_log` SQL view (full spec): do not build.

## Files cited (absolute)

- C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\feature_concept.md (sections 2, 3, 4, 5)
- C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\sheet_excerpts.md (line 9 header row)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260904000000_returns.sql (lines 38-42, 185-230)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261008000000_returns_sku_code.sql (lines 32, 59-61, 79-83)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261021020000_correct_order_guards.sql (lines 97-102)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261022010000_buyer_profiles.sql (lines 18-43)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261029000001_deliveries.sql (lines 12-13, 29, 50-66)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261029000002_expiry_rules.sql (lines 28-39)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\RecordReturnDialog.tsx (lines 127-147, 263-276, 283-307, 316-388)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\GroupedActivityLog.tsx (lines 376-381)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\catalog\SKUList.tsx (lines 127-129)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\catalogDependencies.ts (lines 12-32)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\deliveryExport.ts (lines 23-46)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\deliveryFlags.ts (lines 63-86)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\orderCorrection.ts (line 6)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\returnsCap.ts (line 12)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDeliveries.ts (lines 20, 109-130)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDelivery.ts (lines 45-56, 127)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\docs\superpowers\specs\2026-10-29-delivery-return-log-full.md (lines 117-137, 187-199)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\docs\uuid-migration\PLAN.md (lines 3-8)
- C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\CLAUDE.md (lines 38-44, 48, 56-59)
