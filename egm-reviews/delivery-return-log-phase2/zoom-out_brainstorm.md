# Raw report: Contrarian / YAGNI Brainstormer (egm-zoom-out)

Agent id: ace1e467d538b9edd · Mode: BRAINSTORM · Date: 2026-11-01 · Status: completed
Input: feature_concept.md, sheet_excerpts.md, worktree CLAUDE.md, the section 6 files and the Phase 1 intermediate_zoom_out_report.md. Text below is verbatim as handed back.

---

# Zoom-Out (Contrarian / YAGNI) brainstorm report: Delivery & Return Log, Phase 2

Review status: complete. Every file in concept section 6 that bears on this lens was read; the two `correct_order` migrations and `QuickOutflowBuilder`/`PickListDialog` were skimmed through `src/lib/orderCorrection.ts` only, since the concept rules out `correct_order` for returns.

## 1. Verdict

The hypothesis fixes the right thing (the stock write happens inside the form admin fills anyway) but carries about twice the machinery the root problem needs. The store-side line table is justified: 13 of 108 return rows have no physical return and the warehouse count lags the store line by up to two days, so `returns` alone cannot hold a line that does not exist yet. Everything hung on that table is where the fat is: a `returns.delivery_line_id` FK plus a full `record_return` redefinition that no read path needs, a 22-column export with an unnamed reader whose column semantics do not match the sheet, flags pushed into the Header badge view, an expiry resolver with a SKU remap for a seed that nothing reads, a third "retak" bucket, two paraf-gudang fields for a sheet column that was empty on all 178 rows, and a stock-mutating one-time import that the project's own spec (Phase 4) deliberately avoided. The smallest Phase 2 is one lean table, one direct RPC call reusing four existing helpers, two list chips, and an editable expiry defaulting from the four buyer-level rules already seeded. No RPC change, no view change, no import.

## 2. Findings

