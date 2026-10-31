-- Export Rekonsiliasi: read-only views the xlsx export (and any later
-- reconciliation script / sheet push) reads. Spec: docs/spec-export-rekonsiliasi.md
-- §6–§8; background: docs/reconciliation.md.
--
--   v_recon_products  every egg catalog item with its export label and order
--                     (§7). THE label map lives here and nowhere else.
--   v_recon_ledger    one row per egg stock movement, native units, positive
--                     quantities with the direction carried by the column,
--                     WIB dates, per-row flags (§8). Void rows are included
--                     with voided = true so the client can opt in to them.
--   v_recon_daily     one row per product per calendar day since the first
--                     movement (no-movement days included) with a running
--                     balance seeded from full history. Excludes void rows.
--
-- Classification of PO vs Tunai: outflows carry no source column; the
-- activity-log row written by the same submit does (metadata.orderType =
-- 'quick_outflow' for Purchase Orders, absent/'manual' for "Catat Kas Tunai"),
-- linked by metadata.relatedEntryId. Same rule as entryKind() in the app.
--
-- Additive only: no table changes. All three are security_invoker, so the
-- caller's RLS on the underlying tables applies.

create or replace view public.v_recon_products
with (security_invoker = true) as
with labels(nama_katalog, item, urutan) as (
  values
    ('NEGERI BIASA',  'Telur Negeri',        1),
    ('NEGERI OMEGA',  'Telur Negeri Omega',  2),
    ('KAMPUNG BIASA', 'Telur Kampung Pucat', 3),
    ('KAMPUNG MERAH', 'Telur Kampung Merah', 4),
    ('BEBEK TAWAR',   'Telur Bebek Tawar',   5),
    ('ASIN MATENG',   'Telur Asin Matang',   6),
    ('ASIN MENTAH',   'Telur Asin Mentah',   7),
    ('PUYUH',         'Telur Puyuh',         8),
    ('KUNING MANIK',  'Telur Kuning Manik',  9)
)
-- Deleted catalog rows stay in (historical movements may point at them).
-- RETAKAN children are labelled "<parent label> (RETAKAN)" and sort after
-- every parent; anything without a label sorts last, by catalog name.
select
  t.id,
  t.name                                            as nama_katalog,
  coalesce(lc.item, lp.item || ' (RETAKAN)', t.name) as item,
  case when t.unit = 'kg' then 'kg' else 'butir' end as unit,
  coalesce(t.eggs_per_unit, 1)                      as butir_per_unit,
  t.is_retakan,
  p.name                                            as induk,
  t.deleted_at,
  case when lc.urutan is not null then lc.urutan
       when lp.urutan is not null then 100 + lp.urutan
       when t.is_retakan           then 1100
       else 1000 end                                as urutan,
  (lc.item is null and lp.item is null)             as tanpa_label
from item_types t
left join labels lc on lc.nama_katalog = t.name
left join item_types p on p.id = t.parent_item_type_id
left join labels lp on lp.nama_katalog = p.name
where t.category = 'egg';

