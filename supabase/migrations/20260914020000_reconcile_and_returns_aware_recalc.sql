-- Inventory reconciliation + returns-aware recalculate.
--
-- Two related fixes for ledger↔balance integrity:
--
-- 1. reconcile_inventory(): read-only. For every live inflow, recompute the
--    balance the incremental RPCs are supposed to maintain and compare to the
--    stored remaining_butir. Returns only discrepancies. The invariant is:
--        remaining = quantity_butir
--                  − Σ(fifo_deductions from NON-voided outflows)
--                  + Σ(return_restocks from NON-voided outflows)
--    (Voided outflows net to zero: their deduction is excluded here, and
--    void_outflow already restored the remainder — verified by algebra.)
--
-- 2. recalculate_inventory_fifo(): the existing rebuild reset remaining=quantity
--    and re-deducted outflows but NEVER re-applied return_restocks, so running it
--    after any restock return silently erased the restock (re-deducting returned
--    stock). Added Step 3.5 to re-apply restocks. The inflows_remaining_bounds
--    constraint backstops it: if a rare rebuild edge would push a batch above its
--    intake, recalc aborts (fail-loud) instead of corrupting stock.

-- ── 1. Read-only reconciliation ─────────────────────────────────────────────────
create or replace function public.reconcile_inventory()
returns table (
  inflow_id          uuid,
  product            text,
  stored_remaining   numeric,
  expected_remaining numeric,
  drift              numeric,
  kind               text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.product, i.remaining_butir,
         e.expected_remaining,
         i.remaining_butir - e.expected_remaining as drift,
         case
           when i.remaining_butir < 0                  then 'negative'
           when i.remaining_butir > i.quantity_butir   then 'over_original'
           else 'drift'
         end as kind
  from inflows i
  cross join lateral (
    select i.quantity_butir
         - coalesce((
             select sum(fd.quantity_deducted)
             from fifo_deductions fd
             join outflows o on o.id = fd.outflow_id
             where fd.inflow_id = i.id and o.voided_at is null
           ), 0)
         + coalesce((
             select sum(rr.quantity_restored)
             from return_restocks rr
             join returns r  on r.id  = rr.return_id
             join outflows o2 on o2.id = r.outflow_id
             where rr.inflow_id = i.id and o2.voided_at is null
           ), 0) as expected_remaining
  ) e
  where i.voided_at is null
    and abs(i.remaining_butir - e.expected_remaining) > 1e-9;
$$;

grant execute on function public.reconcile_inventory() to authenticated;

-- ── 2. Returns-aware recalculate ────────────────────────────────────────────────
create or replace function public.recalculate_inventory_fifo()
returns table(product_name text, outflows_processed bigint, deductions_created bigint, total_deducted numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  outflow_record record;
  inflow_record record;
  remaining_to_deduct numeric;
  deduct_amount numeric;
begin
  -- Step 1: clear existing FIFO deductions (WHERE true satisfies RLS)
  delete from fifo_deductions where true;

  -- Step 2: reset all live inflows to their original intake
  update inflows set remaining_butir = quantity_butir where voided_at is null;

  -- Step 3: re-deduct non-voided outflows oldest-first (date, then created_at)
  for outflow_record in (
    select id, product, quantity_butir, date, created_at
    from outflows
    where voided_at is null
    order by date asc, created_at asc
  ) loop
    remaining_to_deduct := outflow_record.quantity_butir;

    for inflow_record in (
      select id, remaining_butir
      from inflows
      where product = outflow_record.product
        and voided_at is null
        and remaining_butir > 0
      order by date asc, created_at asc
    ) loop
      exit when remaining_to_deduct <= 0;
      deduct_amount := least(inflow_record.remaining_butir, remaining_to_deduct);
      insert into fifo_deductions (outflow_id, inflow_id, quantity_deducted)
      values (outflow_record.id, inflow_record.id, deduct_amount);
      update inflows set remaining_butir = remaining_butir - deduct_amount
      where id = inflow_record.id;
      remaining_to_deduct := remaining_to_deduct - deduct_amount;
    end loop;
  end loop;

  -- Step 3.5: re-apply restock returns on non-voided outflows (the missing piece).
  -- FIFO rebuild reproduces the original deduction layout, so each restock's
  -- recorded batch was deducted by at least that much; inflows_remaining_bounds
  -- fails loud on any edge that would exceed intake, so this can't inflate stock.
  update inflows i
  set remaining_butir = i.remaining_butir + agg.restored
  from (
    select rr.inflow_id, sum(rr.quantity_restored) as restored
    from return_restocks rr
    join returns r  on r.id  = rr.return_id
    join outflows o on o.id  = r.outflow_id
    where o.voided_at is null
    group by rr.inflow_id
  ) agg
  where i.id = agg.inflow_id and i.voided_at is null;

  -- Step 4: per-product summary
  return query
  select o.product as product_name,
         count(distinct o.id) as outflows_processed,
         count(fd.id) as deductions_created,
         coalesce(sum(fd.quantity_deducted), 0) as total_deducted
  from outflows o
  left join fifo_deductions fd on fd.outflow_id = o.id
  where o.voided_at is null
  group by o.product
  order by o.product;
end;
$$;

grant execute on function public.recalculate_inventory_fifo() to authenticated;
