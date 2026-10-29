-- Delivery & Return Log, Phase 1: one `deliveries` row per faktur / Purchase
-- Order (Pengiriman + Faktur balik), plus the `open_delivery_items` view that
-- feeds the Header badge and the list filters.
-- Spec: docs/superpowers/specs/2026-10-29-delivery-return-log-design.md §4.2, §4.7
--
-- Keyed on the PO's invoice_ref (metadata.invoiceRef) because purchase_orders
-- has no stable order id. Rows are created lazily from the Deliveries page.
-- Nothing here touches stock, FIFO, outflows, returns or any RPC.
-- Additive only.
create table public.deliveries (
  id                  uuid primary key default gen_random_uuid(),
  invoice_ref         text not null check (length(btrim(invoice_ref)) > 0), -- as typed on the PO
  invoice_ref_norm    text generated always as (upper(btrim(invoice_ref))) stored,
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

alter table public.deliveries enable row level security;

-- Same access as stock_counts: any signed-in user can read/insert/update.
create policy "Authenticated users can read deliveries"
  on public.deliveries for select to authenticated using (true);
create policy "Authenticated users can insert deliveries"
  on public.deliveries for insert to authenticated with check (true);
create policy "Authenticated users can update deliveries"
  on public.deliveries for update to authenticated using (true) with check (true);

-- Open items, one row per (PO, delivery) pair that still needs attention.
-- Phase 1 flags:
--   not_logged       PO has a non-empty invoice_ref but no deliveries row yet
--   invoice_not_back delivered, but the signed faktur has not come back
-- Driven from purchase_orders (non-voided POs only), so a delivery whose PO was
-- voided or re-keyed drops out here: its flags are suppressed, the row itself
-- stays in `deliveries` as history. Later phases add needs_claim_ref,
-- awaiting_warehouse and count_mismatch to the same view.
create view public.open_delivery_items
with (security_invoker = true) as
select
  po.invoice_ref,
  upper(btrim(po.invoice_ref))                                   as invoice_ref_norm,
  po.buyer_name,
  po.dc_name,
  po.outflow_date                                                as delivery_date,
  d.id                                                           as delivery_id,
  d.status,
  d.invoice_returned_at,
  (d.id is null)                                                 as not_logged,
  (d.status = 'terkirim' and d.invoice_returned_at is null)      as invoice_not_back
from public.purchase_orders po
left join public.deliveries d on d.invoice_ref_norm = upper(btrim(po.invoice_ref))
where coalesce(btrim(po.invoice_ref), '') <> ''
  and (d.id is null or (d.status = 'terkirim' and d.invoice_returned_at is null));

revoke all on public.open_delivery_items from anon, authenticated;
grant select on public.open_delivery_items to authenticated;