create or replace view public.v_recon_ledger
with (security_invoker = true) as
with today as (
  select (now() at time zone 'Asia/Jakarta')::date as d
),
-- Name fallback for rows whose item_type_id was never resolved (none today).
by_name as (
  select distinct on (t.name) t.name, t.id
  from item_types t
  where t.category = 'egg'
  order by t.name, (t.deleted_at is null) desc, t.created_at
),
-- The activity-log row an outflow was submitted with (latest if edited).
po as (
  select distinct on (x.oid) x.oid, x.order_type, x.buyer_name, x.invoice_ref
  from (
    select (l.metadata->>'relatedEntryId')::uuid     as oid,
           l.metadata->>'orderType'                  as order_type,
           nullif(btrim(l.metadata->>'buyerName'), '')  as buyer_name,
           nullif(btrim(l.metadata->>'invoiceRef'), '') as invoice_ref,
           l.created_at
    from activity_logs l
    where l.action_type = 'outflow'
      and pg_input_is_valid(l.metadata->>'relatedEntryId', 'uuid')
  ) x
  order by x.oid, x.created_at desc
),
movements as (
  -- Inflows. A RETAKAN child inflow written by record_return (same transaction
  -- timestamp, same quantity, parent product) is the stock effect of a
  -- 'retakan' return and is reported as jenis return_retakan on the child.
  select
    case when rr.id is not null then 'return_retakan' else 'inflow' end as jenis,
    case when pg_input_is_valid(i.date, 'date') then i.date::date end   as tanggal,
    po.invoice_ref                                                       as no_faktur,
    c.item, c.nama_katalog, c.unit, c.urutan, c.is_retakan, c.tanpa_label, c.butir_per_unit,
    i.quantity_butir   as masuk,
    null::numeric      as keluar_po,
    null::numeric      as keluar_tunai,
    null::numeric      as retur,
    i.quantity_butir   as qty,
    coalesce(rr.buyer_name, po.buyer_name, i.invoice_supplier) as pembeli_pemasok,
    i.created_at, i.voided_at,
    i.id, rr.outflow_id, rr.id as return_id,
    case when rr.id is not null then 'retakan' end as disposisi,
    case when pg_input_is_valid(o.date, 'date') then o.date::date end as tanggal_faktur_asal,
    (c.id is null) as sku_yatim,
    false           as tanpa_log
  from inflows i
  left join by_name bn on bn.name = i.product
  left join v_recon_products c on c.id = coalesce(i.item_type_id, bn.id)
  left join lateral (
    select r.id, r.outflow_id, r.buyer_name
    from returns r
    where c.is_retakan
      and r.disposition = 'retakan'
      and r.created_at = i.created_at
      and r.product || ' (RETAKAN)' = i.product
      and r.quantity = i.quantity_butir
    order by r.id
    limit 1
  ) rr on true
  left join outflows o on o.id = rr.outflow_id
  left join po on po.oid = rr.outflow_id
  where i.category = 'egg'

  union all

  -- Outflows: Purchase Orders vs Kas Tunai by the submit path that wrote them.
  select
    case when po.order_type = 'quick_outflow' and po.buyer_name is not null
         then 'outflow_po' else 'outflow_tunai' end,
    case when pg_input_is_valid(o.date, 'date') then o.date::date end,
    case when po.order_type = 'quick_outflow' and po.buyer_name is not null
         then po.invoice_ref end,
    c.item, c.nama_katalog, c.unit, c.urutan, c.is_retakan, c.tanpa_label, c.butir_per_unit,
    null,
    case when po.order_type = 'quick_outflow' and po.buyer_name is not null then o.quantity_butir end,
    case when po.order_type = 'quick_outflow' and po.buyer_name is not null then null else o.quantity_butir end,
    null,
    o.quantity_butir,
    coalesce(po.buyer_name, o.invoice_supplier),
    o.created_at, o.voided_at,
    o.id, o.id, null,
    null,
    null,
    (c.id is null),
    (po.oid is null)
  from outflows o
  left join by_name bn on bn.name = o.product
  left join v_recon_products c on c.id = coalesce(o.item_type_id, bn.id)
  left join po on po.oid = o.id
  where o.category = 'egg'

  union all

  -- Restock / write-off returns, on the parent product. (Retakan returns are
  -- reported through their child inflow above; writeoff has no stock effect.)
  select
    'return_' || r.disposition,
    r.return_date,
    po.invoice_ref,
    c.item, c.nama_katalog, c.unit, c.urutan, c.is_retakan, c.tanpa_label, c.butir_per_unit,
    null,
    null,
    null,
    case when r.disposition = 'restock' then r.quantity end,
    r.quantity,
    coalesce(r.buyer_name, po.buyer_name),
    r.created_at, null::timestamptz,
    r.id, r.outflow_id, r.id,
    r.disposition,
    case when pg_input_is_valid(o.date, 'date') then o.date::date end,
    (c.id is null),
    false
  from returns r
  join outflows o on o.id = r.outflow_id
  left join by_name bn on bn.name = r.product
  left join v_recon_products c on c.id = coalesce(r.item_type_id, bn.id)
  left join po on po.oid = r.outflow_id
  where r.category = 'egg' and r.disposition in ('restock', 'writeoff')

  union all

  -- Physical counts of the JS warehouse (the location the ledger tracks and
  -- the one the stock-count page's own variance compares against).
  select
    'stock_count',
    sc.count_date,
    null,
    c.item, c.nama_katalog, c.unit, c.urutan, c.is_retakan, c.tanpa_label, c.butir_per_unit,
    null, null, null, null,
    sc.quantity,
    null,
    sc.created_at, null::timestamptz,
    sc.id, null, null,
    null,
    null,
    (c.id is null),
    false
  from stock_counts sc
  left join v_recon_products c on c.id = sc.item_type_id
  where sc.category = 'egg' and sc.location = 'js_warehouse'
)
select
  m.jenis,
  m.tanggal,
  m.no_faktur,
  coalesce(m.item, '?')          as item,
  m.nama_katalog,
  coalesce(m.unit, 'butir')      as unit,
  coalesce(m.urutan, 1000)       as urutan,
  coalesce(m.is_retakan, false)  as is_retakan,
  coalesce(m.tanpa_label, true)  as tanpa_label,
  coalesce(m.butir_per_unit, 1)  as butir_per_unit,
  m.masuk, m.keluar_po, m.keluar_tunai, m.retur, m.qty,
  m.pembeli_pemasok,
  -- §8 flags. `faktur-ganda` is range-dependent and added by the client.
  -- `tgl-utc` is the exact shape of the old UTC-default form bug (entered
  -- before 07:00 WIB, business date = the day before): plain "created on
  -- another day" would flag every back-entered row.
  array_remove(array[
    case when m.voided_at is not null then 'void' end,
    case when m.is_retakan then 'retakan' end,
    case when m.sku_yatim then 'sku-yatim' end,
    case when m.jenis = 'outflow_po' and m.no_faktur is null then 'tanpa-faktur' end,
    case when m.tanpa_log then 'tanpa-log' end,
    case when m.qty is null or m.qty <= 0 then 'qty-nol' end,
    case when m.tanggal is null or m.tanggal < date '2026-07-01' or m.tanggal > t.d + 1 then 'tgl-aneh' end,
    case when (m.created_at at time zone 'Asia/Jakarta')::date = m.tanggal + 1
          and extract(hour from m.created_at at time zone 'Asia/Jakarta') < 7 then 'tgl-utc' end
  ]::text[], null)               as flags,
  (m.created_at at time zone 'Asia/Jakarta') as dibuat_wib,
  (m.voided_at is not null)      as voided,
  m.id,
  m.outflow_id,
  m.return_id,
  m.disposisi,
  m.tanggal_faktur_asal
from movements m
cross join today t;

create or replace view public.v_recon_daily
with (security_invoker = true) as
with l as (
  select *
  from v_recon_ledger
  where not voided and tanggal is not null and jenis <> 'stock_count'
),
products as (
  select nama_katalog, item, unit, urutan, is_retakan, tanpa_label
  from l
  group by 1, 2, 3, 4, 5, 6
),
span as (
  select min(tanggal) as d0,
         greatest(max(tanggal), (now() at time zone 'Asia/Jakarta')::date) as d1
  from l
),
days as (
  select generate_series(d0, d1, interval '1 day')::date as tgl from span
),
sums as (
  select nama_katalog, tanggal,
         coalesce(sum(masuk), 0)        as masuk,
         coalesce(sum(keluar_po), 0)    as keluar_po,
         coalesce(sum(keluar_tunai), 0) as keluar_tunai,
         coalesce(sum(retur), 0)        as retur
  from l
  group by 1, 2
),
dayflags as (
  select l.nama_katalog, l.tanggal, string_agg(distinct f, ', ' order by f) as catatan
  from l, unnest(l.flags) f
  group by 1, 2
),
counts as (
  select nama_katalog, tanggal, qty as hitung_fisik
  from v_recon_ledger
  where jenis = 'stock_count' and tanggal is not null
),
roll as (
  select p.*, d.tgl as tanggal,
         coalesce(s.masuk, 0)        as masuk,
         coalesce(s.keluar_po, 0)    as keluar_po,
         coalesce(s.keluar_tunai, 0) as keluar_tunai,
         coalesce(s.retur, 0)        as retur,
         sum(coalesce(s.masuk, 0) - coalesce(s.keluar_po, 0) - coalesce(s.keluar_tunai, 0) + coalesce(s.retur, 0))
           over (partition by p.nama_katalog order by d.tgl) as stok_akhir
  from products p
  cross join days d
  left join sums s on s.nama_katalog = p.nama_katalog and s.tanggal = d.tgl
)
select
  r.tanggal,
  r.item, r.nama_katalog, r.unit, r.urutan, r.is_retakan, r.tanpa_label,
  r.stok_akhir - (r.masuk - r.keluar_po - r.keluar_tunai + r.retur) as stok_awal,
  r.masuk, r.keluar_po, r.keluar_tunai, r.retur,
  r.stok_akhir,
  c.hitung_fisik,
  c.hitung_fisik - r.stok_akhir as selisih_fisik,
  f.catatan
from roll r
left join counts c   on c.nama_katalog = r.nama_katalog and c.tanggal = r.tanggal
left join dayflags f on f.nama_katalog = r.nama_katalog and f.tanggal = r.tanggal;

revoke all on public.v_recon_products, public.v_recon_ledger, public.v_recon_daily from anon, authenticated;
grant select on public.v_recon_products, public.v_recon_ledger, public.v_recon_daily to authenticated;
