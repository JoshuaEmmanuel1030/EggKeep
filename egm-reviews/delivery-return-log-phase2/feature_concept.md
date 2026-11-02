# Feature concept for Goldfish brainstorm: Delivery & Return Log, Phase 2 ("Retur per faktur")

**Date:** 2026-11-01 · **Owner:** Joshua (business owner) · **Mode:** BRAINSTORM (concept, no design doc yet)

This file is the complete input. Reviewers have no chat history. Everything below was gathered on 2026-11-01 from the live database, the Google Sheet admin fills today, and the repository.

## 1. Business context (read this first)

- **EggKeep** is a React/TypeScript + Supabase PWA used by an Indonesian egg distributor (JS). One warehouse, 40+ staff on phones, 7 to 10 buyer orders a day, delivered by own drivers into retail distribution centres (Osave, Segari, Astro, Sayurbox, Family Mart, CircleK).
- **Purchase Order (PO)** in EggKeep = a buyer order recorded **at loading**. Recording it deducts stock (outflow). There is no PO table: the `purchase_orders` view regroups `activity_logs` rows by metadata. Its only business key is the **No. Faktur** (`invoiceRef`, the invoice number admin also types into the accounting system, Peachtree). PO lines are pack SKUs with a pack quantity, e.g. `{"skuCode":"OSVN10B","packQty":18}`.
- **Stock is kg-native for Negeri eggs** (count-sold eggs are in pieces). Column names `quantity_butir` hold the native unit. Never convert kg to pieces when storing stock. Returns convert pieces to kg at a flat 15.5 pieces per kg (`src/lib/returnsCap.ts`) for entry only.
- **Returns pipeline (live since 2026-09):** `record_return(p_return jsonb)` RPC, atomic, idempotent per client line id, capped per outflow at the quantity sold. Three dispositions per line: `restock` (OK, back into the original FIFO batches), `retakan` (cracked, sellable, goes to a child item "<PRODUCT> (RETAKAN)"), `writeoff` (gone). Entry is **per order line in pieces**, in `RecordReturnDialog`. Rows carry `sku_code` (display) and `buyer_name`.
- **Order edit (`correct_order` RPC):** voids the original outflow rows and inserts corrected ones (`corrected_by_log_id`). Meant for loading mistakes. In October 2026, 7 POs were edited this way and 41 voided outright.
- **Phase 1 of this feature is merged to `main` and live since 2026-10-30** (PR #15): tables `drivers`, `deliveries`, `expiry_rules` (seeded, unused), view `open_delivery_items`; page `/deliveries` with list + detail (sections "Pengiriman" and "Faktur balik"), Header badge, order-card chip, drivers in Catalog, CSV export in the sheet's 22-column layout with columns 9 to 22 blank. `deliveries` is keyed by normalized `invoice_ref`, created on first save.
- **Catalog units that matter:** Osave box SKUs `OSVN10B` / `OSVN10O` are boxes of 18 packs of 10 (180 eggs); `OSVKP6O` is a box of 20 packs of 6 (120 eggs); `N30B` has `eggs_per_pack = 150` (a 5-tray box); `N30O` = 30. Box capacities live in `item_types.box_capacities` keyed by SKU code.

## 2. What happens today (facts, not assumptions)

### The Google Sheet "Log Pengiriman & Retur" (read in full, 178 rows, 131 fakturs, 12 to 31 Oct 2026)

- Tabs: `Pengiriman & Retur` (main, 21 columns in 5 groups: PENGIRIMAN, FAKTUR BALIK, PENERIMAAN TOKO per item, GUDANG barang balik, KLAIM RETUR OSV), `Klaim Retur OSV` (auto-filtered view of Osave return rows: 18 rows without a return number, 60 "not yet billed", 3,549 broken eggs not yet billed), `Daftar` (pick lists: customers, items with "isi per pack", drivers, statuses, reasons), `Aturan Expired` (shelf-life rules per customer keyword and item), `Panduan` (filling rules).
- **Every row is typed by office admin**: PIC is Dila (117 rows) or Yani (61). The column "Paraf Gudang" is empty on all 178 rows. "Paraf Admin" and "Catatan Kondisi" are checkboxes; the Catatan one is Novi's tick that the warehouse sorting really happened.
- **Status Kirim is "Terkirim" on 173 of 178 rows.** "Tgl Faktur Balik" is filled on 177 rows, median 1 day after delivery (p90: 3 days). These two Phase 1 columns carry almost no information.
- **The content is the return lines.** 117 rows name an item; 64 of 131 fakturs have at least one return line; 108 rows have "Qty Retur (pack)" > 0. Reasons: Pecah 73, Ditolak 11, tukar guling 11, Kurang 10, one each of "Pecah 19,kurang 2", "Masih ditanyakan", "Cancel", "Revisi PO". The same SKU can appear twice on one faktur with two reasons.
- **Warehouse side on those 108 return rows:** "Tgl Barang Balik" 81, "Butir OK" 65, "Butir Pecah" 76, "Tgl Expired" 98, "No. Retur ARYO" 43, "Status Tagihan" 0. Median 1 day between delivery and barang balik (p90 3 days; owner says up to two days).
- **Osave counts in boxes, and the warehouse count is a split of a known total.** With the sheet's own "isi per pack" (N10 = 10) the sheet's yellow rule flags 42 of 59 Osave return rows. With the catalog box sizes (180 / 120 / 150), `Butir OK + Butir Pecah = Qty Retur × box capacity` **exactly** in almost every Osave row (e.g. faktur 2610319: N10 7 boxes → 1,088 OK + 172 pecah = 1,260 = 7 × 180). The owner confirmed: the warehouse counts only the broken ones; the rest is OK and goes back to stock, for every customer.
- **Owner's description of the physical flow:** a return means the faktur is revised from n to n−m (in Peachtree only; nobody edits the EggKeep PO for this). The returned boxes are sorted in the warehouse **in front of the admin who types**, into OK and cracked. OK goes back to stock. Cracked eggs are billed to **Aryo** (a person who compensates JS for breakage; "No. Retur ARYO" is his reference number) and some are reprocessed into pasteurized egg yolk (not a catalog item yet). Sometimes returned goods land at "TST" (the group's own site) before reaching the warehouse.
- **Sheet vs EggKeep POs for 12 to 31 Oct:** 108 fakturs in both; 23 sheet-only, of which 10 are non-PO rows (TST own-use ×5, Sushi Toku ×2, "bu linda", "Cash/Tunai", one "TST Sayurbox") and 13 are buyer fakturs whose number matches no PO (typo on one side or PO not entered); 49 POs not in the sheet (mostly 12 to 16 Oct, before the sheet started, plus two test POs "TEST-Complete" and "TEST2" that exist in production). Three invoice numbers are shared by two POs each. Sushi Toku is a real buyer but is entered in EggKeep as a cash sale, so it never reaches `purchase_orders`.
- **Expiry rules in the sheet** (customer keyword / item / days): Astro 22 (N15 21, N 30 21, AMTG 14); Segari 30 (AMTG 14); Sayurbox 14 (P 25 21, KP 6 30, N4 30); default 30. Osave has no rule (default 30 applies; the Klaim tab shows Tgl Expired = Tgl Kirim + 30 for Osave). The seed in `expiry_rules` uses the sheet spellings, which match almost no EggKeep SKU code.

