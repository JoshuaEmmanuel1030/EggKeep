-- Per-SKU returns: tag each return row with the pack SKU it was entered under,
-- so the Activities feed can attribute a pooled-egg return to its order line.
-- Nullable + no backfill: existing rows (and loose/manual returns) stay null and
-- match by product. The cap/retakan/restock logic is unchanged from 20260921.

alter table public.returns add column if not exists sku_code text;

create or replace function public.record_return(p_return jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_line jsonb;
  v_id uuid;
  v_outflow_id uuid;
  v_qty numeric;
  v_disp text;
  v_cat inventory_category;
  v_outflow outflows%rowtype;
  v_returned numeric;
  v_remaining numeric;
  v_restore numeric;
  v_already numeric;
  v_total_deducted numeric;
  v_total_restored numeric;
  v_eps constant numeric := 1e-9;
  v_return_date date := (p_return->>'return_date')::date;
  v_buyer text := nullif(p_return->>'buyer_name','');
  v_reason text := nullif(p_return->>'reason','');
  ded record;
  v_parent record;
  v_retakan_name text;
  v_retakan_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED: must be signed in to record returns';
  end if;
  if p_return->'lines' is null or jsonb_typeof(p_return->'lines') <> 'array'
     or jsonb_array_length(p_return->'lines') = 0 then
    raise exception 'NO_ENTRIES: lines must be a non-empty array';
  end if;

  for v_line in select * from jsonb_array_elements(p_return->'lines') loop
    v_id         := nullif(v_line->>'id','')::uuid;
    v_outflow_id := (v_line->>'outflow_id')::uuid;
    v_qty        := (v_line->>'quantity')::numeric;
    v_disp       := v_line->>'disposition';
    v_cat        := (v_line->>'category')::inventory_category;

    if v_outflow_id is null or v_qty is null or v_qty <= 0
       or v_disp not in ('restock','writeoff','retakan') then
      raise exception 'INVALID_ENTRY: outflow_id, positive quantity, valid disposition required (got % / % / %)',
        v_outflow_id, v_qty, v_disp;
    end if;

    if v_id is not null and exists (select 1 from returns where id = v_id) then
      continue;
    end if;
    if v_id is null then v_id := gen_random_uuid(); end if;

    select * into v_outflow from outflows where id = v_outflow_id for update;
    if not found then
      raise exception 'INVALID_ENTRY: outflow % not found', v_outflow_id;
    end if;
    if v_outflow.voided_at is not null then
      raise exception 'OUTFLOW_VOIDED: cannot return against a voided outflow %', v_outflow_id;
    end if;

    select coalesce(sum(quantity),0) into v_returned from returns where outflow_id = v_outflow_id;
    if v_returned + v_qty > v_outflow.quantity_butir + v_eps then
      raise exception 'RETURN_EXCEEDS_OUTFLOW: % returned + % > % sold',
        v_returned, v_qty, v_outflow.quantity_butir;
    end if;

    -- CHANGED: persist sku_code (null for loose/manual returns).
    insert into returns (id, outflow_id, return_date, product, item_type_id, category,
                         quantity, disposition, buyer_name, reason, user_id, sku_code)
    values (v_id, v_outflow_id, v_return_date, v_line->>'product',
            (select id from item_types where name = v_line->>'product' and category = v_cat and deleted_at is null limit 1),
            v_cat, v_qty, v_disp, v_buyer, v_reason, v_user, nullif(v_line->>'sku_code',''));

    if v_disp = 'writeoff' then
      continue;
    end if;

    if v_disp = 'retakan' then
      select id, category, unit, eggs_per_unit, freshness_days, low_stock_threshold, count_tolerance
        into v_parent
        from item_types
        where name = v_line->>'product' and category = v_cat and deleted_at is null
        order by created_at asc
        limit 1;
      if not found then
        raise exception 'PARENT_TYPE_MISSING: no active catalog item %/% to attach a retakan child',
          v_cat, v_line->>'product';
      end if;

      v_retakan_name := (v_line->>'product') || ' (RETAKAN)';
      insert into item_types (name, category, unit, eggs_per_unit, freshness_days,
                              low_stock_threshold, count_tolerance, is_retakan, parent_item_type_id)
      values (v_retakan_name, v_parent.category, v_parent.unit, v_parent.eggs_per_unit,
              v_parent.freshness_days, v_parent.low_stock_threshold, v_parent.count_tolerance,
              true, v_parent.id)
      on conflict (category, name) do nothing;

      update item_types
        set deleted_at = null,
            is_retakan = true,
            parent_item_type_id = coalesce(parent_item_type_id, v_parent.id)
        where category = v_parent.category and name = v_retakan_name
          and (deleted_at is not null or parent_item_type_id is null or is_retakan = false);

      select id into v_retakan_id from item_types
        where category = v_parent.category and name = v_retakan_name;

      insert into inflows (id, date, product, item_type_id, category,
                           quantity_original, quantity_butir, remaining_butir, user_id, created_at)
      values (gen_random_uuid(), v_return_date, v_retakan_name, v_retakan_id, v_parent.category,
              v_qty, v_qty, v_qty, v_user, now());
      continue;
    end if;

    select coalesce(sum(fd.quantity_deducted),0) into v_total_deducted
      from fifo_deductions fd where fd.outflow_id = v_outflow_id;
    select coalesce(sum(rr.quantity_restored),0) into v_total_restored
      from return_restocks rr join returns r on r.id = rr.return_id
      where r.outflow_id = v_outflow_id;
    if v_qty > (v_total_deducted - v_total_restored) + v_eps then
      raise exception 'RESTOCK_EXCEEDS_DEDUCTED: % > deductible % (deducted % - restored %)',
        v_qty, v_total_deducted - v_total_restored, v_total_deducted, v_total_restored;
    end if;

    v_remaining := v_qty;
    for ded in
      select fd.inflow_id, fd.quantity_deducted
      from fifo_deductions fd
      join inflows i on i.id = fd.inflow_id
      where fd.outflow_id = v_outflow_id and i.voided_at is null
      order by i.date asc, i.created_at asc
      for update of i
    loop
      exit when v_remaining <= v_eps;
      select coalesce(sum(rr.quantity_restored),0) into v_already
        from return_restocks rr
        join returns r on r.id = rr.return_id
        where r.outflow_id = v_outflow_id and rr.inflow_id = ded.inflow_id;
      v_restore := least(v_remaining, ded.quantity_deducted - v_already);
      if v_restore <= v_eps then continue; end if;

      update inflows set remaining_butir = remaining_butir + v_restore where id = ded.inflow_id;
      insert into return_restocks (return_id, inflow_id, quantity_restored)
      values (v_id, ded.inflow_id, v_restore);
      v_remaining := v_remaining - v_restore;
    end loop;

    if v_remaining > v_eps then
      raise exception 'RESTOCK_UNALLOCATED: % butir has no live batch to restore to (voided batch?)', v_remaining;
    end if;
  end loop;
end;
$$;

grant execute on function public.record_return(jsonb) to authenticated;
