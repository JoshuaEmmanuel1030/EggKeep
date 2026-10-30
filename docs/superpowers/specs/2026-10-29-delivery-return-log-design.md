# Delivery & Return Log (Log Pengiriman & Retur), Phase 1 — Design Spec

**Date:** 2026-10-29
**Status:** Phase 1 implemented, including the review changes of 2026-10-30; open items in §9; Phases 2–3 pending, Phase 4 optional
**Author:** Joshua
**Builds on:** [buyer profiles](2026-10-22-buyer-profiles-design.md) (the `purchase_orders` view), [stock count](2026-08-20-physical-stock-count-design.md) (the routed-page-from-Header pattern); Phase 2+: [per-SKU returns](2026-10-08-per-sku-returns-design.md) (`returns` / `record_return`).
**Replaces (after Phase 3):** the Google Sheet "Log Pengiriman & Retur" (tabs: Pengiriman & Retur, Klaim Retur OSV, Daftar, Aturan Expired, Panduan).

> This file is the Phase 1 view of the [full spec](2026-10-29-delivery-return-log-full.md), which covers Phases 1–4. Section numbers follow the full spec: §4.3, §4.4, §4.6 and §11 are Phase 2+ and appear only there; §12.1 and §13 are new in this file. Unanswered questions are in §9.

> **Review changes (2026-10-30), now in code:** row created on first save, not on open (§4.2); re-keyed vs voided told apart through `corrected_by_log_id` on the voided rows (§8); live PO fields in the detail and export (§5.2); the badge opens the full open range (§5); the export includes un-logged POs (§5.5); the `batal` / `ditolak` stock hint (§5.2); the CSV formula prefix (§5.5).

## 1. Problem

EggKeep records a PO at loading and a return when eggs come back. Everything between still lives in a sheet that admin (Yani / Dila / Novi) fills by hand:

1. **Pengiriman**: which driver took the faktur, and whether it was delivered, rejected or cancelled.
2. **Faktur balik**: when the signed invoice came back, and who checked it (paraf admin).
3. **Penerimaan toko**: what the store accepted per item, in packs, with a reason.
4. **Penerimaan gudang**: what came back to the warehouse, in pieces (Butir OK / Retak / Pecah).
5. **Klaim Retur OSV**: the OSAVE return-claim number and its billing status.

The sheet is keyed by No. Faktur, which is the `invoiceRef` on an EggKeep PO. Joshua confirmed (2026-10-29) that admin types the same string into Peachtree, so the systems already share a key. The key is not guaranteed: `invoiceRef` is optional in the PO builder (`QuickOutflowBuilder`) and is not checked for uniqueness at entry (§8, §9 Q2). **Phase 1 covers (1) and (2).**

## 2. Scope (Phase 1)

**In scope**
- Tables `drivers`, `deliveries` and `expiry_rules` (table and seed only), and the `open_delivery_items` view.
- `/deliveries`: list; detail sections 1 (Pengiriman) and 2 (Faktur balik); the 🚚 entry in the Header and sidebar with its badge; the status chip on Activities order cards.
- Drivers in Catalog → Supir.
- Log export in the sheet's column layout; Phase 1 fills columns 1–8.

**Out of scope**
- Any change to how POs, outflows, FIFO, `record_order_outflows`, `correct_order`, `void_outflow` or `record_return` compute stock (§7).
- Store acceptance, warehouse receipt and expiry dates (Phase 2); OSV claims and reports (Phase 3); importing the sheet's history (Phase 4, optional).
- Retiring the Google Sheet: Phase 3, and only once §9 Q2 is settled.
- Rupiah values on claims, proof-of-delivery photos or signatures, offline capture, the Tracker Form process sheets.

## 3. Vocabulary

