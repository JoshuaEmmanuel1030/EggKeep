-- Export Rekonsiliasi: Penyesuaian Stok Fisik as its own movement.
-- Spec: docs/superpowers/specs/2026-11-12-stok-fisik-penyesuaian-design.md ("Not a sale,
-- not a receipt"); docs/spec-export-rekonsiliasi.md §5.
--
-- Rows written by apply_stock_count_adjustment (inflows/outflows.stock_adjustment_id set)
-- are neither Barang Masuk nor Kas Tunai: jenis 'penyesuaian', masuk/keluar_* null, and a
-- new signed column `penyesuaian` (+ in, - out). v_recon_daily sums it into stok_akhir.
--
-- Full restatement of v_recon_ledger (20261103000000_delivery_lines_void_return.sql §11)
-- and v_recon_daily (20261029000000_recon_views.sql). The only changes are the
-- penyesuaian jenis/column; the new column is appended last in both views (create or
-- replace view can only add trailing columns).

create or replace view public.v_recon_ledger
with (security_invoker = true) as
with today as (
  select (now() at time zone 'Asia/Jakarta')::date as d
),
by_name as (
  select distinct on (t.name) t.name, t.id
  from item_types t
  where t.category = 'egg'
  order by t.name, (t.deleted_at is null) desc, t.created_at
),
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
  -- Inflows. A RETAKAN child inflow written by record_return is the stock effect of a
  -- 'retakan' return and is reported as jenis return_retakan on the child: matched by
  -- inflows.return_id when set, else (legacy rows) same timestamp, quantity and product.
  select
    case when i.stock_adjustment_id is not null then 'penyesuaian'
         when rr.id is not null then 'return_retakan' else 'inflow' end as jenis,
    case when pg_input_is_valid(i.date, 'date') then i.date::date end   as tanggal,
    po.invoice_ref                                                       as no_faktur,
    c.item, c.nama_katalog, c.unit, c.urutan, c.is_retakan, c.tanpa_label, c.butir_per_unit,
    case when i.stock_adjustment_id is null then i.quantity_butir end as masuk,
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
    false           as tanpa_log,
    coalesce(rr.voided_at is not null, false) as dibatalkan,
    case when i.stock_adjustment_id is not null then i.quantity_butir end as penyesuaian
  from inflows i
  left join by_name bn on bn.name = i.product
  left join v_recon_products c on c.id = coalesce(i.item_type_id, bn.id)
  left join lateral (
    select r.id, r.outflow_id, r.buyer_name, r.voided_at
    from returns r
    where c.is_retakan
      and r.disposition = 'retakan'
      and (r.id = i.return_id
           or (i.return_id is null
               and r.created_at = i.created_at
               and r.product || ' (RETAKAN)' = i.product
               and r.quantity = i.quantity_butir))
    order by r.id
    limit 1
  ) rr on true
  left join outflows o on o.id = rr.outflow_id
  left join po on po.oid = rr.outflow_id
  where i.category = 'egg'

  union all

  -- Outflows: Purchase Orders vs Kas Tunai by the submit path that wrote them; a
  -- compensating outflow of a voided return is 'retur_batal' (a negative retur); a
  -- Penyesuaian Stok Fisik deduction is 'penyesuaian' (negative), never Kas Tunai.
  select
    case when o.stock_adjustment_id is not null then 'penyesuaian'
         when o.void_return_id is not null then 'retur_batal'
         when po.order_type = 'quick_outflow' and po.buyer_name is not null
         then 'outflow_po' else 'outflow_tunai' end,
    case when pg_input_is_valid(o.date, 'date') then o.date::date end,
    case when o.void_return_id is not null then rpo.invoice_ref
         when po.order_type = 'quick_outflow' and po.buyer_name is not null
         then po.invoice_ref end,
    c.item, c.nama_katalog, c.unit, c.urutan, c.is_retakan, c.tanpa_label, c.butir_per_unit,
    null,
    case when o.void_return_id is null and po.order_type = 'quick_outflow' and po.buyer_name is not null
         then o.quantity_butir end,
    case when o.void_return_id is not null or o.stock_adjustment_id is not null then null
         when po.order_type = 'quick_outflow' and po.buyer_name is not null then null
         else o.quantity_butir end,
    case when o.void_return_id is not null then -o.quantity_butir end,
    o.quantity_butir,
    case when o.void_return_id is not null then coalesce(vr.buyer_name, rpo.buyer_name)
         else coalesce(po.buyer_name, o.invoice_supplier) end,
    o.created_at, o.voided_at,
    o.id, o.id, o.void_return_id,
    vr.disposition,
    case when pg_input_is_valid(ro.date, 'date') then ro.date::date end,
    (c.id is null),
    (o.void_return_id is null and o.stock_adjustment_id is null and po.oid is null),
    false,
    case when o.stock_adjustment_id is not null then -o.quantity_butir end
  from outflows o
  left join by_name bn on bn.name = o.product
  left join v_recon_products c on c.id = coalesce(o.item_type_id, bn.id)
  left join po on po.oid = o.id
  left join returns vr on vr.id = o.void_return_id
  left join outflows ro on ro.id = vr.outflow_id
  left join po rpo on rpo.oid = vr.outflow_id
  where o.category = 'egg'

  union all

  -- Restock / write-off returns, on the parent product. (Retakan returns are
  -- reported through their child inflow above; writeoff has no stock effect.)
  -- A voided return stays a movement (its void is the retur_batal row); a return on
  -- a voided outflow is voided with it.
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
    r.created_at, o.voided_at,
    r.id, r.outflow_id, r.id,
    r.disposition,
    case when pg_input_is_valid(o.date, 'date') then o.date::date end,
    (c.id is null),
    false,
    (r.voided_at is not null),
    null::numeric
  from returns r
  join outflows o on o.id = r.outflow_id
  left join by_name bn on bn.name = r.product
  left join v_recon_products c on c.id = coalesce(r.item_type_id, bn.id)
  left join po on po.oid = r.outflow_id
  where r.category = 'egg' and r.disposition in ('restock', 'writeoff')

  union all

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
    false,
    false,
    null::numeric
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
  array_remove(array[
    case when m.voided_at is not null then 'void' end,
    case when m.is_retakan then 'retakan' end,
    case when m.sku_yatim then 'sku-yatim' end,
    case when m.jenis = 'outflow_po' and m.no_faktur is null then 'tanpa-faktur' end,
    case when m.tanpa_log then 'tanpa-log' end,
    case when m.qty is null or m.qty <= 0 then 'qty-nol' end,
    case when m.tanggal is null or m.tanggal < date '2026-07-01' or m.tanggal > t.d + 1 then 'tgl-aneh' end,
    case when (m.created_at at time zone 'Asia/Jakarta')::date = m.tanggal + 1
          and extract(hour from m.created_at at time zone 'Asia/Jakarta') < 7 then 'tgl-utc' end,
    case when m.jenis = 'retur_batal' then 'retur-batal' end,
    case when m.dibatalkan then 'retur-dibatalkan' end
  ]::text[], null)               as flags,
  (m.created_at at time zone 'Asia/Jakarta') as dibuat_wib,
  (m.voided_at is not null)      as voided,
  m.id,
  m.outflow_id,
  m.return_id,
  m.disposisi,
  m.tanggal_faktur_asal,
  m.penyesuaian
from movements m
cross join today t;

revoke all on public.v_recon_ledger from anon, authenticated;
grant select on public.v_recon_ledger to authenticated;

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
         coalesce(sum(retur), 0)        as retur,
         coalesce(sum(penyesuaian), 0)  as penyesuaian
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
         coalesce(s.penyesuaian, 0)  as penyesuaian,
         sum(coalesce(s.masuk, 0) - coalesce(s.keluar_po, 0) - coalesce(s.keluar_tunai, 0) + coalesce(s.retur, 0)
             + coalesce(s.penyesuaian, 0))
           over (partition by p.nama_katalog order by d.tgl) as stok_akhir
  from products p
  cross join days d
  left join sums s on s.nama_katalog = p.nama_katalog and s.tanggal = d.tgl
)
select
  r.tanggal,
  r.item, r.nama_katalog, r.unit, r.urutan, r.is_retakan, r.tanpa_label,
  r.stok_akhir - (r.masuk - r.keluar_po - r.keluar_tunai + r.retur + r.penyesuaian) as stok_awal,
  r.masuk, r.keluar_po, r.keluar_tunai, r.retur,
  r.stok_akhir,
  c.hitung_fisik,
  c.hitung_fisik - r.stok_akhir as selisih_fisik,
  f.catatan,
  r.penyesuaian
from roll r
left join counts c   on c.nama_katalog = r.nama_katalog and c.tanggal = r.tanggal
left join dayflags f on f.nama_katalog = r.nama_katalog and f.tanggal = r.tanggal;


revoke all on public.v_recon_daily from anon, authenticated;
grant select on public.v_recon_daily to authenticated;
