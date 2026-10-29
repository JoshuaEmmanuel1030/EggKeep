# Delivery & Return Log (Log Pengiriman & Retur) — Design Spec

**Date:** 2026-10-29
**Status:** Phase 1 implemented; Phases 2–4 pending
**Author:** Joshua
**Builds on:** `2026-10-22-buyer-profiles-design.md` (the `purchase_orders` view), `2026-10-08-per-sku-returns-design.md` (`returns` / `record_return` with per-SKU lines in pieces and O/R/H dispositions), `2026-08-20-physical-stock-count-design.md` (the routed-page-from-Header pattern).

> This file is the **Phase-1 abridgement** of the full spec, which lives on Joshua's machine (`C:\Users\Joshua\Downloads\spec.md`). The full spec also covers Phases 2–4 (delivery lines, `returns.delivery_line_id`, claims, reports); those are later sessions and are summarised here only where they shape Phase 1's tables. Ask Joshua for Phase 2+ details before designing them.

**Replaces** the Google Sheet "Log Pengiriman & Retur" (tabs: Pengiriman & Retur, Klaim Retur OSV, Daftar, Aturan Expired, Panduan).

## 1. Problem

EggKeep records a PO at loading and a return when eggs come back. Everything between still lives in a sheet admin (Yani / Dila / Novi) fills by hand:

1. **Pengiriman** — which driver took the faktur, delivered / rejected / cancelled;
2. **Faktur balik** — when the signed invoice came back and who checked it (paraf admin);
3. store acceptance per item in packs with a reason;
4. warehouse receipt (Butir OK/Retak/Pecah);
5. Klaim Retur OSV.

The sheet is keyed by No. Faktur = EggKeep's `invoiceRef` on a PO, so the systems already share a key. Joshua confirmed (2026-10-29) that this is the exact string admin also keys into Peachtree, so it is a trustworthy join key. **Phase 1 covers (1) and (2).**

## 3. Vocabulary

| Sheet term | EggKeep | Notes |
|---|---|---|
| No. Faktur / PO | `invoice_ref` | PO's `metadata.invoiceRef`. Single join key. |
| Customer ("OSV Depok") | buyer + DC | Store both, display as `<buyer> <dc>`. |
| Supir | driver | New catalog list. |
| Status Kirim | `status` | `belum_terkirim` · `terkirim` · `ditolak` · `batal` |
| Tgl Faktur Balik / Paraf Admin | `invoice_returned_at` / `invoice_checked_by` | |
| Full | derived | delivered and nothing returned. |

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

**Creation: lazy.** A row is created the first time someone opens that PO on the Deliveries page or taps "Delivery" on its order card. The page lists POs from `purchase_orders` **left-joined** to `deliveries` on `invoice_ref_norm`, so un-logged POs still appear as "belum dicatat". Outflow pipeline untouched.

(Phase 2 adds `delivery_lines` — one per SKU × reason, store-side pack quantities that never feed stock — and `returns.delivery_line_id`; Phase 3 adds `return_claims`. Phase 1 is designed so those attach without altering `deliveries`.)

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

### 4.7 Views (`security_invoker = true`, grant select to authenticated)

**`open_delivery_items`** — Phase 1 flags only: `invoice_not_back` = `status = 'terkirim' and invoice_returned_at is null`; `not_logged` = PO exists in `purchase_orders` with a non-empty `invoice_ref` but no `deliveries` row. (Later: `needs_claim_ref`, `awaiting_warehouse`, `count_mismatch`.)

**`delivery_log`** is Phase 2, but export v1 already uses its columns in this exact order: `pic, delivery_date, invoice_ref, customer (buyer + ' ' + dc), driver_name, status, invoice_returned_at, invoice_checked_by, sku_code, qty_received_pack, qty_returned_pack, full, reason, condition_notes, returned_to_warehouse_at, expected_expiry, pieces_ok, pieces_retak, pieces_pecah, warehouse_checked_by, claim_ref, claim_status`. In Phase 1 the export emits one row per delivery with columns 9 onwards blank.

> Implementation note (2026-10-29): the full spec says "21 columns" but the ordered list above names 22. Phase 1 implements the explicit 22-name list; confirm against the sheet's header row and drop/merge one if the sheet really has 21.

## 5. Navigation & pages

Routed page `/deliveries` (protected) from a 🚚 Header icon, **not** a new tab (tab bar stays at 8). Badge: count of open items from `open_delivery_items` (Phase 1: `invoice_not_back`).

### 5.1 Deliveries list (`src/pages/Deliveries.tsx`)