| Sheet term | EggKeep | Notes |
|---|---|---|
| No. Faktur / PO | `invoice_ref` | PO's `metadata.invoiceRef`. Single join key. |
| Customer ("OSV Depok") | buyer + DC | Store both; display `<buyer> <dc>`, or the buyer alone when there is no DC. |
| Supir | driver | New catalog list. |
| Status Kirim | `status` | `belum_terkirim` · `terkirim` · `ditolak` · `batal` |
| Tgl Faktur Balik / Paraf Admin | `invoice_returned_at` / `invoice_checked_by` | |
| Full | derived (Phase 2) | Delivered with no store-side return lines. Blank in Phase 1 (export column 12). |
| PO (Purchase Order) | `purchase_orders` view | A buyer order recorded at loading, regrouped from outflow rows in `activity_logs`. |
| DC | `dc_name` | The buyer's distribution centre, e.g. Depok. |
| PIC | `pic` | Person in charge: who logged the delivery (user email). |
| OSV | buyer OSAVE | The sheet's abbreviation for OSAVE. |
| Peachtree | — | The accounting system; admin types the same No. Faktur there. |
| Item (sheet SKU) | `expiry_rules.sku_code` | The sheet's spellings (`N 30`, `KP 6`), not `pack_skus.code` (`KP6O`), until §9 Q1. |
| Admin | office staff / app role | "Admin" is the office job (Yani / Dila / Novi). The app's admin role gates driver edits. Who holds it: §9 Q9. |

## 4. Data model

Live project `lgtixzpjbkzapecirbfj`. Additive only. RLS mirrors `stock_counts` (authenticated select/insert/update; admin-only edits are a UI gate). Apply migrations before frontend.

### 4.1 `drivers`

```sql
create table public.drivers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index drivers_name_key on public.drivers (upper(trim(name)));
```

Seed: Hendi, Junaedi, Riyan, Samsudin, Ayub, Bolu, Mirdad, Dede, Dika.

### 4.2 `deliveries` — one per faktur / PO

```sql
create table public.deliveries (
  id                  uuid primary key default gen_random_uuid(),
  invoice_ref         text not null,                        -- as typed on the PO
  invoice_ref_norm    text generated always as (upper(trim(invoice_ref))) stored,
  buyer_name          text not null,                        -- snapshot (activity_logs convention)
  dc_name             text,                                 -- snapshot
  delivery_date       date not null,                        -- Tgl Kirim = PO outflow_date
  driver_id           uuid references public.drivers(id),
  driver_name         text,                                 -- snapshot for display/export
  status              text not null default 'belum_terkirim'
                      check (status in ('belum_terkirim','terkirim','ditolak','batal')),
  invoice_returned_at date,                                 -- Tgl Faktur Balik
  invoice_checked_by  text,                                 -- Paraf Admin (user email)
  pic                 text,                                 -- who logged it (user email)
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index deliveries_invoice_ref_key on public.deliveries (invoice_ref_norm);
create index deliveries_date_idx on public.deliveries (delivery_date desc);
```

**Why key on `invoice_ref`:** `purchase_orders` has no stable order id (it groups `activity_logs` by metadata). Legacy POs with an empty `invoiceRef` cannot have a delivery record.

**Creation: on first save.** A PO with no `deliveries` row shows as "Belum dicatat". The first edit on the detail page (driver, status, PIC, notes or faktur balik) creates the row, with `pic` set to the person saving. Opening a PO, or following the Activities chip, writes nothing. The list is POs from `purchase_orders` left-joined to `deliveries` on `invoice_ref_norm = upper(btrim(po.invoice_ref))`, plus deliveries with no live PO (§8). The outflow pipeline is untouched.

Later phases: Phase 2 adds `delivery_lines` (one per SKU × reason; store-side pack quantities that never feed stock) and `returns.delivery_line_id`; Phase 3 adds `return_claims`. Both attach to `deliveries` without altering it.

### 4.5 `expiry_rules` — Aturan Expired (table + seed only in Phase 1)