### The live database

| Fact | Value |
|---|---|
| POs in the last 30 days | 224 (223 with a No. Faktur); Osave 112, Segari 55, Astro 40, Sayurbox 8, Family Mart 7, CircleK 2 |
| `returns` rows ever | 136 lines on 75 outflows, dated 30 Sep to 14 Oct, **all entered by the owner on 13 and 14 Oct** (a back-entry from the sheet); none since |
| Returned eggs re-entering EggKeep stock since 14 Oct | none (no returns, no matching inflows), while the sheet logged ~21,000 "Butir OK" for 17 to 31 Oct |
| `deliveries` rows since Phase 1 went live | 1, created by the owner on 30 Oct (a test) |
| `expiry_rules` rows | 11 (seed), nothing reads them |
| Physical counts 23 to 31 Oct | system stock far above counted stock for Puyuh and Kampung (out of scope here; the missing returns push the other way) |

**Conclusion the hypothesis rests on:** the warehouse has never used the return dialog or the deliveries page, and will not. Admin types everything, at the office, while the sorting happens in front of them. Phase 1 digitised the two columns with no information in them, so nobody switched.

## 3. Anchored hypothesis (what Phase 2 is)

Phase 2 makes the delivery detail on `/deliveries` the single place where admin logs a faktur's returns, and **that entry is the stock return**.