- Default range: last 14 days of `delivery_date`, newest first; date-range picker.
- One row per PO/faktur: date · invoice_ref · customer · driver · status chip · "faktur balik" chip (date or ✗). (Acceptance / warehouse / claim chips come in later phases.)
- Filter chips (multi): Belum dicatat · Belum terkirim · Faktur belum balik. Search by invoice_ref / customer.
- Tablet landscape (`useIsTabletLandscape()`): list left, detail right; phone: tap → detail replaces list with back arrow (same split as buyer profiles).

### 5.2 Delivery detail (`src/components/deliveries/DeliveryDetail.tsx`) — Phase 1 sections

1. **Pengiriman** — read-only PO header from `purchase_orders` (buyer, DC, date, order lines with pack qty, invoice_ref); editable: driver (select from active drivers, "tambah supir" for admins), status, PIC (defaults to current user). Status change to `batal` / `ditolak` asks for a note.
2. **Faktur balik** — date (defaults today when tapping "Faktur sudah balik"), checked-by auto = current user, editable.

### 5.3 Entry points

- `BuyerOrderCard` on Activities: a small delivery status chip (belum dicatat / belum terkirim / terkirim / ditolak / batal) deep-linking to `/deliveries?invoice=<ref>`. Read-only on the card.

### 5.4 Catalog

- **Drivers** list (new "Supir" tab or a section under Buyers): name, active toggle. Admin-only edit, like buyers.

### 5.5 Reports — Phase 1

- **Log export**: CSV of the log columns for a date range, Indonesian headers, `dd/mm/yyyy`, decimal comma. What admin hands to the boss / accounting instead of the sheet.

## 6. Client contract (Phase 1 subset)

- `src/types/deliveries.ts` — `DeliveryStatus`, `Delivery`, `Driver`, `ExpiryRule`, `DeliveryLogRow`.
- Hooks: `useDeliveries(range, filters)` joins `purchase_orders` + `deliveries` + flags; `useDelivery(invoiceRef)` with `ensureDelivery(po)` upsert on `invoice_ref_norm`; `useDrivers()`.
- `src/lib/deliveryFlags.ts` — pure functions for the flags (same logic as the view, used for optimistic UI and tests). `src/lib/deliveryExport.ts` — CSV builder reusing the existing CSV/export helper and Indonesian number formatting.

## 7. Invariants

- No change to stock, FIFO, outflow/return caps, `record_order_outflows`, `correct_order`, `void_outflow`, `record_return`.
- `activity_logs.metadata` shape unchanged.
- i18n: every string in both locale files under a `deliveries` block; status labels in Indonesian warehouse vocabulary in both locales.
- Phone width 375px: no sideways page scroll; tables scroll inside their own wrapper.

## 8. Edge cases (Phase 1)

- Invoice ref edited via `correct_order` → the delivery no longer matches any PO: list it under "tidak cocok dengan PO" with an "ubah No. Faktur" action (edit `invoice_ref`; uniqueness enforced).
- PO voided after a delivery exists → row stays (history), shows "PO dibatalkan"; flags suppressed.
- Duplicate invoice ref on two POs → the second shows "No. Faktur sudah dipakai"; nothing auto-merged.
- Loose-egg (cash/tunai) orders → no SKU lines; keep minimal. Cash (Kas Tunai) entries are manual outflows without `orderType = 'quick_outflow'`, so they never appear in `purchase_orders`; a buyer PO made only of loose lines does, and shows on `/deliveries` only when it carries an `invoice_ref`.
- Buyer renamed → snapshots keep the old name (consistent with `activity_logs`).

## 10. Testing (Phase 1)

- `src/lib/__tests__/deliveryFlags.test.ts` — `invoice_not_back` and `not_logged`, e.g. sheet row 2610383 second row (`Belum Terkirim`, no faktur balik).
- `deliveryExport.test.ts` — column order and Indonesian formatting match the sheet header row exactly.
- Manual: 375px phone, tablet split, non-admin cannot edit drivers, Header badge count matches the filter.
- Verify gate: `npm run verify`.

## 12. Decision log

| Decision | Choice | Why |
|---|---|---|
| Key for deliveries | `invoice_ref` (unique, normalized) | No PO id exists; staff already key on No. Faktur. |
| Placement | routed page from Header | Tab bar is full; same pattern as stock count. |
| Offline | online-only v1 | Admin fills this at the office; returns keep their outbox. |
| Store/warehouse quantities | Phase 2+, never touch stock | Stock stays single-sourced in `returns`. |
| `invoiceRef` on the PO builder | still optional (unchanged in Phase 1) | Making it required changes the order flow; proposed to Joshua, awaiting his call. |
