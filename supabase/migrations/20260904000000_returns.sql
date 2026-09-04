-- Returns (retur): partial customer returns linked to the original outflow.
-- Restock returns reverse the outflow's fifo_deductions oldest-batch-first (row-locked,
-- relative updates) so stock goes back to its real batch at its real age; write-off
-- returns are logged only and touch no stock. All stock mutation is atomic and server-side,
-- mirroring record_order_outflows. void_outflow is moved server-side here too so a return
-- and a void can never double-restore (silent stock inflation). See
-- docs/superpowers/plans/2026-09-04-returns-backend.md and the data-integrity review.

create table public.returns (
  id            uuid primary key,
  outflow_id    uuid not null references public.outflows(id),
  return_date   date not null,
  product       text not null,
  item_type_id  uuid references public.item_types(id),
  category      inventory_category not null,
  quantity      numeric not null check (quantity > 0),
  disposition   text not null check (disposition in ('restock','writeoff')),
  buyer_name    text,
  reason        text,
  user_id       uuid not null,
  created_at    timestamptz not null default now()
);
create index returns_outflow_id_idx on public.returns(outflow_id);
create index returns_return_date_idx on public.returns(return_date);

create table public.return_restocks (
  id                uuid primary key default gen_random_uuid(),
  return_id         uuid not null references public.returns(id),
  inflow_id         uuid not null references public.inflows(id),
  quantity_restored numeric not null check (quantity_restored > 0)
);
create index return_restocks_return_id_idx on public.return_restocks(return_id);
create index return_restocks_inflow_id_idx on public.return_restocks(inflow_id);

alter table public.returns enable row level security;
alter table public.return_restocks enable row level security;

-- Authenticated users may read; writes happen only through the SECURITY DEFINER RPCs.
create policy returns_select on public.returns
  for select to authenticated using (true);
create policy return_restocks_select on public.return_restocks
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- record_return: atomic, row-locked, idempotent-by-line-id.
-- ---------------------------------------------------------------------------
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

    if v_outflow_id is null or v_qty is null or v_qty <= 0
       or v_disp not in ('restock','writeoff') then
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

    -- item_type_id resolved by name (returns table isn't covered by the Stage-A
    -- resolver trigger; client payload doesn't send it). Names are still the key.
    insert into returns (id, outflow_id, return_date, product, item_type_id, category,
                         quantity, disposition, buyer_name, reason, user_id)
    values (v_id, v_outflow_id, v_return_date, v_line->>'product',
            (select id from item_types where name = v_line->>'product' limit 1),
            (v_line->>'category')::inventory_category,
            v_qty, v_disp, v_buyer, v_reason, v_user);

    if v_disp = 'writeoff' then
      continue; -- logged only, no stock change
    end if;

    -- RESTOCK. Bound the WHOLE restock by what actually left surviving batches:
    -- Sum(deducted) - Sum(already-restored) across ALL prior returns of this outflow.
    -- This up-front cap is the anti-inflation guarantee; the per-batch caps below only
    -- decide WHERE the (already-bounded) amount lands. No phantom fallback inflow.
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
    -- (deducted - already-restored to THAT batch). Every return_restocks row points
    -- at a real deducted batch, so the per-batch subquery is complete.
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

    -- Defensive: leftover can only occur if a DEDUCTED batch was voided (rare -
    -- voidInflow blocks voiding a consumed inflow). Fail loud; NEVER mint a phantom
    -- inflow (that was a silent-inflation vector). Operator handles manually.
    if v_remaining > v_eps then
      raise exception 'RESTOCK_UNALLOCATED: % butir has no live batch to restore to (voided batch?)', v_remaining;
    end if;
  end loop;
end;
$$;

grant execute on function public.record_return(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- void_outflow: atomic void with the SAME lock order as record_return, restoring
-- only the not-yet-returned remainder per batch (return x void safety).
-- Replaces the client-side read-modify-write in useVoidEntry.ts.
-- ---------------------------------------------------------------------------
create or replace function public.void_outflow(p_outflow_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_outflow outflows%rowtype;
  v_already numeric;
  v_restore numeric;
  v_eps constant numeric := 1e-9;
  ded record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED: must be signed in to void';
  end if;

  -- Same lock order as record_return: outflow row first, then inflow rows.
  select * into v_outflow from outflows where id = p_outflow_id for update;
  if not found then raise exception 'OUTFLOW_NOT_FOUND: %', p_outflow_id; end if;
  if v_outflow.voided_at is not null then
    raise exception 'ALREADY_VOIDED: %', p_outflow_id;
  end if;

  for ded in
    select fd.inflow_id, fd.quantity_deducted
    from fifo_deductions fd
    join inflows i on i.id = fd.inflow_id
    where fd.outflow_id = p_outflow_id and i.voided_at is null
    order by i.date asc, i.created_at asc   -- identical order -> no deadlock vs record_return
    for update of i
  loop
    -- Restore only the NOT-yet-returned remainder of this batch (return x void safety).
    select coalesce(sum(rr.quantity_restored),0) into v_already
      from return_restocks rr
      join returns r on r.id = rr.return_id
      where r.outflow_id = p_outflow_id and rr.inflow_id = ded.inflow_id;
    v_restore := ded.quantity_deducted - v_already;
    if v_restore <= v_eps then continue; end if;
    update inflows set remaining_butir = remaining_butir + v_restore where id = ded.inflow_id;  -- relative
  end loop;

  update outflows set voided_at = now(), void_reason = p_reason where id = p_outflow_id;
end;
$$;

grant execute on function public.void_outflow(uuid, text) to authenticated;
