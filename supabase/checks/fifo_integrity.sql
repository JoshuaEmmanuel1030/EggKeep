-- FIFO integrity check — READ ONLY, SAFE ON PRODUCTION.
--
-- Not a test. `supabase/tests/*.sql` are mutating transactions that must never touch
-- production; this file is the opposite: it writes nothing, takes no locks, and is
-- meant to be run against the live project. One statement, so `execute_sql` of the
-- whole file returns the entire report (the MCP tool only returns the LAST result set,
-- which is why this is a single UNION ALL rather than several queries).
--
-- Every row is OK or CHECK. A clean run is 6 rows, all OK. Problems add detail rows.
-- Run it after any bulk or backdated data entry — that is when drift would appear.
--
-- What "OK" on the first check means: for every product, the sum of batch remainders
-- equals inflows - non-voided outflows + restocked returns. That identity is the
-- strongest single statement about FIFO bookkeeping; returns restock a batch WITHOUT
-- reversing the outflow, so they have to be added back or the identity looks broken.

with inf as (
  select product,
         sum(quantity_butir)  as inflow_total,
         sum(remaining_butir) as remaining_total
  from inflows where voided_at is null group by product
), outf as (
  select product, sum(quantity_butir) as outflow_total
  from outflows where voided_at is null group by product
), res as (
  select i.product, sum(rr.quantity_restored) as restocked
  from return_restocks rr join inflows i on i.id = rr.inflow_id
  where i.voided_at is null group by i.product
), ident as (
  select inf.product,
         inf.remaining_total,
         inf.inflow_total - coalesce(outf.outflow_total,0) + coalesce(res.restocked,0) as expected,
         inf.remaining_total - (inf.inflow_total - coalesce(outf.outflow_total,0) + coalesce(res.restocked,0)) as gap
  from inf
  left join outf on outf.product = inf.product
  left join res  on res.product  = inf.product
), oldest_open as (
  -- The batch FIFO would draw from next: first by business date, then by entry time.
  select distinct on (product) product, date, date::date as d, created_at as ca
  from inflows where voided_at is null and remaining_butir > 0
  order by product, date::date asc, created_at asc
), disorder as (
  -- STRICT tuple comparison, so ties are excluded on purpose. Several inflows saved in
  -- one go share created_at to the microsecond, and `order by date, created_at` does not
  -- order those among themselves — the draw order within a tie is undefined, not wrong.
  -- Using row_number() here instead would break ties arbitrarily and report them as
  -- violations. Same date means same age, so a tie is physically equivalent anyway.
  select b.product, count(*) as newer_drawn, sum(b.quantity_butir - b.remaining_butir) as units
  from inflows b join oldest_open o on o.product = b.product
  where b.voided_at is null
    and (b.date::date, b.created_at) > (o.d, o.ca)
    and b.remaining_butir < b.quantity_butir
  group by b.product
), ties as (
  -- Tied (date, created_at) groups where more than one batch is partly drawn. Benign for
  -- stock and for freshness, but it is why draw order can look odd, and it is what a
  -- final `, id asc` in the RPC's ORDER BY would make deterministic.
  select count(*) as tied_groups from (
    select product, date, created_at
    from inflows where voided_at is null
    group by product, date, created_at
    having count(*) > 1 and count(*) filter (where remaining_butir < quantity_butir) > 1
  ) g
), fn as (
  select pg_get_functiondef(p.oid) as d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'record_order_outflows'
  limit 1
)

-- 1. the ledger identity, per product
select 1 as ord, 'ledger identity' as check_name, count(*)::text || ' products' as subject,
       count(*) filter (where abs(gap) >= 0.0005)::text || ' disagree with inflows - outflows + restocks' as detail,
       case when count(*) filter (where abs(gap) >= 0.0005) = 0 then 'OK' else 'CHECK' end as status
from ident
union all
select 2, 'ledger identity', product,
       'remainders ' || round(remaining_total,3) || ' vs ledger ' || round(expected,3) || ' — gap ' || round(gap,3),
       'CHECK'
from ident where abs(gap) >= 0.0005