Per SKU line of the faktur:
1. **Store side** (typed from the faktur the driver brings back, same day): quantity sent back **in the PO line's own unit** (Osave boxes, packs elsewhere, from the PO's `skuCode`), the reason (fixed list from the sheet), the **Aryo reference** for Osave, a free note.
2. **Warehouse side** (typed while the warehouse sorts, up to two days later): the **pecah count in pieces**; OK is pre-filled as `quantity × eggs per unit − pecah` and editable; retak optional. Saving this calls the existing `record_return` with one `ReturnLineInput` per disposition, carrying a new `delivery_line_id`, so stock (restock to FIFO batches, retakan child item), the activity feed (delivered = sold − returned, O/R/H code) and the log agree. The user who saves is the "paraf gudang". Novi's verification is a "diperiksa" tick on the line.
3. **Expiry** is computed from `expiry_rules` (remapped to EggKeep SKU codes) and editable.

Flags on the list and badge: **orange** = a store-side return line with no warehouse entry yet; **red** = an Osave return line without an Aryo reference. The count-mismatch (yellow) flag is dropped: by construction the warehouse count is a split of the returned total. Export: the sheet's 22 columns, now all filled (columns 9 to 22 come from `delivery_lines` and the linked `returns`).

Transition: a **one-time import** of the October sheet rows for the 108 fakturs that match a PO (store-side lines, Aryo refs, and the warehouse counts as `returns` rows dated by "Tgl Barang Balik"), run once at launch; unmatched rows listed for admin. The export keeps the sheet's layout so Novi's checking habit survives. No continuing two-way sync.

Rules the design must keep:
- Returns are **never** recorded through `correct_order`; the order edit stays for loading mistakes. No change to outflow, FIFO, caps, or `record_return`'s stock logic (the only RPC change is persisting `delivery_line_id`, mirroring how `sku_code` was added).
- `delivery_lines` store-side quantities never feed stock; only the `returns` rows created from the warehouse entry do.
- kg-native: entry and display in pieces, stored native, flat 15.5 pieces/kg for Negeri (not the catalog `eggs_per_unit`).
- Every user-facing string in both `src/locales/en.ts` and `id.ts`; Indonesian warehouse vocabulary (Pecah, Kurang, Tukar Guling, Ditolak …).
- Phone width 375 px: no sideways page scroll.
- A delivery record must be allowed to exist **before loading** (a later "PO intake / packing to-do" feature would create it in a "to pack" state). Phase 2 must not bake in "rows start at loading".

## 4. Decisions already taken (challenge them, but know they were deliberate)

| Decision | Choice | Why |
|---|---|---|
| Who types the warehouse numbers | Admin, on the delivery detail, while sorting happens in front of them | Warehouse never used the return dialog; sorting is done in the admin's presence |
| Store-side unit | The PO line's SKU unit (box for Osave box SKUs, pack otherwise) | Sheet's Osave counts are boxes; catalog already knows box capacities |
| Warehouse entry shape | One number (pecah), OK = remainder, retak optional | Sheet data: OK + pecah = returned total in nearly every row; warehouse counts only broken eggs |
| Disposition mapping | OK → `restock`, pecah → `retakan` by default (editable to `writeoff`) | Cracked eggs are reprocessed / billed to Aryo, not thrown away by default; the owner's own back-entry used retakan |
| Aryo reference | A text field on the return line **in Phase 2** (billing status stays Phase 3) | Osave is 59 of 108 return rows; without the ref the sheet must stay open and double entry returns. Status Tagihan has never been filled in the sheet |
| Yellow (count mismatch) flag | Dropped | Meaningless once the unit is right and the count is a split |
| No. Faktur | Required on buyer orders | Gap is 1 PO in 224 |
| Sushi Toku | Enter as a buyer order, not a cash sale, so it appears | Owner: it is a real PO |
| TST own-use rows, "bu linda", cash sales | Out of this log | Not POs; owner: the sheet carried them only because it had no other place |
| Transition | One-time import of October + export in sheet layout | Owner asked for a transition period; a continuing sync is rejected |
| PO intake / packing to-do list | Separate brainstorm, after Phase 2 | Upstream of loading; buyers' POs arrive by email to the company inbox and Novi orchestrates packing verbally today |
| Pasteurized egg yolk | Out | Not a catalog item; mention only |