### F1. `returns.delivery_line_id` and the `record_return` redefinition buy nothing a read path uses
Severity: Major. Dimension: YAGNI / code minimisation.
Challenge: the concept says the FK makes "stock, the activity feed and the log agree". The feed already attributes a pooled-egg return to its order line through `(outflow_id, sku_code)`: `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\usePriorReturns.ts` lines 11-13 and 57-60 (`bySku`), consumed by `GroupedActivityLog`. The delivery detail will have resolved the PO's egg outflow ids anyway (it must, to call `record_return`), so `usePriorReturns(ids).bySku[skuCode]` gives it OK/R/H per SKU for free. The only case the FK distinguishes is two store lines on the same SKU that both physically return, which in October is one row pair (2610421 "N 30" / "N30", a typo of one item). Since the direct call is one RPC per store line, `returns.reason` (per call, `supabase\migrations\20261008000000_returns_sku_code.sql` line 32) carries the line's reason and separates even that case.
Cost of keeping it: a 160-line `create or replace` of the stock-critical RPC for one nullable column, under the deploy model where phones keep old bundles (`CLAUDE.md` line 9). `returns` has a select-only policy (`supabase\migrations\20260904000000_returns.sql` lines 39-40), so a client-side `update returns set delivery_line_id` is not an option either; the FK forces the RPC change.
Alternative: no change to `returns` or `record_return`. Link by `(outflow_id, sku_code)` through `usePriorReturns`, exactly as the feed does. Returns recorded from the Activities card (today's path) then count for the delivery line automatically, which the full spec's §5.3 wanted to build separately.

### F2. The dialog cannot be prefilled and its per-bucket clamp fights "OK = remainder"; call the RPC directly but extract two helpers first
Severity: Major. Dimension: Codebase reuse.
Evidence: `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\RecordReturnDialog.tsx` props (lines 35-48) have no initial-values prop; the reset effect (245-257) wipes every row to `EMPTY_LINE` on open; `setBucket` (286-307) clamps each bucket to `max − other buckets`, so a prefilled OK = total leaves zero room to type pecah until OK is lowered by hand. It also renders every PO line (169-201), not the one store line. So reusing the dialog as-is means a different interaction from the one the concept wants.
What a direct call must not re-implement: (a) eggs per SKU including box capacity, which lives only inside the dialog's `skuMap` memo (127-147; `resolveBoxLine` in `src\lib\outflowCalculator.ts` 99-115 does the same math on an `OrderLine`); (b) the pieces-to-native emit loop with the running native remainder (321-358), which exists because `piecesToNative` rounds to 2 dp and two lines (restock + retakan) on a kg egg can otherwise exceed the server cap by 0.01 and get `RETURN_EXCEEDS_OUTFLOW` (RPC lines 72-76, eps 1e-9). Everything else is already a plain function or hook: `findRelatedEntryId` (`src\hooks\useVoidEntry.ts` 152-204), `callRecordReturn` (`src\lib\returnRpc.ts` 15-47), `piecesToNative`/`nativeToPieces` (`src\lib\returnsCap.ts`), `usePriorReturns`.
Alternative: move `skuMap` and the emit loop into `src\lib\returnsCap.ts` (or next to `resolveBoxLine`), have the dialog import them, and have the delivery detail call the same two functions plus `callRecordReturn`. The per-bucket UI clamp is UX only; the server cap is the guard, so the detail can skip the clamp and surface the server message. Skip the offline outbox on this path: `/deliveries` is online-only by Phase 1 decision, replay is mounted only on `src\pages\Index.tsx` line 66, and `record_return` is idempotent per line id so a plain retry is safe.

### F3. The one-time October import is a stock-mutating backfill the spec itself ruled out, and the cheapest options are not scripts
Severity: Major. Dimension: Contrarian / YAGNI.
Evidence: full spec §11 Phase 4 (`docs\superpowers\specs\2026-10-29-delivery-return-log-full.md` lines 312-313) imports store-side rows and claims only and says "Warehouse pieces are not imported into returns". The concept reverses that: ~21,000 Butir OK restocked into FIFO batches that are weeks old by launch. What the script needs: a CSV parser (none installed, `package.json` dependencies 16-58; `exceljs` only), a customer remap ("OSV Depok" → buyer + DC), an item remap that is customer-dependent (sheet "N 30" is 150 eggs for Osave and 30 for Astro, concept §1 and sheet excerpt observations), faktur matching with 13 typos and 3 shared refs (concept §2), per-faktur outflow-id resolution through `activity_logs`, inference of Butir OK on the 43 of 108 rows where the sheet left it blank, skipping 12-14 Oct rows that the owner already back-entered (double-count risk), and a dry-run report. That is several hundred lines of one-off code for 108 fakturs, and if any count-based stock correction has been or will be applied after the 23-31 Oct physical counts, the restock double-counts on top of it.
What each option gives up: (a) owner back-enters in the new UI as on 13-14 Oct: ~108 fakturs at one number each, maybe two hours, and it dogfoods the form; gives up nothing except his time. (b) a stock count: `stock_counts` records a count and does not adjust stock (spec `2026-08-20-physical-stock-count-design.md`), and `reconcile_inventory` is a drift report (`supabase\migrations\20260914020000_reconcile_and_returns_aware_recalc.sql` 22-42); so "a count" means one manual inflow per egg product on launch day equal to the sheet's OK total; gives up FIFO batch provenance for October, which is already stale. (c) start clean: October stays a sheet record; the Klaim tab keeps tracking October's Aryo refs; gives up in-app October history, which no report in Phase 2 reads.
Alternative: (c), with (b)'s one-line inflow if the owner wants the stock number right before the next physical count. Do not build the script or the button.

### F4. Flags belong in list chips, not in the Header badge view
Severity: Major. Dimension: YAGNI / cost.
Evidence: `useOpenDeliveries` (`src\hooks\useDeliveries.ts` 109-130) runs from the Header on every page every 30 s and already regroups `activity_logs` through `purchase_orders`; the predecessor flagged its cost (Phase 1 zoom-out report N7). Putting orange/red in the badge means redefining `open_delivery_items` (`supabase\migrations\20261029000001_deliveries.sql` 50-66) with joins to `delivery_lines` and `returns`, and changing what the number means. The Klaim tab shows 18 of ~59 Osave rows lacking a ref, so the red flag alone would keep the badge permanently lit with a backlog only office admin acts on, at the office, on the list page.
Alternative: two chips in `filterDeliveryItems` (`src\lib\deliveryFlags.ts` 121-136): "Belum diterima gudang" and "Belum ada No. Aryo". For the list to compute them, fetch `delivery_lines` for the range's delivery ids (same shape as `fetchDeliveriesInRange`, 72-84). The badge stays Phase 1.

### F5. The 22-column export still has no named consumer, and its column semantics will not match the sheet Novi checks against
Severity: Major. Dimension: Root-problem focus.
Evidence: Phase 1 review Major A already found the export had no user; the concept now says "Novi's checking habit", without saying what she checks. The sheet has 21 columns with "Butir OK / Butir Pecah"; the built export (`src\lib\deliveryExport.ts` 23-46) has 22 with "Butir Retak" (41) and "Butir Pecah" (42). The concept maps the warehouse's pecah count to disposition `retakan` (§4 "pecah → retakan by default"), so the sheet's "Butir Pecah" numbers would land under "Butir Retak" and "Butir Pecah" would be mostly zero. The one thing in the sheet with an external consumer is the Klaim tab (what Osave/Aryo need: faktur, item, qty, pecah, expiry, ref), and that is a filter on the same rows.
Alternative: decide the column mapping now (retakan prints under the sheet's "Butir Pecah"; drop "Butir Retak" or append a writeoff column at the end), extend `itemToLogRow` (77-104) to one row per line client-side, and do not build the `delivery_log` SQL view or the `pieces_per_kg()` function from full spec §4.7. Consider swapping scope: a Klaim CSV (Osave lines) is more valuable than 22 columns nobody has asked for; see §3 below.

### F6. Expiry: use the four buyer-level rules that already match; drop the SKU remap
Severity: Major. Dimension: YAGNI.
Evidence: nothing reads `expiry_rules` (grep: only the generated types and an unused `ExpiryRule` interface in `src\types\deliveries.ts` 37-43). The seed (`supabase\migrations\20261029000002_expiry_rules.sql` 28-39) has four rows with `sku_code null` (Astro 22, Segari 30, Sayurbox 14, default 30) whose keyword match against `customerLabel(buyer, dc)` works today, and seven SKU rows whose codes match nothing. 59 of 108 return rows are Osave, where the answer is "+30" regardless. Tgl Expired is filled on 98 of 108 return rows, so the field matters (it goes on the Osave claim), but the SKU-level rules change the answer on a minority of Astro/Segari/Sayurbox lines by 1 to 16 days and admin can edit.
Alternative: `expected_expiry` defaults to `delivery_date + buyer-level shelf_days` from the null-SKU rows, shown in a plain `<input type="date">`. The SKU rows get re-keyed in a later one-line `update` migration when someone cares; the resolver stays a ten-line function. No editor UI in Phase 2.

### F7. Two paraf-gudang fields for a column that was empty on all 178 rows
Severity: Nit. Dimension: YAGNI.
Evidence: concept §2: "Paraf Gudang is empty on all 178 rows"; concept §3 introduces both "the user who saves is the paraf gudang" and "Novi's verification is a diperiksa tick". `returns.user_id` (migration 20260904 line 20) already records who saved. The sheet's Catatan Kondisi tick existed to confirm the sorting happened; the save that writes stock is that confirmation.
Alternative: no tick, no extra column. If the export must print a name, one `warehouse_checked_by text` set to the saver's email at save (Phase 1 pattern, `useDelivery.ts` 138) is enough; even that can wait.

### F8. The optional "retak" third bucket is not in the data
Severity: Nit. Dimension: YAGNI.
Evidence: concept §4 "Warehouse entry shape: one number (pecah), OK = remainder, retak optional". The sheet has only OK and Pecah; the owner's back-entry used retakan for pecah; writeoff (H) is unused by the warehouse. A third input brings back the three-bucket grid the concept is trying to leave.
Alternative: one number. Writeoff stays reachable from the Activities dialog for the rare destroyed case.

### F9. Lean the line table to what the sheet actually carries; derive the rest
Severity: Nit. Dimension: Code minimisation.
Evidence: full spec §4.3 (lines 115-139) has 13 columns. `qty_ordered_pack` duplicates the live PO's `packQty` (`purchase_orders.order_lines`, `supabase\migrations\20261022010000_buyer_profiles.sql` line 30), which Phase 1 already prefers over snapshots. `qty_received_pack` is `ordered − returned` on every October row (2610319: 86 + 7; 2610574: 787 + 123). `claim_id` is Phase 3. A `check` constraint on `reason` means every new reason is a migration plus a deploy, under the old-bundle rule.
Alternative: `delivery_lines(id, delivery_id, sku_code, qty_returned, reason text, note, claim_ref, expected_expiry, pieces_pecah, pieces_ok, returned_at, created_at, updated_at)`. Reason is text with a client pick-list of the seven values October used plus "Lainnya". Add a delete policy from day one (precedent: `supabase\migrations\20260820000001_stock_counts_delete_policy.sql`); a mistyped line must be removable, and Phase 1 has no delete anywhere.

### F10. Recorded returns are immutable; the design must say what happens after the pecah save
Severity: Major. Dimension: Contrarian (constraint the concept does not mention).
Evidence: no `void_return`, no update/delete policy on `returns` (grep of migrations: only `returns_select`), and `record_return` is insert-only. Once the warehouse numbers are saved, pecah/OK cannot be corrected from any UI. The concept says OK is "editable" and the orange flag clears on save, but says nothing about the second save.
Alternative: lock pieces fields after the return is recorded (derive "recorded" from `usePriorReturns.bySku[sku].total > 0`, which also blocks a double submit) and show "hubungi admin" for corrections. Name this ceiling in the spec; do not build a void path now.

### F11. The "delivery before loading" rule needs no design, only one omission
Severity: Nit. Dimension: YAGNI.
Evidence: concept §3 last bullet. The only Phase 2 element that would tie lines to loading is pre-seeding lines from `po.orderLines` (full spec §5.2 section 3). Lines created only when admin types a return depend on the catalog SKU code, not on the PO.
Alternative: do not pre-seed. Nothing else to do; `deliveries.delivery_date not null` is Phase 1's business and a packing feature would pass its planned date.

### F12. Required No. Faktur and Sushi Toku as a buyer order are cheap and unrelated to Phase 2's shipping
Severity: Nit. Dimension: Contrarian.
Evidence: gap is 1 PO in 224 (concept §4); old bundles keep writing POs without it (CLAUDE.md line 9). Fine to do; do not let either gate the Phase 2 merge.

## 3. Strongest counter-argument to the hypothesis

Phase 1 digitised two low-information columns and got one test row in two days. Phase 2 digitises the rest of the same sheet, in a form that is slower than a spreadsheet row (open faktur, add line, pick SKU, type qty and reason; come back a day later for pecah; come back again for the Aryo ref). The claim that admin switches rests entirely on one forcing function: the Osave claim needs the pecah count and the Aryo ref, so the line has to be typed somewhere. But the concept defers the Klaim view and billing status to Phase 3, which means the thing that forces the switch (the list Osave/Aryo actually consume) stays in the sheet, and admin has every reason to keep the sheet open. Meanwhile the literal root problem, "returns stopped reaching stock on 14 Oct", has a two-hour fix with zero code: the owner repeats his 13-14 Oct back-entry weekly from the sheet through the existing dialog. If Phase 2 ships without the Klaim list, it is Phase 1 again, with more columns. The scope swap that answers this: drop the 22-column export, ship the Osave claim list (filter chip plus CSV: faktur, item, qty, reason, expiry, pecah, ref) in Phase 2, keep billing status for Phase 3.

## 4. Simplest alternative that still fixes the root problem

One migration: lean `delivery_lines` (F9) with select/insert/update/delete to authenticated. No change to `returns`, `record_return`, `open_delivery_items`, or `expiry_rules`.

Detail page, per faktur: "+ tambah retur" creates a line (SKU from the PO's lines, qty in the PO unit, reason pick-list, note, Aryo ref text, expiry defaulting from the buyer-level rule). A "Barang balik" row per physical-reason line with one input (pecah) and a date; save resolves the egg outflow id with `findRelatedEntryId`, builds restock + retakan lines through the two helpers extracted from the dialog (F2), calls `callRecordReturn` with `reason` = the line's reason and `buyerName` = the PO's buyer, then writes `pieces_pecah`, `pieces_ok`, `returned_at` on the line. Recorded state and the live O/R/H numbers come from `usePriorReturns.bySku[sku]` (same as the feed); fields lock once recorded (F10).

List: two chips (F4), computed from `delivery_lines` fetched for the range; a fixed set `NO_PHYSICAL_RETURN = {kurang, revisi_po, masih_ditanyakan, cancel}` in `deliveryFlags.ts` suppresses the orange flag.

Export: `itemToLogRow` emits one row per line; retakan prints under the sheet's "Butir Pecah" header; plus the Osave claim filter (§3). Client-side only.

Transition: no import. October stays in the sheet; one manual inflow per egg product on launch day if the owner wants the stock number corrected before the next physical count.

What it gives up: a hard FK from a return row to its store line (only matters for two physical-return lines on the same SKU of one faktur, one typo pair in October); the Retak third bucket; Novi's tick; SKU-level expiry rules until re-keyed; October history in the app; the badge counting Phase 2 flags; offline queueing from `/deliveries`.

## 5. Recommendations on the section 5 open questions

1. Direct call, not the dialog, but only after extracting `skuMap` and the emit loop from `RecordReturnDialog.tsx` into a lib so both paths share them (F2). No outbox on this path.
2. No DB unique, no UI merge. Rows have ids, the UI lists them, each is deletable. Two identical (SKU, reason) rows is a user error the delete button fixes; a merge is code for a case that does not occur.
3. `claim_ref text` on `delivery_lines` now. One ref spanning fakturs is the same string on several lines, which is all Phase 3's claim list needs to group on; `return_claims` can be created and backfilled from `select distinct claim_ref` when billing status arrives. Do not create the table now.
4. Neither. Skip the import (F3). If the owner wants October in, he back-enters through the new form, which also tests it.
5. Tukar guling: reason plus note, nothing else. The replacement is a new PO already.
6. Yes, the line exists with no warehouse side, and the orange flag skips those four reasons via one constant in `deliveryFlags.ts`.
7. Drop the remap. Use the four null-SKU rules now; re-key the seven SKU rows later with a one-line update when someone needs them (F6).

Files referenced (absolute):
- `C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\feature_concept.md`
- `C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\sheet_excerpts.md`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\CLAUDE.md`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\docs\superpowers\specs\2026-10-29-delivery-return-log-full.md`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\docs\superpowers\specs\2026-10-29-delivery-return-log-design.md`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\components\RecordReturnDialog.tsx`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\usePriorReturns.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useVoidEntry.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDeliveries.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\hooks\useDelivery.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\returnRpc.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\returnsCap.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\outflowCalculator.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\deliveryFlags.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\lib\deliveryExport.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\types\deliveries.ts`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\src\pages\Index.tsx`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260904000000_returns.sql`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261008000000_returns_sku_code.sql`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261029000001_deliveries.sql`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261029000002_expiry_rules.sql`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20261022010000_buyer_profiles.sql`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260914020000_reconcile_and_returns_aware_recalc.sql`
- `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\supabase\migrations\20260820000001_stock_counts_delete_policy.sql`
- `C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log\intermediate_zoom_out_report.md`
