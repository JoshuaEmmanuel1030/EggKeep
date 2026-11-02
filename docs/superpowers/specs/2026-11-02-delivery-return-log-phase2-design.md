# Delivery & Return Log (Log Pengiriman & Retur), Phase 2 "Retur per faktur" — Design Spec

- **Date:** 2026-11-02
- **Status:** Approved by the owner on 2026-11-02 (decisions recorded in §9 and §10, row 28). Reviewed with EGM on 2026-11-02 (zoom-out, comprehension, design / structural / style critics, intermediate zoom-out, implementation readiness); reports in `egm-reviews/delivery-return-log-phase2/`. Phase 1 has been live since 2026-10-30.
- **Author:** Joshua (with Claude)
- **Builds on:** [Phase 1 as built](2026-10-29-delivery-return-log-design.md) (tables `drivers`, `deliveries`, `expiry_rules`; page `/deliveries`; export v1) · [per-SKU returns](2026-10-08-per-sku-returns-design.md) (`returns` / `record_return`) · [buyer profiles](2026-10-22-buyer-profiles-design.md) (the `purchase_orders` view) · [the Phase 2 brief](2026-11-01-delivery-return-log-phase2-brief.md) (brainstorm of 2026-11-01 on `feature_concept.md`, which stays in `egm-reviews/delivery-return-log-phase2/`; owner decisions A–D of 2026-11-02), committed together with this document.
- **Citations:** "brief D7" cites one of the brief's nineteen numbered decisions and "owner decision A" one of its four lettered ones; §10 restates all of those. "brief M3", "brief N7", "brief open question 2" cite its analysis items, which are background only.
- **Replaces (for new rows, from launch day):** the store-side, warehouse-side and claim-number columns of the Google Sheet "Log Pengiriman & Retur". Billing status (Status Tagihan) stays Phase 3.

> Where this document and the [full spec](2026-10-29-delivery-return-log-full.md) (Phases 1–4, written 2026-10-29; its Phase 2 is §4.3, §4.4, §4.7, §5.2 sections 3–4, §11) differ, this document takes precedence. Section order follows the repository's existing specs (Problem first; Open questions after Alternatives and Risks), not the EGM template's. Facts about the live database were read on 2026-11-02 from project `lgtixzpjbkzapecirbfj` (`pack_skus`, `item_types.box_capacities`, `buyers`, `expiry_rules`, `returns`, the body of `record_return`). Code references are to `main` at 9ac07a3. Numbers inside quoted screen text use Indonesian separators ("1.260 butir" is one thousand two hundred and sixty); numbers in prose use English separators (1,260; 70.19 kg). Ranges in prose use "to".

## 1. Problem

Returns stopped reaching EggKeep stock on 2026-10-14. Every `returns` row that exists (136 rows on 75 outflow rows, dated 30 Sep to 14 Oct) was back-entered by the owner on 13 and 14 October from the sheet. Since then the sheet has logged about 21,000 "Butir OK" pieces for 17 to 31 October that never re-entered stock, and the Osave return numbers used to bill broken eggs (3,549 pieces in October) are tracked only in the sheet.

The sheet, for 12 to 31 October, holds 178 rows for 131 fakturs; 117 rows name an item, 108 rows carry a returned quantity, and 108 of the 131 fakturs match an EggKeep PO (the two 108s are different sets). Every row was typed by office admin (Dila, Yani) at the office: the store-side return read off the signed faktur the driver brings back, and the warehouse count typed while the warehouse sorts the returned boxes in front of them. The app's return dialog lives on an order card in the Activities feed, takes quantities in pieces across three buckets, and has a free-text reason but no fixed reason list and no field for the Osave return number, so admin never opened it. Phase 1 digitised the two sheet columns that carry almost no information (Status Kirim is "Terkirim" on 173 of 178 rows; Tgl Faktur Balik is filled on 177), so nobody switched: production holds one test delivery row.

Phase 2 puts the delivery lines on the delivery detail that admin already has in front of them, and records the warehouse count typed there as the stock return. Billing the claims (Status Tagihan) is Phase 3.

## 2. Overview

On `/deliveries`, each faktur's detail gains a **Retur** section with one delivery line per (SKU, reason) on the faktur. Admin types, for each delivery line: the quantity sent back in the line's own unit (box or pak), a reason from a fixed list, the Osave return number, a note, the expected expiry (defaulted from the shelf-life rules), and, when the goods arrive, the pieces received (prefilled) and the broken pieces the warehouse counted (**Pecah**). The app shows the arithmetic ("Diterima 1.260 butir · Pecah 172 · OK 1.088"), and one explicit, confirmed save records the stock return through the existing `record_return` RPC: OK back into the order's FIFO batches, Pecah into the product's RETAKAN child item (or written off if admin chooses). Stock, the Activities feed and this log then read the same `returns` rows by the same key.

The stock side gains one RPC, `void_return` (owner decision A), the void columns on `returns`, an `expected_prior` check in `record_return`, and a `voided_at is null` filter in every business-view reader of `returns` (§6.3.4), so caps and displays exclude voided returns. A void never rewrites stock history: it records the opposite movement as its own outflow (§6.3.2), and `void_outflow` restores stock as if the order, its returns and their voids never happened (§6.3.3). How POs, outflows and FIFO deduction are recorded, `reconcile_inventory` and `correct_order` are unchanged; `delivery_lines` never feeds stock; returns never go through `correct_order` (brief D1). Everything ships in one migration, reviewed as a whole.

The list gets list chips and row summaries for awaiting-warehouse (orange), no return number (red, by buyer flag), Klaim (the claim rows for the claim CSV), Masih ditanyakan and Kurang. The export uses the sheet's 21 columns with its header strings, plus a claim CSV in the Klaim tab's layout. October's sheet rows are imported once (store side only, owner decision D); the warehouse counts for 15 to 31 October are re-entered through the new screen. §6.7.3 says what happens to the sheet and to the rows the app does not take.

### 2.1 Four sentences from the brainstorm input, restated (brief N8)

The brainstorm input (`feature_concept.md`) contained four sentences a new reader could not follow. Their meaning here:

1. *"Retak optional."* There is no third bucket. The warehouse side has two counts: the pieces received (prefilled with the line's pieces, changed only for a partial sorting) and **Pecah (butir)**. Pecah goes to one disposition: **Retakan** (default: cracked eggs kept and sold cheaper) or **Hancur** (written off). OK is the remainder, shown, not typed. A three-way split is still possible from the Activities dialog.
2. *"The user who saves is the paraf gudang."* Office admin saves. The app records who saved (`returns.user_id`, and from Phase 2 `returns.user_email`); the export prints that email under "Paraf Gudang". There is no separate warehouse signature and no reviewer tick in Phase 2 (nothing would read it).
3. *"Expiry is computed and editable."* `expected_expiry` on a delivery line defaults to `Tgl Kirim + shelf life` from `expiry_rules` when the line is created and is a plain date field admin may change. Only the claim CSV ("Tgl Expired") and the 21-column export read it.
4. *"Transition period" vs "no continuing sync."* October's rows are imported once by a script. From launch day admin types in EggKeep only. The two CSV exports are downloads (Novi's weekly claim list and the owner's month-end archive); nobody pastes them into the sheet. After the import there is no synchronisation in either direction.

## 3. Scope

### 3.1 Goals (brief "In-Scope Goals")

- Delivery lines on the delivery detail, one per (SKU, reason), at most one physical-return line per SKU: quantity in the line's unit with the piece equivalent shown inline, reason, note, No. Retur OSV, expected expiry, received pieces and Pecah with OK computed and shown; one explicit, confirmed save that records the stock return through `record_return`; both sides savable in one visit.
- `delivery_lines`: facts only, state derived from `returns`, DB-unique per (delivery, SKU, reason) and per physical-return line per (delivery, SKU), deletable, with a `source` audit column.
- `void_return(p_return_id, p_reason)` to the same standard as `void_outflow` (lock order, idempotency, error codes, server-side authorisation): it voids a whole save group as one compensating stock movement; `void_outflow` nets those movements per batch when the order is voided; `inflows.return_id` and `outflows.void_return_id` for provenance.
- `record_return` gains `expected_prior`, a once-per-outflow check of the prior returns the client saw, so two writers cannot record the same physical return twice.
- One shared implementation of return-entry resolution (box → pieces → native, outflow id, cap, shared-egg rows, running remainder, error mapping), extracted from `RecordReturnDialog` and used by `RecordReturnDialog` and the Retur section.
- `purchase_orders.egg_totals` extended additively with each egg outflow's id; the warehouse save refused on a duplicate or missing PO.
- A duplicate-ref warning at PO entry in `QuickOutflowBuilder` (brief D6, §6.10): warns, never blocks.
- Orange (awaiting warehouse) and red (no return number, by a buyer flag, with its pecah total) as list chips with counts; a Klaim list chip that filters the claim rows; flags classified once, in `deliveryFlags.ts`, from tables.
- Export in the sheet's 21 columns with verbatim headers, one row per delivery line; a second export, the claim CSV, in the Klaim tab's layout.
- Error messages for every `record_return` and `void_return` code in both locales, in pieces per SKU; prior returns and "Riwayat retur" visible before typing; `/deliveries` online-only.
- Import of October's store-side rows, reasons, No. Retur OSV values and expiry dates as data, reversible by delete.
- A rollout checklist with pre-flight, old-bundle check, verification queries and an ordered rollback.

### 3.2 Non-goals (brief "Out-of-Scope Non-Goals")

- Importing October's warehouse counts into stock by script (owner decision D: re-entered through the UI, or one manual inflow per product after the next count).
- A `returns.delivery_line_id` link (§7); a `record_delivery_return` wrapper RPC; the `delivery_log` SQL view; extending `open_delivery_items`.
- A `return_claims` table or billing status (Phase 3); the Klaim tab's counters 2 and 3 ("belum ditagih").
- A third "retak" bucket; a `status` column on `delivery_lines`; stored pieces or warehouse dates on `delivery_lines`; a stored "paraf gudang" column on `delivery_lines` (the export derives it from `returns.user_email`); a "Diperiksa" reviewer tick.
- Offline queueing from `/deliveries`; an "Import dari sheet" button for any role.
- An expiry-rules editor; prefix matching of expiry rules.
- A "No. Faktur pengganti" link for tukar guling; any automatic stock correction for Kurang or Lebih.
- A "to pack" status or PO-intake UI (separate brainstorm). Phase 2 stays compatible with it (§6.2.1, §6.10).
- Delivery lines for loose-egg PO lines: those keep the Activities dialog (§6.7.3).
- Pasteurized egg yolk as a catalog item; TST own-use rows, "bu linda" and cash sales in this log (§6.7.3).
- Making `invoiceRef` required on buyer orders (Phase 1 Q2). It does not gate this merge: 1 PO in 224 lacks a ref, and old bundles would keep writing POs without one (brief N7, §10).

### 3.3 Success signals

Reviewed four weeks after launch, each as a query against the database on the review day: sheet rows added after launch day = 0; warehouse-done physical-return lines created per week since launch at or above the sheet's October rate (about 25 a week); physical-return lines older than two days that are not warehouse-done = 0 (`delivery_lines` with a physical reason, `created_at` older than two days, and no non-voided return for their SKU on the PO's egg outflow rows); physical-return lines of buyers with `requires_claim_ref`, older than seven days, with `claim_ref_norm is null` = 0. If admin is still adding sheet rows at the review, the owner decides between fixing what blocks them and the "start clean" fallback of §7.

## 4. Vocabulary

### 4.1 Glossary

