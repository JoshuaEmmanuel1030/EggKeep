# Delivery & Return Log (Log Pengiriman & Retur) — Design Spec

> Full spec, Phases 1–4. Phase 1 as built, and the open questions that still affect it: [2026-10-29-delivery-return-log-design.md](2026-10-29-delivery-return-log-design.md).

**Date:** 2026-10-29
**Status:** Draft for Claude Code — build in phases (see Rollout)
**Author:** Joshua (with Claude)
**Replaces:** the Google Sheet "Log Pengiriman & Retur" (tabs: Pengiriman & Retur, Klaim Retur OSV, Daftar, Aturan Expired, Panduan), which itself replaced the paper "binder faktur" and "binder merah retur".
**Builds on:** `purchase_orders` view (buyer-profiles spec, 2026-10-22), `returns` / `record_return` with per-SKU lines in pieces and O/R/H dispositions (2026-10-08 specs), routed-page-from-Header pattern (stock-count spec, 2026-08-20).

---

## 1. Problem

EggKeep records a Purchase Order (PO) at loading and a return (retur) when eggs physically come back to the warehouse. Everything that happens **between and around** those two events still lives in a Google Sheet that admin (Yani / Dila / Novi) fills by hand:

1. **Pengiriman** — which driver took the faktur, whether it was delivered, rejected, cancelled.
2. **Faktur balik** — when the signed invoice came back to the office and who checked it (paraf admin).
3. **Penerimaan toko (per item)** — what the store actually accepted vs. returned, in **packs**, with a reason (pecah / kurang / ditolak / tukar guling …).
4. **Gudang (barang balik)** — when the returned goods reached the warehouse, expected expiry, Butir OK vs Butir Pecah, paraf gudang.
5. **Klaim Retur OSV** — for Osave only: the Osave return reference (`OSV-26100xx`) used to bill a third party, and whether that claim has been invoiced / paid.

The sheet is keyed by **No. Faktur**, which is exactly EggKeep's `invoiceRef` on a PO (Panduan rule 3), so the two systems already share a key. The goal is to move this whole lifecycle into EggKeep so that:

- a PO can be followed from loading → delivery → invoice return → store acceptance → warehouse receipt → OSV claim without leaving the app;
- the warehouse-side numbers (Butir OK / Retak / Pecah) come from the **existing `returns` pipeline** rather than being retyped;
- the store-side numbers (packs received / returned, reason) are captured **once**, per SKU line, and reconcile against the warehouse count;
- the three reports the sheet produces (open items by colour, OSV claim list, retur-per-customer-per-product) are views/exports, not formulas.

## 2. Scope

### In scope (this spec)
- New entity **Delivery** (one per PO / faktur) with delivery status, driver, invoice-return tracking.
- New entity **Delivery line** (one per SKU × reason on a faktur) for store acceptance.
- Link from the existing `returns` rows to a delivery line (warehouse receipt side).
- **Expiry rules** (Aturan Expired) → computed expected expiry per line.
- **OSV return claims** (No. Retur OSV + billing status).
- A **Deliveries page** (`/deliveries`) with the list, filters mirroring the sheet's colour codes, per-delivery detail, and entry points from the Activities order cards.
- **Reports/exports**: flat log (identical column set to the sheet), OSV claim list, returns-per-customer pivot.
- Catalog additions: drivers list, expiry rules editor.

### Out of scope (deferred, not blocked)
- Changing how POs, outflows, FIFO, `record_order_outflows`, `correct_order`, `void_outflow` or `record_return` compute stock. **No stock math changes.**
- Rupiah values on claims (accounting applies pricing outside EggKeep, same as stock count).
- Offline capture for the delivery page (online-only v1, like stock count; returns keep their existing outbox).
- Importing the sheet's history (Phase 4, optional).
- Proof-of-delivery photos / signatures.
- The Tracker Form "Flow Stock" / "Retakan sortir" process sheets (separate workflow).

## 3. Vocabulary (keep consistent in code, i18n and UI)

