# Spec: Export Rekonsiliasi (unified export)

Status: draft for implementation
Companion doc: `docs/reconciliation.md` (sources, sheet layout, gotchas, agent design)

## 1. Problem

EggKeep has two exports (`exportInflowsToCSV`, `outflowSkuExport.ts`) that were built for different purposes, use different units and vocabularies, and recompute kg from today's catalog. Neither can be placed next to the `[JS Online] Monitoring Stock` sheet or a Peachtree (P3) export and compared without manual rearranging. The admin reconciles by hand on scratch paper.

## 2. Goal

One button → one `.xlsx` whose tabs match the shapes the admin already works in (Final Check daily roll, P3 transaction ledger, invoice list). Numbers are the stored values, in native units, with a unit column on every row. A person with no knowledge of EggKeep internals can VLOOKUP it against P3.

### 2.1 How the file is compared — the reason for every tab

The shape of this workbook is dictated by two things outside EggKeep: the Peachtree (P3) exports the admin already produces, and the `[JS Online] Monitoring Stock` Google Sheet she already maintains. Each tab exists to line up against exactly one of those.

**The three records being reconciled**

| Record | Owner | How it is produced | Granularity |
|---|---|---|---|
| EggKeep | the app | this export | per movement, per invoice, per day |
| P3 (Peachtree) | admin re-keys invoices by hand | report → CSV/Excel, columns `Item ID, Date, Barang Masuk, Barang Keluar, Cash Tunai, Remaining Qty`, with invoice reference | per movement |
| Monitoring Stock sheet | admin, daily | physical count + hand-entered in/out, tab `Final Check` | per product per day |

There is no integration between any of them. EggKeep is the only one with a clean ledger identity (on-hand = inflows − outflows + restock returns), so it is the baseline and the other two are compared *to* it.

**Tab → what it is compared against → join key**

| Export tab | Compared against | Join on | What a mismatch means |
|---|---|---|---|
| `Faktur` | P3 sales rows | `No. Faktur` + `Item` | Invoice re-keyed wrong, posted late, missing from P3, or sold outside the app. Date-independent: the same invoice matches whether P3 posted it on the 22nd or the 23rd. |
| `Transaksi` | P3 full ledger (the `P3 … KOMPARE` tab) | `Tanggal` ± 2 days + `Item` + qty, for rows with no invoice number (inflows, cash) | Purchase never reached P3, cash sale not keyed, or a date shift. |
| `Harian` | `Final Check` tab, same columns | `TGL` + `Item` | Hand-entered in/out differs from the app, or the sheet's closing chain is broken (it restarts from a fresh count daily). `Hitung Fisik` vs `Stok Akhir` is the app's own count variance. |
| `Retur` | the OSV return references used to bill the third party | `Outflow ID` → `No. Faktur` | Returns not credited, or credited twice. |
| `Katalog` | nothing — snapshots the factor so the above comparisons are reproducible later | — | — |

**The intended workflow**

1. Admin runs Export Rekonsiliasi for the month and exports the P3 ledger for the same month.
2. `Faktur` is matched to P3 on invoice number first. This explains the big numbers (PO sales) with no timing noise. Four outcomes: matched-same, matched-different-qty, in-EggKeep-only, in-P3-only.
3. What remains — inflows and cash sales — is matched on `Transaksi` with a ±2-day window.
4. `Harian` is placed next to `Final Check`. If the sheet is still maintained by hand, this shows where it drifts; the longer-term intent is that `Harian` *replaces* the hand-maintained roll.
5. Anything still unexplained is the admin's worklist. Later, a script automates steps 2–5 and writes the result back into the sheet; v1 only has to make steps 2–5 possible with VLOOKUP.

**Consequences for the design**

- Units must be the stored deduction, with the unit on every row, because the admin keys P3 in the same unit the invoice shows; any recomputation makes the match fail.
- `No. Faktur` must be exported verbatim because it is the join key.
- `Harian` must use the sheet's product names and column order so it can be pasted alongside `Final Check` without rearranging.
- Signs must be positive with direction in the column, matching P3's `Barang Masuk` / `Barang Keluar` layout, not a signed single column.
- Days with no movement must appear, because `Final Check` has a row for every product every day.