| Term | Meaning here |
|---|---|
| JS | The company: the egg distributor whose warehouse and office use EggKeep. |
| The owner | Joshua, who owns JS and runs the import and the manual stock corrections named here. |
| Office admin: Dila, Yani, Novi | The three office staff. Dila and Yani type the rows; Novi checks the Osave claim list weekly. "Admin" alone means office admin; "app admin" means the EggKeep admin role (`has_role(uid, 'admin')`). |
| Osave / DC | Osave is the largest buyer (112 of 224 POs in the last 30 days); a DC is a buyer's distribution centre (Osave: BDG, BKS, DPK, KRW, TGR). The sheet writes "OSV Depok"; the app writes "Osave DPK" (`customerLabel`). |
| Faktur / No. Faktur | The invoice number admin also types into Peachtree (the accounting system). The only business key of a PO in EggKeep (`purchase_orders.invoice_ref`, `deliveries.invoice_ref`). "Shared invoice ref": one number carried by two live POs. |
| Tgl Kirim | The delivery date: the PO's outflow date, stored as `deliveries.delivery_date` (Phase 1). |
| Faktur balik | The signed invoice the driver brings back from the store (Phase 1 section 2 of the detail). |
| PO / PO line | A buyer order recorded at loading. Recording it deducts stock. There is no PO table: the `purchase_orders` view regroups `activity_logs` rows. A PO line is one product line of that order: a pack SKU with a pack quantity (`order_lines[].skuCode / packQty`), or a loose-egg PO line (`order_lines[].eggProduct / looseQty`, in the egg's native unit). |
| Outflow row | One `outflows` row per egg product per PO, the row that `returns` rows key on (`returns.outflow_id`). A PO has one egg outflow row per egg product even when two SKUs share that product. Its `quantity_butir` is the product's **native** unit (kg for Negeri, pieces for the rest), despite the column name. |
| Butir / pieces | Single eggs. Screen text says "butir"; prose says "pieces". |
| Pak / box | The two units a delivery line can be typed in: a pak is one pack SKU unit (its `eggs_per_pack` pieces); a box is a box SKU unit (base pack × box capacity, §4.4). |
| Delivery / delivery line | A `deliveries` row is one faktur (Phase 1). A `delivery_lines` row (new) is one (SKU, reason) on that faktur: the store-side record of that SKU and reason. |
| Physical-return line / non-physical line | A delivery line whose reason is a physical return (goods come back and get sorted) / one whose reason is in `NO_PHYSICAL_RETURN` (§4.3). |
| Return entry | One element of the `lines` array sent to `record_return` (`ReturnLineInput` in code): one disposition on one outflow row, with a client-generated id ("return-entry id") that makes a replay a no-op. One warehouse save sends up to two return entries. |
| Save group | The `returns` rows one `record_return` call wrote for one outflow row and SKU: same `outflow_id`, `sku_code` and `created_at`. "Riwayat retur" lists by save group and `void_return` voids by save group. |
| Store side / warehouse side | Store side: what the store sent back, read off the faktur (quantity, reason, No. Retur OSV, note). Warehouse side: what the warehouse counted when the goods arrived (received pieces, Pecah), which becomes the stock return. |
| Warehouse-done | A physical-return line whose SKU has a non-voided `returns` row on the PO's egg outflow rows. Its absence is the **orange** flag (`awaitingWarehouse`). **Red** is the `needsClaimRef` flag (§6.6). |
| Pecah | The warehouse's word for broken eggs. On screen it is the count the warehouse side needs typed. |
| OK / Retak / Hancur | The app's three dispositions (feed letters O / R / H). See §4.2. |
| Retakan | A product's child catalog item "<PRODUCT> (RETAKAN)" where cracked-but-sellable eggs are stocked. `record_return` creates that child on first use and, when an app admin had soft-deleted it, undeletes it ("retakan child resurrection"). |
| Compensating outflow | The `outflows` row a void writes (`outflows.void_return_id` set): the opposite movement of a voided restock or retakan, deducted FIFO from the product's current batches (§6.3.2). |
| Reasons | Defined once in §4.3. |
| No. Retur OSV | The return number Osave issues for a faktur's broken eggs. JS bills those eggs to Aryo, a third party who compensates JS for them, quoting this number; the sheet therefore calls the column "No. Retur ARYO" on its main tab and "No. Retur OSV" on its Klaim tab. The app uses one label, "No. Retur OSV", and prints the sheet's header in the export. Family Mart also issues one (FMI-2610005). |
| Claim / claim rows | Only the physical-return lines of buyers with `requires_claim_ref` (Osave and Family Mart): the rows of the Klaim list chip and the claim CSV. |
| Paraf / PIC | Initials, sign-off / the admin who typed the row. |
| Shared-egg rows | Two pack SKUs on one order that draw from one egg product (N30B and OSVN10B both sell NEGERI BIASA), so they share one return cap on one outflow row. |
| Old bundle | A phone running an earlier PWA build. It keeps running until the user taps the update toast, so every DB change must stay readable and writable by the previous frontend. |
| Pre-loading | A later feature (PO intake) that would create a delivery record before the PO is loaded. Phase 2 keeps its tables compatible with that (§6.2.1). |
| TST | Tirta Soeper Telor, the group's own site; returned goods sometimes land there before the warehouse. |
| Outbox | The offline queue that replays a failed write on reconnect (`src/lib/returnOutbox.ts`). Not used by `/deliveries`. |
| The sheet | Google Sheet "Log Pengiriman & Retur". Main tab "Pengiriman & Retur": row 1 group headers, row 2 the 21 column headers, one row per item per faktur. Tab "Klaim Retur OSV": a filtered view of the Osave return rows with three counters (1: rows without a return number; 2: rows not yet billed; 3: broken pieces not yet billed). Tab "Daftar": pick lists. Tab "Aturan Expired": shelf-life rules. Tab "Panduan": filling rules, numbered 1–8. |
| `data-integrity-reviewer` | The repository's Claude Code review agent for stock-touching changes (`.claude/agents/data-integrity-reviewer.md`; read-only; invoked from Claude Code by that name). Untracked today; committed together with this document. |

**Phase 1 terms used below** (defined in the [Phase 1 spec](2026-10-29-delivery-return-log-design.md)):

| Term | Meaning |
|---|---|
| `poState` | The detail's view of the PO behind a faktur: `ok` (a live PO carries the ref), `voided` (the PO was voided after the delivery was logged), `missing` (no live PO carries the ref, e.g. the ref was edited). |
| `duplicatePos` | The number of extra live POs sharing the ref. |
| Header badge, `open_delivery_items` | The badge counts fakturs that are Terkirim with no faktur balik, from that view. Unchanged in Phase 2. |
| Phase 1 list chips | "Belum dicatat", "Belum terkirim", "Faktur belum balik". |
| Banners | "PO dibatalkan" (`poState = voided`) and "tidak cocok dengan PO" (`poState = missing`). |
| Terkirim | The delivery status "delivered". |
| Edit pesanan, `canCorrect`, `useVoidEntry().canEdit` | The Activities feed's order-edit action, which calls `correct_order` within one hour of the PO, and its UI guard (`src/lib/orderCorrection.ts`); `useVoidEntry().canEdit` (`src/hooks/useVoidEntry.ts`) is the feed's edit / void gate: app admins always, the author within 48 hours, compared in whole hours (`differenceInHours`). `canEditEntry` in `src/lib/activityGrouping.ts` is a copy of the same rule that no production code calls. |
| PLAN.md classes | `docs/uuid-migration/PLAN.md` classifies name-keyed columns as S (point-in-time snapshot, never re-resolved) or R (resolved against the live catalog on read). |

### 4.2 Dispositions: what the words map to

| On screen (input) | App bucket label | `returns.disposition` | Stock effect | Feed letter | Export column |
|---|---|---|---|---|---|
| OK (computed: received pieces − Pecah) | OK | `restock` | back into the outflow row's original FIFO batches (`return_restocks`) | O | Butir OK (ke stok) |
| Pecah (typed), disposition **Retakan** (default) | Retak | `retakan` | a new inflow on "<PRODUCT> (RETAKAN)" | R | Butir Pecah |
| Pecah (typed), disposition **Hancur** | Hancur | `writeoff` | none (logged only) | H | Butir Pecah |

The Pecah input is labelled with the warehouse's word; the disposition control explains the two choices: "Retakan: dijual lagi sebagai telur retak" and "Hancur: dibuang". The export's "Butir Pecah" column is retakan + writeoff pieces, which is what the sheet means by it; the O/R/H split stays in the app, rendered everywhere by the existing `returnCode` / `ReturnCodeParts` / `ReturnBubble` (`src/lib/activityGrouping.ts`, `src/components/GroupedActivityLog.tsx`). The reason list (§4.3) is unrelated to the disposition: a delivery line with reason `pecah` can still have its count written off.

### 4.3 Reasons (`RETURN_REASONS`, fixed list, stored as the code)

| Code | Screen / export label | Meaning | Physical return (warehouse side)? | Sheet strings mapped on import |
|---|---|---|---|---|
| `pecah` | Pecah | broken eggs came back | yes | Pecah |
| `rusak` | Rusak | damaged (packaging or eggs) came back | yes | Rusak |
| `ditolak` | Ditolak | rejected at the DC, goods came back | yes | Ditolak |
| `expired` | Expired | past date, came back | yes | Expired |
| `tukar_guling` | Tukar Guling | swap: goods came back, a replacement goes out as a new PO | yes | tukar guling |
| `lainnya` | Lainnya | any other physical return; the detail goes in the note | yes | anything else (original text kept in the note, e.g. "Pecah 19,kurang 2") |
| `kurang` | Kurang | the store received fewer than the faktur says; nothing comes back | **no** (stock hint, §6.5.6) | Kurang |
| `lebih` | Lebih | the store received more than the faktur says; the surplus is kept (faktur revised up in Peachtree) or sent back, and in both cases it was never deducted from EggKeep stock | **no** (stock hint, §6.5.6) | Lebih |
| `revisi_po` | Revisi PO | the faktur was revised on paper only | **no** | Revisi PO |
| `cancel` | Cancel | the store cancelled the line on paper | **no** | Cancel |
| `masih_ditanyakan` | Masih ditanyakan | unresolved, not final | **no** (neutral marker + list chip) | Masih ditanyakan |

`NO_PHYSICAL_RETURN = {kurang, lebih, revisi_po, cancel, masih_ditanyakan}` is one constant in `src/lib/deliveryFlags.ts`; the partial unique index of §6.2.1 repeats the list, so **adding a non-physical reason needs a migration**, while adding a physical reason does not. For those reasons the warehouse side is disabled ("Tidak ada barang balik") and the orange flag does not apply (brief D9). **A faktur holds at most one physical-return line per SKU** (the sheet's own rule, Panduan 7: one reason per row, the rest in the note); non-physical lines (Kurang) may sit next to it, which is what October's two-reason rows (2610382, 2610556) are. The form shows four reason chips (Pecah, Ditolak, Tukar Guling, Kurang: 105 of the 117 item rows) and "Lainnya…", which opens the full list (brief N4).

### 4.4 Sheet item code → EggKeep SKU code (live `pack_skus`, read 2026-11-02)

The sheet's "Item" is a short code; the app's delivery line stores `pack_skus.code` (Phase 1 Q1 resolved: EggKeep codes everywhere; this table is the bridge). Pieces per unit for a box SKU come from its base pack × the box's capacity in `item_types.box_capacities`, exactly as `resolveBoxLine` (`src/lib/outflowCalculator.ts`) and the return dialog's `skuMap` compute it. Box capacities live (`item_types.box_capacities`): `box osave` = {N10B: 18, N10O: 18, KP6B: 20, KP6O: 20}; `box osave polos` = {N10B: 18, N10O: 18}; `box kecil` = {N6B: 20, N6O: 20, P25: 15, KP6B: 20, KP6O: 20, N10B: 12, N10O: 12, N15B: 8, KP10B: 14, KP10O: 14, BK4AMTG: 20}.

| Sheet code | Customer | `code` | `eggs_per_pack` | `base_pack_code` | `box_mode` | Pieces per unit | Default unit word |
|---|---|---|---|---|---|---|---|
| N10 | Osave | `OSVN10B` | 1 (placeholder; `egg_product` is empty) | `N10B` (10, NEGERI BIASA) | `box osave` | box 10 × 18 = **180**; pak 10 | box |
| NO10 | Osave | `OSVN10O` | 1 (placeholder) | `N10O` (10, NEGERI OMEGA) | `box osave` | box 10 × 18 = **180**; pak 10 | box |
| KpO6 | Osave | `OSVKP6O` | 1 (placeholder) | `KP6O` (6, KAMPUNG MERAH) | `box osave` | box 6 × 20 = **120**; pak 6 | box |
| N 30 / N30 | Osave | `N30B` | **150** (NEGERI BIASA; the repo seed says 30, the live row says 150) | null | null | **150** | box (not a box-mode SKU; `unit_label` must say so, §6.2.5) |
| N 30 | Astro (per PO) | `N30O` | 30 (NEGERI OMEGA) | null | null | 30 | pak |
| N10 / NO10 | other buyers (per PO) | `N10B` / `N10O` | 10 | null | null | 10 | pak |
| N15 | any | `N15B` / `N15O` | 15 | null | null | 15 | pak |
| N6 / NO6 | any | `N6B` / `N6O` | 6 | null | null | 6 | pak |
| N4 | Sayurbox | `N4` | 4 (NEGERI BIASA) | null | null | 4 | pak |
| AMTG | Astro, Segari | `BK4AMTG` | 4 (ASIN MATENG) | null | null | 4 | pak |
| P 25 | Astro, Sayurbox | `P25` | 25 (PUYUH) | null | null | 25 | pak |
| KP 6 | Sayurbox | `KP6B` / `KP6O` | 6 | null | null | 6 | pak |
| KP 10 | any | `KP10B` / `KP10O` | 10 | null | null | 10 | pak |

Three facts matter for the math. First, the three Osave box rows exist only in the live table (no migration seeds them) and carry `eggs_per_pack = 1` with an empty `egg_product`: any code that reads a box SKU's own `eggs_per_pack` or `egg_product` gets a wrong answer; everything must go through the base pack (§6.4). Second, `N30B` is 150 eggs while `N30O` is 30: an Osave "N30" typed on the wrong variant is a 5× error, which is why every quantity shows its piece equivalent as it is typed (§6.5.2). Third, Osave returns are sometimes counted in packs rather than boxes (sheet 2610448 NO10 "55": OK 409 + Pecah 141 = 550 = 55 × 10), so a delivery line on a box SKU can be typed in box (default) or pak (§6.5.1); the unit and its pieces are snapshotted on the line. Where one sheet code maps to several SKUs the import resolves it against the PO's own PO lines (§6.9).

NEGERI BIASA and NEGERI OMEGA are kg-native (`item_types.unit = 'kg'`, `eggs_per_unit = 15.5` live). Returns convert pieces to kg at the flat `NEGERI_PIECES_PER_KG = 15.5` (`src/lib/returnsCap.ts`); because the live catalog factor is also 15.5, a return of a PO line's full sold quantity fits the cap (brief N2). That equality is a dependency, not a guarantee (§8). The dashboard shows a Negeri restock in kg; that is expected (brief D3).

## 5. Critical user journeys

### CUJ 1: Osave return, faktur and goods back the same day

- **Given**: PO 2610319 (Osave DPK, Tgl Kirim 19 Oct) with PO lines `OSVN10B × 86` and `OSVN10O × 33` is live; nobody has logged the faktur yet (no `deliveries` row); the faktur came back with "N10: 7 box, Pecah" written on it; the warehouse has sorted the 7 boxes in front of Dila: 172 broken.
- **When**: Dila opens the faktur on `/deliveries`, taps "Tambah baris retur", picks `OSVN10B` (shown as "OSVN10B · 86 box terkirim"), keeps the unit on box, types 7, taps the Pecah reason chip, leaves "Butir diterima" at its prefilled 1.260, types 172 in Pecah (butir), leaves Retakan selected, types "OSV-2610037" in the faktur-level No. Retur OSV field, taps Simpan, reads "7 box × 180 = 1.260 butir · Diterima 1.260 · Pecah 172 → Retakan · OK 1.088 → masuk stok. Terjual 15.480 butir, sudah diretur 0 butir. Tgl Barang Balik 19/10/2026." (the §6.5.4 template filled in), and confirms.
- **Then**: the `deliveries` row is created (Phase 1's create-on-first-save, PIC = Dila); one `delivery_lines` row (quantity 7, unit box, 180 per unit, reason `pecah`, claim_ref OSV-2610037, expiry 19 Nov = 19 Oct + 1 month); one `record_return` call with two return entries on the NEGERI BIASA outflow row: restock 70.19 kg (1,088 ÷ 15.5) and retakan 11.10 kg, both `sku_code = OSVN10B`, the call carrying `expected_prior = 0` for that outflow row; the Activities card shows "1.260 diretur · 1.088O 172R" under the OSVN10B PO line; the list row shows "1 item retur"; no orange, no red.

### CUJ 2: Store side today, warehouse count two days later

- **Given**: as CUJ 1, but the goods are still at TST.
- **When**: Dila saves the delivery line with Pecah blank (no confirmation dialog: no stock moves). Two days later Yani opens the list with the "Gudang belum" list chip, taps the row (summary "1 item retur · gudang belum"), the detail opens on the Retur section with the Pengiriman and Faktur balik cards collapsed, types Pecah 172, sets Tgl Barang Balik to that day, taps Simpan and confirms.
- **Then**: the same `returns` rows as CUJ 1 with `return_date` two days later; the orange chip count drops by one.

### CUJ 3: Kurang

- **Given**: PO 2610574 (Astro, 30 Oct), `BK4AMTG × 910`; the faktur says 787 received, 123 short.
- **When**: Dila adds a delivery line `BK4AMTG`, 123, reason Kurang, and taps Simpan.
- **Then**: the line saves without a confirmation dialog; the warehouse side reads "Tidak ada barang balik"; a hint says stock has not changed and what to do (§6.5.6); no orange, no red; the export row shows Qty Diterima 787, Qty Retur 123, Alasan Kurang, warehouse columns blank.

### CUJ 4: A wrong Pecah count

- **Given**: CUJ 1 saved with Pecah 712 instead of 172 (a transposition the plausibility rules cannot catch: 712 is below the 1,260 received pieces). Stock now shows 548 OK restocked and 712 in NEGERI BIASA (RETAKAN). Two sales of NEGERI BIASA have happened since.
- **When**: Dila, within 48 hours of their own save (or Novi at any time: Novi holds the app admin role, §9), opens "Riwayat retur" on the faktur, taps "Batalkan retur ini" on the save group of 2 Nov, types the reason and confirms; then types Pecah 172 and saves again.
- **Then**: one `void_return` call voids both rows of the save group and, in one all-or-nothing `record_order_outflows` call, records one compensating outflow of 712 pieces (45.94 kg) on NEGERI BIASA (RETAKAN) and one of 548 pieces (35.35 kg) on NEGERI BIASA, each deducted FIFO from the product's oldest live batches, dated 2 Nov; both `returns` rows show struck through with the reason and who voided them; the feed bubble disappears; `reconcile_inventory()` returns 0 rows; the new save records 1,088 OK and 172 Retakan with new return-entry ids. If NEGERI BIASA (RETAKAN) had less than 712 pieces in stock (the cracked eggs already sold), the whole void is refused with "Stok NEGERI BIASA (RETAKAN) tidak cukup untuk membatalkan retur ini", nothing changes, and admin retries when stock allows or asks the owner (§6.5.7).

### CUJ 5: A return typed on an old phone through the Activities dialog

- **Given**: a warehouse phone has not updated; a return for PO 2610319 was recorded there through `RecordReturnDialog` with `sku_code = OSVN10B`.
- **When**: Dila opens the faktur on `/deliveries` after adding the store-side delivery line.
- **Then**: the line shows "Sudah diretur: 1.088O 172R (20 Okt)" and no orange, because warehouse-done is derived from returns on the PO's egg outflow rows with the line's `sku_code` (brief D4). Had the dialog been opened for a loose-egg PO line (no `sku_code`), the return appears under "Riwayat retur" as "retur tanpa baris".

### CUJ 6: Novi's check

- **Given**: it is Friday; Novi wants the open claim rows and the claim list. Osave and Family Mart have `requires_claim_ref` (§6.2.6).
- **When**: she opens `/deliveries`; the red list chip reads "Tanpa No. Retur · 17 faktur · 1.236 butir pecah" (October's 18 flagged sheet rows sit on 17 fakturs); she taps it, follows up the numbers, then taps "Ekspor klaim".
- **Then**: the download is the claim CSV in the Klaim tab's column order (§6.7.2): the Osave and Family Mart physical-return lines for the range, newest first, with their pecah pieces where the warehouse count has been entered (including the sheet's one Family Mart row, 2610397 / FMI-2610005). Which rows are billed is Phase 3.

### CUJ 7: October import

- **Given**: launch day; the sheet's main tab downloaded as `.xlsx`.
- **When**: the owner runs the import script with `--dry-run`, reads the report (of the 131 sheet fakturs: 108 match one PO, 13 match none, 3 match two POs, 7 are non-PO customers; plus the merged same-SKU rows, the derived quantities and the unit resolutions), then runs it live and once more.
- **Then**: `deliveries` and `delivery_lines` hold October's store-side rows with `source = 'sheet_import'`; the second run adds zero rows; no `returns` row was written by the script; October's physical-return lines without a return number show red in-app; admin re-enters the warehouse counts for 15 to 31 October through CUJ 2, typing the received pieces and Pecah the note shows ("Sheet: OK 1088 · Pecah 172 · balik 20/10") and **the sheet's Tgl Barang Balik as the return date** so the returns land on their October dates (about 50 to 60 fakturs), after the per-product precondition of §6.10.

## 6. Technical plan

### 6.1 Data flow

```text
  faktur (paper)                   warehouse sorting (in front of admin)
       |                                     |
       v                                     v
 +------------------- /deliveries detail . Retur section -------------------+
 | delivery line: SKU . qty (box|pak) . reason . note . No. Retur OSV      |
 |   . expiry . Butir diterima . Pecah (butir) . disposition . OK (shown)  |
 |   . Tgl Barang Balik . [Simpan] -> confirmation with the arithmetic     |
 +------+-------------------------------------+-----------------------------+
        | 1. deliveries row (Phase 1 create-on-first-save, if none)
        | 2. upsert delivery_lines (PostgREST)  | 3. record_return(p_return) (RPC)
        v                                      v
  delivery_lines --(delivery_id)-- deliveries   returns -- return_restocks -- inflows (restock)
   facts only, no stock                           |       \-- inflows.return_id (retakan child)
                                                  |
   warehouse-done = non-voided returns on the PO's egg outflow rows with the line's sku_code
                                                  |
                   +------------------------------+------------------------+
                   v                              v                        v
          Activities feed (bySku)        /deliveries list chips      exports (21 cols, claim CSV)
          usePriorReturns                deliveryFlags.ts            deliveryExport.ts
          (voided_at is null)            (voided_at is null)         (voided_at is null)

  void_return(p_return_id, p_reason)  <- "Batalkan retur ini" in Riwayat retur
     = the save group voided + one all-or-nothing record_order_outflows call
       (compensating outflows, outflows.void_return_id)
```

Up to three writes, each its own transaction, in this order: the `deliveries` row if the faktur has none (Phase 1's upsert on `invoice_ref_norm`, PIC = the saver), the delivery line (upserted on its client-generated `id`), then one `record_return` call. A failure between the line and the RPC leaves a saved store-side line and no return, which is the orange state; "Coba lagi" resends the RPC with the same return-entry ids, which `record_return` skips if they already exist (brief D5, §7).

### 6.2 Data model

Live project `lgtixzpjbkzapecirbfj`. One migration file, `20261103000000_delivery_lines_void_return.sql`, applied before the frontend is pushed and reviewed as a whole by `data-integrity-reviewer` (it replaces two stock-side functions and adds one). It holds: `delivery_lines`; `returns.user_email` and the void columns; `inflows.return_id` and `outflows.void_return_id`; the `egg_totals` outflow id; `pack_skus.unit_label`; `buyers.requires_claim_ref`; the `expiry_rules` re-key; the replaced `record_return` and `void_outflow`; the new `void_return`; the replaced `purchase_orders` and `v_recon_ledger` views, each restated in full `with (security_invoker = true)` (§6.2.4). Rollback never drops anything (Detailed Implementation Plan, "Rollback"). RLS follows Phase 1 (`authenticated` may select/insert/update; app-admin-only actions are UI gates) plus a delete policy on `delivery_lines` (precedent: `20260820000001_stock_counts_delete_policy.sql`).

#### 6.2.1 `delivery_lines`

One row per (faktur, SKU, reason), store side (brief M10, D7).

```sql
create table public.delivery_lines (
  id               uuid primary key,                                -- client-generated; the form upserts on it
  delivery_id      uuid not null references public.deliveries(id) on delete cascade,
  sku_code         text not null check (length(btrim(sku_code)) > 0), -- snapshot of the PO line's pack_skus.code; never an FK
  unit_label       text not null check (unit_label in ('pak','box')), -- the unit this line was typed in (snapshot)
  pieces_per_unit  integer not null check (pieces_per_unit > 0),      -- snapshot: eggs per pak, or per box (base pack x capacity)
  quantity         numeric not null default 0 check (quantity >= 0),  -- as typed, in unit_label; 0 = no quantity (e.g. Revisi PO on the whole faktur)
  reason           text not null,                                     -- RETURN_REASONS code; client pick-list, no check constraint
  note             text,
  claim_ref        text,                                              -- No. Retur OSV, any buyer
  claim_ref_norm   text generated always as (nullif(upper(btrim(claim_ref)), '')) stored,
  expected_expiry  date,                                              -- defaulted from expiry_rules, then user-edited: a fact
  source           text not null default 'app' check (source in ('app','sheet_import')),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()                 -- set by the client on update, as deliveries.updated_at is
);
create unique index delivery_lines_key on public.delivery_lines (delivery_id, sku_code, reason);
-- One physical-return line per (faktur, SKU). The reason list mirrors NO_PHYSICAL_RETURN in
-- src/lib/deliveryFlags.ts; a sync test reads this migration (precedent: reconViewsSync.test.ts).
create unique index delivery_lines_physical_key on public.delivery_lines (delivery_id, sku_code)
  where reason not in ('kurang', 'lebih', 'revisi_po', 'cancel', 'masih_ditanyakan');
-- RLS: enable; select / insert / update / delete for authenticated.
```

Rules:

- **Nothing stock-side is stored.** Warehouse-done = non-voided `returns` exist on the PO's egg outflow rows with `sku_code = delivery_lines.sku_code`; Tgl Barang Balik = `min(return_date)` of those; OK / Pecah = their sums; paraf gudang = their `user_email`; orange, red and Full are derived. No `status` column (brief D7). Those derived numbers belong to **the physical-return line only**: a non-physical line on the same SKU (Kurang next to Pecah) shows none of them, never locks and stays deletable.
- **Snapshots, not pointers.** `sku_code`, `unit_label` and `pieces_per_unit` are copied from the catalog at save so a renamed code or a changed box capacity never changes what an old line means. `pack_skus.code` is treated as a dependency: `checkSKUDependencies` counts `delivery_lines` and `returns` by code (brief D7). The new columns are added to `docs/uuid-migration/PLAN.md` as class S.
- **Uniqueness in the database.** A second physical return of the same SKU is a second save group, not a second line (brief open question 2). A unique violation on save maps to "Baris <SKU> <reason> sudah ada; muat ulang" (`delivery_lines_key`) or "<SKU> sudah punya baris retur fisik; tulis alasan tambahan di catatan" (`delivery_lines_physical_key`), with the SKU and reason substituted.
- **Pre-loading compatibility.** No `outflow_id`, no NOT NULL column known only at loading, no pre-seeding from `po.orderLines`; the warehouse save is the only step that needs a live PO (brief D16).
- **Once non-voided returns exist for a physical-return line's SKU** (whoever recorded them), its `sku_code` is read-only and its reason may only change to another physical reason; `quantity`, `note`, `claim_ref` and `expected_expiry` stay editable (the mismatch hint of §6.5.3 shows any gap). Deleting such a line is allowed after a warning: its returns stay recorded and show as "retur tanpa baris". A physical-return line whose goods never reach the warehouse stays orange; admin writes why in the note.

#### 6.2.2 `returns`: author email and void columns

```sql
alter table public.returns add column user_email text;   -- auth.jwt()->>'email' at insert (display; user_id stays the audit key)
update public.returns r set user_email = u.email from auth.users u where u.id = r.user_id and r.user_email is null;  -- the 136 existing rows
alter table public.returns
  add column voided_at   timestamptz,
  add column void_reason text,
  add column voided_by   uuid;
```

`user_email` exists because the app has no profiles table and the export must print a name under "Paraf Gudang"; the RPC stamps it server-side so old bundles get it too. There is no `delivery_line_id` (§7): the feed, the log, the caps and "Riwayat retur" all key by (`outflow_id`, `sku_code`).

#### 6.2.3 `inflows.return_id`, `outflows.void_return_id`

```sql
alter table public.inflows  add column return_id      uuid references public.returns(id);
alter table public.outflows add column void_return_id uuid references public.returns(id);
create index inflows_return_id_idx       on public.inflows  (return_id)      where return_id is not null;
create index outflows_void_return_id_idx on public.outflows (void_return_id) where void_return_id is not null;
```

`return_id` is set by `record_return` in the retakan branch (brief M12) and read by `v_recon_ledger` when present; the 65 existing RETAKAN inflows are not backfilled (a heuristic write to production rows that no reader needs). `void_return_id` marks a compensating outflow (§6.3.2), so `void_outflow` can find it (§6.3.3), the reconciliation export can label it and the feed can keep ignoring it.

#### 6.2.4 `purchase_orders.egg_totals` carries the outflow id

`egg_totals` is today `jsonb_agg(jsonb_build_object('product', r.product, 'quantity', r.quantity_butir)) filter (where r.category = 'egg')`, one object per egg outflow row with its native sold quantity as written to `activity_logs.quantity_butir` (the same client payload that `record_order_outflows` wrote to `outflows.quantity_butir`; the server cap reads the latter, and every error message carries the server's numbers). The view is replaced with the same column list and the object gains one key (brief M1, D6):

```sql
-- excerpt: the inner select gains
  case when pg_input_is_valid(metadata->>'relatedEntryId', 'uuid')
       then (metadata->>'relatedEntryId')::uuid end             as outflow_id,
-- excerpt: egg_totals becomes
  coalesce(jsonb_agg(jsonb_build_object('product', r.product, 'quantity', r.quantity_butir, 'outflow_id', r.outflow_id))
             filter (where r.category = 'egg'), '[]'::jsonb) as egg_totals
```

The migration restates the whole view, `create or replace view public.purchase_orders with (security_invoker = true) as …`, with the column list unchanged: `create or replace view` replaces the view's option list, so leaving the clause out would run the view with its owner's rights and bypass the RLS of `activity_logs`. The same rule applies to `v_recon_ledger` (§6.3.4). Existing readers (`src/lib/buyerProfile.ts`, `src/hooks/usePurchaseOrders.ts`) ignore the extra key. The delivery page resolves a delivery line's egg outflow as the `egg_totals` entry whose `product` equals the SKU's egg product (through the base pack, §6.4) and reads from the same entry the sold native quantity the cap needs (`remainingReturnable(quantity, prior)`), with zero extra queries and without searching `activity_logs` by product name. A legacy PO whose rows carry no `relatedEntryId` has `outflow_id: null`: the warehouse save is refused with "PO lama tanpa tautan stok; catat retur lewat Aktivitas" (the dialog's `findRelatedEntryId` fallback still works there).

#### 6.2.5 `pack_skus.unit_label`

```sql
alter table public.pack_skus add column unit_label text not null default 'pak' check (unit_label in ('pak','box'));
update public.pack_skus set unit_label = 'box' where code in ('OSVN10B','OSVN10O','OSVKP6O','N30B');
```

The default unit word comes from the catalog, not from `box_mode` or `base_pack_code`, because `N30B` (150 eggs, no base pack, no box mode) is counted in boxes by admin, and the sheet's 5× unit errors came from this SKU (brief B3, D3). Editable in `SKUDialog` (app-admin UI gate). A delivery line on a box-mode SKU may still be typed in pak (§6.5.1). The Phase 1 PO-line list on the detail uses the catalog word too (today every PO line says "pak", `DeliveryDetail.tsx:206`).

#### 6.2.6 `buyers.requires_claim_ref` ("Perlu No. Retur")

```sql
alter table public.buyers add column requires_claim_ref boolean not null default false;
update public.buyers set requires_claim_ref = true where lower(btrim(name)) in ('osave', 'family mart');
```

Red is decided by this flag, matched to the delivery's `buyer_name` case-insensitively, never by a name prefix (the sheet's "OSV" never matches the live buyer "Osave") (brief M9, D10). The field is visible and optional for every buyer. The migration ticks Osave and Family Mart (FMI-2610005), the two buyers that issue a return number (owner, 2026-11-02).

#### 6.2.7 `expiry_rules` re-keyed, months added

The sheet's "Aturan Expired" tab has a unit column: day rules ("Hari") and month rules ("1 Bulan"), and the sheet adds a **calendar month** for the latter (its own rows: 19/10 → 19/11, 23/10 → 23/11, 31/10 → 30/11). Phase 1 seeded "1 Bulan" as 30 days, which is off by up to two days (February). The table gains `shelf_months`; a row has exactly one of the two; the seed is deleted and re-inserted with EggKeep base pack codes, under a unique index (closing the Phase 1 review's open item that re-running the seed duplicated rows; the migration itself runs once and is not re-runnable, Detailed Implementation Plan item 1) (brief M13, D14):

```sql
alter table public.expiry_rules alter column shelf_days drop not null;
alter table public.expiry_rules add column shelf_months integer check (shelf_months > 0);
alter table public.expiry_rules add constraint expiry_rules_one_unit
  check ((shelf_days is null) <> (shelf_months is null));
delete from public.expiry_rules;
create unique index expiry_rules_key on public.expiry_rules ((coalesce(buyer_keyword,'')), (coalesce(sku_code,'')));
insert into public.expiry_rules (buyer_keyword, sku_code, shelf_days, shelf_months, note) values
  ('Astro',    null,      22, null, 'Astro default'),
  ('Astro',    'N15B',    21, null, null), ('Astro', 'N15O', 21, null, null),
  ('Astro',    'N30B',    21, null, null), ('Astro', 'N30O', 21, null, null),
  ('Astro',    'BK4AMTG', 14, null, null),
  ('Segari',   null,    null,    1, 'Segari default (1 Bulan)'),
  ('Segari',   'BK4AMTG', 14, null, null),
  ('Sayurbox', null,      14, null, 'Sayurbox default'),
  ('Sayurbox', 'P25',     21, null, null),
  ('Sayurbox', 'KP6B',  null,    1, '1 Bulan'), ('Sayurbox', 'KP6O', null, 1, '1 Bulan'),
  ('Sayurbox', 'N4',    null,    1, '1 Bulan'),
  (null,       null,    null,    1, 'Default (1 Bulan)');
```

`N4` exists live (4 eggs, NEGERI BIASA). Osave has no row: its +1 month comes from the default row in the data, not from a hardcoded fallback. Resolution is in §6.8.

### 6.3 Stock-side RPCs

The three functions below are `security definer`, `set search_path = public`, `language plpgsql`, granted to `authenticated`, and go through `data-integrity-reviewer` before merge (brief D19). The live `record_return` body was verified on 2026-11-02 to equal `20261008000000_returns_sku_code.sql`; the migration replaces the whole body once. `reconcile_inventory` is not touched: its per-batch invariant (intake − deductions of live outflows + restocks of returns on live outflows, voided returns included; `20260914020000_reconcile_and_returns_aware_recalc.sql:44–60`) holds before and after every operation below (§6.3.3). `recalculate_inventory_fifo` is not touched either, and is not relied on: it cannot rebuild a sale that consumed restocked eggs today (§8), and a compensating outflow is such a sale.

#### 6.3.1 `record_return(p_return jsonb)`: four changes

1. The insert gains `user_email = auth.jwt()->>'email'`.
2. **`expected_prior`, once per outflow row per call.** A return entry may carry `expected_prior` (numeric, native unit: the non-voided sum of `returns.quantity` on that outflow row, all SKUs, that the client displayed). The function keeps a list of outflow rows already checked in this call; at an outflow row's first entry that is **not** skipped by the idempotency rule, before anything of this call has been inserted for that outflow row, it compares `v_returned` (which already excludes voided rows, change 3) with the entry's `expected_prior` and raises `PRIOR_MISMATCH: outflow % has % returned, client expected %` when they differ by more than `v_eps`; later entries for the same outflow row in the same call are not checked again. The check runs before the caps, so a stale form gets "muat ulang" rather than "melebihi". Because a call is all-or-nothing, a resend after a timed-out success skips every entry (no check runs) and a resend after a rollback checks afresh. Entries without the key (old bundles, the Activities dialog) skip the check and do not mark the outflow row as checked.
3. Caps count non-voided returns only: `v_returned` reads `from returns where outflow_id = … and voided_at is null`; `v_total_restored` and the per-batch `v_already` join `returns r on r.id = rr.return_id and r.voided_at is null`. The eggs a voided restock put into a batch were taken back out by its compensating outflow (§6.3.2), so the corrected return may restock the same batches again; a batch can then hold the restocks of a voided and a live return together, which `void_outflow` accounts for (§6.3.3).
4. The retakan inflow carries `return_id = v_id`.

Lock order, idempotency by return-entry id, cumulative cap, restock distribution oldest-first, `RESTOCK_UNALLOCATED`, `PARENT_TYPE_MISSING` and the retakan child resurrection are unchanged. The input shape only gains an optional key, so old bundles are unaffected.

#### 6.3.2 `void_return(p_return_id uuid, p_reason text)`

Specified to the standard of `void_outflow` (`20260904000000_returns.sql:185–230`), with the server-side authorisation `correct_order` already uses (`20261021020000_correct_order_guards.sql`: `has_role(v_user, 'admin')`, author check). The body below is the contract the `data-integrity-reviewer` reads. It voids the **save group** of the given row (every row one `record_return` call wrote for that outflow row and SKU: same `outflow_id`, `sku_code`, `created_at`), which is what every caller means by "this return".

**Why a compensating movement, not a reversal in place.** `record_return` restocks into the order's original batches, which are the oldest live batches of the product, and `record_order_outflows` sells from the oldest live batch first (`20260707000000_idempotent_order_outflows.sql:78–86`). So the next sale of the product takes the restocked eggs, and for NEGERI BIASA that is within hours. A void that subtracts from the original batch would then fail almost every time, and owner decision A ("admin can undo a wrong save") would not be delivered. Instead, a void records the opposite movement: one outflow per row with a stock effect, on the product that received the eggs (the parent product for a restock, the RETAKAN child for a retakan), deducted FIFO from whatever batches hold the product now, through one call of the existing atomic `record_order_outflows` (same inflow lock order as `record_return`; `INSUFFICIENT_STOCK` rolls the whole void back). The voided `returns` rows and their `return_restocks` rows stay as history; each compensating outflow carries `void_return_id`. Stock history is never rewritten.

```sql
create or replace function public.void_return(p_return_id uuid, p_reason text) returns void … as $$  -- attributes per §6.3 intro
declare
  v_user uuid := auth.uid(); v_is_admin boolean;
  v_ret returns%rowtype; v_outflow outflows%rowtype; r returns%rowtype;
  v_product text; v_date text; v_oid uuid;
  v_entries jsonb := '[]'::jsonb; v_tags jsonb := '[]'::jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED: must be signed in to void a return'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED: a void reason is required'; end if;

  select * into v_ret from returns where id = p_return_id;
  if not found then raise exception 'RETURN_NOT_FOUND: %', p_return_id; end if;

  -- Same lock order as record_return and void_outflow: the outflow row first. No row of
  -- `returns` is locked before it. Then the idempotency check, before authorisation, so a
  -- retried tap after the window is still a no-op.
  select * into v_outflow from outflows where id = v_ret.outflow_id for update;
  select * into v_ret from returns where id = p_return_id for update;
  if v_ret.voided_at is not null then return; end if;

  v_is_admin := public.has_role(v_user, 'admin');
  if not v_is_admin then
    if v_ret.user_id <> v_user then
      raise exception 'NOT_ALLOWED: only the person who recorded this return (or an admin) can void it';
    end if;
    if v_ret.created_at < now() - interval '48 hours' then
      raise exception 'VOID_WINDOW_CLOSED: returns can be voided within 48 hours of being recorded';
    end if;
  end if;
  v_date := to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD');   -- the WIB business day of the void

  -- The save group. All its rows share user_id and created_at, so the check above covers them.
  for r in
    select * from returns
    where outflow_id = v_ret.outflow_id and sku_code is not distinct from v_ret.sku_code
      and created_at = v_ret.created_at and voided_at is null
    order by product, id for update          -- fixed product order, so v_entries is too
  loop
    -- The product that holds the eggs this row put into stock, if any.
    --   restock on a live outflow   -> the parent product
    --   restock on a voided outflow -> nothing: void_outflow restored only the un-returned
    --                                  remainder, so the batch is already whole
    --   retakan                     -> the RETAKAN child (void_outflow never touches it)
    --   writeoff                    -> nothing
    v_product := case r.disposition
                   when 'restock' then case when v_outflow.voided_at is null then r.product end
                   when 'retakan' then r.product || ' (RETAKAN)'
                 end;
    if v_product is not null then
      v_oid := gen_random_uuid();
      v_entries := v_entries || jsonb_build_object('id', v_oid, 'product', v_product, 'category', r.category,
                     'quantity_butir', r.quantity, 'date', v_date, 'invoice_supplier', 'VOID RETUR');
      v_tags := v_tags || jsonb_build_object('outflow_id', v_oid, 'return_id', r.id);
    end if;
    update returns set voided_at = now(), void_reason = p_reason, voided_by = v_user where id = r.id;
  end loop;

  if jsonb_array_length(v_entries) > 0 then
    perform public.record_order_outflows(v_entries);   -- all-or-nothing; INSUFFICIENT_STOCK rolls the whole void back
    update outflows o set void_return_id = (t->>'return_id')::uuid
      from jsonb_array_elements(v_tags) t where o.id = (t->>'outflow_id')::uuid;
  end if;
end $$;
```

What the body does not show:

| Property | Rule |
|---|---|
| Lock order | the outflow row first, then the save group's `returns` rows (by product, id), then, inside `record_order_outflows`, each product's live inflow rows with stock by (`date`, `created_at`), products in `v_entries` order. `record_return` and `void_outflow` lock the outflow row first and then inflow rows by the same clause, so a concurrent `record_return` on the same outflow row serialises behind the void. The clause has no `id` tie-breaker (pre-existing: inflows written in one transaction share `created_at`) and `record_order_outflows` locks every live batch with stock while `record_return` locks only the deducted ones, so a deadlock against a concurrent multi-product sale is possible in theory; Postgres aborts one side with SQLSTATE `40P01`, which the client maps to "coba lagi" (§6.5.7). |
| Idempotency | an already-voided row returns without error (unlike `void_outflow`'s `ALREADY_VOIDED`), checked under the lock before authorisation, so a retried tap is harmless (brief D19); rows of the group already voided are skipped by the `voided_at is null` filter. |
| Atomicity | the whole save group is voided or nothing is: the rows are updated first, the one `record_order_outflows` call is all-or-nothing, and an exception rolls the row updates back too. |
| Error codes | `AUTH_REQUIRED`, `REASON_REQUIRED`, `RETURN_NOT_FOUND`, `NOT_ALLOWED`, `VOID_WINDOW_CLOSED`, and `INSUFFICIENT_STOCK: <product> (<category>) is short <n> butir/pcs` from the inner RPC (`<n>` is in the product's native unit, kg for Negeri, whatever the text says; the product's live stock is below what the group put back: the eggs have been sold on and stock is right as it is). SQLSTATE `40P01` (deadlock) is mapped as `DEADLOCK`. |
| Stock algebra | the voided restock's `+X` on the original batches stays; the void's `−X` lands FIFO on the product's current batches (often the same ones). The three stock-balance functions see one more ordinary outflow (`void_outflow` with one addition, §6.3.3). |
| Dashboard and feed | a compensating outflow has no `activity_logs` row, so the Activities feed never shows it; the stock dashboard reads inflow remainders and is right. |
| UI mirror | `useVoidEntry().canEdit` (`src/hooks/useVoidEntry.ts`: app admins always, the author within 48 hours, in whole hours) decides whether "Batalkan retur ini" is shown, as `canCorrect` mirrors `correct_order`; it is not changed. Because it compares whole hours, for up to 59 minutes past 48 h the button is still shown and the server refuses with `VOID_WINDOW_CLOSED`, whose message says so. The server check is the guard. |
| Where | "Batalkan retur ini" on a save group in "Riwayat retur" on the delivery detail (§6.5.7). The Activities feed does not offer it in Phase 2. |
| After a void | the feed bubble, the dialog's cap and warehouse-done no longer count the return; the rows stay visible, struck through, under "Riwayat retur" with reason, who and when. |

#### 6.3.3 `void_outflow`: restore as if the order, its returns and their voids never happened

Today `void_outflow` restores, per batch the order deducted from, `deducted − Σ return_restocks` over this order's returns, and skips the batch when that is zero or negative (`20260904000000_returns.sql:210–226`). That is right only while the restocks into a batch never exceed what the order took from it. Two Phase 2 facts break that bound: a voided restock's `+X` stays in its batch while its compensating outflow's `−X` sits wherever FIFO put it (§6.3.2), and after a void the corrected return may restock the same batch again (§6.3.1 change 3), so one batch can hold a voided restock and a live one together. Keeping today's loop would then inflate stock by the compensated amount in some histories and trip `inflows_remaining_bounds` in others.

**Rule.** For order O and each batch b, let `ded_b` be O's `fifo_deductions` from b, `rs_b` the `return_restocks` into b over **all** returns of O (voided included), and `vd_b` the `fifo_deductions` from b over O's **compensating outflows** (live `outflows` rows whose `void_return_id` points at a restock return of O). Over the union of the batches those three touch, `void_outflow` adds to each batch the signed amount

```text
delta_b = ded_b − rs_b + vd_b
```

and marks O and those compensating outflows voided (`void_reason = 'VOID ORDER ' || p_outflow_id` on the latter). The result is the state in which O, its returns and their voids never happened, which is exactly what `reconcile_inventory` expects of a voided order: it excludes the deductions of voided outflows and the restocks of their returns, and the compensating outflows are voided too. `reconcile_inventory` is therefore unchanged. An order with no returns behaves as today (`rs_b = vd_b = 0`, so `delta_b = ded_b`).

Worked examples (B and C are batches of one product, B the older; "true" is the state with O, its returns and their voids removed):

| # | History | Live state before the void | `delta` | After | True |
|---|---|---|---|---|---|
| 1 | B = C = 100. O takes 50 from B. R restocks 50 into B. A sale takes 100 from B. R is voided: V takes 50 from C. R2 restocks 50 into B. | B 50, C 50 | B: 50 − 100 + 0 = −50; C: 0 − 0 + 50 = +50 | B 0, C 100 | B 100 − 100 = 0; C 100 |
| 2 | B1 = B2 = 100. O takes 5 from B1 and 45 from B2. R restocks 5 + 5. R is voided: V takes 10 from B1. R2 restocks 5 + 5. | B1 95, B2 65 | B1: 5 − 10 + 10 = +5; B2: 45 − 10 + 0 = +35 | B1 100, B2 100 | both 100 |
| 3 | B = 100. O takes 100. R restocks 100. R is voided: V takes 100 from B. R2 restocks 100. | B 100 | B: 100 − 200 + 100 = 0 | B 100 | B 100 |
| 4 | B = C = 100. O takes 50 from B. R restocks 10 into B. A sale takes 60 from B. R is voided: V takes 10 from C. | B 0, C 90 | B: 50 − 10 + 0 = +40; C: 0 − 0 + 10 = +10 | B 40, C 100 | B 100 − 60 = 40; C 100 |

A negative `delta_b` is an ordinary outcome (the batch held eggs only because of O's returns). When `remaining_b + delta_b` would fall below 0 or above `quantity_b`, the eggs O's returns put back have already been sold on (example 3 followed by a sale of 50: `delta_B = 0` but B holds 50, so a further order of events exists in which it holds −50), and the order cannot be voided without creating or destroying stock: the function raises `VOID_BLOCKED: batch % of % would hold % of %` before any update, the feed shows it, and the owner decides. It is the same situation as `INSUFFICIENT_STOCK` on a return void (§6.3.2). `inflows_remaining_bounds` stays as the backstop behind it.

**Body.** The function locks O's row (as today), then the rows of O's compensating outflows (`for update`, by id), then the union of batches in one pass, each batch once, in (`date`, `created_at`, `id`) order:

```sql
-- excerpt: replaces the restore loop of 20260904000000_returns.sql:210-226
for b in
  select i.id, i.remaining_butir, i.quantity_butir,
    coalesce((select sum(fd.quantity_deducted) from fifo_deductions fd
              where fd.outflow_id = p_outflow_id and fd.inflow_id = i.id), 0)                 as ded,
    coalesce((select sum(rr.quantity_restored) from return_restocks rr
              join returns r on r.id = rr.return_id
              where r.outflow_id = p_outflow_id and rr.inflow_id = i.id), 0)                  as rs,
    coalesce((select sum(fd.quantity_deducted) from fifo_deductions fd
              join outflows v on v.id = fd.outflow_id
              where v.voided_at is null and fd.inflow_id = i.id
                and v.void_return_id in (select id from returns
                                         where outflow_id = p_outflow_id and disposition = 'restock')), 0) as vd
  from inflows i
  where i.voided_at is null and i.id in (
    select fd.inflow_id from fifo_deductions fd where fd.outflow_id = p_outflow_id
    union select rr.inflow_id from return_restocks rr join returns r on r.id = rr.return_id
          where r.outflow_id = p_outflow_id
    union select fd.inflow_id from fifo_deductions fd join outflows v on v.id = fd.outflow_id
          where v.voided_at is null
            and v.void_return_id in (select id from returns
                                     where outflow_id = p_outflow_id and disposition = 'restock'))
  order by i.date, i.created_at, i.id
  for update of i
loop
  v_delta := b.ded - b.rs + b.vd;
  if abs(v_delta) <= v_eps then continue; end if;
  if b.remaining_butir + v_delta < -v_eps or b.remaining_butir + v_delta > b.quantity_butir + v_eps then
    raise exception 'VOID_BLOCKED: batch % of % would hold % of %',
      b.id, v_outflow.product, b.remaining_butir + v_delta, b.quantity_butir;
  end if;
  update inflows set remaining_butir = remaining_butir + v_delta where id = b.id;   -- relative
end loop;
update outflows set voided_at = now(), void_reason = 'VOID ORDER ' || p_outflow_id
  where voided_at is null
    and void_return_id in (select id from returns where outflow_id = p_outflow_id and disposition = 'restock');
update outflows set voided_at = now(), void_reason = p_reason where id = p_outflow_id;
```

Compensating outflows of **retakan** returns are left alone: they sit on the RETAKAN child product, which `void_outflow` never touches, and they net against the child inflow that stays live. `correct_order` calls `void_outflow` and inherits the change; it never reaches it in practice because `HAS_RETURNS` refuses orders with any return, voided included. The four examples and the blocked case are RPC tests R13 to R17.

`recalculate_inventory_fifo` is unchanged and is not a check of any of this: it replays live outflows oldest-first and re-applies restocks only afterwards (its Step 3.5), so a sale that consumed restocked eggs, a compensating outflow among them, is under-deducted in the replay and the batch over-states. That limitation exists today (§8); `reconcile_inventory` (V2) is the correctness check.

#### 6.3.4 Readers of `returns`: which filter `voided_at is null`, which must not

| Reader | Change |
|---|---|
| `record_return` caps | filter (§6.3.1). |
| `usePriorReturns` (feed bubbles, dialog cap) | filter: its aggregation becomes the pure `summarizeReturns(rows)`, which sums non-voided rows and sets `anyReturns` (true when any row exists, voided or not); its fetch takes `includeVoided` (default false, adds `.is("voided_at", null)`); the delivery page reuses both. The feed's Edit pesanan guard (`hasReturns`, `GroupedActivityLog.tsx:376–381`) reads `anyReturns`, so an order whose only return was voided stays non-editable, matching `correct_order`'s `HAS_RETURNS` below. |
| `/deliveries` list and detail | filter; "Riwayat retur" alone selects voided rows too, to show them struck through. |
| `supabase/functions/inventory-assistant/tools.ts` `getReturnsTool` | filter (`.is("voided_at", null)`); its totals object, input enum and filter also learn `retakan` (item 31); the Edge Function is redeployed after the migration (rollout step 3). |
| `void_outflow`, `reconcile_inventory`, `recalculate_inventory_fifo` | **no filter, deliberately**: a voided restock is still a physical movement; the void is its own outflow (§6.3.2); `void_outflow` nets both per batch (§6.3.3). Filtering here would break the stock invariant. |
| `v_recon_ledger` | the view is restated in full `with (security_invoker = true)` and the same column list, with these edits: a compensating outflow (`o.void_return_id is not null`) becomes `jenis = 'retur_batal'`, its quantity carried as a negative `retur` and the `keluar_*` columns null (so `v_recon_daily`'s stock arithmetic is right without a new column), `outflow_id` = its own id, `return_id` = `o.void_return_id`, `disposisi` = the voided return's disposition, flag `retur-batal`, no `tanpa-log` flag; the movements CTE gains a `dibatalkan` column (not `voided_at`, which `v_recon_daily` filters on) that sets the flag `retur-dibatalkan` on return rows with `r.voided_at is not null`, which stay as movements; return rows on a voided outflow take `voided_at = o.voided_at` (fixing a pre-existing overstatement: `void_outflow` already restored around them); the retakan row (from the inflow branch) matches `i.return_id = r.id` when set, else the timestamp rule, and carries `retur-dibatalkan` when its return is voided. The export client (`src/lib/reconExport.ts`: `ReconJenis`, `RECON_JENIS`, `RECON_FLAGS`, `RECON_SCHEMA_VERSION`), the Retur and Faktur tabs of `reconXlsx.ts` and the drift test `reconViewsSync.test.ts` follow (item 12); `docs/spec-export-rekonsiliasi.md` gets a note for the new jenis and flags. |
| `correct_order` `HAS_RETURNS` | unchanged: an order with a voided return stays non-editable; the case needs a return recorded and voided within one hour of the PO. |
| Old bundles | their `usePriorReturns` still counts voided returns: the bubble stays until they update and their cap is tighter than the server's, never looser. The tighter cap is the safe direction. |

### 6.4 Shared return-entry library (brief M2, D5)

`src/lib/returnLines.ts` (new, pure, next to `returnsCap.ts`) holds the rules that today live only inside `RecordReturnDialog.tsx`; the dialog is changed to import them, and `GroupedActivityLog.useOrderReturns` drops its own copy of the SKU → egg map. Three contracts, signatures in the Detailed Implementation Plan (item 3):

- **SKU → egg resolution** (`buildSkuEggMap`): a pack SKU's egg product and pieces per unit (box and pak). A box SKU's egg product is its base pack's egg product whether or not a capacity is configured (today's `skuToEgg` behaviour, kept so feed attribution does not change); its pieces per box are base `eggs_per_pack` × `boxCapacityMap[boxMode][basePackCode]` through `resolveBoxLine`'s rule, and an unconfigured capacity leaves the box unit unresolved for the warehouse save. Never the box row's own `eggs_per_pack` / `egg_product` (placeholders on the live Osave boxes).
- **Return-entry building** (`buildReturnLines`): one return entry per non-zero bucket per input row (an input row is one SKU or loose-egg row of the builder's input); pieces → native through `piecesToNative`; a **running native remainder per egg product shared across rows**, so two rows on one kg egg can never exceed the server cap by rounding. Extracted from `RecordReturnDialog.tsx:316–360`, with one change: a bucket that overshoots the remainder by more than one piece's worth (`piecesToNative(1, 'kg')`, 1 ÷ 15.5 kg, for a kg-native egg; nothing for a count egg; plus `1e-9`) is reported (`{ok: false, kind: 'exceeds', product, exceedsBy}`), not silently cut; a smaller overshoot is rounding (`nativeToPieces` rounds a 5 kg cap up to 78 pieces, which converts back to 5.03 kg) and is clamped as today. The Retur section shows piece caps with `Math.floor`, so a typed maximum never overshoots; the dialog keeps its rounded clamp and shows its over-maximum message on `exceeds`. The builder is synchronous: callers resolve every outflow id (the dialog's `findRelatedEntryId` fallback included) before calling it. Return-entry ids are supplied by the caller.
- **Error mapping** (`returnErrorCode`, `voidReturnErrorCode`): takes the `ReturnSubmitResult` that `callRecordReturn` and the new `callVoidReturn` already classify (`kind: "network" | "server"`) and matches only the server prefixes (`RETURN_EXCEEDS_OUTFLOW`, `RESTOCK_EXCEEDS_DEDUCTED`, `RESTOCK_UNALLOCATED`, `OUTFLOW_VOIDED`, `PARENT_TYPE_MISSING`, `PRIOR_MISMATCH`, `INVALID_ENTRY`, `AUTH_REQUIRED`; for voids `INSUFFICIENT_STOCK`, `RETURN_NOT_FOUND`, `NOT_ALLOWED`, `VOID_WINDOW_CLOSED`, `REASON_REQUIRED`), the way `correctionErrorCode` does for edits.

The Retur section generates return-entry ids once per save attempt, holds them in a React `useRef` (not in `delivery_lines`), and reuses them on retry (brief D5); their lifecycle is in §6.5.5. The dialog keeps its `makeId()` at submit: its outbox already replays the same ids. `remainingReturnable`, `piecesToNative`, `nativeToPieces` stay in `returnsCap.ts`; `summarizeReturns` (the O/R/H sums per outflow row and per SKU) is extracted from `usePriorReturns` and shared; O/R/H display reuses `returnCode`, `ReturnCodeParts` and `ReturnBubble`. The dialog's per-bucket UI clamp (`setBucket`) is UX and stays in the dialog.

### 6.5 Delivery detail: the Retur section

Component `src/components/deliveries/DeliveryReturnLines.tsx`, rendered by `DeliveryDetail.tsx` as section 3 after Pengiriman and Faktur balik. Phone (375 px): one card per delivery line, no sideways scroll. Tablet landscape and desktop: one row per delivery line in a table inside its own scroll wrapper; the list keeps its scroll position after a save (the split view already does; only the phone path scrolls to top).

#### 6.5.1 Layout of a delivery line (one row, both sides, brief D2, M4)

```text
+-- OSVN10B . 86 box terkirim (15.480 butir)                                [hapus] --+
| Qty retur [ 7 ] (box|pak) = 1.260 butir    Alasan (Pecah)(Ditolak)(Tukar Guling)(Kurang)(Lainnya...)
| Catatan   [                      ]         No. Retur OSV [ OSV-2610037 ]  Tgl Expired [19/11/2026]
| -- Gudang ---------------------------------------------------------------------------
| Sudah diretur: 0                           Tgl Barang Balik [02/11/2026]
| Butir diterima [ 1260 ]   Pecah (butir) [ 172 ]  (o) Retakan: dijual lagi  ( ) Hancur: dibuang
| OK = 1.260 - 172 = 1.088 butir -> masuk stok                                   [Simpan]
+-------------------------------------------------------------------------------------+
```

- **SKU picker** (on "Tambah baris retur"): the PO's pack-SKU PO lines, each as "`<code> · <packQty> <unit word> terkirim (<pieces> butir)`", unit word from `pack_skus.unit_label`, pieces from `buildSkuEggMap`; a SKU that appears on two PO lines of one PO is offered once with the quantities summed. For a box-mode SKU the picker offers the unit **box** (default) or **pak** (the base pack: 10 pieces for OSVN10B), and the line snapshots the choice. `pieces_per_unit` follows one rule (`piecesPerUnit` in `returnLines.ts`): unit pak → the base pack's `eggs_per_pack` (the SKU's own when it has no base pack); unit box → base pack × box capacity when the SKU has a box mode and a configured capacity, else the SKU's own `eggs_per_pack` (`N30B`: box = 150). A box-mode SKU with no configured capacity can only be typed in pak, and the picker says why. For a SKU that already has a physical-return line on this faktur, only the non-physical reasons are offered (§4.3); reasons already used for that SKU are not offered again. Loose-egg PO lines are not offered (§3.2).
- **Store fields**: quantity (numeric, decimal comma accepted, `inputMode="decimal"`), reason chips, note, No. Retur OSV, expected expiry (`<input type="date">`, §6.8).
- **The faktur-level "No. Retur OSV" field** above the lines is not stored. It prefills the No. Retur OSV of every delivery line added while it holds a value, and its button "Terapkan ke semua baris" writes it into every existing delivery line whose `claim_ref` is empty. When the faktur is reopened it shows the value all lines share, or blank when they differ or none has one. A line's own field always wins (brief D10).
- **Warehouse fields**: "Sudah diretur" (prior returns for this SKU from `summarizeReturns`, in pieces, with the O/R/H code and the first return date), Tgl Barang Balik (`<input type="date">`, default today by local date, min Tgl Kirim, max today), **Butir diterima** (the pieces that arrived in this sorting; prefilled with line pieces − prior pieces for this SKU, so on a first sorting it equals the line's pieces and admin leaves it alone), Pecah (butir), disposition (Retakan default / Hancur), the computed OK line (`OK = diterima − pecah`). Disabled for `NO_PHYSICAL_RETURN` reasons with the text "Tidak ada barang balik".
- **Save** is one explicit "Simpan" per delivery line; nothing saves on blur (brief D2). Enter in the Pecah field opens the confirmation; Enter in the confirmation confirms. Tab order: quantity → unit → reason → note → No. Retur → expiry → Tgl Barang Balik → Butir diterima → Pecah → disposition → Simpan (brief M4).

#### 6.5.2 Piece equivalents everywhere a quantity is typed (brief B3)

As the quantity is typed the line shows "`<qty> <unit> × <pieces_per_unit> = <pieces> butir`" next to "`terkirim <packQty> <unit>`". The Pecah field shows "`OK = <diterima> − <pecah> = <ok> butir`". Everything on the warehouse side is in pieces, never kg; the kg conversion happens only inside `buildReturnLines`.

#### 6.5.3 Plausibility blocks and the mismatch hint

- **Blocks (the warehouse side cannot be saved):** `diterima + prior pieces for this SKU > quantity × pieces_per_unit` ("Melebihi yang diretur: `<qty> <unit> = <pieces> butir`"); `diterima > capPieces` where `capPieces = Math.floor(remaining × 15.5)` for a kg-native egg (`remaining` itself for a count egg) and remaining is the **egg's** remaining cap across all SKUs and null-SKU returns ("Melebihi yang terjual: sisa yang bisa diretur untuk `<egg product>` `<n>` butir"); `diterima < 1` (a sorting that received nothing is not a stock return); Pecah > diterima; non-integer pieces; `quantity = 0`; no reason; `poState !== "ok"`; `duplicatePos > 0` ("No. Faktur ini dipakai 2 PO; perbaiki dulu di Aktivitas", brief D6); no egg outflow id for the SKU (§6.2.4); an unresolved box capacity; offline.
- **Store-side save** with `quantity × pieces_per_unit > sold pieces` for a physical reason: a non-blocking warning, saved anyway (the paper may say so). For `lebih` the quantity is the surplus and is not compared with sold.
- **Mismatch hint (non-blocking, line-level, never a list flag):** when non-voided returns exist for the SKU and their pieces ≠ `quantity × pieces_per_unit`: "Retur tercatat `<pieces>` butir ≠ `<qty> <unit> × <ppu>`" (a return from the Activities dialog, a partial sorting, or a wrong unit).
- **Catalog factor hint:** when the egg's live `eggs_per_unit` is not 15.5 for a kg product, the line shows "Faktor katalog `<f>` ≠ 15,5: retur penuh bisa melebihi batas" (§8).

#### 6.5.4 The confirmation (brief D2)

Shown only when the save will record a stock return (§6.5.5). A dialog, not a toast: "**`<qty> <unit> × <ppu> = <pieces> butir`** · Diterima `<diterima>` · Pecah `<pecah>` → `<Retakan|Hancur>` · OK `<ok>` → masuk stok. Terjual `<soldPieces>` butir, sudah diretur `<prior>` butir (`<priorOtherSku>` di SKU lain). Tgl Barang Balik `<date>`." Buttons: Batal / Simpan ke stok. On confirm, the save sequence of §6.1.

#### 6.5.5 Save sequence, ids, errors (brief M11, D5, D13)

**When a save moves stock.** The warehouse side counts as filled when the Pecah field is non-blank; `0` is a valid value and means every received egg is OK (restock only). A save with Pecah blank, a save on a non-physical line, and an edit of note / No. Retur / expiry / quantity on a line whose SKU already has returns are store-only saves: no confirmation dialog, no RPC, a plain "Tersimpan" toast.

**Return-entry ids.** The section draws fresh ids when the line's warehouse inputs are first touched, after every successful RPC, after every void, and whenever the SKU's loaded returns change while the inputs are not frozen; while they are frozen after a network failure the ids are pinned, and "Coba lagi" resends them (the server's `expected_prior` still prevents a double return if the stored returns changed meanwhile).

1. If the faktur has no `deliveries` row, create it through Phase 1's `save` (upsert on `invoice_ref_norm`; PIC = the saver). Then upsert the `delivery_lines` row on `id` (generated when the row was added to the form). A unique violation (23505) maps to the messages of §6.2.1.
2. If the warehouse side is filled: build the return entries with `buildReturnLines` for one input row (`restock` = OK if > 0; `retakan` or `writeoff` = Pecah if > 0; `skuCode`, `product` = egg product via the base pack; `expectedPrior` = the non-voided native sum the form displayed for the outflow row) and call `record_return` through `callRecordReturn` with the attempt's ids, `reason` = the line's reason code (`returns.reason` stores the code; the feed, Riwayat retur and the assistant show it as stored) and `buyerName` = `po.buyerName`. A `{ok: false, kind: 'exceeds'}` from the builder cannot happen after the blocks of §6.5.3 (the caps shown use `Math.floor`); it is shown as the egg-level message if it does. The RPC raises `NO_ENTRIES` for a call with no entries; the `diterima < 1` block keeps that from happening, and the code is mapped anyway.
3. Success: invalidate `['delivery', norm]`, `['deliveries']`, the returns query for the PO's outflow rows; toast "Retur tercatat: `<pieces>` butir · `<O/R/H code>`"; new ids.
4. `NETWORK`: keep every typed value on screen but freeze the warehouse inputs; the button reads "Coba lagi"; toast "Tidak ada koneksi, coba lagi"; never enqueue (the outbox replays only from `Index.tsx`; `/deliveries` is online-only, Phase 1 decision). "Coba lagi" resends the same ids with the same `expected_prior`: if the earlier call committed, every entry is skipped and the server returns success; if it rolled back, the call runs afresh. Either way the section then reloads the SKU's returns and shows what is stored.
5. Server codes map through `returnErrorCode` to messages in both locales, in pieces per SKU, with the remaining cap computed client-side (`remainingReturnable` on the egg's outflow row, converted with `nativeToPieces`); when the egg is shared by two SKUs the message names both. `PRIOR_MISMATCH` → "Retur untuk `<SKU>` baru saja dicatat (dari Aktivitas atau HP lain); muat ulang" and the section reloads. Example for `RETURN_EXCEEDS_OUTFLOW`: "Melebihi yang terjual: sisa yang bisa diretur untuk `<SKU>` `<n>` butir (sudah diretur `<m>`)". SQLSTATE `40P01` (`DEADLOCK`) → "Sedang ada transaksi lain; coba lagi". The full text of every message lives in the locale files (Detailed Implementation Plan, item 28).

**Second sorting.** When the SKU already has non-voided returns, the warehouse inputs are locked with "Retur sudah tercatat · batalkan retur dulu untuk mengubah" and one button "Tambah retur kedua" unlocks them for goods that came back over two days: "Butir diterima" prefills with line pieces − prior pieces, and the cumulative block of §6.5.3 keeps the total within the line.

**Double entry is caught on the server.** The Retur section always sends `expected_prior`; a return recorded from the Activities dialog, an old bundle, an outbox replay or another admin between the form's load and its save changes the outflow row's non-voided sum and the RPC refuses with `PRIOR_MISMATCH`. No client-side re-read is needed.

#### 6.5.6 Reasons with no physical return (brief D9, owner decision B)

For `kurang`, `lebih`, `revisi_po`, `cancel`, `masih_ditanyakan` the warehouse side is disabled and reads "Tidak ada barang balik". `kurang` adds a hint in the style of `stockHintDitolak`: stock has not changed; within one hour of the PO use Edit pesanan in Activities; after that tell the owner (the eggs are in the warehouse or at TST). `lebih` adds the mirror hint: the surplus was never deducted, so recording a return for it would inflate stock; tell the owner. `masih_ditanyakan` shows a neutral "belum jelas" marker and has a list chip so it is resolved. No automatic stock change for any of them. The monthly "selisih kurang" figure the owner reads is the summary row of the 21-column log exported for the month (§6.7.1); the Kurang list chip shows the same number on screen (pieces = Σ quantity × pieces_per_unit over `kurang` lines in the range).

#### 6.5.7 Riwayat retur and void (brief M11, owner decision A)

A read-only list under the delivery lines: every `returns` row on the PO's egg outflow rows (any `sku_code`, including null, including voided), from `useDeliveryReturns` (the shared fetcher with `includeVoided`), grouped into save groups. Each save group shows the return date, the created time, `user_email` (or "Anda" when `user_id` is the signed-in user), its return entries (disposition label, native quantity with the piece equivalent, through `ReturnCodeParts`), `sku_code`, reason, and "retur tanpa baris" when no delivery line of this faktur carries that `sku_code` (brief M3). Voided rows are struck through with the void reason, `voided_by` and time, and a line derived from the row itself: "ditarik dari stok `<WIB date of voided_at>`: `<quantity>` butir `<product>`" (the product with " (RETAKAN)" appended for a retakan; omitted for a writeoff and for a restock on a voided PO, which `poState` already knows).

A save group shows "Batalkan retur ini" when `useVoidEntry().canEdit(createdAt, userId)` allows it (the app admin flag comes from `useUserRole().isAdmin`, which `DeliveryDetail` already receives as `isAdmin`). The action asks for one reason and calls `void_return` once with any row id of the group; the server voids the whole group or nothing. Messages (new locale keys, not the edit dialog's): `INSUFFICIENT_STOCK` → "Stok `<product>` tidak cukup untuk membatalkan retur ini; coba lagi setelah stok masuk, atau hubungi pemilik" (the product is parsed from the server text with one regex, `^INSUFFICIENT_STOCK: (.+?) \(`; the number is in the product's native unit and is not shown); `NOT_ALLOWED` → "Hanya yang mencatat retur ini (atau admin) yang bisa membatalkannya"; `VOID_WINDOW_CLOSED` → "Batas 48 jam untuk membatalkan retur ini sudah lewat"; `DEADLOCK` → "Sedang ada transaksi lain; coba lagi". Then it invalidates and the Retur section draws new return-entry ids.

#### 6.5.8 Opening behaviour and banners

- A faktur with an orange line opens on the Retur section with the Pengiriman and Faktur balik cards collapsed (`@radix-ui/react-collapsible`, already installed); otherwise Phase 1 order.
- `poState = "voided"`: delivery lines and returns render as history under the Phase 1 "PO dibatalkan" banner; flags suppressed; no save (brief N3, D17).
- `poState = "missing"` or a delivery line whose `sku_code` is not on the live PO (a `correct_order` within the hour): the line renders with the "tidak cocok dengan PO" banner, no crash, no hide; warehouse save refused.
- The section header shows "Diterima penuh" when the delivery is Terkirim and no delivery line has `quantity > 0` (the sheet's "Full").

### 6.6 List: chips, row summaries, badge (brief M6, D11, owner decision C)

`useDeliveries(range)` reads `deliveries` with their delivery lines embedded (`select("*, delivery_lines(*)")`, the FK makes PostgREST do the join), the non-voided `returns` for the union of the items' egg outflow ids through the shared fetcher (chunked by 100 ids, the `useDeliveryStatuses` pattern), `buyers` (`useBuyers`) for the `requires_claim_ref` map, and `useItemTypes().conversionMap` for each egg product's unit. Pieces are converted per bucket (`nativeToPieces` on restock, retakan and writeoff separately, then summed), the way `ReturnBubble` does, so the chip, the export and the feed show the same numbers. `deliveryFlags.ts` classifies once, from tables:

| Flag / list chip | Rule | Colour |
|---|---|---|
| `awaitingWarehouse` — "Gudang belum · `<n>`" | a physical-return line that is not warehouse-done | orange |
| `needsClaimRef` — "Tanpa No. Retur · `<n>` faktur · `<p>` butir pecah" | buyer `requires_claim_ref` and a physical-return line with `claim_ref_norm is null`; `<p>` is the retakan + writeoff pieces on those lines (the sheet's counter 1 with its pecah total). The flag is evaluated per delivery line; the chip counts fakturs with at least one flagged line. | red |
| `unresolved` — "Masih ditanyakan · `<n>`" | a line with reason `masih_ditanyakan` | neutral |
| `kurang` — "Kurang · `<p>` butir" | lines with reason `kurang`; `<p>` = Σ quantity × pieces_per_unit for the range | neutral |
| "Klaim · `<n>` baris · `<p>` butir pecah" | buyer `requires_claim_ref` and a physical-return line, with or without a ref: the claim rows (§6.7.2). It is a filter, not a flag; it shows the row count and the total pecah pieces for the range. | — |
| `full` (row text only) | Terkirim and no line with `quantity > 0` | — |

Row summary text: "Diterima penuh" · "2 item retur · gudang belum" · "1 tanpa No. Retur" · "Masih ditanyakan". A row that is both orange and red shows the orange left border and the red summary text. List chips combine with OR logic, together with the Phase 1 list chips. A delivery with no live PO keeps every flag suppressed (Phase 1 rule), so a pre-loading row can still be flagged later from tables. The Header badge and `open_delivery_items` are unchanged (owner decision C); the badge never counts orange or red.

### 6.7 Exports (brief M7, D12)

Two buttons, both independent of chips and search (Phase 1 §5.5 rule kept): "Ekspor log" and "Ekspor klaim".

#### 6.7.1 The 21-column log (`src/lib/deliveryExport.ts`)

The file header says: "Headers are row 2 of the sheet admin used until launch. This file is the month-end archive." One row per delivery line, lines sorted by `sku_code`, `reason`; a faktur with no lines is one row with columns 9–11 and 13–21 blank and column 12 filled ("Ya" when Terkirim). `DeliveryLogRow` drops `piecesRetak`; `claimStatus` becomes a constant blank.

| # | Header (verbatim) | Source |
|---|---|---|
| 1 | PIC | Phase 1 |
| 2 | Tgl Kirim | Phase 1 |
| 3 | No. Faktur / PO | Phase 1 |
| 4 | Customer | Phase 1 |
| 5 | Supir | Phase 1 |
| 6 | Status Kirim | Phase 1 |
| 7 | Tgl Faktur Balik | Phase 1 |
| 8 | Paraf Admin | Phase 1 |
| 9 | Item | `delivery_lines.sku_code` (EggKeep code) |
| 10 | Qty Diterima (pack) | in that line's unit: PO `packQty` (converted to the line's unit) for a physical reason (the goods were received, then returned; sheet 2610319 N10: 86), `packQty − quantity` for `kurang` (sheet 2610574 AMTG: 787), `packQty + quantity` for `lebih`, `packQty` otherwise; blank when the PO has no such line |
| 11 | Qty Retur (pack) | `quantity`, in the line's own unit (the header keeps the sheet's word "pack" for boxes too) |
| 12 | Full | "Ya" when Terkirim and no line has `quantity > 0`, else "Tidak" |
| 13 | Alasan Retur | the Indonesian label of the reason code (`RETURN_REASON_LABEL_ID`, fixed like `DELIVERY_STATUS_LABEL_ID`) |
| 14 | Catatan Kondisi | `note` (the sheet's Panduan meaning, "detail kondisi barang"; the sheet's TRUE/FALSE tick is not carried) |
| 15 | Tgl Barang Balik | physical-return line only: earliest non-voided return date for the SKU; blank on non-physical lines |
| 16 | Tgl Expired | `expected_expiry` |
| 17 | Butir OK (ke stok) | physical-return line only: restock pieces (`nativeToPieces` with the egg's unit) |
| 18 | Butir Pecah | physical-return line only: retakan pieces + writeoff pieces, each converted then summed |
| 19 | Paraf Gudang | physical-return line only: `user_email` of the latest non-voided return for the SKU |
| 20 | No. Retur ARYO | `claim_ref` |
| 21 | Status Tagihan | blank (Phase 3) |

Separator, quoting, BOM, `dd/mm/yyyy`, decimal comma and the formula guard stay as in Phase 1 §5.5.

**The "selisih kurang" summary row (owner decision B, confirmed 2026-11-02).** After the data rows the file has one blank row and then one summary row: column 1 = "Total selisih kurang (butir)", column 2 = the export's range ("01/10/2026–31/10/2026"), column 11 = Σ `quantity × pieces_per_unit` over the `kurang` lines of the exported range, every other column blank. The figure is the same number the Kurang list chip shows for that range (§6.6); exported over a calendar month, it is the monthly figure the owner reads. It is a sum only: it changes no stock, writes nothing and reads no `returns` row. The claim CSV has no summary row.

#### 6.7.2 The claim CSV

"Ekspor klaim" downloads `klaim-retur-<from>_<to>.csv` with the Klaim tab's ten headers verbatim, in this order: 1 Tgl Kirim · 2 No. Faktur / PO (EggKeep) · 3 Customer · 4 Item · 5 Qty Retur (pack) · 6 Alasan Retur · 7 Tgl Expired · 8 Butir Pecah · 9 No. Retur OSV · 10 Status Tagihan (blank). Rows: the claim rows for the range, newest first. Counters 2 and 3 of the Klaim tab ("belum ditagih") are Phase 3.

#### 6.7.3 What happens to the sheet, and what the app does not take

The sheet stops for new rows on launch day. Novi's check moves to the red and Klaim list chips; the claim CSV is her weekly download for Osave and Family Mart. The 21-column export is the owner's month-end archive. Nothing is pasted into the sheet.

Rows the app does not take after that, and where they go:

- A return on a loose-egg PO line: recorded in stock through the Activities dialog; its reason and No. Retur OSV go in the dialog's free-text reason; it has no delivery line (none of October's 117 item rows is a loose-egg line).
- TST own-use, "bu linda" and cash rows: not sales; not logged anywhere (the owner: the sheet carried them only because it had no other place).
- Sushi Toku: a buyer in EggKeep ("SUSHI TOKU"); entered as a buyer PO from launch day, so its fakturs appear like any other.
- A PO recorded without a No. Faktur: it cannot carry delivery lines and shows in the list's "n PO tanpa No. Faktur disembunyikan" count. Within the hour the loader adds the ref with Edit pesanan; after that its return is recorded through the Activities dialog with the reason and No. Retur OSV in the dialog's free-text reason, and the faktur is absent from the exports. Making the ref required at entry is the Phase 1 Q2 follow-up, not gated here.

### 6.8 Expiry resolution (brief M13, D14)

`src/lib/expiryRules.ts` (new, pure): `resolveShelfLife(rules, customerLabel, baseSkuCode)` picks, in order: a row whose keyword matches and whose `sku_code` equals the line's **base pack code** (`OSVKP6O` → `KP6O`, `OSVN10B` → `N10B`, from `buildSkuEggMap`'s base resolution); else a row whose keyword matches and whose `sku_code` is null; else the `(null, null)` row. Keyword match = case-insensitive substring of `customerLabel(buyer, dc)` ("Astro" matches "Astro CKD"). Rows with a `sku_code` and no keyword are not supported (none exist). No match → null (no hardcoded fallback; the default row is data). `expectedExpiry(deliveryDate, rule)` adds `shelf_days` days, or `shelf_months` calendar months with the day clamped to the month's end (`addMonths` from `date-fns`: 31 Oct + 1 month = 30 Nov, as the sheet does), by local date. It is written into the delivery line when the row is added and the date input is editable. No rules editor in Phase 2.

### 6.9 One-time import of October's store-side rows (brief D15, owner decision D)

Why it is worth a script: October's fakturs with a physical-return line and no return number become red list chips admin follows up in-app, the 50 to 60 fakturs whose warehouse counts must be re-entered need only their received pieces and Pecah typed (the store side is already there, and the note carries the sheet's figures), and October's claim rows are in the claim CSV. The sheet remains the system of record for October; the import copies rows and deletes nothing from it.

`scripts/import-sheet-lines.mjs`, Node, no new dependency: `@supabase/supabase-js` and `exceljs` (both installed; the sheet's main tab is downloaded as `.xlsx`, so numbers and dates arrive typed and "1.000" needs no parsing); run as `node --env-file=.env scripts/import-sheet-lines.mjs …` (Node 20.6 or later loads `.env` itself; no `dotenv`); it builds its own client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the app's `src/integrations/supabase/client.ts` reads `import.meta.env` and `localStorage`, so Node cannot import it), refuses to run unless that URL names project `lgtixzpjbkzapecirbfj` (the repository's ref guard checks `VITE_SUPABASE_PROJECT_ID`, not the URL the script would write to), and signs in with `auth.signInWithPassword` using `IMPORT_EMAIL` / `IMPORT_PASSWORD` from the environment (never stored). The script reads `pack_skus`, `item_types.box_capacities` (asserting the `box osave` rows for N10B, N10O and KP6O exist: the app overlays a hardcoded `BOX_CAPACITIES` fallback, the script has none) and `drivers` from the database and applies the base-pack rule of §4.4 for pieces per unit. The pure rules (code resolution, unit, reason, derived quantity, merge, note) live in `scripts/lib/sheetImportRules.mjs` and are unit-tested (item 29); the sheet-code table (§4.4) and the reason map (§4.3) sit there, with a comment pointing at this document.

Per sheet row, in this order:

1. **Normalise and match the faktur**: `upper(btrim(No. Faktur))` against `purchase_orders` (`upper(btrim(invoice_ref))`): 0 rows → "unmatched" (13 expected), listed; 2+ rows → "shared invoice ref" (3 expected), listed; 1 row → continue. A row whose customer is a non-PO name (TST, bu linda, Cash/Tunai, "TST Sayurbox") and matches no PO is listed as "non-PO" (7 expected). **Check**: the sheet customer's first word must map to the PO's buyer (OSV → Osave, FamilyMart → Family Mart, Sushitoku → SUSHI TOKU, Circle → CircleK, others by name); a mismatch is listed and skipped.
2. **Resolve the item** with §4.4: the candidate codes for the sheet code are intersected with the PO's PO-line codes; exactly one → use it; none or several → listed, skipped.
3. **Resolve the unit** for a box-mode SKU: when the sheet's `Butir OK + Butir Pecah` is filled and equals `Qty Retur × base pieces`, the line is in pak (2610448 NO10 "55" → pak, 10 pieces); when it equals `Qty Retur × box pieces`, box; otherwise box with a **unit-doubt** flag in the report and in the note.
4. **Reason** by §4.3; unknown text → `lainnya` with the text in `note`, listed.
5. **Quantity**: `Qty Retur` as typed; when it is blank and the reason is non-physical, `PO packQty − Qty Diterima` (2610448 N30: PO quantity − 168; 2610598 KpO6: PO quantity − 22), listed; when both are blank, 0.
6. **Merge** rows of one faktur with the same resolved SKU and reason (2610421: "N 30" and "N30", both `tukar_guling`, 6 + 30 boxes → one line of 36 with both notes), listed. A faktur with two physical reasons on one SKU keeps the first and lists the second (none expected).
7. **Note**: the sheet's Catatan text, plus "Sheet: OK `<ok>` · Pecah `<pecah>` · balik `<date>`" when any of the three is filled, so admin sees the warehouse figures on the line when re-entering them.
8. **Dry run** prints every list above, the lines per faktur, and the totals; **live run** inserts `deliveries` only for fakturs with no row yet (existing rows untouched, listed) with the Phase 1 fields the sheet has: `pic` and `invoice_checked_by` take the sheet's PIC name as typed (both free-text columns; Phase 1 writes emails into them by convention), `driver_id` / `driver_name` by case-insensitive name match to `drivers` (unknown driver → `driver_name` as typed, `driver_id` null, listed), `status` from Status Kirim ("Terkirim" → the Terkirim status; the five other October values → listed, the row left at Phase 1's default status with the text in the first line's note), `invoice_returned_at` from Tgl Faktur Balik, and the NOT NULL columns `buyer_name`, `delivery_date` and `invoice_ref` from the matched PO (as Phase 1's create-on-first-save fills them); then inserts `delivery_lines` one row at a time after reading the faktur's existing lines, with `source = 'sheet_import'`, `claim_ref`, `expected_expiry` as typed; an existing line with the same key is listed as a collision and left as it is (a PostgREST upsert cannot target the partial index, so the script does not rely on ignore-duplicates). **No `returns` row is ever written by the script.**
9. The report of the live run is committed as `docs/sheet-import-2026-10.md`.

Re-running is a no-op (every line exists). Rollback is `delete from delivery_lines where source = 'sheet_import'`, and then the `deliveries` rows the report lists as created, only those that carry no other delivery line, by the owner in SQL (Detailed Implementation Plan, "Rollback" step 5).

### 6.10 Edge cases

- **Shared invoice ref (three today).** `duplicatePos > 0`: store-side lines may be typed; the warehouse save is refused with both POs named (brief D6). `QuickOutflowBuilder` gets a duplicate-ref warning at entry (`useDuplicateOrderCheck` gains a second, unwindowed query on `purchase_orders.invoice_ref`, any date, next to its 15-minute near-duplicate query; the confirm dialog names the existing PO's buyer and date; warns, never blocks; item 27) because a shared ref now blocks the warehouse save for both POs.
- **PO voided after delivery lines exist.** `void_outflow` has no returns guard; returns stay as history, and the compensating outflows of its voided restocks are voided with it (§6.3.3); lines render under "PO dibatalkan"; flags suppressed (brief N3).
- **`correct_order` after a return.** Still refused by `HAS_RETURNS` (voided returns included, §6.3.4).
- **A return typed under one SKU for eggs sold under two** (shared egg): the feed and the line both attribute by `sku_code`; the cap is the egg's; messages name both SKUs; `expected_prior` is the egg's sum.
- **Old bundle returns, loose-egg returns, the 136 existing rows**: counted by SKU when they carry `sku_code`, else shown as "retur tanpa baris".
- **Renamed SKU code**: delivery lines keep the old code (snapshot); `checkSKUDependencies` warns.
- **Re-entering October's warehouse counts moves stock and the reconciliation export.** The reconciliation export (`v_recon_daily`, built from `v_recon_ledger`; see `docs/spec-export-rekonsiliasi.md`) is the owner's daily stock ledger compared against physical counts, the latest of which are 23 to 31 October. Re-entry with the sheet's dates (CUJ 7) restocks October eggs into today's batches and changes those October days once (brief N6). **Precondition, per egg product**: no manual stock correction has been posted since 15 October for that product, and the owner has compared the product's current physical-count difference with the sheet's October OK total. Per product the owner chooses one route, re-entry or one manual inflow after the next count, never both.
- **Pre-loading compatibility** (future PO intake): `delivery_lines` has no PO-derived NOT NULL column and no `outflow_id`; flags come from tables; only the warehouse save needs a live PO.

## 7. Alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| Open `RecordReturnDialog` prefilled from the delivery line (full spec §5.2 section 4) | Rejected as-is; its core is extracted (§6.4) | No initial-values prop; the reset effect wipes state on open (`RecordReturnDialog.tsx:245–257`); the per-bucket clamp (`:286–307`) leaves no room to type Pecah after a prefilled OK; it renders every PO line. The rules must exist once, so they move to a lib both paths call. The dialog stays for the three-way split. |
| No `delivery_lines`; reason and `claim_ref` on `returns`; open the dialog from the detail | Rejected | Loses the 13 of 108 October return rows with no physical return (Kurang, Revisi PO, Masih ditanyakan), the store-before-warehouse timing, and the pre-loading record; `returns` is select-only and one delivery line splits into up to three rows. |
| `returns.delivery_line_id` (as the agreement mechanism, or as provenance only) | Rejected | The feed keys by (`outflow_id`, `sku_code`); old bundles, the Activities dialog and the 136 existing rows never write the link, so it cannot be the mechanism. As provenance it has no reader beyond a verification query, yet widens the stock RPC's input, `ReturnLineInput`, an FK and the rollback. |
| A server-side "one live return set per line" guard in `record_return` | Rejected in favour of `expected_prior` | Needs the line id inside the stock RPC. `expected_prior` is one comparison per outflow row under the lock, needs no line id, and also catches the Activities dialog, old bundles and outbox replays. |
| No server guard; client re-read before the RPC | Rejected | Leaves the window between the re-read and the RPC, and cannot see a return typed on another device at the same moment. |
| A `record_delivery_return` wrapper RPC for atomicity | Rejected | Not needed once nothing stock-side is stored on lines: line first, then `record_return`; the orange flag is the recovery state; a larger RPC change with no added guarantee. |
| No `void_return`; lock the warehouse numbers and keep an owner SQL runbook | Rejected (owner decision A) | Admin typed 178 rows between 12 and 31 October (§1), so typing errors are expected; without a void, each wrong count is a permanent stock delta only the owner can fix in SQL. |
| `void_return` as a reversal in place (subtract from the batches `return_restocks` names; refuse when consumed) | Rejected | The restocked batches are the oldest and sell first, so the reversal fails on the first sale after the restock, for Negeri within hours; and nothing in the app can lower stock afterwards. |
| `void_return` as a compensating outflow through `record_order_outflows`, voiding the whole save group in one call | **Adopted** (§6.3.2) | Succeeds whenever the product's stock covers the amount, reuses the atomic FIFO RPC and its lock order, leaves `reconcile_inventory` untouched, never rewrites history, and voids a group atomically. Cost: one `outflows` column, the signed restore in `void_outflow` (§6.3.3), one ledger jenis, and a void shows as a movement rather than an erasure. |
| `record_return` counting voided restocks in its per-batch cap, so restocks into a batch never exceed the order's deduction from it | Rejected | Re-recording a near-full return after a void, the very case the void exists for, would then fail with `RESTOCK_UNALLOCATED`; the signed restore in `void_outflow` keeps the cap meaningful for one loop. |
| `void_return` per `returns` row, the UI voiding a save group row by row | Rejected | Creates a partly-voided state when the second call fails, a client stock pre-check and an ordering rule; the group is the unit every caller means. |
| `void_outflow` untouched, refusing orders that have a voided restock return | Rejected | Would leave the owner a hand correction for every such order; the signed restore of §6.3.3 is one loop inside the existing lock order and keeps the reconciliation invariant. |
| Delete `return_restocks` rows on void | Rejected | Loses which batch was restored, and with compensating movements the rows are needed as history. |
| Two migrations (feature, then void) | Rejected | Would need two full `record_return` bodies back to back; the frontend needs both, the rollback drops nothing, and the stock RPC is replaced in the feature half too, so the split buys nothing. One migration, one review. |
| `void_return` authorised in the UI only, like `void_outflow` | Rejected | `correct_order`, the newest stock-changing RPC, checks admin-or-author on the server; an admin-or-author check in the function stops any signed-in client from reversing stock through the API. |
| Backfill `inflows.return_id` for the 65 existing RETAKAN inflows | Rejected | A heuristic write to production rows that no reader needs; new rows carry the id. |
| Import October's warehouse counts into stock by script | Rejected (owner decision D) | Double-counts 12 to 14 Oct (already back-entered), invents OK on 43 blank rows, hits `OUTFLOW_VOIDED` on 41 voided POs, creates RETAKAN stock, restocks into consumed batches that the physical counts already dispute, and needs a signed-in user; the full spec's Phase 4 had ruled it out. UI re-entry has the same stock effect and therefore the precondition of §6.10. |
| An "Import dari sheet" button in the app | Rejected | Ships the workbook parsing and the code map into every phone forever, needs an upload from a phone, and needs its own guard against repeat runs. |
| Start clean (October stays a sheet record; no import) | Acceptable fallback | Gives up the in-app red chips for October's fakturs without a return number, the pre-filled store side for the 50 to 60 re-entries, and October's claim CSV rows. |
| `return_claims` table now with only `claim_ref` | Rejected | A find-or-create in the save path and a table to roll back for a status nobody records; Phase 3 backfill is one `insert … select distinct claim_ref_norm`. |
| A "Diperiksa" reviewer tick (`verified_by` / `verified_at`) | Rejected | Nothing reads it: no flag, no chip, no export column; Novi's check runs through the red and Klaim list chips. One additive column if it is ever wanted. |
| A reason "Tidak masuk gudang" to close an orange line whose goods never arrive | Rejected | A warehouse outcome on the store-reason axis: switching an Osave Pecah line to it would drop the line out of red, the Klaim chip and the claim CSV while the claim still exists. Such a line stays orange with a note; model the outcome separately if it shows up in practice. |
| Flags in `open_delivery_items` and the Header badge | Rejected (owner decision C) | Joins lines and returns into a jsonb regroup polled on every page every 30 s; red would keep the badge on for as long as the backlog lasts, although only office admin acts on it, from the list. |
| `delivery_log` SQL view with the export columns | Rejected | A second definition of the sheet's column layout and a third copy of the 15.5 constant; the TypeScript export exists. |
| A separate `egg_outflows` column on `purchase_orders` | Rejected | `egg_totals` already aggregates one object per egg outflow row; one more key gives the id and the sold quantity together, with no new column or type. |
| Keep "1 Bulan" as 30 days | Rejected | The sheet adds a calendar month and the claim's Tgl Expired must match what Osave was told; one nullable column and `addMonths` reproduce it. |
| Prefix matching for expiry rules | Rejected | "N" matches N4/N6/N10/N15/N30; "N30" matches the 150-egg and the 30-egg SKU; "AMTG" misses `BK4AMTG`. Base pack code then exact match covers every seed row. |
| Buyer-level expiry rules only (no SKU rows) | Set aside | Once re-keyed, the SKU rows need no extra code and change the date on Astro / Segari / Sayurbox lines by 1 to 16 days. |
| Box-only units for box SKUs | Rejected | Osave returns are sometimes counted in packs (sheet 2610448); a per-line unit choice costs nothing because the unit and its pieces are already snapshots. |
| Third "retak" input bucket | Rejected | Not in the data; the sheet has OK and Pecah; writeoff stays reachable from the dialog. |
| Offline outbox for the delivery save | Rejected | Replay is mounted only on `Index.tsx`; a queued return with no line, or a line with no return, is worse than a visible error at the office. |
| "No. Faktur pengganti" on tukar guling lines | Rejected | The replacement is a new PO, already visible by buyer and date. |
| A `restock` return with reason `kurang` | Deferred (owner decision B) | Numerically exact and the only fix after the one-hour edit window, but it is not a return and the eggs may be at TST. Revisit when PO intake makes loaded quantities explicit. |
| Unit word derived from `base_pack_code` or `box_mode` | Rejected | `N30B` is a 150-egg box with neither; "pak × 150" on screen is the wording the sheet's unit errors came from; a catalog column keeps one source. |

## 8. Non-functional requirements, risks and limits

- **Stock safety.** Three RPCs move stock here and all are server-side, row-locked, relative updates: `record_return` (cap logic unchanged except that voided returns are excluded and `expected_prior` is checked), `void_return` (§6.3.2, through the existing `record_order_outflows`) and `void_outflow` with its signed restore (§6.3.3). The migration is reviewed by `data-integrity-reviewer`. `reconcile_inventory()` is the pre-flight and post-launch check and must return zero rows.
- **`recalculate_inventory_fifo` (pre-existing limit, stated here).** The rebuild resets every batch, replays live outflows oldest-first and re-applies restocks only afterwards (Step 3.5), so a sale that consumed restocked eggs is under-deducted in the replay (the loop stops when the batch is empty) and that batch then over-states; a compensating outflow is such a sale. The function is an owner-only repair tool today and stays one; it is not part of this feature's verification, and `reconcile_inventory` (V2) is the correctness check.
- **The 15.5 dependency.** Outflows convert pieces to kg at the catalog `eggs_per_unit` (`outflowCalculator.ts:178`, editable in Catalog); returns convert at the flat `NEGERI_PIECES_PER_KG = 15.5`. A full-line return fits the cap only while the two are equal (they are, live, on 2026-11-02). If the owner edits the factor, full returns exceed the cap and are blocked (§6.5.3), never silently cut; the line shows the catalog-factor hint and `returnsCap.test.ts` pins the constant.
- **Compensating outflows in other readers.** A compensating outflow is an ordinary `outflows` row to the dashboard's `averageDailyOutflow` (`InventoryDashboard.tsx:161`), the trend chart (`InventoryTrendLineChart.tsx:73`), and the assistant's monthly averages and movement sums (`inventory-assistant/index.ts`, `tools.ts` `listTransactionsTool` / `sumMovementsTool`). Voids are rare and small, so Phase 2 accepts the effect; `void_return_id` is indexed if any of them should exclude it later.
- **Who can write.** Any signed-in user can insert, update and delete `delivery_lines` and update `buyers.requires_claim_ref` and `pack_skus.unit_label`; app-admin-only is a UI gate as for `stock_counts`, buyers and voiding an outflow. `void_return` checks app-admin-or-author on the server (§6.3.2).
- **Irreversibility that remains.** A void needs the product's stock to cover the group's quantities (`INSUFFICIENT_STOCK`); when the eggs have been sold on, stock is right as it is and only the business record is wrong, which the owner notes or corrects manually after the next count. Voiding never deletes rows.
- **Old bundles.** They keep writing valid `returns` rows (`user_email` stamped server-side, no `expected_prior`), keep counting voided returns in their bubbles and caps (tighter, never looser), and cannot see delivery lines or list chips. The PO list hook reads the new `egg_totals` key only in the new bundle.
- **Concurrency.** Unique indexes on `delivery_lines`; the line lock of §6.2.1; `expected_prior` under the outflow lock; per-attempt return-entry ids; the server cap and lock order behind all of it. The inflow lock clause has no `id` tie-breaker and `record_order_outflows` locks more batches than `record_return` does, so a deadlock against a concurrent multi-product sale is possible in theory (§6.3.2); Postgres aborts one side, and the client says "coba lagi".
- **Performance.** The list adds one embedded select, one chunked `.in()` on `returns` (about 150 outflow ids for a 14-day range) and a buyers read; the badge query is unchanged. `purchase_orders` gains one key in an existing aggregate.
- **Data quality limits.** `reason` is free text at the DB level (client list); `claim_ref` is free text; `sku_code` is validated against the catalog only in the UI and the script. `user_email` is a display snapshot, not a signature.
- **Rollout and rollback.** Detailed Implementation Plan, "Rollout checklist" and "Rollback".

## 9. Open questions

None open. The two questions of the review draft were answered by the owner on 2026-11-02:

1. **Family Mart and the red flag.** Family Mart needs a No. Retur like Osave: the migration sets `requires_claim_ref` on both (§6.2.6).
2. **App roles** (Phase 1 Q9). Novi gets the app admin role; Yani and Dila stay ordinary users. So Yani and Dila type delivery lines and void their own save groups within 48 hours; Novi can also void any save group at any time, add drivers and tick `requires_claim_ref`. The role is granted at rollout step 2.

## 10. Decision log

| # | Decision | Choice | Source |
|---|---|---|---|
| 1 | Entry point and stock truth | Delivery detail; admin types; `returns` via `record_return` is the only stock path in; `delivery_lines` never feed stock; never through `correct_order` | brief D1 |
| 2 | Save shape | One delivery line per (SKU, reason); both sides in one visit; one explicit confirmed save showing the arithmetic when stock moves; received pieces and Pecah typed, OK computed; plausibility blocks; line-level mismatch hint; no yellow list flag | brief D2, B1; received-pieces field by this document |
| 3 | Units | `pack_skus.unit_label` (box / pak) as the default, a per-line choice for box SKUs, snapshot on the line; piece equivalent inline; warehouse side in pieces; dashboard shows kg | brief D3, B3 |
| 4 | Warehouse-done | Derived from non-voided returns on the PO's egg outflow rows with the line's `sku_code`, as the feed does; no `delivery_line_id` | brief D4, M3; column dropped by this document |
| 5 | One implementation | `src/lib/returnLines.ts` extracted from the dialog (reporting excess instead of clamping); `summarizeReturns` extracted from `usePriorReturns`; the Retur section calls them plus `callRecordReturn`; online-only; return-entry ids per attempt; "Tambah retur kedua" | brief D5, M2 |
| 6 | Outflow ids | `purchase_orders.egg_totals[].outflow_id` (additive key); warehouse save refused on 0 or 2+ live POs; duplicate-ref warning at PO entry; stale test POs voided before launch | brief D6, M1 |
| 7 | `delivery_lines` | Columns of §6.2.1; DB unique (delivery, SKU, reason) and one physical-return line per (delivery, SKU); deletable; snapshots; `checkSKUDependencies` extended; PLAN.md updated | brief D7, M10; physical-line rule by this document |
| 8 | Vocabulary | Input "Pecah (butir)"; disposition Retakan (default) / Hancur; no retak bucket; export "Butir Pecah" = retakan + writeoff | brief D8, M8 |
| 9 | No-physical-return reasons | Line exists, warehouse side disabled, no orange, one constant (`kurang`, `lebih`, `revisi_po`, `cancel`, `masih_ditanyakan`); Masih ditanyakan marker + list chip; Kurang and Lebih hints; no stock change; monthly figure = the summary row of the 21-column log, also shown by the Kurang chip | brief D9, owner decision B (export cell confirmed 2026-11-02); `lebih` by this document |
| 10 | Red flag and the reference | `buyers.requires_claim_ref`; field optional for every buyer; one label "No. Retur OSV"; faktur-level entry prefills and bulk-fills lines; `claim_ref` + `claim_ref_norm`; no `return_claims` | brief D10, M9 |
| 11 | Flags and badge | List chips with counts and row summaries from tables in `deliveryFlags.ts`; red carries the pecah-without-ref total; Klaim is the claim-CSV filter; badge and `open_delivery_items` unchanged | brief D11, owner decision C |
| 12 | Exports | 21 columns, verbatim headers, one row per delivery line, client-side; a second button for the claim CSV; both independent of chips; sheet stops on launch day, nothing pasted back; §6.7.3 says where the rest goes | brief D12, M7 |
| 13 | Errors and history | Every RPC code mapped in both locales in pieces per SKU; prior returns and Riwayat retur on the line; Phase 1 banners reused | brief D13, M11 |
| 14 | Expiry | Buyer-level default + editable date; SKU rules via base pack code then exact match; day and calendar-month rules; delete-and-reinsert seed with a unique index; Osave default is data | brief D14, M13; months by this document |
| 15 | Import | Store-side rows, reasons, No. Retur OSV values, expiry only; script, once, owner-run (Joshua), dry-run first, `exceljs` over the `.xlsx`; `source` column; row-by-row inserts with a collision list; warehouse counts re-entered via UI with the sheet's dates under the per-product precondition | brief D15, owner decision D |
| 16 | Pre-loading compatibility | New tables reference `deliveries.id`; no PO-derived NOT NULL; no `outflow_id`; no new status; no pre-seeding | brief D16 |
| 17 | Order edit and void | `correct_order` stays blocked by returns (voided included); `void_outflow` keeps returns as history with flags suppressed and restores each batch as if the order, its returns and their voids never happened, refusing with `VOID_BLOCKED` when that would create or destroy stock | brief D17, N3; signed restore by this document |
| 18 | Paraf gudang | No stored column on `delivery_lines`; the export derives it from `returns.user_email`; no reviewer tick in Phase 2 | brief D18, N1; tick dropped by this document |
| 19 | `void_return` | Ships in Phase 2 as §6.3.2: voids a save group as one compensating movement through `record_order_outflows`, with server-side app-admin-or-author authorisation; `inflows.return_id` and `outflows.void_return_id`; business views filter voided, stock-balance functions do not; one migration | brief D19, owner decision A; compensating model, group void and server check by this document; mechanism approved by the owner 2026-11-02 |
| 20 | `correct_order` untouched | HAS_RETURNS keeps counting voided returns (the case needs a return within the one-hour edit window) | this document |
| 21 | `user_email` on returns | Added and backfilled so "Paraf Gudang" prints a name without a profiles table | this document |
| 22 | Double entry | `expected_prior` in `record_return`, once per outflow row per call, always sent by the Retur section; no client re-read | this document |
| 23 | `invoiceRef` not required at PO entry | 1 PO in 224 lacks it; old bundles would keep writing POs without it; Phase 1 Q2 follow-up, not a gate for this merge | brief N7 |
| 24 | "Paper first, post later" | Adopted per line: the explicit confirmed save per line is the posting step; a per-faktur or per-day batch post would add a queue and a second screen to save one tap per line | brief "Alternatives Weighed" |
| 25 | Astro "N 30" | Resolved per PO by the import (`N30B` or `N30O`, whichever the PO carries); both get 21 days | this document |
| 26 | Void gate in the UI | `useVoidEntry().canEdit`, unchanged (whole hours), gates "Batalkan retur ini"; the server's 48 h check is the guard; the sub-hour gap is accepted and messaged | this document |
| 27 | Stock checks | `reconcile_inventory` is the correctness check (V2); `recalculate_inventory_fifo` is unchanged, not relied on, and its sell-after-restock limit is written down (§8) | this document |
| 28 | Owner answers of 2026-11-02 | (1) the compensating-outflow void and signed `void_outflow` restore are approved; (2) the monthly selisih kurang is a summary row of the 21-column log (§6.7.1); (3) Family Mart gets `requires_claim_ref` with Osave; (4) Novi is app admin, Yani and Dila are ordinary users | owner |

---

## Detailed Implementation Plan

Items are numbered; "item N" below means that item, which may cover up to four files. Phase **2a** is the code PR, built in four steps that each compile and pass tests on their own: **2a-1** the migration and its RPC test script (items 1–2); **2a-2** the pure libraries, types and their tests (items 3–13); **2a-3** the hooks and the delivery UI (items 14–23); **2a-4** catalog, the duplicate-ref warning, the import script, docs and the Edge Function (items 24–32). Phase **2b** is launch day: the rollout checklist below and item 33. The 2a PR is reviewed at rollout step 2 and merged at step 5, after the migration is applied at step 3. Each item is marked Create or Modify; no file is deleted.

### Target files to create / modify

#### 1. `supabase/migrations/20261103000000_delivery_lines_void_return.sql` (Create) — 2a-1

- Postgres migration: one new table (`delivery_lines`), new columns on six existing tables (`returns`, `inflows`, `outflows`, `pack_skus`, `buyers`, `expiry_rules`), an `expiry_rules` re-seed, two function replacements (`record_return`, `void_outflow`), one new function (`void_return`) and two view replacements (`purchase_orders`, `v_recon_ledger`). Applied once with the Supabase MCP `apply_migration` against `lgtixzpjbkzapecirbfj` (rollout step 3); reviewed as a whole by `data-integrity-reviewer` before the PR is merged (rollout step 2). It runs in one transaction and is not re-runnable (`add column`, `add constraint` and `create unique index` carry no `if not exists`).
- **Proposed changes**, in this order:
  1. `delivery_lines`: the table, `delivery_lines_key`, `delivery_lines_physical_key`, RLS enabled with select / insert / update / delete for `authenticated` (§6.2.1).
  2. `returns`: `user_email`, then its backfill from `auth.users`, then `voided_at`, `void_reason`, `voided_by` (§6.2.2).
  3. `inflows.return_id`, `outflows.void_return_id` and their partial indexes (§6.2.3).
  4. `pack_skus.unit_label` with its check, then `update … set unit_label = 'box' where code in ('OSVN10B','OSVN10O','OSVKP6O','N30B')` (§6.2.5).
  5. `buyers.requires_claim_ref`, then the Osave update (§6.2.6).
  6. `expiry_rules`: `shelf_days` drops NOT NULL, `shelf_months` added, the one-unit check, delete the seed rows, create the unique index, re-insert the 14 seed rows (§6.2.7).
  7. `create or replace view public.purchase_orders with (security_invoker = true) as …`: the full definition of `20261022010000_buyer_profiles.sql` with the `outflow_id` key in `egg_totals` and the same column list (§6.2.4).
  8. `create or replace function public.record_return`: the full body of `20261008000000_returns_sku_code.sql` with the four changes of §6.3.1.
  9. `create or replace function public.void_outflow`: the full body of `20260904000000_returns.sql` with the restore loop replaced per §6.3.3.
  10. `create or replace function public.void_return` (§6.3.2); `revoke execute … from public, anon; grant execute … to authenticated`.
  11. `create or replace view public.v_recon_ledger with (security_invoker = true) as …`: the full definition of `20261029000000_recon_views.sql` with the §6.3.4 edits and the same column list.
  12. A header comment listing every reader of `returns`, which filter `voided_at is null` and which must not (§6.3.4), and the four worked examples of §6.3.3.

#### 2. `supabase/tests/phase2_returns.sql` (Create) — 2a-1

- A SQL test script (new folder; the repository has none today), run by hand against a Supabase branch (`create_branch`, `apply_migration` of item 1 on the branch, `execute_sql` of this file) or a local stack; it is rollout step 2b.
- **Proposed changes**: one transaction (`begin … rollback`), re-runnable. Setup: a test egg product `TEST PHASE2` (category `egg`, count unit) with batches B (older) and C of 100 each as `inflows`, and a second product for example 2 of §6.3.3; the first two user ids from `auth.users` as A and B, asserting `not has_role(B, 'admin')`; every RPC call runs as a signed-in user through `set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', <id>, 'email', <email>)::text, true);`, and the asserts run after `reset role`; back-dating is `update returns set created_at = now() - interval '49 hours' where …` as the owner. Each case R1–R20 of the Verification plan is one `do $$ … if not (<condition>) then raise exception 'R<n> failed: <what>'; end if; … $$` block, so the first failure stops the run with its number.

#### 3. `src/lib/returnLines.ts` (Create) — 2a-2

- Pure TypeScript module (no React, no Supabase). `PackSKU` is the one in `src/types/catalog.ts` (the type `usePackSKUs` and `SKUDialog` use), not the separate `PackSKU` of `src/lib/outflowCalculator.ts`.
- **Proposed changes**:
  - `buildSkuEggMap(skus: PackSKU[], boxCapacityMap: BoxCapacityMap | undefined): Record<string, SkuEgg>` with `SkuEgg = { eggProduct: string; piecesPerPak: number; piecesPerBox: number | null; basePackCode: string | null; isBoxMode: boolean }`: `eggProduct` = the base pack's egg product when `basePackCode` is set, else the SKU's own; `piecesPerPak` = the base pack's `eggsPerPack` for a SKU with a base pack, else the SKU's own; `piecesPerBox` = `piecesPerPak × boxCapacityMap[boxMode][basePackCode]` when the SKU has a box mode and the capacity exists, else null; `isBoxMode` = the SKU has a box mode. Never the box row's own `eggsPerPack` / `eggProduct`.
  - `piecesPerUnit(egg: SkuEgg, unit: 'pak' | 'box'): number | null`: pak → `piecesPerPak`; box → `piecesPerBox` when `isBoxMode`, else `piecesPerPak` (`N30B`: 150); null when box is asked of a box-mode SKU with no capacity.
  - `buildReturnLines(input: { rows: ReturnRowInput[]; outflowIdByProduct: Record<string, string | null | undefined>; remainingNativeByProduct: Record<string, number>; unitByProduct: Record<string, string | undefined>; categoryByProduct: Record<string, InventoryCategory>; expectedPriorByProduct?: Record<string, number>; ids: (rowKey: string, disposition: ReturnDisposition) => string }): { ok: true; lines: ReturnLineInput[] } | { ok: false; kind: 'unresolved'; product: string } | { ok: false; kind: 'exceeds'; product: string; exceedsBy: number }` with `ReturnRowInput = { key: string; skuCode?: string; eggProduct: string; inPieces: boolean; buckets: Record<ReturnDisposition, number> }`; `inPieces` says whether the row's buckets were typed in pieces (pack rows, converted with `piecesToNative`) or already in the egg's native unit (the dialog's loose-egg rows). One return entry per non-zero bucket per row; a running native remainder per egg product shared across rows. A bucket that overshoots the remainder by at most `tolerance = (unitByProduct[p] === 'kg' ? piecesToNative(1, 'kg') : 0) + 1e-9` is clamped to the remainder; a larger overshoot returns `exceeds` with `exceedsBy` in native units. `expectedPrior` is set on every return entry of an egg product the map has (the server checks it once per outflow row). Synchronous: every outflow id is resolved before the call.
  - `returnErrorCode(result: ReturnSubmitResult): ReturnErrorCode` and `voidReturnErrorCode(result: ReturnSubmitResult): VoidReturnErrorCode`: `NETWORK` when `result.kind === "network"`; else the first matching server prefix of the unions in §6.4 (`returnErrorCode` also maps `NO_ENTRIES`; `voidReturnErrorCode` also maps `VOID_BLOCKED` and SQLSTATE `40P01` → `DEADLOCK`); else `OTHER`.

#### 4. `src/lib/__tests__/returnLines.test.ts` (Create) — 2a-2

- vitest. **Proposed changes**, one case per bullet:
  - OSVN10B, 7 boxes, Pecah 172, Retakan → two entries on one outflow row: restock 70.19 kg and retakan 11.10 kg, both `skuCode = "OSVN10B"`, `product = "NEGERI BIASA"`, `expectedPrior = 0`.
  - Two rows on one kg-native egg whose rounded sum overshoots the remainder by 0.05 kg (less than one piece) → the second is clamped, result `ok`.
  - One row that overshoots by 0.5 kg → `{ ok: false, kind: 'exceeds', product: 'NEGERI BIASA' }` with `exceedsBy` ≈ 0.5.
  - A count-native egg (KAMPUNG MERAH) overshooting by 1 piece → `exceeds`.
  - A Negeri return of the PO line's full sold quantity (15,480 pieces against 998.71 kg sold) → `ok`, one restock entry of 998.71 kg.
  - A row whose product has no outflow id → `{ ok: false, kind: 'unresolved' }`.
  - `buildSkuEggMap` with the live `box osave` capacities → OSVN10B: `piecesPerBox 180, piecesPerPak 10, eggProduct "NEGERI BIASA", isBoxMode true`, ignoring the box row's own `eggsPerPack = 1` and empty `eggProduct`; with no capacity → `piecesPerBox null`, `eggProduct` kept.
  - `piecesPerUnit`: N30B box → 150; OSVN10B pak → 10; OSVN10B box with no capacity → null.
  - `returnErrorCode` maps each server prefix; `kind: "network"` → `NETWORK`; `voidReturnErrorCode` maps `VOID_BLOCKED` and `40P01`.

#### 5. `src/types/returns.ts`, `src/lib/returnRpc.ts` (Modify) — 2a-2

- **Proposed changes**: `ReturnLineInput.expectedPrior?: number`; `callRecordReturn` maps it to `expected_prior` only when set. The unused `ReturnRecord` interface is deleted (item 6's `ReturnRow` is the only row type). `returnRpc.ts` adds `callVoidReturn(returnId: string, reason: string): Promise<ReturnSubmitResult>` (RPC `void_return`; the same `classifyOutflowError` network / server classification as `callRecordReturn`).

#### 6. `src/hooks/usePriorReturns.ts` (Modify) — 2a-2

- **Proposed changes**: define and export `ReturnRow` (the selected columns of a `returns` row: `id, outflow_id, sku_code, product, category, quantity, disposition, reason, return_date, created_at, user_id, user_email, voided_at, void_reason, voided_by`); extract `summarizeReturns(rows: ReturnRow[]): Record<string, OutflowReturns>` keyed by outflow id (pure, exported, tested in item 9), which sums non-voided rows only and sets a new `OutflowReturns.anyReturns: boolean` (true when any row, voided or not, exists for that outflow row); extract `fetchReturnsForOutflows(ids: string[], opts?: { includeVoided?: boolean }): Promise<ReturnRow[]>` (chunked by 100 ids; `.is("voided_at", null)` unless `includeVoided`). `usePriorReturns` keeps its signature, fetches with `includeVoided: true` and calls `summarizeReturns`, so feed bubbles and the dialog cap exclude voided returns while `anyReturns` still sees them. Its query key becomes `["prior-returns", sortedIds]`, exported as `priorReturnsKey(ids)` for items 16 and 17. The three test files that mock this module (`GroupedActivityLog.returns.test.tsx:28`, `GroupedActivityLog.editButton.test.tsx:22`, `RecordReturnDialog.test.tsx:52`) must export the new names from their mock factories, or vitest throws "No export defined on mock".

#### 7. `src/types/deliveries.ts` (Modify) — 2a-2

- **Proposed changes**: `RETURN_REASONS` const and `ReturnReason` type (§4.3); `DeliveryLine` (camelCased §6.2.1 columns); `DeliveryPo.eggTotals: { product: string; quantity: number; outflowId: string | null }[]`; `DeliveryFlags` gains `awaitingWarehouse`, `needsClaimRef`, `unresolved`; `LineReturnSummary = { okPieces: number; pecahPieces: number; restockNative: number; retakanNative: number; writeoffNative: number; firstReturnDate: string | null; lastUserEmail: string | null }`; `DeliveryLineView = DeliveryLine & { piecesTotal: number; physical: boolean; returns: LineReturnSummary | null; mismatch: boolean }`; `LineSummary = { lineCount: number; awaitingCount: number; needsRefCount: number; pecahWithoutRef: number; kurangPieces: number; unresolvedCount: number; claimRowCount: number; claimPecah: number; full: boolean }`; `DeliveryListItem` gains `lines: DeliveryLineView[]`, `lineSummary: LineSummary`, `requiresClaimRef: boolean`; `DeliveryListFilters` gains `awaitingWarehouse`, `needsClaimRef`, `unresolved`, `kurang`, `claim` (booleans, OR-combined); `DeliveryLogRow` drops `piecesRetak`; new `ClaimCsvRow`; `ExpiryRule.shelfDays: number | null` and `shelfMonths: number | null`.

#### 8. `src/lib/deliveryFlags.ts` (Modify) — 2a-2

- **Proposed changes**: `NO_PHYSICAL_RETURN`; `lineHasPhysicalReturn(line)`; `summarizeLineReturns(rows: ReturnRow[], eggOutflowIds: string[], skuCode: string, unit: string | undefined): LineReturnSummary | null` (non-voided rows on those outflow rows with that `sku_code`; pieces per bucket with `nativeToPieces(native, unit)` and then summed, as `ReturnBubble` does; `firstReturnDate = min(return_date)`; `lastUserEmail` from the row with the greatest `created_at`); `buildDeliveryItems(pos: DeliveryPo[], deliveries: Delivery[], lines: DeliveryLine[], returns: ReturnRow[], requiresRefByBuyer: Record<string, boolean>, unitByProduct: Record<string, string | undefined>): DeliveryListItem[]` (the existing two-argument signature gains four parameters; `unitByProduct` is `useItemTypes().conversionMap`'s unit per product; a delivery with `poState !== "ok"` keeps every flag false, the Phase 1 rule); `summarizeLines(lines: DeliveryLineView[], requiresRef: boolean, delivered: boolean): LineSummary`; `rowSummaryText(summary: LineSummary): string`; `filterDeliveryItems` gains the five filter keys. Derived warehouse figures attach to the physical-return line only.

#### 9. `src/lib/__tests__/deliveryFlags.test.ts` (Modify), `src/lib/__tests__/deliveryLinesSync.test.ts` (Create) — 2a-2

- **Proposed changes**: the five existing `buildDeliveryItems(pos, deliveries)` calls (`deliveryFlags.test.ts:93, 106, 112, 122, 134`) pass the four new arguments (`[]`, `[]`, `{}`, `{}`). Sheet rows as fixtures, each with its expected result:
  - 2610319: two Osave lines with a claim ref, returns with matching `sku_code` → `awaitingWarehouse` false on both, `needsClaimRef` false.
  - 2610382: P25 `pecah` and P25 `kurang`, buyer without `requires_claim_ref` → orange on the `pecah` line only; `returns` summary on the `pecah` line only; no red.
  - 2610421: one merged `tukar_guling` line, 36 boxes, with a claim ref, no returns → `awaitingWarehouse` true, `needsClaimRef` false.
  - 2610448: N30 `kurang` without a claim ref → not red; NO10 `tukar_guling` typed in pak with a claim ref → `piecesTotal = 550`.
  - 2610574: AMTG `kurang` 123 → no orange; `kurangPieces = 492`.
  - 2610598: KpO6 `revisi_po` → no orange; `full` false.
  - A `lebih` line → no orange.
  - A `masih_ditanyakan` line → `unresolved` true, `unresolvedCount = 1`.
  - A voided PO (`poState = "voided"`) → every flag false.
  - A return with null `sku_code` → does not clear orange.
  - A line whose returned pieces ≠ `quantity × pieces_per_unit` → `mismatch` true.
  - The red total counts retakan + writeoff pieces on flagged lines without a claim ref only.
  - `summarizeReturns` reproduces today's `bySku` sums and sets `anyReturns` when the only row is voided.
  - The sync test reads item 1's migration file and asserts that the partial index's reason list equals `NO_PHYSICAL_RETURN` (pattern: `reconViewsSync.test.ts`).

#### 10. `src/lib/expiryRules.ts`, `src/lib/__tests__/expiryRules.test.ts` (Create) — 2a-2

- **Proposed changes**: `resolveShelfLife` and `expectedExpiry` per §6.8; callers pass `basePackCode ?? code`. Tests, each "input → expected":
  - keyword + SKU row, keyword-only row and the `(null, null)` row present → the keyword + SKU row wins; without it, the keyword-only row; without both, the default.
  - customer "Astro CKD" → matches keyword "Astro".
  - OSVKP6O on Sayurbox → resolved as KP6O → 1 month.
  - Osave, 19 Oct 2026 → 19 Nov 2026 (from the `(null, null)` row).
  - 31 Oct 2026 + 1 month → 30 Nov 2026.
  - Sayurbox P25, 21 Oct 2026 + 21 days → 11 Nov 2026; Astro P25 → the Astro default, 22 days → 12 Nov 2026.
  - No rows → null.
  - A delivery date `2026-10-19` yields `2026-11-19` regardless of the machine's time zone (local-date arithmetic, no UTC shift).

#### 11. `src/lib/deliveryExport.ts`, `src/lib/__tests__/deliveryExport.test.ts` (Modify) — 2a-2

- **Proposed changes**: `DELIVERY_LOG_COLUMNS` = the 21 headers of §6.7.1 verbatim; `RETURN_REASON_LABEL_ID`; `itemToLogRows(item): DeliveryLogRow[]` (one row per delivery line, or one row with columns 9–11 and 13–21 blank and column 12 filled; warehouse columns from `line.returns` on the physical-return line only; Qty Diterima per the reason rule, in the line's unit); `buildClaimCsv(items)` with the ten Klaim headers and `claimCsvFilename(from, to)`; the source-file header comment of §6.7.1. The existing `buildDeliveryItems` call at `deliveryExport.test.ts:48` passes the new arguments. Tests: the joined header string equals the sheet's row 2 exactly; one row per line; "Butir OK (ke stok)", "Butir Pecah", "Tgl Barang Balik" and "Paraf Gudang" filled from fixture returns on the physical-return line and blank on the `kurang` line of the same SKU; Full "Ya" on a Terkirim faktur with no lines and "Tidak" with a line of quantity 7; Qty Diterima 86 for `pecah` (PO 86), 787 for `kurang` (PO 910, line 123), `packQty + quantity` for `lebih`; the summary row after one blank row, with column 1 "Total selisih kurang (butir)" and column 11 = 492 for the 2610574 fixture (123 × 4), and 0 when the range has no `kurang` line; claim CSV rows (physical-return lines of flagged buyers only: Osave and Family Mart) newest first, with no summary row.

#### 12. `src/lib/reconExport.ts`, `src/lib/reconXlsx.ts`, `src/lib/__tests__/reconViewsSync.test.ts` (Modify) — 2a-2

- **Proposed changes**: `ReconJenis` and `RECON_JENIS` gain `"retur_batal"`; `RECON_FLAGS` gains `"retur-batal"` and `"retur-dibatalkan"`; `RECON_SCHEMA_VERSION` becomes 2. In `reconXlsx.ts` the Retur tab's filter (`jenis.startsWith("return_")`) also includes `retur_batal`, and the Faktur tab's Retur column skips `return_restock` rows flagged `retur-dibatalkan`. `reconViewsSync.test.ts:12` reads item 1's migration file instead of `20261029000000_recon_views.sql` and also asserts that the new jenis and both flags appear in the view SQL.

#### 13. `src/components/RecordReturnDialog.tsx` (Modify) — 2a-2

- **Proposed changes**: the `skuMap` memo becomes `buildSkuEggMap(skus, boxCapacityMap)` (box rows use `piecesPerBox`; a box SKU with `piecesPerBox` null keeps today's fallback, the box row's own placeholder fields, so that egg still gets a native-unit row and feed attribution does not change); the async `findRelatedEntryId` fallback runs for every unresolved product before the pure builder is called; the `handleConfirm` resolution loop (`RecordReturnDialog.tsx:316–360`) becomes one `buildReturnLines` call (ids from the existing `makeId()`; no `expectedPrior`); an `exceeds` result shows the dialog's existing over-maximum message for that egg product; the "unresolved" toast keeps naming the row label (the SKU code) by mapping the builder's `product` back to the row. `setBucket`, the outbox enqueue and every prop stay. The 14 existing tests in `src/components/__tests__/RecordReturnDialog.test.tsx` pass unchanged (its mock factory for `@/hooks/usePriorReturns` exports the new names, item 6).

#### 14. `src/components/GroupedActivityLog.tsx` (Modify) — 2a-3

- **Proposed changes**: `useOrderReturns.skuToEgg` (`GroupedActivityLog.tsx:1061–1072`) reads `buildSkuEggMap(skus, boxCapacityMap)[sku].eggProduct` instead of its own map, and `useOrderReturns` adds `useItemTypes()` for `boxCapacityMap`; no visual change. The Edit pesanan guard (`GroupedActivityLog.tsx:376–381`) reads `returnsMap[id].anyReturns` instead of `.total > 0`, so an order whose only return was voided stays non-editable, as `correct_order`'s `HAS_RETURNS` has it. `src/hooks/useVoidEntry.ts` and `src/lib/activityGrouping.ts` are not changed.

#### 15. `src/hooks/useDeliveries.ts` (Modify) — 2a-3

- **Proposed changes**: `PO_COLUMNS` and the `PoRow` Pick type add `egg_totals`; `rowToPo` maps `egg_totals[].outflow_id` (null when a row lacks it); `fetchDeliveriesInRange` selects `"*, delivery_lines(*)"` and returns `{ deliveries, lines }` (`rowToDelivery` is unchanged; the embedded lines are mapped separately with `rowToLine`); `useDeliveries` calls `fetchReturnsForOutflows(ids)` (item 6, non-voided) for the union of the items' egg outflow ids, `useBuyers()` for the `requires_claim_ref` map by lower-cased name, `useItemTypes().conversionMap` for `unitByProduct`, then `buildDeliveryItems` with all six arguments. `useOpenDeliveries` is unchanged.

#### 16. `src/hooks/useDelivery.ts` (Modify) — 2a-3

- **Proposed changes**: `DeliveryDetailData` gains `lines: DeliveryLine[]` and `eggOutflowIds: string[]`; `fetchDeliveryDetail` selects the delivery with `delivery_lines(*)` embedded; `eggOutflowIds` comes from the live PO's `eggTotals` when `poState = "ok"`, and when `poState = "voided"` from the voided `activity_logs` rows' `metadata->>'relatedEntryId'` that the existing `voidedPoState` query reads (it adds `metadata` to its select), so returns and lines still render as history. New mutations next to `save`: `ensureDelivery(po, savedBy)` (the create path of `save` with an empty patch, `upsert(…, { onConflict: "invoice_ref_norm", ignoreDuplicates: true })` so a row created a moment earlier keeps its `pic`, then `.select("id")`; this is §6.5.5 step 1); `upsertLine(line)` (on `id`; sets `updated_at` from the client like `save`; maps 23505 to `DUPLICATE_LINE` / `DUPLICATE_PHYSICAL_LINE` by constraint name); `deleteLine(id)`; `setClaimRefForDelivery(deliveryId, claimRef)` (fills lines with null `claim_ref`). Invalidation after each: `['delivery', norm]`, `['deliveries']` and `priorReturnsKey(eggOutflowIds)`.

#### 17. `src/hooks/useDeliveryReturns.ts` (Create) — 2a-3

- **Proposed changes**: `useDeliveryReturns(eggOutflowIds)` → every `ReturnRow` from `fetchReturnsForOutflows(ids, { includeVoided: true })` under `priorReturnsKey(ids)`, grouped into save groups by (`outflow_id`, `sku_code`, `created_at`), plus `summarizeReturns` of the non-voided rows; `recordLineReturn(input)` composing `buildReturnLines` (with `expectedPrior`) and `callRecordReturn` with the attempt's ids, `reason` = the line's reason code, `buyerName` = `po.buyerName`, and the "Coba lagi" resend of §6.5.5 step 4; `voidSaveGroup(rowId, reason)` calling `callVoidReturn` once and mapping errors with `voidReturnErrorCode`.

#### 18. `src/hooks/useExpiryRules.ts` (Create) — 2a-3

- **Proposed changes**: `useExpiryRules()` reads `expiry_rules` (`select("*")`, mapped to `ExpiryRule` with nullable `shelfDays` / `shelfMonths`; `staleTime` one hour; query key `["expiry-rules"]`). Nothing reads the table today; this is its first reader.

#### 19. `src/components/deliveries/DeliveryReturnLines.tsx` (Create) — 2a-3

- **Proposed changes**: the Retur section of §6.5: the faktur-level No. Retur OSV field with "Terapkan ke semua baris"; "Tambah baris retur" with the SKU picker (a SKU on two PO lines of one PO offered once, quantities summed), its unit choice through `piecesPerUnit`, the one-physical-return-line-per-SKU rule, and the per-line "tidak cocok dengan PO" state for a `sku_code` no longer on the live PO (§6.5.8); one `ReturnLineRow` per delivery line (store fields, warehouse fields including "Butir diterima", piece equivalents, the blocks and hints of §6.5.3 with piece caps shown through `Math.floor`, lock state, Simpan, delete with warning); store-only versus stock-moving save; the return-entry id lifecycle (`useRef`, pinned while frozen); the frozen state after NETWORK with "Coba lagi"; the confirmation dialog (the §6.5.4 template); keyboard rules; "Tambah retur kedua". Hooks: `useDelivery`, `useDeliveryReturns`, `usePackSKUs`, `useItemTypes`, `useExpiryRules`, `useAuth`.

#### 20. `src/components/deliveries/ReturnHistory.tsx` (Create) — 2a-3

- **Proposed changes**: "Riwayat retur" of §6.5.7 grouped by save group; "Batalkan retur ini" shown when `useVoidEntry().canEdit(group.createdAt, group.userId)` is true, with `isAdmin` passed down from `DeliveryDetail` (which already receives it); "Anda" when `user_id` equals the signed-in user; O/R/H through `ReturnCodeParts`; the "ditarik dari stok" text derived from the voided row; the void dialog with its reason field.

#### 21. `src/components/deliveries/DeliveryDetail.tsx` (Modify) — 2a-3

- **Proposed changes**: render `DeliveryReturnLines` and `ReturnHistory` after the two Phase 1 cards; wrap those cards in `Collapsible`, collapsed when the delivery has a delivery line that is not warehouse-done (orange); the PO line list shows each SKU's `unit_label` (replacing the fixed "pak" at `DeliveryDetail.tsx:206`) and adds its piece equivalent; "Diterima penuh" in the Retur section header; the Phase 1 banners for `poState` and `duplicatePos` stay, and the `duplicatePos > 0` banner now names both POs' buyer and date (§6.10), under which the Retur section refuses the warehouse save.

#### 22. `src/components/deliveries/__tests__/DeliveryReturnLines.test.tsx`, `src/test/renderWithQuery.tsx` (Create) — 2a-3

- vitest + testing-library. `renderWithQuery.tsx` (new, shared) wraps a component in a fresh `QueryClientProvider`; the test mocks `@/hooks/useDelivery`, `@/hooks/useDeliveryReturns`, `@/hooks/usePackSKUs`, `@/hooks/useItemTypes`, `@/hooks/useExpiryRules`, `@/hooks/useAuth`, `@/hooks/useUserRole`, `@/hooks/useVoidEntry`, `@/integrations/supabase/client` and `sonner` with factories, so the transitive import of `GroupedActivityLog` (for `ReturnCodeParts`) loads without a Supabase client.
- **Proposed changes**, one case per bullet:
  - CUJ 1's inputs → the confirmation text equals the §6.5.4 template filled with CUJ 1's values (the string quoted in CUJ 1).
  - Pecah blank → no confirmation, no RPC call, toast "Tersimpan".
  - Pecah 0, diterima 1260 → one restock-only return entry.
  - A box SKU typed in pak → 10 pieces per unit; N30B in box → 150.
  - A SKU with a physical-return line → the picker offers only non-physical reasons for it.
  - Reason `kurang` and `lebih` → warehouse side disabled with the hints.
  - The blocks of §6.5.3 each fire: cumulative diterima over the line, egg-level cap including a null-SKU return, Pecah > diterima, diterima 0, non-integer pieces.
  - A SKU with prior non-voided returns → inputs locked; tapping "Tambah retur kedua" unlocks them and prefills "Butir diterima" with line pieces − prior pieces.
  - Enter in Pecah opens the confirmation; Enter confirms.
  - Confirm → `callRecordReturn` receives two return entries, `skuCode = "OSVN10B"`, `product = "NEGERI BIASA"`, restock 70.19 kg, retakan 11.10 kg, `expectedPrior = 0`, `reason = "pecah"`, `buyerName` = the PO's buyer.
  - A `NETWORK` result → inputs frozen, button "Coba lagi"; tapping it resends the same ids.
  - `PRIOR_MISMATCH` → its message and a reload of the SKU's returns.
  - `RETURN_EXCEEDS_OUTFLOW` → the message with the remaining cap in pieces for the SKU.
  - Delete on a line with returns → the warning names "retur tanpa baris".

#### 23. `src/pages/Deliveries.tsx` (Modify) — 2a-3

- **Proposed changes**: the five new list chips of §6.6 (counts, or pieces for Kurang and Klaim); the row summary text from `lineSummary`; two export buttons, "Ekspor log" and "Ekspor klaim", both over every item in the range regardless of chips; row colour: orange left border for `awaitingWarehouse`, red for `needsClaimRef`, both shown when both apply (orange border, red summary text); the `placeholder` item (`Deliveries.tsx:69–71`) gains `lines: []`, an empty `lineSummary` and `requiresClaimRef: false`.

#### 24. `src/types/catalog.ts`, `src/components/catalog/SKUDialog.tsx`, `src/hooks/usePackSKUs.ts` (Modify) — 2a-4

- **Proposed changes**: `PackSKU.unitLabel: 'pak' | 'box'` and `PackSKUInput.unitLabel` in `src/types/catalog.ts`; `usePackSKUs`'s row mapping and the `addSKU` / `updateSKU` payloads read and write `unit_label`; the dialog's zod schema gains `unitLabel`, and the dialog gets a two-option select "Satuan di faktur" (pak / box) defaulting to box when its derived `kind` (`SKUDialog.tsx:38`, computed from `basePackCode` at line 93, not stored) is "box".

#### 25. `src/components/catalog/BuyerDialog.tsx`, `src/components/catalog/BuyerList.tsx`, `src/hooks/useBuyers.ts`, `src/types/quickOutflow.ts` (Modify) — 2a-4

- **Proposed changes**: `Buyer.requiresClaimRef: boolean`; the dialog gets a checkbox "Perlu No. Retur (klaim telur pecah)"; `addBuyer` and `updateBuyer` write it; the `buyers` query maps it; `BuyerList` shows a short "Perlu No. Retur" tag on flagged buyers.

#### 26. `src/lib/catalogDependencies.ts` (Modify) — 2a-4

- **Proposed changes**: `checkSKUDependencies` also counts `delivery_lines` and `returns` rows by `sku_code` (exact match) and adds them to `dependencyDetails`.

#### 27. `src/lib/duplicateOrder.ts`, `src/hooks/useDuplicateOrderCheck.ts`, `src/components/QuickOutflowBuilder.tsx`, `src/lib/__tests__/duplicateOrder.test.ts` (Modify) — 2a-4

- **Proposed changes**: `OrderToCheck.invoiceRef?: string`; `DuplicateMatch.kind: 'near' | 'ref'` with, for `ref`, the existing PO's `buyerName` and `date`; `useDuplicateOrderCheck` runs a second, unwindowed query (`purchase_orders` with `invoice_ref` `ilike` the trimmed ref: exact, case-insensitive, any date; the view already excludes voided rows) next to the existing 15-minute near-duplicate query; the pure matcher also flags two queued orders of one batch that share a ref; the builder's existing confirm dialog gains the sentence "No. Faktur `<ref>` sudah dipakai PO `<buyer> <date>`" (locale key under `outflow`). Warns, never blocks. Tests: a ref match on another date → `kind: 'ref'` with the existing PO's buyer and date; a near-duplicate stays `kind: 'near'`; two batch orders with one ref → flagged.

#### 28. `src/locales/en.ts`, `src/locales/id.ts` (Modify) — 2a-4

- **Proposed changes**: add every key to both files. Under `deliveries`: section title, SKU picker and unit choice, reason labels (fixed Indonesian in both), unit words, piece-equivalent templates, "Butir diterima", the §6.5.4 confirmation template, hints (`stockHintKurang`, `stockHintLebih`, the catalog-factor hint, "Tidak ada barang balik", the unresolved marker), lock / second-return / frozen-after-network texts, the two unique-violation messages, every `ReturnErrorCode` and `VoidReturnErrorCode` message (the Indonesian text is the examples of §6.5.5 and §6.5.7, including the new `voidErrNotAllowed`, `voidErrWindowClosed`, `voidErrInsufficientStock`, `voidErrBlocked`, `voidErrDeadlock`; English mirrors them), Riwayat retur labels including the "ditarik dari stok" text, the void dialog, list chips and summaries, the two export buttons, the claim CSV filename, the delete warning; under `catalog`: "Satuan di faktur", "Perlu No. Retur (klaim telur pecah)" and the short tag "Perlu No. Retur"; under `outflow`: the duplicate-ref sentence.

#### 29. `scripts/import-sheet-lines.mjs`, `scripts/lib/sheetImportRules.mjs`, `scripts/__tests__/sheetImportRules.test.ts` (Create) — 2a-4

- **Proposed changes**: implement §6.9. `sheetImportRules.mjs` holds the pure rules (sheet-code resolution against a PO's line codes, unit resolution, reason mapping, derived quantity, same-key merge, note composition, the customer-to-buyer check) as exported functions with no I/O; `sheetImportRules.test.ts` (vitest; `vitest.config` includes `scripts/**/*.test.ts`) covers each with the sheet rows named in §6.9: 2610448 NO10 "55" → pak, 10 pieces; 2610421 "N 30" + "N30" → one `tukar_guling` line of 36; 2610598 KpO6 → quantity derived from Qty Diterima; "Pecah 19,kurang 2" → `lainnya` with the text kept; a code with two candidates and one on the PO → resolved; none on the PO → listed. `import-sheet-lines.mjs` takes `--xlsx <path>` and `--dry-run`, is run as `node --env-file=.env scripts/import-sheet-lines.mjs …` (Node 20.6 or later; no `dotenv`), builds its own `@supabase/supabase-js` client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the app's `client.ts` cannot be imported from Node), refuses to run unless that URL contains `lgtixzpjbkzapecirbfj`, signs in with `IMPORT_EMAIL` / `IMPORT_PASSWORD`, reads `pack_skus`, `item_types.box_capacities` (asserting the `box osave` rows for N10B, N10O and KP6O exist) and `drivers`, inserts one delivery line at a time after reading the faktur's existing lines (§6.9 step 8), and writes the report that item 33 commits.

#### 30. `docs/uuid-migration/PLAN.md`, `docs/OPERATIONS.md`, `docs/spec-export-rekonsiliasi.md` (Modify) — 2a-4

- **Proposed changes**: PLAN.md's location table lists the code locations that read `delivery_lines.sku_code`, `unit_label`, `pieces_per_unit` and `returns.sku_code` as class S (snapshot, never re-resolved) and the `expiry_rules.sku_code` reader as class R (resolved on read, exact match over live base pack codes), in the table's own format. OPERATIONS.md gets the `void_return` runbook (who may void; the compensating outflow; what `INSUFFICIENT_STOCK` and `VOID_BLOCKED` mean; the `void_outflow` interaction of §6.3.3; the owner's correction after the next physical count, §8) and the import script's usage line. The reconciliation spec gets the `jenis` value `retur_batal` (negative `retur`), the flags `retur-batal` / `retur-dibatalkan`, and the schema version 2.

#### 31. `src/integrations/supabase/types.ts`, `supabase/functions/inventory-assistant/tools.ts` (Modify) — 2a-4

- **Proposed changes**: regenerate the types with `generate_typescript_types` against the Supabase **branch** on which item 1 was applied (rollout step 2b), commit them in the PR, and drop the `as any` casts on `returns` and `delivery_lines` that the generated types now cover; production gets the same schema at step 3. `getReturnsTool`: `.is("voided_at", null)` on its query; the initial totals object becomes `{ restock: 0, retakan: 0, writeoff: 0 }`; the input schema's disposition enum (`tools.ts:129`) and the filter (`tools.ts:340`) accept `retakan`; `reason` is returned as stored (a reason code on Phase 2 rows, free text on older ones). Deployed with `deploy_edge_function` after the migration (rollout step 3); git push does not deploy it (CLAUDE.md).

#### 32. `.claude/agents/data-integrity-reviewer.md` (Create: commit the untracked file) — 2a-4

- **Proposed changes**: none to its content; it is committed with the PR so rollout step 2's review is reproducible.

#### 33. `docs/sheet-import-2026-10.md` (Create, after the live run) — 2b

- **Proposed changes**: the import report of CUJ 7, including the ids of the `deliveries` rows the script created (the rollback's second delete statement reads them).

### Verification plan

- **Verify gate**: `npm run verify` (the Supabase ref guard, `tsc --noEmit -p tsconfig.app.json`, the full vitest run) passes before every git push; `npm run build` and `npm run lint` pass before the PR is opened. New or changed suites: items 4, 9, 10, 11, 12, 22, 27, 29, plus the unchanged dialog suite (item 13). Flake fallback per CLAUDE.md (`--pool=forks --no-file-parallelism`).
- **RPC tests** (item 2, on a Supabase branch with item 1 applied; rollout step 2b). Each case is "action → expected result"; "reconcile" means `select * from reconcile_inventory()` returns 0 rows.
  1. R1: `record_return` with a restock and a retakan entry, both carrying `expected_prior = 0` → both rows written, `user_email` = the caller's email, the child inflow carries `return_id`, reconcile.
  2. R2: the same call with `expected_prior = 1` → `PRIOR_MISMATCH`, no rows written.
  3. R3: R1's call resent with the same ids → success, no new rows.
  4. R4: `void_return` on either row of R1's save group, after a sale emptied the original batch → both rows voided, two compensating outflows with `void_return_id`, each deducted FIFO from the product's oldest live batch with stock, reconcile.
  5. R5: `void_return` again on the same group → returns without error, nothing changes.
  6. R6: user B (no app admin role) voids a group user A recorded → `NOT_ALLOWED`.
  7. R7: user A voids their own group whose `created_at` was set to 49 hours ago → `VOID_WINDOW_CLOSED`.
  8. R8: user A, after 48 h, voids a group already voided → no-op, no error.
  9. R9: the RETAKAN child holds fewer pieces than the group's retakan quantity → `INSUFFICIENT_STOCK`, nothing written, both rows still non-voided.
  10. R10: a retakan return whose child inflow has no `return_id` (legacy) → voided the same way.
  11. R11: a restock return on an outflow that `void_outflow` has voided → marked voided, no compensating outflow.
  12. R12: `record_return` after R4 with the same quantities → accepted, restocked into the same batches, reconcile.
  13. R13: §6.3.3 example 1 end to end → after `void_outflow(O)`: B 0, C 100, V voided, reconcile.
  14. R14: example 2 → B1 100, B2 100, reconcile.
  15. R15: example 3 → B 100, reconcile.
  16. R16: example 4 → B 40, C 100, reconcile.
  17. R17: example 3 continued by a sale of 50 after R2 → `void_outflow(O)` raises `VOID_BLOCKED`, no batch changed, O and V still live, reconcile.
  18. R18: `void_outflow` on an order with no returns → the same batch remainders the current body produces.
  19. R19: `v_recon_ledger` after R4 → the compensating outflow is a `retur_batal` row with negative `retur`, `return_id` = the voided return, flag `retur-batal`; the voided return row carries `retur-dibatalkan`; `v_recon_daily`'s closing balance equals the sum of inflow remainders.
  20. R20: `correct_order` on an order whose only return is voided → `HAS_RETURNS`.
- **Manual**: 375 px phone (no sideways scroll, one card per delivery line); tablet split view keeps the list scroll position after a save; a user without the app admin role cannot void another user's save group, or their own after 48 h (button hidden; a direct RPC call is refused); after a warehouse save, the Activities card shows the bubble under the delivery line's SKU; an old-bundle return clears the orange flag on the line and makes a warehouse save from a form loaded before that return fail with `PRIOR_MISMATCH`; the 21-column log opens in Excel (id-ID) with 21 columns and the claim CSV with 10.
- **Launch verification queries.** `<launch>` is the timestamp of rollout step 5 (the merge to main); `<migration_applied>` that of step 3; `<test_ref>` the No. Faktur of the step 4 test PO. V2–V4 must return 0 rows. V1 lists returns recorded since launch with no matching delivery line (Activities dialog, old bundle); the office admin adds each missing delivery line, V1 is re-run and must then return 0 rows.

```sql
-- V1. non-voided returns since launch, under a SKU, on a logged faktur, with no delivery line for that SKU:
--     each is a return typed before its delivery line (old bundle, Activities dialog); admin adds the delivery line
select r.id, d.invoice_ref, r.sku_code from returns r
join activity_logs al on al.action_type = 'outflow' and al.voided_at is null
                     and al.metadata->>'relatedEntryId' = r.outflow_id::text
join deliveries d on d.invoice_ref_norm = upper(btrim(al.metadata->>'invoiceRef'))
where r.created_at > '<launch>' and r.voided_at is null and r.sku_code is not null
  and d.invoice_ref_norm <> upper('<test_ref>')
  and not exists (select 1 from delivery_lines dl where dl.delivery_id = d.id and dl.sku_code = r.sku_code);
-- V2. ledger consistent
select * from reconcile_inventory();
-- V3. every non-voided restock fully allocated
select r.id from returns r where r.disposition = 'restock' and r.voided_at is null
  and r.quantity - coalesce((select sum(quantity_restored) from return_restocks where return_id = r.id), 0) > 1e-9;
-- V4. every voided return with a stock effect has its compensating outflow (live, or voided together with its order),
--     and every retakan since the migration has its child batch
select r.id from returns r where r.voided_at is not null
  and (r.disposition = 'retakan' or (r.disposition = 'restock'
       and exists (select 1 from outflows o where o.id = r.outflow_id and o.voided_at is null)))
  and not exists (select 1 from outflows v where v.void_return_id = r.id)
union all
select r.id from returns r where r.disposition = 'retakan' and r.created_at > '<migration_applied>'
  and not exists (select 1 from inflows i where i.return_id = r.id);
```

- **Per-faktur check** after rollout step 8: for each faktur re-entered from the sheet, the pieces over its non-voided returns, per bucket, equal the sheet's Butir OK and Butir Pecah within 1 piece each.

### Rollout checklist (ordered; brief "Staging") — Phase 2b

1. **Pre-flight on production**: `select * from reconcile_inventory()` returns 0 rows; void the two stale test POs `TEST-Complete` and `TEST2` from Activities (they would otherwise show in the list, the exports and the import's matching); snapshot `select product, sum(remaining_butir) from inflows where voided_at is null group by product` and `select count(*), sum(quantity) from returns` (expect `count` = 136); step 9 compares against them.
2. **Review**: `npm run verify` passes; `data-integrity-reviewer` on item 1. The owner grants Novi the app admin role (a `user_roles` row with role `admin`, the way existing admins were added) and confirms `select has_role('<Novi uid>', 'admin')` is true and false for Yani and Dila (§9 item 2).
   - **2b. RPC tests and types**: `create_branch`; `apply_migration` of item 1 on the branch; `execute_sql` of item 2 → every R case passes; `generate_typescript_types` against the branch for item 31; delete the branch.
3. **Apply the migration** via `apply_migration`; record the time (`<migration_applied>`); deploy the `inventory-assistant` Edge Function (item 31) with `deploy_edge_function`. Post-apply checks: `select 1 from information_schema.columns where table_name = 'delivery_lines' and column_name = 'claim_ref_norm'` (expect 1 row); `select proname from pg_proc where proname = 'void_return'` (expect 1 row); `select count(*) from expiry_rules` (expect 14); `select unit_label, count(*) from pack_skus group by 1` (expect `box` = 4); `select count(*) from returns where user_email is null` (expect 0; a non-zero count names returns whose auth user was deleted, which stay as they are); `select relname from pg_class where relname in ('purchase_orders','v_recon_ledger') and reloptions::text like '%security_invoker=true%'` (expect 2 rows).
4. **Old-bundle check** (every phone still runs the Phase 1 bundle): record a test PO with No. Faktur `<test_ref>` (buyer Osave, one `OSVN10B` box) from an office device; from any phone, record a return for it through the Activities dialog with OK 170 and Retak 10 pieces; confirm the two `returns` rows have `user_email` set and the feed shows the bubble "180 diretur · 170O 10R".
5. **Merge the PR to main**; wait until the Vercel deployment is Ready; tap the update toast on the office devices; record the time (`<launch>`). On `/deliveries`, open `<test_ref>`, add a delivery line `OSVN10B`, 1 box, reason Pecah: confirm it shows "Sudah diretur: 170O 10R" from step 4 and no orange flag, and that the warehouse inputs stay locked until "Tambah retur kedua" is tapped. Then void that save group from Riwayat retur ("Batalkan retur ini"; confirm the "ditarik dari stok" text) and void the test PO from Activities, so the test movements net to zero.
6. **Catalog**: confirm `unit_label = box` on OSVN10B, OSVN10O, OSVKP6O and N30B in Catalog → SKU; confirm Osave and Family Mart show "Perlu No. Retur".
7. **Import**: `node --env-file=.env scripts/import-sheet-lines.mjs --xlsx <file> --dry-run`; the owner reviews unmatched (13 expected), shared invoice refs (3 expected), non-PO (7 expected), merged, derived-quantity and unit-doubt rows, and decides for each unmatched faktur whether to create the missing PO, fix the PO's No. Faktur, or leave it in the sheet; then `node --env-file=.env scripts/import-sheet-lines.mjs --xlsx <file>`; an immediate re-run reports zero new rows; commit the report (item 33).
8. **Warehouse counts 15 to 31 Oct**: for each egg product, apply the precondition of §6.10 and choose one route: admin re-enters with CUJ 2's warehouse save and the sheet's dates (50 to 60 fakturs, estimate; the note on each line shows the figures), or the owner posts one manual inflow after the next physical count; in both cases before the owner next reads the 23 to 31 October days of the reconciliation export.
9. **Verification**: queries V1–V4 and the per-faktur check; `count(*) from returns` = 136 + the rows written since the step 1 snapshot; the step 1 per-product snapshot is the owner's reference when reading V2's output and the reconciliation export.
10. **Retire the sheet**: office admins stop adding rows to the sheet; Novi uses the red and Klaim list chips.

### Rollback (ordered; no table or column is dropped)

1. `revoke execute on function public.void_return(uuid, text) from authenticated;` stops all voids.
2. Revert the frontend: promote the last Phase 1 deployment on Vercel. Phones on the Phase 2 bundle keep working except voiding (step 1): every column, table and view the new bundle reads stays in place (`voided_at`, `delivery_lines`, the `egg_totals` key, `unit_label`, `requires_claim_ref`). Phones on the reverted bundle run Phase 1 as before.
3. Leave the function bodies as they are: `record_return` with the voided filter and `expected_prior`, and `void_outflow` with the signed restore, keep the reconciliation invariant whether or not any return was voided (§6.3.3).
4. Leave `delivery_lines` in place: after launch day it is the only store-side record (quantities, reasons, No. Retur OSV). If a later cleanup must drop it, export the 21-column log and the claim CSV for the whole period first, and drop only once every device runs the Phase 1 build.
5. To reverse the import, the owner runs, in SQL: `delete from delivery_lines where source = 'sheet_import';` and then `delete from deliveries d where d.id in (<the ids item 33 lists as created>) and not exists (select 1 from delivery_lines where delivery_id = d.id);` (there is no delete policy on `deliveries`; a created row that admin has since added app lines to stays).
6. `v_recon_ledger` is not reverted: its `retur_batal` rows keep the daily balances right once a return has been voided, and the export client (item 12) reads the new jenis.

---

*Drafted with EGM*

---

## Implementation notes (2a build, 2026-11-02)

Where the build differs from the text above, and why. The code is the reference for these points.

**Stock side (migration `20261103000000`), after the `data-integrity-reviewer` pass**

1. **Per-batch restock room in `record_return` (review finding, high).** §6.3.1 change 3 excluded voided restocks from the per-batch `v_already`. That lets one batch receive up to twice what the order took from it and trips `inflows_remaining_bounds` when the compensating outflow drained a *different* batch (an older batch holding another order's restock: X sells A out, O sells from B, X's return refills A by 10, R restocks B, the void takes 10 from A and 40 from B, the corrected return of 50 would put 110 into B). The built rule caps each batch at what the order's family still holds out of it, `ded_b + vd_b − rs_all_b` (O's deductions, plus its live compensating outflows' deductions, minus every restock of O's returns, voided included), over O's batches and the compensating outflows' batches, oldest first. Without voids it equals the old `ded_b − rs_b`; its sum equals the unchanged total cap. Test R21.
2. **Consequence: `VOID_BLOCKED` is a backstop.** With that room rule `void_outflow`'s `delta_b ≥ 0` and no batch can leave `[0, quantity]`, so the error fires only on data written outside the RPCs. Checked read-only on production on 2026-11-02: 0 of the 62 live (outflow, batch) restock pairs have restocks above their deductions (a `recalculate_inventory_fifo` run after returns existed could have produced such pairs), so the starting state satisfies the invariant. The reviewer re-checked the fix and found it clean. §6.3.3's claim that "example 3 followed by a sale of 50" blocks was wrong even under the original rule (`delta_B = 0`, and B 50 is the true state). R17 now checks that example 1 followed by a sale of 50 voids to the true state (B 0, C 50). R13's intermediate live state is B 0, C 100 (the corrected return restocks into C, where the void took the eggs), not B 50, C 50; the end state is the same. R14 uses a prior sale of 95 so FIFO can produce "5 from B1, 45 from B2".
3. **Hardening (review, low).** `record_return` and `void_outflow` refuse a compensating outflow (`IS_RETURN_VOID`); a present, non-numeric `expected_prior` is `INVALID_ENTRY` instead of silently skipping the check; `void_return` compensates a restock on the outflow's own `product` / `category` rather than the return row's snapshot. Test R22. `void_outflow` locks inflows by (`date`, `created_at`, `id`) and `record_return` now does too.
4. **RPC test script.** Supabase branching needs the Pro plan (`create_branch` refused), so `supabase/tests/phase2_returns.sql` (R1–R22) was run on a **local Supabase stack** (Postgres 17, all repo migrations, via Podman) instead: **R1–R22 pass**. Running a fresh stack showed two pre-existing repo issues: `20261029000000_drivers.sql` and `20261029000000_recon_views.sql` share one version number (a fresh `supabase start` refuses the second; renumber `recon_views` before any branch or local reset), and the old Lovable migrations do not grant `authenticated` table privileges (production has them from hosted defaults), so a local stack needs `grant … to authenticated` before the app can read. It creates two throwaway auth users inside its transaction instead of taking the first two from `auth.users`, and keeps save groups apart with one `sku_code` per call (a single transaction shares one `now()`).

**Client**

5. `summarizeReturns`, `ReturnRow` and the column list live in the pure `src/lib/returnsSummary.ts` (re-exported from `usePriorReturns`), so `deliveryFlags.ts` stays free of React/Supabase imports. `usePriorReturns` keeps its effect-based fetch (it is not a TanStack query in the code); `priorReturnsKey` keys the delivery page's queries only, and the feed refetches on its own.
6. `buildDeliveryItems` keeps Phase 1's `{ items, hiddenNoInvoice }` result and takes a seventh optional `skuEggMap` (to state Qty Diterima in the line's unit when a box SKU is typed in pak); `summarizeLineReturns` takes `unitByProduct` instead of one unit. `buildLineViews` / `eggOutflowIdsOf` are shared by the list and the detail. `rowSummaryText` takes its labels from the locale.
7. `BuildReturnLinesResult` is one flat interface, not a union: the repo compiles with `strict: false`, which does not narrow unions.
8. `insufficientStockProduct` anchors on the category (`… (egg) is short`): §6.5.7's lazy regex would cut "NEGERI BIASA (RETAKAN)" to "NEGERI BIASA".
9. The Retur / Faktur tab changes of item 12 are in `reconExport.ts` (where those tabs are built), not `reconXlsx.ts`. `reconViewsSync.test.ts` reads labels from `20261029000000` and the ledger from `20261103000000`.
10. The return-entry builder is called from the line row (`DeliveryReturnLines.tsx`), which holds every input; `useDeliveryReturns` exposes `record` / `voidSaveGroup` and the save groups. `ensureDelivery` is a plain async function on `useDelivery`.
11. Locale keys for the Retur section sit under `deliveries.retur`.
12. Generated Supabase types were **not** regenerated (no branch), so the `as any` casts on `returns`, `delivery_lines`, `expiry_rules`, `buyers.requires_claim_ref` and `pack_skus.unit_label` stay; regenerate after the migration is applied (rollout step 3) and drop them.
13. The tracked `.env` carried the stale `VITE_SUPABASE_PROJECT_ID` (the URL was already live), so `npm run verify`'s ref guard blocked every fresh checkout; it now names `lgtixzpjbkzapecirbfj`.
14. Import script choices: `invoice_checked_by` takes the sheet's Paraf Admin column (Phase 1's mapping) and `pic` its PIC; a row with no Alasan and no Qty Retur adds no line; derived quantities use `|PO packQty − Qty Diterima|`; same-key rows with different units are not merged (listed); a dry run also writes the report file.
15. Owner review in the preview: the Klaim chip reads "Klaim · `<n>` faktur" (fakturs with a claim line), not §6.6's row count and range pecah total. With the chip on, each card lists its claim lines: SKU · quantity unit · `<p>` pecah (or "gudang belum") · No. Retur OSV (or a red "Tanpa No. Retur"). `LineSummary.claimPecah` is gone.