| Sheet / warehouse term | EggKeep term | Notes |
|---|---|---|
| No. Faktur / PO | `invoice_ref` | The PO's `metadata.invoiceRef`. Single join key. |
| Customer (e.g. "OSV Depok") | buyer + DC | Sheet names = `<buyer> <dc>`; store both, display as sheet does. |
| Supir | driver | New catalog list. |
| Status Kirim | `delivery_status` | `belum_terkirim` · `terkirim` · `ditolak` · `batal` |
| Tgl Faktur Balik / Paraf Admin | `invoice_returned_at` / `invoice_checked_by` | |
| Item | `sku_code` | Sheet uses short codes (N10, NO10, N 30, P 25, KP 6, KpO6, AMTG, N15, N6, NO6, N4, KP 10). Map to EggKeep `pack_skus.code` on entry; see §9 Q1. |
| Qty Diterima / Qty Retur (pack) | `qty_received_pack` / `qty_returned_pack` | Store side, **packs** (boxes for Box SKUs). |
| Full | derived | "Ya" iff delivered and nothing returned (Panduan rule 5). |
| Alasan Retur | `reason` | Fixed list, see §4.3. One reason per line (Panduan rule 7). |
| Catatan Kondisi | `condition_notes` | Free text. |
| Tgl Barang Balik | `returns.return_date` | Warehouse receipt date — already captured by `record_return`. |
| Tgl Expired | `expected_expiry` | Computed from expiry rules, editable. |
| Butir OK (ke stok) / Retak / Butir Pecah | `returns.disposition` = `restock` (O) / `retakan` (R) / `writeoff` (H) | Native units in DB; displayed in pieces like the return dialog. |
| Paraf Gudang | `warehouse_checked_by` | |
| No. Retur OSV (was "No. Retur ARYO") | `return_claims.claim_ref` | Osave's reference for billing a third party. |
| Status Tagihan | `return_claims.status` | `belum_ditagih` · `sudah_ditagih` · `dibayar` |

## 4. Data model

All tables in the live Supabase project `lgtixzpjbkzapecirbfj`. Additive only. RLS mirrors `stock_counts`: authenticated users may select/insert/update; no admin gate at DB level (UI-gated like catalog). Apply migrations **before** pushing frontend (EggKeep deploy rule).

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
Seed from the sheet's Daftar: Hendi, Junaedi, Riyan, Samsudin, Ayub, Bolu, Mirdad, Dede, Dika.

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

**Why key on `invoice_ref`:** the `purchase_orders` view has no stable order id (it groups `activity_logs` by metadata). The sheet already uses No. Faktur as the key, and the business already treats it as unique per faktur. Legacy POs with an empty `invoiceRef` simply cannot have a delivery record (see §9 Q2).

**Creation:** lazy. A delivery row is created the first time someone opens that PO on the Deliveries page or taps "Delivery" on its order card. The page lists POs from `purchase_orders` **left-joined** to `deliveries` on `invoice_ref_norm`, so un-logged POs still appear (as "belum dicatat"). This keeps the outflow pipeline untouched.