## 3. Non-goals

- No Peachtree integration (none exists; P3 side stays a manual export).
- No packaging BOM / label counts in this export (see §10 for what happens to the existing BOM export).
- No automatic reconciliation verdicts in v1. The file is the input to that; it does not contain "selisih" against P3.
- No PDF.

## 4. Entry point

- Location: Inventory dashboard header, button label **"Export Rekonsiliasi"**. Single primary action; existing export buttons are removed or demoted (§10).
- Dialog fields:
  - Date range: `Dari` / `Sampai` (default: 1st of current month → today). Presets: Bulan ini, Bulan lalu, 7 hari terakhir.
  - Format angka: `Indonesia (1.234,56)` / `Standar (1234.56)`. Default Indonesia. Affects Excel number format only; cell values are always numeric.
  - Checkbox `Sertakan baris void` (default off).
  - Checkbox `Sertakan produk RETAKAN` (default on).
- Output file name: `EggKeep_Rekonsiliasi_YYYY-MM-DD_YYYY-MM-DD.xlsx`.
- Generation runs server-side (Supabase edge function or RPC) against the SQL views in §6, client only triggers and downloads. Must not depend on client-side state or the in-memory conversion map.

## 5. Workbook structure

Six tabs, this order. Column order is fixed; do not append columns in the middle.

### 5.1 `Ringkasan`
Metadata block (not a table):
- Periode, Dibuat (timestamp WIB), Versi skema (`1`), Jumlah transaksi, Catatan (count of flagged rows by flag type).
- Table: per product, `Item | Unit | Stok Awal Periode | Total Masuk | Total Keluar PO | Total Keluar Tunai | Total Retur Restock | Stok Akhir Periode`. Stok Akhir must equal the last day's Stok Akhir in `Harian`.

### 5.2 `Harian` — daily roll, mirrors Final Check
One row per product per calendar day in the range, including days with no movement.