```sql
create table public.expiry_rules (
  id             uuid primary key default gen_random_uuid(),
  buyer_keyword  text,          -- null = any buyer; case-insensitive substring of "<buyer> <dc>"
  sku_code       text,          -- null = any SKU
  shelf_days     integer not null check (shelf_days > 0),
  note           text,
  created_at     timestamptz not null default now()
);
```

Seed: Astro 22d (N15 21d, N 30 21d, AMTG 14d); Segari 30d (AMTG 14d); Sayurbox 14d (P 25 21d, KP 6 30d, N4 30d); default 30d. ("1 Bulan" = 30 days.) The resolver and editor are Phase 2.

The seed's `sku_code` values are the sheet's spellings (`N15`, `N 30`, `AMTG`, `P 25`, `KP 6`, `N4`), not `pack_skus.code` (e.g. `N15B`, `N30B`, `BK4AMTG`, `KP6O`). Case- and space-insensitive matching bridges only `P 25` → `P25`. The Phase 2 resolver depends on §9 Q1. The table has no unique key, so re-running the seed duplicates rows. Nothing reads the table in Phase 1.

### 4.7 Views (`security_invoker = true`, grant select to authenticated)

**`open_delivery_items`** feeds the Header badge. It has one row per (PO, delivery) pair that needs attention, across all dates. It is driven from `purchase_orders`, so it contains only live (non-voided) POs with a non-empty `invoice_ref`:

```sql
create view public.open_delivery_items with (security_invoker = true) as
select po.invoice_ref, upper(btrim(po.invoice_ref)) as invoice_ref_norm,
       po.buyer_name, po.dc_name, po.outflow_date as delivery_date,
       d.id as delivery_id, d.status, d.invoice_returned_at,
       (d.id is null) as not_logged,
       (d.status = 'terkirim' and d.invoice_returned_at is null) as invoice_not_back
from public.purchase_orders po
left join public.deliveries d on d.invoice_ref_norm = upper(btrim(po.invoice_ref))
where coalesce(btrim(po.invoice_ref), '') <> ''
  and (d.id is null or (d.status = 'terkirim' and d.invoice_returned_at is null));
```

`not_logged`: a live PO with a ref and no delivery. `invoice_not_back`: `terkirim`, no faktur balik, and the PO is still live. A delivery whose PO was voided or re-keyed drops out, so its flags are suppressed. Two POs sharing a ref give two rows, so the badge counts distinct `invoice_ref_norm`. (Later: `needs_claim_ref`, `awaiting_warehouse`, `count_mismatch`.)

The list does not read this view. `src/lib/deliveryFlags.ts` applies the same two rules to the date-ranged list, and adds what the view leaves out: deliveries with no live PO (`poMissing`) and later POs that reuse a ref (`duplicateInvoice`, flags suppressed).

**`delivery_log`** is Phase 2. The Phase 1 export already uses its column layout, with one row per list item (§5.5) and columns 9–22 blank. Headers are as implemented in `src/lib/deliveryExport.ts`; they have not been checked against the sheet's header row yet (§9 Q8).

| # | Key | Header | Phase 1 |
|---|---|---|---|
| 1 | `pic` | PIC | filled |
| 2 | `delivery_date` | Tgl Kirim | filled |
| 3 | `invoice_ref` | No. Faktur | filled |
| 4 | `customer` | Customer | filled |
| 5 | `driver_name` | Supir | filled |
| 6 | `status` | Status Kirim | filled |
| 7 | `invoice_returned_at` | Tgl Faktur Balik | filled |
| 8 | `invoice_checked_by` | Paraf Admin | filled |
| 9 | `sku_code` | SKU | blank |
| 10 | `qty_received_pack` | Qty Diterima (Pak) | blank |
| 11 | `qty_returned_pack` | Qty Retur (Pak) | blank |
| 12 | `full` | Full | blank |
| 13 | `reason` | Alasan | blank |
| 14 | `condition_notes` | Keterangan Kondisi | blank |
| 15 | `returned_to_warehouse_at` | Tgl Kembali Gudang | blank |
| 16 | `expected_expiry` | Expired | blank |
| 17 | `pieces_ok` | Butir OK | blank |
| 18 | `pieces_retak` | Butir Retak | blank |
| 19 | `pieces_pecah` | Butir Pecah | blank |
| 20 | `warehouse_checked_by` | Paraf Gudang | blank |
| 21 | `claim_ref` | No. Klaim | blank |
| 22 | `claim_status` | Status Klaim | blank |