### 4.3 `delivery_lines` — store acceptance, one per (SKU × reason)
```sql
create table public.delivery_lines (
  id                   uuid primary key default gen_random_uuid(),
  delivery_id          uuid not null references public.deliveries(id) on delete cascade,
  sku_code             text not null,                      -- pack_skus.code
  qty_ordered_pack     numeric,                            -- snapshot from PO order_lines (packQty); null for loose lines
  qty_received_pack    numeric,                            -- Qty Diterima (store)
  qty_returned_pack    numeric not null default 0 check (qty_returned_pack >= 0),
  reason               text check (reason in (
                         'pecah','rusak','ditolak','kurang','lebih','expired',
                         'revisi_po','tukar_guling','cancel','masih_ditanyakan','lainnya')),
  condition_notes      text,                               -- Catatan Kondisi
  expected_expiry      date,                               -- Tgl Expired (computed, editable)
  warehouse_checked_by text,                               -- Paraf Gudang
  claim_id             uuid references public.return_claims(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index delivery_lines_delivery_idx on public.delivery_lines (delivery_id);
create index delivery_lines_claim_idx on public.delivery_lines (claim_id);
```
- No unique on `(delivery_id, sku_code)`: the sheet legitimately has the same SKU twice with different reasons (P 25 "Pecah" + P 25 "Kurang" on 2610382). Enforce `(delivery_id, sku_code, reason)` uniqueness in the UI only.
- A line with `qty_returned_pack = 0` and no reason is a "received in full" line (the sheet's row 2610301 / N15 / 40 / 0). Lines are optional for full deliveries (Panduan rule 2): a delivery with status `terkirim` and no lines is simply full.
- **Not a stock event.** `qty_returned_pack` is what the store sent back on paper. Stock only changes when the warehouse records the return through `record_return` (next section).

### 4.4 Link `returns` → `delivery_lines`
```sql
alter table public.returns add column if not exists delivery_line_id uuid references public.delivery_lines(id);
create index returns_delivery_line_idx on public.returns (delivery_line_id);
```
`record_return`: persist the new field exactly like `sku_code` was added — add `delivery_line_id` to the insert column list and `nullif(v_line->>'delivery_line_id','')::uuid` to values. **No other change to the RPC** (cap, retakan, restock logic untouched). Full `create or replace` of the current body (latest definition is in the newest `*returns*|*retakan*` migration).

Warehouse-side numbers per line are then a join: `sum(quantity) filter (where disposition='restock')` → Butir OK, `retakan` → Retak, `writeoff` → Butir Pecah, `min(return_date)` → Tgl Barang Balik. Quantities are native (kg for Negeri) — convert to pieces for display with the existing `nativeToPieces` (`src/lib/returnsCap.ts`, flat 15.5).

### 4.5 `expiry_rules` — Aturan Expired
```sql
create table public.expiry_rules (
  id             uuid primary key default gen_random_uuid(),
  buyer_keyword  text,          -- null = any buyer; matched case-insensitively as a substring of "<buyer> <dc>"
  sku_code       text,          -- null = any SKU
  shelf_days     integer not null check (shelf_days > 0),
  note           text,
  created_at     timestamptz not null default now()
);
```
Resolution (pure function `resolveShelfDays(rules, buyerDisplayName, skuCode)` in `src/lib/expiryRules.ts`), most specific wins:
1. keyword matches **and** `sku_code` matches
2. keyword matches, `sku_code` null
3. keyword null, `sku_code` matches
4. keyword null, `sku_code` null (default)
Ties within a level → longest keyword. No match → `null` (leave expiry blank).
`expected_expiry = delivery_date + shelf_days`. "1 Bulan" in the sheet = 30 days. Seed from the sheet: Astro 22d (N15 21d, N 30 21d, AMTG 14d); Segari 30d (AMTG 14d); Sayurbox 14d (P 25 21d, KP 6 30d, N4 30d); default 30d.

### 4.6 `return_claims` — Klaim Retur OSV
```sql
create table public.return_claims (
  id          uuid primary key default gen_random_uuid(),
  claim_ref   text not null,                         -- e.g. OSV-2610057, FMI-2610005
  buyer_name  text not null,
  status      text not null default 'belum_ditagih'
              check (status in ('belum_ditagih','sudah_ditagih','dibayar')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index return_claims_ref_key on public.return_claims (upper(trim(claim_ref)));
```
A claim is its own entity because one `claim_ref` spans several lines and sometimes several fakturs (OSV-2610055 covers 2610505 on 27/10 and 2610474 on 26/10). Status lives on the claim, not the line. Not Osave-only in the schema (the sheet already has `FMI-2610005` for FamilyMart) — the "OSV" filter is a report filter.

### 4.7 Views (read-only, `security_invoker = true`, grant select to authenticated)

**`delivery_log`** — one row per delivery line, plus one row per delivery with no lines; exactly the sheet's 21 columns in order, so the CSV export is a drop-in replacement:

`pic, delivery_date, invoice_ref, customer (buyer + ' ' + dc), driver_name, status, invoice_returned_at, invoice_checked_by, sku_code, qty_received_pack, qty_returned_pack, full, reason, condition_notes, returned_to_warehouse_at, expected_expiry, pieces_ok, pieces_retak, pieces_pecah, warehouse_checked_by, claim_ref, claim_status`

- `full` = `status = 'terkirim' and not exists(line with qty_returned_pack > 0 or reason is not null)`.
- `pieces_*` from the `returns` join (§4.4), converted to pieces in the view for kg products using the same flat 15.5 (keep one constant; expose it as a SQL function `pieces_per_kg()` or hardcode 15.5 with a comment pointing at `NEGERI_PIECES_PER_KG`).

**`open_delivery_items`** — the sheet's colour codes as boolean flags per delivery/line (used by the page filters and the Header badge):
- `needs_claim_ref` (red): buyer matches `OSV%`, line has `qty_returned_pack > 0`, `claim_id is null`.
- `awaiting_warehouse` (orange): line has `qty_returned_pack > 0`, reason not in (`kurang`, `cancel`, `revisi_po`, `masih_ditanyakan`), and no linked `returns` rows.
- `count_mismatch` (yellow): `pieces_ok + pieces_retak + pieces_pecah > qty_returned_pack × eggs_per_pack` (from `pack_skus`; for Box SKUs resolve via base pack × box capacity as `resolveBoxLine` does — do it client-side if awkward in SQL).
- `invoice_not_back`: `status = 'terkirim'` and `invoice_returned_at is null`.
- `not_logged`: PO exists in `purchase_orders` with a non-empty `invoice_ref` but no `deliveries` row.

**`returns_by_customer_product`** — the "RETURAN FOR REPORT" pivot source: `return_date, buyer_name, product, disposition, quantity_native, pieces` from `returns` joined to the delivery (for the buyer/DC name) — report page pivots client-side.

## 5. Navigation & pages

Follow the stock-count pattern: a **routed page `/deliveries`** (protected), reached from a 🚚 icon in the Header, **not** a new tab (tab bar stays at 8). Badge: a dot with the count of red + orange items from `open_delivery_items`.

### 5.1 Deliveries list (`src/pages/Deliveries.tsx`)
- Default range: last 14 days of `delivery_date`, newest first; date-range picker.
- Each row = one PO/faktur (not one line): date · invoice_ref · customer · driver · status chip · "faktur balik" chip (date or ✗) · acceptance summary ("Full" or "N pack retur · 2 item") · warehouse chip ("sudah diterima gudang dd/mm" or ⚠ belum) · OSV claim chip (ref or ⚠).
- **Filter chips** (multi): Belum dicatat · Belum terkirim · Faktur belum balik · Retur belum diterima gudang · OSV belum ada No. Retur · Hitungan tidak cocok · Full saja. These are the sheet's colour legend turned into filters.
- Search by invoice_ref / customer.
- Tablet landscape (`useIsTabletLandscape()`): list left, selected delivery detail right; phone: tap → detail replaces list, with back arrow (same split as buyer profiles).

### 5.2 Delivery detail (`src/components/deliveries/DeliveryDetail.tsx`)
Four sections, matching the sheet's merged header groups, each a small card:

1. **Pengiriman** — read-only PO header (from `purchase_orders`: buyer, DC, date, order lines with pack qty, invoice_ref); editable: driver (select from active drivers, or "tambah supir" for admins), status, PIC (defaults to current user). Status change to `batal` / `ditolak` asks for a note.
2. **Faktur balik** — date (defaults today when tapping "Faktur sudah balik"), checked-by auto = current user, editable.
3. **Penerimaan toko (per item)** — a table pre-seeded from the PO's `order_lines` (one row per pack SKU line, `qty_ordered_pack` = `packQty`, `qty_received_pack` defaults to `qty_ordered_pack`, `qty_returned_pack` 0). User edits received/returned and picks a reason; "+ tambah baris" to add a second reason row for the same SKU, or a SKU not on the PO (reason `lebih`). Expected expiry auto-fills from rules when `qty_returned_pack > 0`, editable. **Mark Full** button: sets status `terkirim`, leaves lines at zero returned (or deletes untouched seeded rows — keep the DB lean: only persist lines the user actually touched or that have a return).
4. **Gudang (barang balik)** — per line with `qty_returned_pack > 0`: shows linked returns (Tgl Barang Balik, OK / Retak / Pecah in pieces, paraf gudang) and a **"Catat barang balik"** button that opens the existing `RecordReturnDialog` for this order **pre-filtered to this SKU and prefilled** with `qty_returned_pack × eggs_per_pack` pieces in the Pecah column (the warehouse adjusts into OK/Retak/Pecah). The dialog emits `delivery_line_id` on every `ReturnLineInput` → `record_return`. The sum check (yellow) shows inline. Paraf gudang = the user who saved the return (store on the line when the return is recorded).
   - Reasons `kurang`, `cancel`, `revisi_po`, `masih_ditanyakan`: nothing physically returns → the section shows "tidak ada barang balik" and no orange flag.
   - `tukar_guling` (swap): the returned goods come back (so warehouse receipt applies) and the replacement is a **new PO** — note this in the UI, no special stock handling.
   - `ditolak` with the whole faktur rejected: status `ditolak`; lines still describe what came back (sheet row 2610315: AMTG 11 packs ditolak → 44 pecah).
5. **Klaim retur** (shown when buyer name starts with `OSV` or any line already has a claim) — pick an existing open claim for this buyer or create one (`claim_ref`, status). Assign to all returned lines of this delivery at once (the common case) or per line.

### 5.3 Entry points elsewhere
- **Activities page order cards** (`BuyerOrderCard`): a small delivery status chip (belum dicatat / belum terkirim / terkirim / ditolak / batal) that deep-links to `/deliveries?invoice=<ref>`. Read-only on the card.
- **RecordReturnDialog** opened from the Activities card (today's path) stays unchanged; if a matching delivery line exists for that order+SKU, attach `delivery_line_id` automatically so the two paths converge. If none exists, create the delivery (lazy) and a line with `qty_returned_pack = ceil(pieces / eggs_per_pack)` and reason `pecah` — the admin can correct the reason later. Decision Q3 confirms whether this auto-creation is wanted.

### 5.4 Catalog additions
- **Drivers** list (Catalog → new "Supir" tab, or a section under Buyers): name, active toggle. Admin-only edit, like buyers.
- **Aturan Expired** editor: table of rules (buyer keyword, SKU, days, note). Admin-only.

### 5.5 Reports (`/deliveries/reports` or a tab on the page)
1. **Log export** — CSV of `delivery_log` for a date range, columns in the sheet's order and Indonesian headers, dates `dd/mm/yyyy`, decimal comma. This is what admin hands to the boss / accounting instead of the sheet.
2. **Klaim Retur OSV** — the sheet's tab: KPIs (lines without claim ref, lines not yet billed, pieces pecah not yet billed) + table (delivery_date, invoice_ref, customer, sku, qty_returned_pack, reason, expected_expiry, pieces_pecah, claim_ref, status). Filter by buyer prefix (default `OSV`), status. Status is edited here too (one place; the sheet makes you go back to the log).
3. **Retur per customer per product** — the "RETURAN FOR REPORT" pivot: date range → rows = customer, columns = egg product, cells = pieces (and kg for Negeri), split by disposition (OK restocked is what the sheet reports; show all three with a toggle). Cross-product totals in butir-equivalent (CLAUDE.md rule).

## 6. Client contract

- `src/types/deliveries.ts` — `DeliveryStatus`, `ReturnReason`, `ClaimStatus`, `Delivery`, `DeliveryLine`, `ReturnClaim`, `ExpiryRule`, `Driver`, `DeliveryLogRow`.
- Hooks (TanStack Query, online-only):
  - `useDeliveries(range, filters)` — joins `purchase_orders` + `deliveries` + `open_delivery_items` flags; pages with `.range()` in 1000s like `usePurchaseOrders`.
  - `useDelivery(invoiceRef)` — one delivery + lines + linked returns; `ensureDelivery(po)` mutation does the lazy create (upsert on `invoice_ref_norm`).
  - `useDeliveryLines(deliveryId)` — CRUD; batch upsert on save.
  - `useDrivers()`, `useExpiryRules()`, `useReturnClaims(buyerPrefix)`.
- `src/lib/expiryRules.ts` — `resolveShelfDays`, `expectedExpiry`.
- `src/lib/deliveryFlags.ts` — pure functions for the five flags (same logic as the view, used for optimistic UI and tests).
- `src/lib/deliveryExport.ts` — CSV builder for the log export (reuse the existing CSV/export helper and Indonesian number formatting).
- `ReturnLineInput` gains `deliveryLineId?: string`; `returnRpc.ts` maps to `delivery_line_id`. Return outbox payload carries it through unchanged.
- Query invalidation: saving a return invalidates `['deliveries']`, `['delivery', invoiceRef]` in addition to today's keys.

## 7. Invariants (do not break)

- No change to stock, FIFO, outflow/return caps, `record_order_outflows`, `correct_order`, `void_outflow`. The only RPC edit is `record_return` persisting `delivery_line_id`.
- `delivery_lines.qty_*_pack` are paper/store numbers and **never** feed stock. Stock still moves only via `record_return`.
- kg-native rule: DB stores native units in `returns`; the delivery UI shows **pieces** (consistent with the return dialog) and labels kg products with `(≈ kg)` where a native figure is shown.
- `activity_logs.metadata` shape unchanged.
- i18n: every string in both `src/locales/en.ts` and `id.ts`, under a new `deliveries` block. Status/reason/claim labels in Indonesian warehouse vocabulary in both locales (like O/R/H), e.g. `Terkirim`, `Belum Terkirim`, `Ditolak`, `Batal`, `Pecah`, `Kurang`, `Tukar Guling`, `Belum Ditagih`, `Sudah Ditagih`, `Dibayar`.
- Phone width 375px: no sideways page scroll; tables scroll inside their own wrapper.

## 8. Edge cases

- **Invoice ref edited via `correct_order`** → the delivery's `invoice_ref` no longer matches any PO: list shows it under "tidak cocok dengan PO" with an "ubah No. Faktur" action (edit `invoice_ref` on the delivery; uniqueness enforced).
- **PO voided** after a delivery exists → the delivery row stays (history) but shows "PO dibatalkan"; flags are suppressed.
- **Duplicate invoice ref typed on two POs** → the second PO shows "No. Faktur sudah dipakai" on the Deliveries page; nothing is auto-merged. (Consider a soft warning in `QuickOutflowBuilder` later — out of scope here.)
- **Two returns events for one line** (eggs come back over two days) → multiple `returns` rows link to the same line; Tgl Barang Balik shows the first date, pieces sum.
- **Return recorded before the delivery is logged** (today's flow) → §5.3 auto-create, so nothing is lost.
- **SKU on the delivery line not on the PO** (`lebih`, or paper mismatch) → allowed; `qty_ordered_pack` null; warehouse receipt still works because the return dialog caps by the egg's pooled outflow, not the SKU.
- **Loose-egg (cash/tunai) orders** → have no SKU lines; deliveries are allowed but acceptance rows are per egg product with unit butir/kg; the sheet rarely has these. Keep minimal: no seeded rows, user adds rows with `sku_code` = egg product name. (Q4)
- **Box SKUs** → `qty_*_pack` means boxes; label the unit from `basePackCode` like the buyer-profile Prep list.
- **Buyer renamed** → snapshots keep old name (consistent with `activity_logs`); the `OSV` prefix rule uses the snapshot.

## 9. Open questions for the owner (answer before Phase 2)

1. **SKU codes.** The sheet's item codes (`N10`, `NO10`, `N 30`, `P 25`, `KP 6`, `KpO6`, `AMTG`, `N15`, `N6`, `NO6`, `N4`, `KP 10`) are not identical to EggKeep `pack_skus.code` (e.g. `KP6O`, `KP10B`, `BK4AMTG`). Proposal: delivery lines use EggKeep codes, and the export prints `pack_skus.code` (admin learns the app codes). Alternative: add `pack_skus.short_label` for the sheet spelling. Which?
2. **POs without `invoiceRef`.** Is `invoiceRef` already required in `QuickOutflowBuilder`? If not, make it required (it is the key for everything here) — confirm.
3. **Auto-create a delivery + line when a return is recorded from Activities** (§5.3) — yes/no? It keeps the two paths consistent but creates rows admin didn't type.
4. **Cash/tunai (loose) orders** — track deliveries for them at all in v1, or hide them from the Deliveries page?
5. **Expected expiry on full deliveries.** The sheet fills Tgl Expired even for full deliveries with no return (e.g. 2610304 Sushitoku 17/11). Needed in-app, or only when something is returned? Proposal: compute on demand in the export for all lines, store only on returned lines.
6. **Paraf** — email of the signed-in user is fine as paraf (no initials field)?
7. **"Kurang" vs. the PO.** When the store received less than ordered with reason `kurang`, should EggKeep suggest a `correct_order` (stock never left the warehouse)? Proposal: show a hint only, no automatic correction.

## 10. Testing

- `src/lib/__tests__/expiryRules.test.ts` — specificity order, substring match ("Astro" ⇢ "Astro Cikuda"), ties, default, no-match → null, 30-day month.
- `src/lib/__tests__/deliveryFlags.test.ts` — each flag against the sheet rows: 2610315 (ditolak + pecah 44, no claim needed, not OSV), 2610319 (OSV, two lines, claim OSV-2610037), 2610382 (same SKU, two reasons), 2610421 (one claim across 4 lines, two PICs), 2610383 second row (`Belum Terkirim`, no faktur balik), 2610402 (`kurang` → no warehouse flag), count mismatch (yellow).
- `deliveryExport.test.ts` — column order and Indonesian formatting match the sheet header row exactly.
- `RecordReturnDialog.test.tsx` — prefill from a delivery line, `deliveryLineId` emitted on every line, existing cap tests still pass.
- RPC: after redefining `record_return`, an idempotent replay with `delivery_line_id` is a no-op; a line without the field still inserts (null).
- Migration check: `select count(*) from delivery_log` equals `count(delivery_lines) + count(deliveries without lines)`.
- Manual: 375px phone, tablet split, non-admin cannot edit drivers/rules, Header badge count matches the red+orange filter.
- Verify gate: `npm run verify` (ref guard + `tsc --noEmit -p tsconfig.app.json` + vitest).

## 11. Rollout (each phase merges on its own)

**Phase 1 — Pengiriman & Faktur Balik** (replaces the "binder faktur" half)
- Migrations: `drivers`, `deliveries`, `expiry_rules` (table only), `open_delivery_items` with the `not_logged`, `invoice_not_back` flags.
- `/deliveries` list + detail sections 1–2, Header icon + badge, Activities card chip, drivers in Catalog.
- Export v1 (header columns, acceptance/warehouse columns blank).

**Phase 2 — Penerimaan toko & Gudang** (replaces the "binder merah")
- Migrations: `delivery_lines`, `returns.delivery_line_id` + `record_return` redefine, `delivery_log` view, remaining flags.
- Detail sections 3–4, seeded lines from `order_lines`, expiry rules editor + auto-fill, RecordReturnDialog prefill + linking, §5.3 auto-create (per Q3).
- Export v2 (full column set).

**Phase 3 — Klaim & laporan**
- Migration: `return_claims`, `delivery_lines.claim_id`, `returns_by_customer_product`.
- Detail section 5, Klaim Retur OSV report, Retur-per-customer pivot.
- Retire the Google Sheet: admin runs both for one week, then the sheet becomes read-only history.

**Phase 4 (optional) — Import history**
- One-off script that reads the sheet's `Pengiriman & Retur` tab and creates deliveries/lines/claims for fakturs that exist as POs in EggKeep (match on `invoice_ref`), mapping sheet item codes per Q1. Warehouse pieces are **not** imported into `returns` (those are already recorded there since 2026-09-21); only store-side rows and claims.

## 12. Decision log

| Decision | Choice | Why |
|---|---|---|
| Key for deliveries | `invoice_ref` (unique, normalized) | No PO id exists; the sheet and staff already key on No. Faktur. |
| Store-side quantities | packs, on `delivery_lines`, never touch stock | Mirrors paper; stock stays single-sourced in `returns`. |
| Warehouse-side quantities | reuse `returns` via `delivery_line_id` | No double entry of OK/Retak/Pecah; cap/FIFO untouched. |
| Reasons | fixed `check` list from the sheet's Daftar | One reason per line (Panduan rule 7); `lainnya` + notes for the rest. |
| Claims | own table, status per claim | One ref spans lines and fakturs; FamilyMart also has refs. |
| Expiry | rules table + pure resolver, editable result | Sheet's Aturan Expired logic exactly, but admin-editable. |
| Placement | routed page from Header | Tab bar is full; same pattern as stock count. |
| Offline | online-only v1 | Admin fills this at the office; returns keep their outbox. |