| Col | Header | Type | Rule |
|---|---|---|---|
| A | `TGL` | date (dd/mm/yyyy) | business date |
| B | `Item` | text | sheet name (§7) |
| C | `Unit` | text | `kg` / `butir` |
| D | `Stok Awal` | number | = Stok Akhir of previous day; first day = on-hand as of 00:00 that day, derived from full ledger history |
| E | `Masuk` | number | Σ inflows that day, non-void, excluding `is_retakan` rows (those go to the child product's row) |
| F | `Keluar PO` | number | Σ outflows that day with an order/buyer ref |
| G | `Keluar Tunai` | number | Σ outflows that day from Kas Tunai / manual path |
| H | `Retur Restock` | number | Σ returns with `disposition = restock` by `return_date` |
| I | `Stok Akhir` | number | = D + E − F − G + H |
| J | `Hitung Fisik` | number or blank | latest stock count for that product on that date, if any |
| K | `Selisih Fisik` | number or blank | = J − I when J present |
| L | `Catatan` | text | flags (§8), comma-separated |

Rows grouped by date, products in the fixed order of §7. Date rows separated by a thin border, no merged cells, no blank spacer rows (the sheet's blank rows break formulas).

### 5.3 `Transaksi` — flat ledger, mirrors P3 KOMPARE
One row per stock movement. Signs are always positive; direction is carried by the column.

| Col | Header | Rule |
|---|---|---|
| A | `Tanggal` | business `date` |
| B | `No. Faktur` | order/invoice ref for PO outflows; blank for inflows and cash; return ref for returns |
| C | `Item` | sheet name |
| D | `Unit` | |
| E | `Masuk` | inflow qty, else blank |
| F | `Keluar PO` | PO outflow qty, else blank |
| G | `Keluar Tunai` | cash outflow qty, else blank |
| H | `Retur` | restock return qty, else blank |
| I | `Pembeli / Pemasok` | buyer or supplier name if known |
| J | `Jenis` | `inflow` / `outflow_po` / `outflow_tunai` / `return_restock` / `return_retakan` / `return_writeoff` / `stock_count` |
| K | `Catatan` | flags (§8) |
| L | `Dibuat` | `created_at` in WIB, `dd/mm/yyyy HH:mm` |
| M | `ID` | source row id |

Sorted by Tanggal, then Item, then Dibuat. `return_retakan` rows show qty in `Masuk` on the RETAKAN child item; `return_writeoff` rows show qty in no numeric column (informational only).

### 5.4 `Faktur` — invoice-level, for ticking against P3
One row per (order, product).

| Col | Header |
|---|---|
| A | `Tanggal` |
| B | `No. Faktur` |
| C | `Pembeli` |
| D | `Item` |
| E | `Unit` |
| F | `Qty` (stored deduction, native unit) |
| G | `Qty Butir Setara` (estimate: kg × catalog factor, rounded int; blank for butir items) |
| H | `Retur` (Σ restock returns against this outflow) |
| I | `Netto` (= F − H) |
| J | `Catatan` |
| K | `Outflow ID` |

Sorted by Tanggal, No. Faktur. This tab is the primary join key to Peachtree (ref ↔ ref); keep `No. Faktur` exactly as stored, trimmed, no reformatting.

### 5.5 `Retur`
`Tanggal Retur | No. Faktur Asal | Tanggal Faktur Asal | Pembeli | Item | Unit | Qty | Disposisi | Catatan | Return ID | Outflow ID`

### 5.6 `Katalog` — snapshot at export time
`Item (sheet) | Nama Katalog | Unit | Butir per Unit | Induk (parent) | Is RETAKAN | Box capacities (JSON)`
Plus a second table: `pack_skus` with `SKU | Produk | Butir per Pack`. Purpose: the factor in force when this file was produced, so later catalog edits can't change the meaning of historical files.

## 6. Data layer

Create two Postgres views; the export reads only from these. Other consumers (reconciliation script, Apps Script push, BI) read the same views.

- `v_recon_ledger` — one row per movement, columns matching `Transaksi` plus raw ids and a `flags text[]`. Encodes: void exclusion, RETAKAN routing, PO-vs-tunai classification, WIB conversion of `created_at`, UTC-date flag.
- `v_recon_daily` — one row per product per day, columns matching `Harian`. Derived from `v_recon_ledger` with a window-function running balance seeded from full history (not just the requested range). Uses `generate_series` so no-movement days appear.

Classification of PO vs Tunai: by the source path that created the outflow (order payload vs `OutflowForm` "Catat Kas Tunai"). If no column distinguishes them today, add `outflows.source text` with a backfill migration; do not infer from the presence of a buyer name.

Product display name and order come from a small `recon_product_labels` table or a constant in one place (§7), not scattered in the view.

## 7. Product vocabulary and order

| Order | Export `Item` | Catalog name | Unit |
|---|---|---|---|
| 1 | Telur Negeri | `NEGERI BIASA` | kg |
| 2 | Telur Negeri Omega | `NEGERI OMEGA` | kg |
| 3 | Telur Kampung Pucat | `KAMPUNG BIASA` | butir |
| 4 | Telur Kampung Merah | `KAMPUNG MERAH` | butir |
| 5 | Telur Bebek Tawar | `BEBEK TAWAR` | butir |
| 6 | Telur Asin Matang | `ASIN MATENG` | butir |
| 7 | Telur Asin Mentah | `ASIN MENTAH` | butir |
| 8 | Telur Puyuh | `PUYUH` | butir |
| 9 | Telur Kuning Manik | `KUNING MANIK` | butir |
| 10+ | `<Item> (RETAKAN)` | child products | parent unit |

Any product not in this map is still exported, using its catalog name, placed after the mapped ones, and counted in `Ringkasan` under "Produk tanpa label".

## 8. Flags (`Catatan` column)

Short tokens, comma-separated, so they can be filtered in Excel.

| Token | Condition |
|---|---|
| `tgl-utc` | `created_at` converted to WIB falls on a different calendar day than `date` |
| `void` | row has `voided_at` (only present when "Sertakan baris void" is on) |
| `retakan` | movement on a RETAKAN child product |
| `sku-yatim` | outflow line whose pack SKU maps to a product not in the catalog (seed drift) |
| `tanpa-faktur` | PO outflow with empty/null ref |
| `faktur-ganda` | same No. Faktur + Item appears on more than one outflow in the range |
| `qty-nol` | movement with quantity 0 or negative |
| `tgl-aneh` | `date` outside 2026-07-01 .. today + 1 |

## 9. Formatting rules

- All quantities are numeric cells. kg: 2 decimals. butir: 0 decimals. Never text.
- Dates are real Excel dates with `dd/mm/yyyy` format, not strings.
- Header row bold, frozen, autofilter on every data tab.
- Column widths set so the file opens readable; no wrapped headers.
- No formulas in the file (values only) — the file is a record, and formulas break when pasted into the sheet. Exception: none.
- Sheet names exactly as in §5 (the reconciliation script addresses tabs by name).
- UTF-8, Excel 2016+ compatible. Use the existing xlsx dependency if one is present; otherwise SheetJS (community) or `exceljs`.

## 10. Migration of existing exports

- `exportInflowsToCSV`: remove button. Its content is a subset of `Transaksi` filtered by `Jenis = inflow`.
- `outflowSkuExport.ts` (SKU-BOM CSV): keep only if packaging counts are used operationally; move it to a secondary "Export lainnya" menu and rename to "Export BOM Kemasan". Its kg column must either be removed or relabeled `kg (estimasi katalog saat ini)` so it stops being read as the deduction.
- Any docs/screenshots referencing the old buttons updated in `docs/panduan-eggkeep.md`.

## 11. Acceptance criteria

1. For September 2026, `Harian` Stok Akhir on 30/09 for each product equals `calculateStockSummary()` as of 30/09 23:59 WIB, within 0.01 kg / 0 butir.
2. Σ `Faktur.Qty` for a product and date equals `Harian.Keluar PO` for that product and date.
3. Σ `Transaksi` by day and type reproduces every `Harian` cell.
4. Opening the file in Excel with Indonesian locale shows `1.234,56`; with English locale `1,234.56`; values are numeric either way.
5. A row entered at 01:00 WIB with a UTC-default date carries `tgl-utc`.
6. A RETAKAN return appears as `Masuk` on the child product row and does not change the parent.
7. Export of a 3-month range completes in under 10 s.
8. `conversionSync.test.ts`-style test: views and export agree with `src/types/inventory.ts` on units for every catalog product.

## 12. Out of scope for v1, noted for v2

- Scheduled push of `Harian` and `Faktur` into a tab of the Monitoring Stock sheet (Apps Script or Supabase cron).
- A `Selisih P3` tab that takes an uploaded Peachtree CSV and performs the invoice match inside the app.
- Fixing the UTC default date in `InflowForm.tsx:47`, `OutflowForm.tsx:51`, `QuickOutflowBuilder.tsx:92` — separate small PR, should land before or alongside this so the `tgl-utc` flag stops growing.
- Cleaning `pack_skus` seed drift (`BK4AMTG`, `BK4AMTH`, `KP10O`, `KP6O`).

## 13. Open questions for the implementer

1. Is there an existing column that distinguishes Kas Tunai outflows from PO outflows, or does `outflows.source` need adding?
2. Does the activity log store buyer name on the outflow, or only on the order? `Faktur.Pembeli` needs it.
3. Has `KUNING MANIK` had any movement since July? If yes, confirm with Josh whether the sheet should get a row.
4. Confirm `No. Faktur` in EggKeep is the same string the admin keys into Peachtree's reference field (not a Peachtree-generated number). If not, add a `p3_ref` field on orders.
