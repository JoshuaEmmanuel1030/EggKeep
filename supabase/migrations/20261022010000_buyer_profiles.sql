-- Buyer profiles: pinned SKUs + a one-row-per-order view for insights.
-- Additive only: one new column with a default, one new read-only view.

-- SKUs pinned to the top of this buyer's Purchase Order SKU dropdown.
-- pack_skus ids (rename-safe); ids of deleted/inactive SKUs are ignored on read.
alter table public.buyers
  add column if not exists pinned_sku_ids uuid[] not null default '{}';

-- One row per recorded Purchase Order. An order writes one activity_logs row per
-- egg/packaging/label/box entry, all with the same metadata except relatedEntryId.
-- Metadata has no order id and recorded_at differs by ~1 ms between an order's
-- rows, so each (category, product) row is numbered within its metadata group
-- (k): an order writes each product once, so two identical orders become k=1 and
-- k=2 instead of merging. Voided rows are excluded, so an edited order appears
-- once, as its replacement. egg_totals come from the live rows (not the
-- relatedProducts snapshot) so a single voided egg row drops out; order_lines
-- stay the as-ordered snapshot.
create view public.purchase_orders
with (security_invoker = true) as
select
  min(r.recorded_at) as recorded_at,
  r.m->>'buyerName'  as buyer_name,
  case when pg_input_is_valid(r.m->>'outflowDate', 'date')
       then (r.m->>'outflowDate')::date
       else (min(r.recorded_at) at time zone 'Asia/Jakarta')::date
  end                as outflow_date,
  r.m->>'dcId'       as dc_id,
  r.m->>'dcName'     as dc_name,
  r.m->>'invoiceRef' as invoice_ref,
  coalesce(r.m->'orderLines', '[]'::jsonb) as order_lines,
  coalesce(jsonb_agg(jsonb_build_object('product', r.product, 'quantity', r.quantity_butir))
             filter (where r.category = 'egg'), '[]'::jsonb) as egg_totals
from (
  select metadata - 'relatedEntryId' as m, category, product, quantity_butir, recorded_at,
         row_number() over (partition by metadata - 'relatedEntryId', category, product
                            order by recorded_at, id) as k
  from public.activity_logs
  where action_type = 'outflow'
    and voided_at is null
    and metadata->>'orderType' = 'quick_outflow'
    and coalesce(metadata->>'buyerName', '') <> ''
) r
group by r.m, r.k;

revoke all on public.purchase_orders from anon, authenticated;
grant select on public.purchase_orders to authenticated;
