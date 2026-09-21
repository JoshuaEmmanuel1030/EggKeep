-- Retakan reuse guard — forward delta on 20260914000000_retakan_tag.sql.
--
-- Fixes a latent stock-invisibility bug: the retakan find-or-create did
--   insert ... on conflict (category,name) do nothing;
--   select id into v_retakan_id from item_types where category=... and name=...;
-- with NO `deleted_at is null` on the select. If an admin had soft-deleted the
-- RETAKAN child in Catalog, the on-conflict insert is a no-op (the dead row still
-- occupies the unique key) and the select returns the DEAD row's id — so a return
-- keeps appending inflows to an item hidden from the dashboard: stock accrues
-- invisibly. Not triggered by current data, but a sharp edge.
--
-- Fix: before selecting, RESURRECT any soft-deleted child with that (category,name)
-- (set deleted_at = null) so a return re-activates the line instead of feeding a
-- hidden row. Everything else in the function is unchanged from 20260914000000.

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
  v_eps constant numeric := 1e-9;  -- single tolerance for all qty comparisons (kg decimals)
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

    -- Idempotency: this return line already recorded (outbox replay). Skip whole line.
    if v_id is not null and exists (select 1 from returns where id = v_id) then
      continue;
    end if;
    if v_id is null then v_id := gen_random_uuid(); end if;

    -- Lock the outflow row FIRST: serializes against concurrent void + other returns.
    select * into v_outflow from outflows where id = v_outflow_id for update;
    if not found then
      raise exception 'INVALID_ENTRY: outflow % not found', v_outflow_id;
    end if;
    if v_outflow.voided_at is not null then
      raise exception 'OUTFLOW_VOIDED: cannot return against a voided outflow %', v_outflow_id;
    end if;

    -- Cumulative cap: prior returns (all dispositions) + this line <= outflow qty.
    select coalesce(sum(quantity),0) into v_returned from returns where outflow_id = v_outflow_id;
    if v_returned + v_qty > v_outflow.quantity_butir + v_eps then
      raise exception 'RETURN_EXCEEDS_OUTFLOW: % returned + % > % sold',
        v_returned, v_qty, v_outflow.quantity_butir;
    end if;

    -- item_type_id points at the PARENT product sold (name+category is the key).
    insert into returns (id, outflow_id, return_date, product, item_type_id, category,
                         quantity, disposition, buyer_name, reason, user_id)
    values (v_id, v_outflow_id, v_return_date, v_line->>'product',
            (select id from item_types where name = v_line->>'product' and category = v_cat and deleted_at is null limit 1),
            v_cat, v_qty, v_disp, v_buyer, v_reason, v_user);

    if v_disp = 'writeoff' then
      continue; -- logged only, no stock change
    end if;

    -- RETAKAN: find-or-create the parent's Retakan child, then add a new inflow to it.
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
      -- Race-safe find-or-create via the (category,name) unique index. Copy the
      -- correctness-critical config (unit/eggs_per_unit) + operational defaults;
      -- packaging (box/labels) and price stay null, editable in Catalog later.
      insert into item_types (name, category, unit, eggs_per_unit, freshness_days,
                              low_stock_threshold, count_tolerance, is_retakan, parent_item_type_id)
      values (v_retakan_name, v_parent.category, v_parent.unit, v_parent.eggs_per_unit,
              v_parent.freshness_days, v_parent.low_stock_threshold, v_parent.count_tolerance,
              true, v_parent.id)
      on conflict (category, name) do nothing;

      -- GUARD (new): resurrect a soft-deleted child so the return re-activates the
      -- existing line instead of silently writing stock to a row hidden from the
      -- dashboard. Also re-establish the parent link if a hand-created row lacked it.
      update item_types
        set deleted_at = null,
            is_retakan = true,
            parent_item_type_id = coalesce(parent_item_type_id, v_parent.id)
        where category = v_parent.category and name = v_retakan_name
          and (deleted_at is not null or parent_item_type_id is null or is_retakan = false);

      select id into v_retakan_id from item_types
        where category = v_parent.category and name = v_retakan_name;

      -- inflows NOT-NULL/no-default cols (verified): date, product, quantity_original,
      -- quantity_butir, remaining_butir, user_id. quantity_* all = v_qty (retakan qty
      -- is already in the child's native unit, copied from the parent).
      insert into inflows (id, date, product, item_type_id, category,
                           quantity_original, quantity_butir, remaining_butir, user_id, created_at)
      values (gen_random_uuid(), v_return_date, v_retakan_name, v_retakan_id, v_parent.category,
              v_qty, v_qty, v_qty, v_user, now());
      continue; -- no return_restocks row: that table is restock-to-original-batch only.
    end if;

    -- RESTOCK. Bound the WHOLE restock by what actually left surviving batches:
    -- Sum(deducted) - Sum(already-restored) across ALL prior restocks of this outflow.
    -- return_restocks holds restock rows only (retakan writes none), so this is exact.
    select coalesce(sum(fd.quantity_deducted),0) into v_total_deducted
      from fifo_deductions fd where fd.outflow_id = v_outflow_id;
    select coalesce(sum(rr.quantity_restored),0) into v_total_restored
      from return_restocks rr join returns r on r.id = rr.return_id
      where r.outflow_id = v_outflow_id;
    if v_qty > (v_total_deducted - v_total_restored) + v_eps then
      raise exception 'RESTOCK_EXCEEDS_DEDUCTED: % > deductible % (deducted % - restored %)',
        v_qty, v_total_deducted - v_total_restored, v_total_deducted, v_total_restored;
    end if;

    -- Distribute OLDEST-first over LIVE deducted batches, capped per batch at
    -- (deducted - already-restored to THAT batch).
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