## 5. Navigation & pages

Routed page `/deliveries` (protected), opened from a 🚚 icon in the Header and the sidebar, **not** a new tab (the tab bar stays at 8). Badge: the number of distinct fakturs with `invoice_not_back`, across all dates (from `open_delivery_items`). Tapping it opens the list with the "Faktur belum balik" chip on and the range starting at the oldest open faktur's date, so the list shows every faktur the badge counts.

### 5.1 Deliveries list (`src/pages/Deliveries.tsx`)

- Default range: the last 14 days by local date (`localToday()`), newest first; date-range picker. POs are selected by `outflow_date`, and deliveries with no live PO by `delivery_date`.
- One row per PO/faktur: date · invoice_ref · customer · driver · status chip · faktur balik chip (date or ✗). Acceptance, warehouse and claim chips come in later phases.
- Filter chips (multi-select, combined with OR): Belum dicatat · Belum terkirim · Faktur belum balik. "Belum terkirim" matches logged deliveries only. Search by invoice_ref or customer.
- Tablet landscape and desktop (`useIsTabletLandscape()`): list on the left, detail on the right. Phone and portrait tablet: tapping a row replaces the list with the detail and a back arrow (same split as buyer profiles).

### 5.2 Delivery detail (`src/components/deliveries/DeliveryDetail.tsx`) — Phase 1 sections

1. **Pengiriman**: read-only PO header from `purchase_orders` (buyer, DC, date, order lines with pack qty, invoice_ref). While the PO is live, its buyer, DC and date are what the list and the detail show and what the export prints. Each save also copies them into the row's snapshot, which is used only once the PO is gone. Editable: driver (active drivers; admins can "tambah supir"), status, PIC, notes. Selects save on change; text fields save on blur. Changing status to `ditolak` or `batal` requires a note, stored in `notes` (it replaces any earlier note). After it is saved, a non-blocking hint says stock has not changed: for `batal`, void the PO; for `ditolak`, record the return. Phase 1 puts no limits on status changes.
2. **Faktur balik**: "Faktur sudah balik" sets the date to today (local date) and checked-by to the current user. Both stay editable, and "clear" undoes them. Faktur balik can be recorded in any status.

### 5.3 Entry point

- `BuyerOrderCard` on Activities: a small, read-only delivery status chip (Belum dicatat / Belum terkirim / Terkirim / Ditolak / Batal) linking to `/deliveries?invoice=<ref>`. Following it writes nothing. The detail finds the PO with a case-insensitive exact match on `invoice_ref`.

### 5.4 Catalog

- **Drivers**: the Catalog → Supir tab, with name and an active toggle. Admin-only edit (UI gate), like buyers. The detail's "tambah supir" adds to the same list; drivers are managed in the Catalog tab.

### 5.5 Reports — Phase 1

- **Log export**: CSV of the §4.7 columns for the list's date range, `;`-separated (decimal commas), UTF-8 with BOM, every cell quoted, `dd/mm/yyyy` dates, Indonesian headers. Rows are the list's rows for the range, whatever chips or search are set: every PO with a ref (including a later PO that reuses a ref), plus deliveries with no live PO. POs not yet logged have blank status, driver and PIC. A text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so spreadsheets treat it as text, not a formula. Numbers and dates are not prefixed. The sheet stays in use until Phase 3 (§2).

## 6. Client contract (Phase 1 subset)