## 5. Open questions the reviewers may help settle

1. Should the warehouse entry on the delivery line call `record_return` directly (one save = one RPC call per line), or open the existing `RecordReturnDialog` prefilled? The hypothesis says directly, to keep one form, but the dialog already handles caps, shared-egg rows and the offline outbox.
2. `delivery_lines` keyed by `(delivery_id, sku_code, reason)` with no DB unique, or allow duplicates and merge in the UI?
3. Where does the Aryo reference live: a text column on `delivery_lines` now, migrated into `return_claims` in Phase 3, or create the `return_claims` table now with only `claim_ref`?
4. Import: as a script run once (Node, against the exported CSV), or an admin-only "Import dari sheet" button? The script is simpler; the button is repeatable.
5. "Tukar guling" (swap): returned goods come back and a replacement goes out as a new PO. Anything beyond recording the return and a note?
6. "Kurang" / "Revisi PO" / "Masih ditanyakan": nothing physically returns. Should the line still exist with no warehouse side (as the sheet does), and should the orange flag skip these reasons?
7. The expiry rule remap: Astro "N 30" → `N30B` (150) and `N30O`? "AMTG" → `BK4AMTG`; "KP 6" → `KP6B`/`KP6O`/`OSVKP6O`; "N15" → `N15B`/`N15O`. Is a per-family match (prefix) better than listing codes?

## 6. Files to read (absolute paths; this checkout is a detached copy of `main`)

Repo root for review: `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\`

- Project rules: `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\CLAUDE.md`
- Full spec, Phases 1 to 4 (the Phase 2 section is §4.3, §4.4, §4.7 `delivery_log`, §5.2 sections 3 to 4, §11): `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\docs\superpowers\specs\2026-10-29-delivery-return-log-full.md`
- Phase 1 as built (wins over the full spec where they differ): `C:\Users\Joshua\JS\EggKeep\.claude\worktrees\main-ro\docs\superpowers\specs\2026-10-29-delivery-return-log-design.md`
- Phase 1 code: `src\pages\Deliveries.tsx`, `src\components\deliveries\DeliveryDetail.tsx`, `src\hooks\useDeliveries.ts`, `src\hooks\useDelivery.ts`, `src\lib\deliveryFlags.ts`, `src\lib\deliveryExport.ts`, `src\types\deliveries.ts`, `supabase\migrations\20261029000001_deliveries.sql`, `supabase\migrations\20261029000002_expiry_rules.sql` (all under the repo root above)
- Returns pipeline: `src\components\RecordReturnDialog.tsx`, `src\hooks\useRecordReturn.ts`, `src\lib\returnRpc.ts`, `src\lib\returnsCap.ts`, `src\lib\returnOutbox.ts`, `src\types\returns.ts`, `supabase\migrations\20261008000000_returns_sku_code.sql` (latest `record_return` body), `docs\superpowers\specs\2026-10-08-per-sku-returns-design.md`
- PO view and order edit: `supabase\migrations\20261022010000_buyer_profiles.sql` (defines the `purchase_orders` view), `supabase\migrations\20261021010000_correct_order.sql`, `supabase\migrations\20261021020000_correct_order_guards.sql`, `src\lib\orderCorrection.ts`, `src\components\QuickOutflowBuilder.tsx`, `src\components\PickListDialog.tsx`
- Activity feed return display: `src\lib\activityGrouping.ts`, `src\components\GroupedActivityLog.tsx`
- Phase 1 EGM review reports (what was already found and fixed): `C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log\goldfish_review_report.md`, `...\intermediate_zoom_out_report.md`
- Sheet excerpts (Klaim tab, Daftar, Aturan Expired, Panduan): `C:\Users\Joshua\JS\EggKeep\egm-reviews\delivery-return-log-phase2\sheet_excerpts.md`

Reviewers cannot open URLs or run commands. Everything needed is in the files above or in this document.