-- 2. batch-level invariants. Each must be zero.
union all
select 3, 'batch invariants', 'negative remainder',
       count(*)::text || ' batches', case when count(*) = 0 then 'OK' else 'CHECK' end
from inflows where voided_at is null and remaining_butir < 0
union all
select 3, 'batch invariants', 'remainder exceeds batch size',
       count(*)::text || ' batches', case when count(*) = 0 then 'OK' else 'CHECK' end
from inflows where voided_at is null and remaining_butir > quantity_butir + 0.0005
union all
select 3, 'batch invariants', 'null remainder',
       count(*)::text || ' batches', case when count(*) = 0 then 'OK' else 'CHECK' end
from inflows where voided_at is null and remaining_butir is null
union all
select 3, 'batch invariants', 'restocked more than was deducted',
       count(*)::text || ' batches', case when count(*) = 0 then 'OK' else 'CHECK' end
from (
  select rr.inflow_id from return_restocks rr join inflows i on i.id = rr.inflow_id
  group by rr.inflow_id, i.quantity_butir
  having sum(rr.quantity_restored) > i.quantity_butir + 0.0005
) over_restored

-- 3. Voided batches keeping a remainder. Cosmetic while the FIFO guard below holds,
--    because the deduction query excludes voided rows — the numbers are unreachable.
--    Expect remaining = quantity: anything less means stock was stranded mid-draw.
union all
select 4, 'voided batches holding a remainder',
       count(*)::text || ' batches',
       'unreachable while the FIFO guard holds; ' ||
       count(*) filter (where remaining_butir <> quantity_butir)::text || ' were partly drawn before voiding',
       case when count(*) filter (where remaining_butir <> quantity_butir) = 0 then 'OK' else 'CHECK' end
from inflows where voided_at is not null and coalesce(remaining_butir,0) <> 0

-- 4. Draw order. A product here is USUALLY backdating, not a bug: an inflow entered
--    today with an older date lands behind the FIFO pointer, and a draw that already
--    happened cannot reach back for it. Compare `dated` with `entered` on the named
--    batch — if they differ, that is the whole story. Equal dates deserve a look.
union all
select 5, 'draw order', 'products drawing out of order',
       count(*)::text || ' products', case when count(*) = 0 then 'OK' else 'REVIEW' end
from disorder
union all
select 6, 'draw order', d.product,
       'oldest open batch dated ' || o.date || ' but entered ' || o.ca::date ||
       case when o.d <> o.ca::date then ' — backdated, expected' else ' — NOT backdated, look closer' end ||
       '; ' || d.newer_drawn || ' strictly-newer batches already drawn (' || round(d.units,2) || ' units)',
       case when o.d <> o.ca::date then 'REVIEW' else 'CHECK' end
from disorder d
join oldest_open o on o.product = d.product

-- 4b. Tied entry timestamps: why draw order within one save is undefined.
union all
select 6.5, 'draw order', 'tied (date, created_at) groups partly drawn',
       tied_groups::text || ' groups — draw order within a tie is undefined; a final '', id asc'' in the RPC ORDER BY would fix it',
       case when tied_groups = 0 then 'OK' else 'REVIEW' end
from ties

-- 5. The deduction query's own guards, so a future edit that drops one is caught here
--    rather than by a stock discrepancy weeks later.
union all
select 7, 'fifo guard in record_order_outflows', 'required clauses',
       concat_ws(', ',
         case when d ~* 'voided_at\s+is\s+null'                      then 'excludes voided'      else 'MISSING voided filter' end,
         case when d ~* 'remaining_butir\s*>\s*0'                    then 'skips empty batches'  else 'MISSING remaining > 0' end,
         case when d ~* 'order\s+by\s+date\s+asc\s*,\s*created_at\s+asc' then 'date-ordered'     else 'MISSING date ordering' end,
         case when d ~* 'for\s+update'                               then 'row-locked'           else 'MISSING row lock' end),
       case when d ~* 'voided_at\s+is\s+null'
             and d ~* 'remaining_butir\s*>\s*0'
             and d ~* 'order\s+by\s+date\s+asc\s*,\s*created_at\s+asc'
             and d ~* 'for\s+update'
            then 'OK' else 'CHECK' end
from fn

order by ord, subject;