- `src/types/deliveries.ts` — `DeliveryStatus`, `Delivery`, `Driver`, `ExpiryRule` (unused until Phase 2), `DeliveryLogRow`.
- Hooks: `useDeliveries(range, filters)` reads `purchase_orders` and `deliveries` and builds the list with `deliveryFlags.ts`; `useOpenDeliveryCount()` reads `open_delivery_items` for the badge; `useDelivery(invoiceRef)` loads one faktur and saves edits (the first save inserts the row, on conflict do nothing, then applies the edit, so two first saves at once never overwrite each other); `useDrivers()`.
- `src/lib/deliveryFlags.ts` — pure functions for the list's flags, orphans and duplicates (§4.7), unit-tested. `src/lib/deliveryExport.ts` — CSV builder with its own Indonesian date and number formatters; the download uses `downloadCSV` (`src/lib/inventory.ts`).

## 7. Invariants

- No change to stock, FIFO, outflow/return caps, `record_order_outflows`, `correct_order`, `void_outflow`, `record_return`.
- `activity_logs.metadata` shape unchanged.
- i18n: every user-facing string goes in both `src/locales/en.ts` and `src/locales/id.ts`, under a `deliveries` block; status labels use Indonesian warehouse vocabulary in both locales.
- Phone width 375px: no sideways page scroll; tables scroll inside their own wrapper.

## 8. Edge cases (Phase 1)

- **Invoice ref edited via `correct_order`.** `correct_order` voids the original rows and inserts corrected ones whose `original_log_id` points back. The delivery's ref then matches only voided rows that have a live successor. The detail shows "tidak cocok dengan PO" and offers "ubah No. Faktur" (edit `invoice_ref`; uniqueness enforced). If the corrected ref already has its own delivery, the edit fails with "No. Faktur sudah dipakai"; Phase 1 has no merge.
- **PO voided after a delivery exists.** The ref matches only voided rows with no successor. The row stays as history and the detail shows "PO dibatalkan"; flags are suppressed.
- In the list, both cases show as one "tidak cocok dengan PO" state (`poMissing`).
- **Duplicate invoice ref on two POs.** The later-recorded PO (by `recorded_at`, among POs in the range) shows "No. Faktur sudah dipakai" with flags suppressed and opens the first PO's delivery; nothing is merged automatically.
- **Cash (Kas Tunai) entries** are manual outflows without `orderType = 'quick_outflow'`, so they are never in `purchase_orders` or on `/deliveries`.
- **Buyer POs made only of loose-egg lines** are listed when they carry an `invoice_ref`, like any other PO.
- **POs without an `invoice_ref`** are neither listed nor exported; the list shows how many POs in the range were left out (§9 Q2).
- **Buyer renamed:** snapshots keep the old name (consistent with `activity_logs`).

## 9. Open questions (Phase 1)

Owner: Joshua. Numbers follow the full spec; full-spec Q3, Q5 and Q7 are Phase 2 and stay there. Q8 and Q9 are new.

1. **Q1 SKU codes — pending.** The sheet's item codes differ from `pack_skus.code`. This affects the `expiry_rules` seed (§4.5) and Phase 2 lines. Options: lines and export use `pack_skus.code`; or add a sheet label to `pack_skus`.
2. **Q2 `invoiceRef` required — pending; gates retiring the sheet.** It is optional in `QuickOutflowBuilder`, so POs without it never reach this log (§8). Options: require it on buyer POs; or keep it optional and accept the gap. Optional companion: warn at entry when a ref is already used (`src/lib/duplicateOrder.ts`).
3. **Q4 Cash orders — resolved for Phase 1:** see §8.
4. **Q6 Paraf — assumed:** the signed-in user's email serves as the paraf. Confirm.
5. **Q8 Export headers — pending.** The full spec says 21 columns but names 22. The implemented headers (§4.7) differ from the full spec's wording: Alasan / Alasan Retur, Keterangan Kondisi / Catatan Kondisi, Tgl Kembali Gudang / Tgl Barang Balik, Expired / Tgl Expired, No. Klaim / No. Retur OSV, Status Klaim / Status Tagihan. Check them against the sheet's header row before Phase 2 builds `delivery_log`.
6. **Q9 App admin role — pending.** Do Yani, Dila and Novi hold the app admin role? Without it they cannot add drivers.

