# Stage 6: Comprehension Test (egm-comprehension, Opus)

**Target:** `design_draft.md` (FeatureRange 1–672, DetailedRange 673–869 at review time) · **Standard:** none (self-containment) · **Date:** 2026-11-02
**Status:** resolved (fixes applied to `design_draft.md` before Stage 7)

## Resolution by the drafting session (Elephant)

Comprehension gaps are not contested (egm-resolve rule). Every finding was fixed except where noted.

| # | Finding | Resolution | Applied change |
|---|---|---|---|
| 1 | No `deliveries` row when the first line is added | PROPOSE FIX | §6.1 / §6.5.5 / file 14: the first line save creates the `deliveries` row through Phase 1's create-on-first-save, then the line, then the RPC (three writes at most); CUJ 1 "Given" no longer assumes the row. |
| 2 | Where non-app rows live after the sheet stops | PROPOSE FIX | §6.7.3 says where each kind goes (loose-egg lines: Activities dialog, no store-side record; TST / bu linda / cash: nowhere, not sales; Sushi Toku: entered as a buyer PO from launch day, the buyer exists; POs without a No. Faktur: the list's hidden count, Edit pesanan within the hour); brief N7 restated in §10. |
| 3 | `lebih` undefined and its rules conflict | PROPOSE FIX | `lebih` and `rusak` defined; `lebih` moved to the no-physical-return set (the surplus was never deducted, so a restock would inflate stock; hint like Kurang); export adds it to Qty Diterima; partial index list and `NO_PHYSICAL_RETURN` updated. |
| 4 | "Warehouse side is filled" undefined; Pecah blank vs 0; store-only saves | PROPOSE FIX | §6.5.5 defines: warehouse side filled ⇔ Pecah non-blank (0 = all OK); store-only saves skip the confirmation; the confirmation appears only when a stock return will be recorded. |
| 5 | Retry vs pre-RPC re-read conflict | PROPOSE FIX | The re-read recognises the form's own return-entry ids: rows with those ids mean the earlier attempt succeeded (treated as success); other rows refuse the save unless "Tambah retur kedua". Terminology fixed (finding 14). |
| 6 | Half-voided state when one of two voids fails | PROPOSE FIX | §6.5.7 / §6.3.2: Riwayat groups the rows of one save (same outflow, SKU, `created_at`); "Batalkan retur ini" voids the retakan row first, then the restock row, stops at the first failure and names the row left; recovery for the half state written (re-record Pecah alone through the Activities dialog). CUJ 4 updated. |
| 7 | 19 Oct + 30 days ≠ 19 Nov | PROPOSE FIX | The sheet's "1 Bulan" is a calendar month (its own rows prove it: 19/10 → 19/11, 23/10 → 23/11, 31/10 → 30/11). `expiry_rules` gains `shelf_months` (exactly one of `shelf_days` / `shelf_months` set); the seed uses months for the "1 Bulan" rows; the resolver adds calendar months (`addMonths`, end-of-month clamped); Tgl Kirim = `delivery_date` = the PO's outflow date. |
| 8 | Recon re-read unexplained; re-entry dates | PROPOSE FIX | §6.10 names the reconciliation export (`v_recon_daily`, the owner's comparison against the 23–31 Oct physical counts); CUJ 7 and rollout step 8 say the re-entry types the sheet's Tgl Barang Balik so the returns land on their October dates. |
| 9 | Full spec unnamed; "Phase 1 F8"; "the concept" | PROPOSE FIX | Full spec linked in the header; "Phase 1 F8" replaced by the open item in words; "the concept" → the brainstorm input, named. |
| 10 | Brief link not on `main`; §10 does not restate every citation; "Q2" ambiguity | PROPOSE FIX | Header says the brief is committed with this spec and that M*/N*/Q* citations are the brief's analysis items (background); "brief Q2" → "brief open question 2"; N7 restated. |
| 11 | Letters A–D overloaded | PROPOSE FIX | Migrations renamed "feature migration" / "void migration"; verification queries V1–V4; owner decisions keep "owner decision A–D". |
| 12 | "No. Retur OSV" grammar; Aryo, JS, Novi, owner undefined | PROPOSE FIX | Glossary rows for JS, Aryo, the owner (Joshua), Novi, Dila and Yani; definition rewritten. |
| 13 | Phase 1 terms without pointers | PROPOSE FIX | A "Phase 1 and project terms" glossary block (`poState`, `duplicatePos`, Header badge / `open_delivery_items`, the Phase 1 chips, the two banners, Terkirim, Edit pesanan, `canCorrect`, retakan child resurrection, PLAN.md classes, the sheet's tabs / row 2 / counters). |
| 14 | "Line" means three things | PROPOSE FIX | "delivery line", "PO line" and "return entry" (RPC input; "return-entry ids") used consistently. |
| 15 | Derived numbers "for the SKU" vs the physical line | PROPOSE FIX | "the physical line only"; non-physical lines never lock, stay deletable, export blank warehouse columns. |
| 16 | Number separators | PROPOSE FIX | Convention stated once in §4 (quoted screen text uses Indonesian separators; prose uses English). |
| 17 | Population counts | PROPOSE FIX | §1 states the sheet's populations once (178 rows, 131 fakturs, 117 item rows, 108 rows with a returned quantity, 108 fakturs matching a PO: the two 108s are different sets). |
| 18 | Faktur-level No. Retur field has no storage; Klaim label | PROPOSE FIX | §6.5.1: the field is not stored; it prefills new lines and "Terapkan ke semua baris" fills lines without a ref; on reopen it shows the shared value or blank. Klaim label fixed. |
| 19 | `quantity_butir` is native | PROPOSE FIX | One sentence in §4.1 (Outflow row) and §6.2.4. |
| 20 | Paraf gudang wording | PROPOSE FIX | "no stored column on `delivery_lines`". |
| 21 | Import name → email / driver mapping | PROPOSE FIX | §6.9 step 6: `pic` and `invoice_checked_by` are free text and take the sheet's name; driver by case-insensitive name match to `drivers`, unknown driver → `driver_name` as typed, `driver_id` null, listed. |
| 22 | Wrong cross-reference | PROPOSE FIX | File numbers corrected. |
| 23 | `data-integrity-reviewer` undefined | PROPOSE FIX | Defined: the repository's Claude Code review agent `.claude/agents/data-integrity-reviewer.md` (read-only; untracked today, committed with this spec). |
| 24 | Test POs voided then used | PROPOSE FIX | Step 1 voids the two stale test POs and says why; step 4 creates a fresh test PO for the old-bundle check; step 5 voids its return (through the new UI) and the PO; V1–V4 exclude it by its ref. |
| 25 | Rollback A after B with the stop rule | PROPOSE FIX | One rollback section: with any voided return, neither migration's function bodies nor the `returns` columns are rolled back (only the frontend, `delivery_lines`, the catalog flags and the seed); otherwise the full ordered list; duplicate step removed. |
| 26 | V1 exceptions; `<launch>` undefined | PROPOSE FIX | `<launch>` = the frontend push time of step 5; V1 filters `sku_code is not null`, excludes the test ref, and its rows are "returns without a line for admin to add", not "expect 0". |
| 27 | 2a / 2b tags; "Delete" | PROPOSE FIX | Files tagged; "no file is deleted". |
| 28 | Undefined names | PROPOSE FIX | `ReturnRow` defined (file 6); `pieces` explained; map output renamed `piecesPerUnit`; SKUDialog's existing `kind` field named; `callVoidReturn` added to file 5. |
| 29 | Ambiguous migration prefix | PROPOSE FIX | Full file names. |
| 30 | Q9 precondition vs open question | PROPOSE FIX | Unanswered Q9 does not block launch; it limits who can void older returns and add drivers. |

## Reviewer report (verbatim)

Comprehension review of C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\design_draft.md

I read all 870 lines. As you instructed, no document standard applies. FeatureRange is lines 1–672 and DetailedRange is lines 673–870 (from `## Detailed Implementation Plan`). Every section can be paraphrased, so there are no Blockers. Findings: 10 Major and 20 Nit.

I spot-checked the references against the read-only `main` copy. Its HEAD is 9ac07a3, which matches line 9. The code references all exist and the line numbers match: `returnsCap.ts`, `activityGrouping.ts`, `GroupedActivityLog.tsx` line 1061, the `RecordReturnDialog.tsx` line ranges, `DeliveryDetail.tsx` line 206, the named migrations, the npm scripts, and the `exceljs` and collapsible dependencies. Three links resolve: Phase 1, per-SKU returns, and buyer profiles. Exceptions are noted in findings 10 and 23.

**What this proposes**

Each faktur's detail on `/deliveries` gets a "Retur" section. There, office admin enters one line per returned SKU:
- **Store side:** quantity in box or pak, a reason from a fixed list, Osave's return number, a note and an expected expiry. These go into a new `delivery_lines` table that never touches stock.
- **Warehouse side:** one count of broken eggs (Pecah, in pieces). On an explicit, confirmed save, the app computes OK = returned pieces − Pecah and calls the existing `record_return` RPC. OK goes back into the original FIFO batches; Pecah goes to the product's RETAKAN item or is written off.

A line counts as warehouse-done when non-voided `returns` rows exist on the PO's egg outflows with the line's `sku_code`. A second migration adds a server-authorised `void_return` (admin, or the author within 48 hours) and makes every reader of `returns` ignore voided rows. Around this, the design adds:
- list chips: orange "gudang belum", red "tanpa No. Retur" for flagged buyers, Klaim, Masih ditanyakan and Kurang
- an export in the sheet's 21 columns and a claim CSV
- a one-off script that imports October's store-side sheet rows
- stopping the Google Sheet for new rows from launch day

**How the existing system works, per this document**

There is no PO table. A PO is a regrouping of `activity_logs` rows in the `purchase_orders` view, and its only business key is the faktur number. Recording a PO deducts stock from FIFO inflow batches through one `outflows` row per egg product.

Today returns can only be entered from `RecordReturnDialog` on an Activities order card. It calls `record_return`, which writes `returns` rows keyed by (`outflow_id`, `sku_code`) with three dispositions, capped at what was sold:
- restock, through `return_restocks`, back into the original batches
- retakan, as a new inflow on a RETAKAN child item
- writeoff

Negeri eggs are stocked in kg and converted at 15.5 pieces per kg.

Phase 1 added `drivers`, `deliveries` (one per faktur), `expiry_rules` and the `/deliveries` page. Nobody adopted it: admin still keeps the Google Sheet, and no return has reached stock since 14 Oct. Old PWA builds keep running until the user taps the update toast. Stock consistency is checked by `reconcile_inventory()` and the `v_recon_ledger` view.

---

## FeatureRange (lines 1–672)

**1. Severity: Major**
**Affected scope:** §6.2.1 (`delivery_id … not null`), §6.5.5 step 1, CUJ 1 "Given", §1 ("production holds one test delivery row"). Also DetailedRange file 14 (`upsertLine`).
**Discrepancy:** Every save starts by upserting a `delivery_lines` row, and that needs an existing `deliveries` row. The document never says what happens when the faktur has none. By its own §1, that is nearly every faktur at launch. The linked Phase 1 spec creates the row on the first edit of the detail. This document doesn't say whether "Tambah baris retur" or Simpan creates it, or how that fits "two writes, two transactions" (§6.1), which would become three. Only the import (§6.9 step 6) creates `deliveries` rows, and file 14 lists no parent-creation step.

**2. Severity: Major**
**Affected scope:** "Replaces" (line 7), §2 last paragraph, §2.1 item 4, Non-goals lines 59–61, §6.7.3.
**Discrepancy:** The sheet stops for new rows on launch day, but the document keeps several kinds of rows outside the app:
- loose-egg PO lines (Activities dialog only, no delivery line)
- non-PO rows: TST, Sushi Toku, bu linda, cash
- POs without an `invoiceRef`, which have no key and so cannot appear on `/deliveries`

It never says where the store-side record of these lives once the sheet stops. The linked Phase 1 spec made "invoiceRef required" (its Q2) the gate for retiring the sheet. This document calls it "unrelated, not gating this merge" and cites brief N7, which §10 does not restate, so a reader can't see why the gate was lifted.

**3. Severity: Major**
**Affected scope:** reason `lebih`: §4.3 table, §6.5.3 second bullet, §6.7.1 "Qty Diterima".
**Discrepancy:** Lebih is the only reason with special rules, and the glossary doesn't define it. Line 78 covers Kurang, Ditolak, Tukar guling, Revisi PO, Masih ditanyakan and Cancel, but not Lebih or Rusak. Its three rules conflict:
- (a) It is a physical return, so the line stays orange until a warehouse save.
- (b) A quantity above what was sold is expected for lebih (no warning). But the warehouse save is blocked whenever quantity × pieces per unit exceeds sold pieces, so such a line can never leave orange.
- (c) The export adds the quantity to Qty Diterima. That reads as "the store kept extra goods", which contradicts "goods came back".

The stock meaning is also missing: were the extra eggs ever deducted?

**4. Severity: Major**
**Affected scope:** §6.5.1 Save bullet, §6.5.4, §6.5.5 step 2, CUJ 2, CUJ 3.
**Discrepancy:** Whether a save moves stock depends on "the warehouse side is filled", which is never defined. Tgl Barang Balik always has a default, so it must mean Pecah is non-blank. That leaves unstated:
- that Pecah blank (warehouse not done) and Pecah 0 (all OK, restock only) behave differently;
- whether a store-only save goes through the confirmation dialog. Examples: CUJ 2's first visit, CUJ 3 Kurang, editing a note on a locked line. §6.5.4's template always shows Pecah, OK and Tgl Barang Balik.

**5. Severity: Major**
**Affected scope:** §6.1 last paragraph, §6.4 paragraph after the bullets, §6.5.5 steps 2 and 4.
**Discrepancy:** The two retry mechanisms conflict.
- §6.1 and §6.4: a retry after a timed-out success is a server no-op, because the same ids are reused.
- Step 2: re-read the SKU's returns before every RPC call, and refuse when returns exist "that the form did not know about".

After a timed-out success, those returns exist and the form only saw a NETWORK error. The retry is therefore refused with "Retur untuk <SKU> baru saja dicatat orang lain" (recorded by someone else) and never reaches the idempotent RPC. The document doesn't say whether the re-read excludes the form's own pending ids. In §6.1, "the same line ids" could also mean either `delivery_lines.id` or the `ReturnLineInput` ids (see finding 14).

**6. Severity: Major**
**Affected scope:** CUJ 4, §6.3.2, §6.5.7.
**Discrepancy:** One warehouse save writes up to two `returns` rows (restock and retakan). A void reverses one row per call, and each call can fail on its own: `RESTOCK_CONSUMED`, `RETAKAN_INFLOW_MISSING`, or the 48-hour window. CUJ 4 covers only "the retakan void is refused". It doesn't describe the half-voided state:
- the OK eggs are already taken back out of stock;
- the line is still warehouse-done and locked;
- re-entering Pecah needs "Tambah retur kedua".

It also gives no recommended void order and no recovery steps.

**7. Severity: Major**
**Affected scope:** CUJ 1 "Then" (expiry 19 Nov), §6.5.1 mockup (19/11/2026), §2.1 item 3, §6.2.7, §6.8.
**Discrepancy:** The rule is Tgl Kirim + shelf days, and Osave falls to the 30-day default row. PO 2610319 is dated 19 Oct, and 19 Oct + 30 days = 18 Nov, not 19 Nov. One of three things is true:
- the example is wrong;
- Tgl Kirim is not the PO date (`delivery_date` in §6.8 is never defined here);
- "1 Bulan" means a calendar month. File 11's "30-day month arithmetic" can be read either way.

Both the acceptance criterion and the mockup contradict the rule.

**8. Severity: Major**
**Affected scope:** §6.10 "Re-entry … moves the recon days", CUJ 7 "Then", CUJ 2, §6.9 step 5. Also DetailedRange rollout step 8.
**Discrepancy:** The rule "do the re-entry before the 23–31 Oct counts are re-read" depends on an activity the document never explains. Who re-reads which counts? Why 23–31, when the re-entry covers 15–31? The rule also assumes the re-entered returns carry October dates. But CUJ 7 sends admin "through CUJ 2", and CUJ 2 sets Tgl Barang Balik to the day of entry. Only §6.9 step 5 hints that admin should type the sheet's date. That choice decides whether the recon days change at all.

**9. Severity: Nit**
**Affected scope:** line 4; §7 rows "Open RecordReturnDialog prefilled" and "Import October's warehouse counts"; §6.2.7; §2.1 heading.
**Discrepancy:**
- "The full spec" (§4.3, §4.4, §4.7, §11, §5.2.4, "Phase 4") is never named or linked, yet the status line gives this document precedence over it. It resolves to `2026-10-29-delivery-return-log-full.md` only by guessing.
- "Phase 1 F8 closed" matches no item in either Phase 1 document.
- "The concept" in §2.1 is undefined: whose four sentences are these?

**10. Severity: Nit**
**Affected scope:** line 6 and brief citations throughout.
**Discrepancy:**
- The brief link doesn't resolve on `main`. The file exists only uncommitted in the working copy, so it must be committed in the same change.
- Line 6 says §10 restates every cited decision. But these never appear in §10: brief N2, N4, N6, N7, N8, M4, M6, M12, Q2, and the sections "In-Scope Goals", "Out-of-Scope Non-Goals" and "Staging". Usually the surrounding text carries the content; N7 is the exception (finding 2).
- "Brief Q2" (§6.2.1) and "Phase 1 Q2" (Non-goals) are different questions with the same label.

**11. Severity: Nit**
**Affected scope:** §2 paragraph 2, §6.2.2 heading, §7 "One migration…", DetailedRange "Launch verification queries".
**Discrepancy:** The letters A–D each name up to three things: owner decisions (brief A–D), migrations A and B, and verification queries A–D. Line 23 has "(B)", "(A)" and "(brief A)" in one sentence. "Brief D" (the import decision) also reads like one of D1–D19.

**12. Severity: Nit**
**Affected scope:** §4.1 "No. Retur OSV"; names.
**Discrepancy:** The definition's second clause, "the person Aryo compensates JS for them", is ungrammatical. "Aryo" and "JS" are undefined, so a reader can't tell why the export header is "No. Retur ARYO". Novi's role is never stated; she only downloads the claim CSV. That "the owner" is Joshua is only implied (§10 row 15).

**13. Severity: Nit**
**Affected scope:** Phase 1 and other project terms used without a gloss.
**Discrepancy:** Phase 1 is linked as background, but these terms are never pointed to a section:
- `poState` and its values ok / voided / missing (§6.5.3, §6.5.8)
- `duplicatePos`
- the Header badge and `open_delivery_items` (§6.6, §7)
- "the Phase 1 three" chips (§6.6)
- the "PO dibatalkan" and "tidak cocok dengan PO" banners
- the Terkirim status
- "Edit pesanan" (presumably `correct_order`'s UI)
- `canCorrect` (§6.3.2)
- "retakan child resurrection" (§6.3.1)
- PLAN.md "class R" (file 27)

The sheet's structure is likewise only described in passing: main tab, Klaim tab, "Panduan 7", "row 2", counters 1–3.

**14. Severity: Nit**
**Affected scope:** §4.1 "Delivery / line" compared with how "line" is used.
**Discrepancy:** "Line" means three things:
- a `delivery_lines` row (the glossary meaning)
- a PO order line ("returned PO line")
- an RPC input line ("record_return call with two lines", "line ids", "Line building")

The idempotency explanation in §6.1 and §6.4 depends on which ids are meant. Use three distinct terms.

**15. Severity: Nit**
**Affected scope:** §6.2.1 last rule; §6.7.1 rows Tgl Barang Balik, Butir OK, Butir Pecah, Paraf Gudang.
**Discrepancy:** §6.2.1 says the derived warehouse numbers belong to the one physical line. But the lock rule and the export columns are keyed "for the SKU". Read literally, a Kurang line next to a Pecah line on the same SKU (the 2610382 / 2610556 case) would become undeletable. Its export row would also repeat the Pecah line's counts. That contradicts CUJ 3's "warehouse columns blank" and would double-count in the archive. Say "the physical line only".

**16. Severity: Nit**
**Affected scope:** §1, §5, §6.4, file 3.
**Discrepancy:** Numbers switch between English separators ("3,549", "21,000", "70.19 kg") and Indonesian ones ("1.088", "15.480", "3.549") without saying so. Examples: "1.088 ÷ 15.5" in CUJ 1, and "15.480 pieces against 998.71 kg" in file 3. State the convention once.

**17. Severity: Nit**
**Affected scope:** population counts in §1, §4.3, §7, CUJ 6, CUJ 7, §6.9.
**Discrepancy:** The same numbers count different units, and nothing says whether they are the same set:
- 178 rows (§1) and 117 October rows (§4.3)
- "13 of 108 October return rows" (§7) vs "108 matched fakturs, 13 unmatched" (CUJ 7)
- "18 rows" vs "18 faktur"
- re-entry for 15–31 Oct vs uncounted OK eggs for 17–31 Oct

**18. Severity: Nit**
**Affected scope:** §6.5.1 Store fields, CUJ 1, §6.6 Klaim row.
**Discrepancy:** The faktur-level "No. Retur OSV" field has no storage. `deliveries` gains no column, and file 14 shows the field is a bulk fill of lines that have no ref. It's unclear which save triggers "fills every line … on save", and what the field shows when the faktur is reopened. Separately, the Klaim chip is said to show a row count and a pecah total, but its label (§6.6, file 20) is only "Klaim · <n> baris".

**19. Severity: Nit**
**Affected scope:** §6.2.4, §6.3.2.
**Discrepancy:** `quantity_butir` and `remaining_butir` hold native units (kg for Negeri), as "sold native quantity" and the 998.71 kg test imply. Everywhere else the document uses "butir" to mean pieces. One sentence would prevent a 15.5× misreading.

**20. Severity: Nit**
**Affected scope:** Non-goals "a 'paraf gudang' column equal to the saver" and §10 row 18, vs §2.1 item 2 and §6.7.1.
**Discrepancy:** Side by side, "no paraf gudang column equal to the saver" and "the export prints the saver's email under Paraf Gudang" look contradictory. Say "no stored column on `delivery_lines`".

**21. Severity: Nit**
**Affected scope:** §6.9 step 6.
**Discrepancy:** The import fills PIC, the driver "by name", and "Paraf Admin → invoice_checked_by = the PIC" from names in the sheet. The linked Phase 1 schema stores `pic` and `invoice_checked_by` as user emails and `driver_id` as an FK. The document doesn't say how names map to emails or drivers, or what happens with a driver it doesn't recognise.

**22. Severity: Nit**
**Affected scope:** §6.5.5 step 5, "(Detailed Implementation Plan, file 26)".
**Discrepancy:** Wrong cross-reference. The locale files are file 25; file 26 is the import script.

**23. Severity: Nit**
**Affected scope:** §6.3 intro, §8, DetailedRange file 1b and rollout step 2.
**Discrepancy:** The "`data-integrity-reviewer` agent" is the merge gate for migration B. It is not defined or linked, and nothing by that name exists in the repository. A new engineer can't tell what it is or how to run it.

## DetailedRange (line 673 to end)

**24. Severity: Major**
**Affected scope:** Rollout checklist steps 1, 4, 5 and 9.
**Discrepancy:**
- Step 1 voids the two test POs. Step 4 then records an old-bundle return "on a test PO", which `record_return` would refuse on a voided outflow (`OUTFLOW_VOIDED`).
- Step 5 expects that return to "show on its delivery line and clear orange". That needs a `deliveries` row and a physical delivery line for that SKU, and no step creates them.
- The test return moves real production stock, and no step voids it or keeps it out of the step 9 queries.
- Nothing says why the test POs must be voided; decision 6 only cites brief D6.

**25. Severity: Major**
**Affected scope:** Rollback, migration B step 2 vs migration A step 4.
**Discrepancy:** B's stop rule keeps B whenever a return has been voided, because older `record_return` bodies would re-count voided restocks. But A's rollback is ordered "after B", and its step 4 puts back the pre-A `20261008000000` body of `record_return`. That brings back exactly the drift the stop rule prevents. The plan doesn't say whether A may be rolled back, fully or partly, while B is kept. Also, step 2's "roll back the frontend only" repeats step 1.

**26. Severity: Major**
**Affected scope:** Launch verification query A; the `<launch>` placeholder.
**Discrepancy:** Query A expects 0 rows: every non-voided return on a logged faktur must match a delivery line by `sku_code`. The FeatureRange allows several exceptions:
- loose-egg returns, which have a null `sku_code` (non-goal; CUJ 5 "retur tanpa baris"). `dl.sku_code = r.sku_code` never matches null.
- old-bundle returns recorded before admin adds the line (CUJ 5)
- the test return from step 4

`<launch>` is never tied to a checklist step: migration B applied, frontend pushed, or the step 10 switch? Queries A and D give different results depending on the choice. D needs a start time at or after migration B.

**27. Severity: Nit**
**Affected scope:** opening paragraph of the plan.
**Discrepancy:** Phases 2a and 2b are introduced, but no file or step is tagged with either. The plan says each file is "marked Create, Modify or Delete", but none is Delete.

**28. Severity: Nit**
**Affected scope:** files 2, 5, 6, 15, 21.
**Discrepancy:** These names and types are undefined or misleading:
- `ReturnRow` (files 6 and 15) does not exist in the codebase, while file 5 extends `ReturnRecord`. Is it the same type or a new one?
- `ReturnRowInput.pieces: boolean` is unexplained.
- `buildSkuEggMap` returns pieces per box under the name `eggsPerPack`, the same name §4.4 warns is a placeholder 1 on box rows.
- File 21's "default box for kind 'box'" uses the SKU dialog's `kind` field, which is never introduced.
- `voidReturnErrorCode(result: ReturnSubmitResult)` assumes a void caller that returns a `ReturnSubmitResult`, and no file specifies one.

**29. Severity: Nit**
**Affected scope:** file 1b (7) and rollback step 3, "the `20261029000000` body".
**Discrepancy:** Two migrations share that prefix: `20261029000000_drivers.sql` and `20261029000000_recon_views.sql`. Give the full file name.

**30. Severity: Nit**
**Affected scope:** rollout step 2 vs §9 Q3.
**Discrepancy:** Granting the Phase 1 Q9 admin roles is a checklist precondition, but §9 lists the question as still open. The checklist doesn't say whether an unanswered Q9 blocks launch or only limits who can void a return.