## 10. Testing (Phase 1)

- `src/lib/__tests__/deliveryFlags.test.ts` — `invoice_not_back` and `not_logged`. Example: faktur 2610383, second sheet row (`Belum Terkirim`, no faktur balik) gives `invoice_not_back = false`, because the flag needs `terkirim`.
- `src/lib/__tests__/deliveryExport.test.ts` — column order, headers and formatting match the §4.7 table.
- Manual: 375px phone, tablet split, non-admin cannot edit drivers, the Header badge count equals the "Faktur belum balik" chip's count after tapping the badge.
- Verify gate: `npm run verify`.

## 12. Decision log

| Decision | Choice | Why |
|---|---|---|
| Key for deliveries | `invoice_ref` (unique, normalized) | No PO id exists; staff already key on No. Faktur. |
| Placement | routed page from Header | Tab bar is full; same pattern as stock count. |
| Offline | online-only in Phase 1 | Admin fills this at the office; returns keep their outbox. |
| Store/warehouse quantities | Phase 2+, never touch stock | Stock stays single-sourced in `returns`. |

### 12.1 Alternatives considered

| Decision | Rejected alternative | Why not |
|---|---|---|
| Key on `invoice_ref` | A stable order id written into PO metadata at save | Changes `activity_logs.metadata`, which §7 keeps fixed, and the outflow write path. Phones on old PWA bundles keep writing POs without it, so `invoice_ref` would still be needed as a fallback. Staff already work by No. Faktur. |
| Lazy creation (on first save) | Eager rows from `record_order_outflows`, a trigger on `activity_logs`, or a backfill | Touches the outflow RPC (§7). `activity_logs` has one row per order line, not per PO, so a trigger would have to group them. Creates rows for POs nobody tracks. |
| Separate `deliveries` table | Delivery fields in the PO's `activity_logs.metadata` | A PO spans several rows, and editing them after loading rewrites outflow history. |
| List flags computed in TypeScript | The list reads `open_delivery_items` | The list needs order lines, a date range, orphans and duplicates; the view is PO-driven and covers all dates, which suits the badge. |
| Admin-only edits as a UI gate | Admin-only RLS policies | Same as `stock_counts` and buyers. The cost is listed in §13. |

## 13. Risks & limits (Phase 1)

- **Who can write.** Any signed-in user can insert and update `deliveries`, `drivers` and `expiry_rules` through the API; "admin-only" is a UI gate, as for `stock_counts` and buyers. Nothing in the app can delete a row.
- **Paraf is not a signature.** `pic` and `invoice_checked_by` are emails the client writes. There is no change history: a new status overwrites the old one, a new note replaces `notes`, and `updated_at` comes from the device clock (no trigger). If the paraf must hold up in an audit, add admin-only update policies plus a history table or `activity_logs` entries.
- **Concurrent edits.** The last write wins per field. The insert is on conflict do nothing, so two people creating the same row at once don't overwrite each other.
- **Query cost.** Every list and badge query regroups outflow rows through `purchase_orders`, and the badge query runs from the Header on every page (cached 30 s). Lists page through results with `fetchAllRows`, so there is no 1000-row cut-off. If this becomes measurably slow: an index or a materialized view.
- **Export cells.** User-typed values go into a CSV opened in Excel; the §5.5 prefix rule stops formula injection.
- **Stock and status.** `ditolak` / `batal` don't change stock (§7); the §5.2 hint prompts the user to void the PO (`batal`) or record the return (`ditolak`).
- **Corrected dates.** A `correct_order` that moves a PO's date out of the list's range shows its delivery as "tidak cocok dengan PO" until the next save on that faktur refreshes the snapshot.
