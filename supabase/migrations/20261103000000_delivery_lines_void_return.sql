-- Delivery & Return Log, Phase 2 "Retur per faktur".
-- Spec: docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md
-- (§6.2 data model, §6.3 stock-side RPCs, Detailed Implementation Plan item 1).
--
-- Runs once, in one transaction; NOT re-runnable (add column / add constraint /
-- create unique index carry no "if not exists" on purpose). Apply BEFORE the
-- frontend that reads it is pushed. Every change is additive for old bundles:
-- record_return only gains an optional input key; views keep their column lists.
--
-- Contents, in order:
--   1. delivery_lines (store-side facts per faktur, SKU, reason; never feeds stock)
--   2. returns.user_email (+ backfill) and the void columns
--   3. inflows.return_id, outflows.void_return_id
--   4. pack_skus.unit_label
--   5. buyers.requires_claim_ref
--   6. expiry_rules re-keyed (shelf_months, unique index, base-pack-code seed)
--   7. purchase_orders view: egg_totals[].outflow_id
--   8. record_return: user_email, expected_prior, caps exclude voided, retakan return_id
--   9. void_outflow: signed per-batch restore
--  10. void_return (new)
--  11. v_recon_ledger: retur_batal rows, retur-dibatalkan flag, returns on voided outflows
--
-- Readers of `returns` and the voided filter (§6.3.4):
--   FILTER voided_at is null : record_return caps; usePriorReturns / summarizeReturns
--     (feed bubbles, dialog cap); /deliveries list and detail (Riwayat retur alone also
--     reads voided rows, struck through); inventory-assistant getReturnsTool.
--   MUST NOT FILTER          : void_outflow, reconcile_inventory, recalculate_inventory_fifo.
--     A voided restock is still a physical movement; its void is its own (compensating)
--     outflow; void_outflow nets both per batch. Filtering there breaks the invariant.
--   v_recon_ledger           : keeps voided returns as movements, flagged retur-dibatalkan,
--     and shows the compensating outflow as jenis retur_batal (negative retur).
--   correct_order HAS_RETURNS: unchanged, counts voided returns too.
--
-- void_outflow worked examples (§6.3.3; B, C batches of one product, B older):
--   1. B=C=100. O takes 50 from B. R restocks 50 into B. Sale 100 from B. R voided: V takes
--      50 from C. R2 restocks 50 into B.  Live B50 C50 -> delta B -50, C +50 -> B0 C100.
--   2. B1=B2=100. O takes 5 B1 + 45 B2. R restocks 5+5. V takes 10 from B1. R2 restocks 5+5.
--      Live B1 95 B2 65 -> delta B1 +5, B2 +35 -> both 100.
--   3. B=100. O takes 100. R +100. V takes 100. R2 +100. Live B100 -> delta 0 -> B100.
--   4. B=C=100. O takes 50 from B. R +10 into B. Sale 60 from B. V takes 10 from C.
--      Live B0 C90 -> delta B +40, C +10 -> B40 C100.
--   Example 3 followed by a sale of 50 -> VOID_BLOCKED (batch would leave [0, quantity]).

-- ── 1. delivery_lines ──────────────────────────────────────────────────────────
create table public.delivery_lines (
  id               uuid primary key,                                  -- client-generated; the form upserts on it
  delivery_id      uuid not null references public.deliveries(id) on delete cascade,
  sku_code         text not null check (length(btrim(sku_code)) > 0), -- snapshot of the PO line's pack_skus.code; never an FK
  unit_label       text not null check (unit_label in ('pak','box')), -- the unit this line was typed in (snapshot)
  pieces_per_unit  integer not null check (pieces_per_unit > 0),      -- snapshot: eggs per pak, or per box (base pack x capacity)
  quantity         numeric not null default 0 check (quantity >= 0),  -- as typed, in unit_label; 0 = no quantity
  reason           text not null,                                     -- RETURN_REASONS code; client pick-list, no check constraint
  note             text,
  claim_ref        text,                                              -- No. Retur OSV, any buyer
  claim_ref_norm   text generated always as (nullif(upper(btrim(claim_ref)), '')) stored,
  expected_expiry  date,                                              -- defaulted from expiry_rules, then user-edited
  source           text not null default 'app' check (source in ('app','sheet_import')),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()                 -- set by the client on update, as deliveries.updated_at is
);
create unique index delivery_lines_key on public.delivery_lines (delivery_id, sku_code, reason);
-- One physical-return line per (faktur, SKU). The reason list mirrors NO_PHYSICAL_RETURN in
-- src/lib/deliveryFlags.ts; deliveryLinesSync.test.ts reads this file and fails on drift.
create unique index delivery_lines_physical_key on public.delivery_lines (delivery_id, sku_code)
  where reason not in ('kurang', 'lebih', 'revisi_po', 'cancel', 'masih_ditanyakan');

alter table public.delivery_lines enable row level security;
create policy "Authenticated users can read delivery_lines"
  on public.delivery_lines for select to authenticated using (true);
create policy "Authenticated users can insert delivery_lines"
  on public.delivery_lines for insert to authenticated with check (true);
create policy "Authenticated users can update delivery_lines"
  on public.delivery_lines for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete delivery_lines"
  on public.delivery_lines for delete to authenticated using (true);

-- ── 2. returns: author email, void columns ─────────────────────────────────────
alter table public.returns add column user_email text;  -- auth.jwt()->>'email' at insert (display; user_id stays the audit key)
update public.returns r set user_email = u.email
  from auth.users u where u.id = r.user_id and r.user_email is null;
alter table public.returns
  add column voided_at   timestamptz,
  add column void_reason text,
  add column voided_by   uuid;

-- ── 3. provenance links ────────────────────────────────────────────────────────
-- inflows.return_id: the RETAKAN child inflow a 'retakan' return wrote (new rows only; the
-- existing RETAKAN inflows are not backfilled). outflows.void_return_id: marks a
-- compensating outflow written by void_return.
alter table public.inflows  add column return_id      uuid references public.returns(id);
alter table public.outflows add column void_return_id uuid references public.returns(id);
create index inflows_return_id_idx       on public.inflows  (return_id)      where return_id is not null;
create index outflows_void_return_id_idx on public.outflows (void_return_id) where void_return_id is not null;

-- ── 4. pack_skus.unit_label ────────────────────────────────────────────────────
alter table public.pack_skus add column unit_label text not null default 'pak' check (unit_label in ('pak','box'));
update public.pack_skus set unit_label = 'box' where code in ('OSVN10B','OSVN10O','OSVKP6O','N30B');

-- ── 5. buyers.requires_claim_ref ("Perlu No. Retur") ───────────────────────────
alter table public.buyers add column requires_claim_ref boolean not null default false;
update public.buyers set requires_claim_ref = true where lower(btrim(name)) in ('osave', 'family mart');

-- ── 6. expiry_rules: day or calendar-month rules, keyed by base pack code ──────
alter table public.expiry_rules alter column shelf_days drop not null;
alter table public.expiry_rules add column shelf_months integer check (shelf_months > 0);
alter table public.expiry_rules add constraint expiry_rules_one_unit
  check ((shelf_days is null) <> (shelf_months is null));
delete from public.expiry_rules;
create unique index expiry_rules_key on public.expiry_rules ((coalesce(buyer_keyword,'')), (coalesce(sku_code,'')));
insert into public.expiry_rules (buyer_keyword, sku_code, shelf_days, shelf_months, note) values
  ('Astro',    null,      22, null, 'Astro default'),
  ('Astro',    'N15B',    21, null, null), ('Astro', 'N15O', 21, null, null),
  ('Astro',    'N30B',    21, null, null), ('Astro', 'N30O', 21, null, null),
  ('Astro',    'BK4AMTG', 14, null, null),
  ('Segari',   null,    null,    1, 'Segari default (1 Bulan)'),
  ('Segari',   'BK4AMTG', 14, null, null),
  ('Sayurbox', null,      14, null, 'Sayurbox default'),
  ('Sayurbox', 'P25',     21, null, null),
  ('Sayurbox', 'KP6B',  null,    1, '1 Bulan'), ('Sayurbox', 'KP6O', null, 1, '1 Bulan'),
  ('Sayurbox', 'N4',    null,    1, '1 Bulan'),
  (null,       null,    null,    1, 'Default (1 Bulan)');

-- ── 7. purchase_orders: egg_totals carries each egg outflow row's id ───────────
-- Full restatement of 20261022010000_buyer_profiles.sql; same column list. The
-- security_invoker option MUST be restated: create or replace replaces the option list.
create or replace view public.purchase_orders
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
  coalesce(jsonb_agg(jsonb_build_object('product', r.product, 'quantity', r.quantity_butir,
                                        'outflow_id', r.outflow_id))
             filter (where r.category = 'egg'), '[]'::jsonb) as egg_totals
from (
  select metadata - 'relatedEntryId' as m, category, product, quantity_butir, recorded_at,
         case when pg_input_is_valid(metadata->>'relatedEntryId', 'uuid')
              then (metadata->>'relatedEntryId')::uuid end as outflow_id,
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

-- ── 8. record_return ───────────────────────────────────────────────────────────
-- Full body of 20261008000000_returns_sku_code.sql with four changes (CHANGED below):
--   a. user_email stamped server-side (old bundles get it too);
--   b. optional expected_prior per entry, checked once per outflow row per call;
--   c. caps count NON-voided returns only;
--   d. the retakan child inflow carries return_id.
create or replace function public.record_return(p_return jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
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
  v_expected numeric;
  v_checked uuid[] := '{}';             -- outflow rows whose expected_prior was checked in this call
  v_call_qty jsonb := '{}'::jsonb;      -- quantity this call has inserted so far, per outflow row
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

    -- Idempotency: this return entry already recorded (replay). Skip it entirely,
    -- including the expected_prior check.
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

    -- CHANGED (c): voided returns no longer count against the cap.
    select coalesce(sum(quantity),0) into v_returned
      from returns where outflow_id = v_outflow_id and voided_at is null;

    -- CHANGED (b): expected_prior = the non-voided sum (native unit, all SKUs) the client
    -- displayed. Checked at this outflow row's first non-skipped entry that carries the key,
    -- against the sum before anything of this call (v_call_qty), and not again in this call.
    -- Runs before the caps, so a stale form gets PRIOR_MISMATCH ("muat ulang").
    if v_line ? 'expected_prior' and jsonb_typeof(v_line->'expected_prior') = 'number'
       and not (v_outflow_id = any(v_checked)) then
      v_expected := (v_line->>'expected_prior')::numeric;
      if abs((v_returned - coalesce((v_call_qty->>v_outflow_id::text)::numeric, 0)) - v_expected) > v_eps then
        raise exception 'PRIOR_MISMATCH: outflow % has % returned, client expected %',
          v_outflow_id, v_returned - coalesce((v_call_qty->>v_outflow_id::text)::numeric, 0), v_expected;
      end if;
      v_checked := v_checked || v_outflow_id;
    end if;

    if v_returned + v_qty > v_outflow.quantity_butir + v_eps then
      raise exception 'RETURN_EXCEEDS_OUTFLOW: % returned + % > % sold',
        v_returned, v_qty, v_outflow.quantity_butir;
    end if;

    -- CHANGED (a): user_email.
    insert into returns (id, outflow_id, return_date, product, item_type_id, category,
                         quantity, disposition, buyer_name, reason, user_id, sku_code, user_email)
    values (v_id, v_outflow_id, v_return_date, v_line->>'product',
            (select id from item_types where name = v_line->>'product' and category = v_cat and deleted_at is null limit 1),
            v_cat, v_qty, v_disp, v_buyer, v_reason, v_user, nullif(v_line->>'sku_code',''), v_email);
    v_call_qty := jsonb_set(v_call_qty, array[v_outflow_id::text],
                    to_jsonb(coalesce((v_call_qty->>v_outflow_id::text)::numeric, 0) + v_qty));

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

      -- CHANGED (d): return_id links the child batch to its return.
      insert into inflows (id, date, product, item_type_id, category,
                           quantity_original, quantity_butir, remaining_butir, user_id, created_at, return_id)
      values (gen_random_uuid(), v_return_date, v_retakan_name, v_retakan_id, v_parent.category,
              v_qty, v_qty, v_qty, v_user, now(), v_id);
      continue;
    end if;

    -- CHANGED (c): restores of voided returns no longer count. Their eggs were taken back
    -- out by the compensating outflow, so the corrected return may restock the batches again.
    select coalesce(sum(fd.quantity_deducted),0) into v_total_deducted
      from fifo_deductions fd where fd.outflow_id = v_outflow_id;
    select coalesce(sum(rr.quantity_restored),0) into v_total_restored
      from return_restocks rr join returns r on r.id = rr.return_id and r.voided_at is null
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
        join returns r on r.id = rr.return_id and r.voided_at is null
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

-- ── 9. void_outflow: restore as if the order, its returns and their voids never happened ──
-- Full body of 20260904000000_returns.sql with the restore loop replaced (§6.3.3). Per batch b:
--   delta_b = ded_b - rs_b + vd_b
--   ded_b  O's fifo_deductions from b
--   rs_b   return_restocks into b over ALL returns of O (voided included)
--   vd_b   fifo_deductions from b of O's live compensating outflows (void_return_id -> a
--          restock return of O)
-- O and those compensating outflows are marked voided. Compensating outflows of retakan
-- returns sit on the RETAKAN child and are left alone. A batch that would leave
-- [0, quantity] raises VOID_BLOCKED (the returned eggs were sold on; the owner decides).
create or replace function public.void_outflow(p_outflow_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_outflow outflows%rowtype;
  v_delta numeric;
  v_eps constant numeric := 1e-9;
  b record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED: must be signed in to void';
  end if;

  -- Same lock order as record_return / void_return: outflow row first, then the
  -- compensating outflow rows (by id), then inflow rows.
  select * into v_outflow from outflows where id = p_outflow_id for update;
  if not found then raise exception 'OUTFLOW_NOT_FOUND: %', p_outflow_id; end if;
  if v_outflow.voided_at is not null then
    raise exception 'ALREADY_VOIDED: %', p_outflow_id;
  end if;

  perform 1 from outflows v
    where v.voided_at is null
      and v.void_return_id in (select id from returns
                               where outflow_id = p_outflow_id and disposition = 'restock')
    order by v.id
    for update;

  for b in
    select i.id, i.remaining_butir, i.quantity_butir,
      coalesce((select sum(fd.quantity_deducted) from fifo_deductions fd
                where fd.outflow_id = p_outflow_id and fd.inflow_id = i.id), 0)                 as ded,
      coalesce((select sum(rr.quantity_restored) from return_restocks rr
                join returns r on r.id = rr.return_id
                where r.outflow_id = p_outflow_id and rr.inflow_id = i.id), 0)                  as rs,
      coalesce((select sum(fd.quantity_deducted) from fifo_deductions fd
                join outflows v on v.id = fd.outflow_id
                where v.voided_at is null and fd.inflow_id = i.id
                  and v.void_return_id in (select id from returns
                                           where outflow_id = p_outflow_id and disposition = 'restock')), 0) as vd
    from inflows i
    where i.voided_at is null and i.id in (
      select fd.inflow_id from fifo_deductions fd where fd.outflow_id = p_outflow_id
      union select rr.inflow_id from return_restocks rr join returns r on r.id = rr.return_id
            where r.outflow_id = p_outflow_id
      union select fd.inflow_id from fifo_deductions fd join outflows v on v.id = fd.outflow_id
            where v.voided_at is null
              and v.void_return_id in (select id from returns
                                       where outflow_id = p_outflow_id and disposition = 'restock'))
    order by i.date, i.created_at, i.id
    for update of i
  loop
    v_delta := b.ded - b.rs + b.vd;
    if abs(v_delta) <= v_eps then continue; end if;
    if b.remaining_butir + v_delta < -v_eps or b.remaining_butir + v_delta > b.quantity_butir + v_eps then
      raise exception 'VOID_BLOCKED: batch % of % would hold % of %',
        b.id, v_outflow.product, b.remaining_butir + v_delta, b.quantity_butir;
    end if;
    update inflows set remaining_butir = remaining_butir + v_delta where id = b.id;   -- relative
  end loop;

  update outflows set voided_at = now(), void_reason = 'VOID ORDER ' || p_outflow_id
    where voided_at is null
      and void_return_id in (select id from returns where outflow_id = p_outflow_id and disposition = 'restock');
  update outflows set voided_at = now(), void_reason = p_reason where id = p_outflow_id;
end;
$$;

grant execute on function public.void_outflow(uuid, text) to authenticated;

-- ── 10. void_return ────────────────────────────────────────────────────────────
-- Voids the SAVE GROUP of the given row (same outflow_id, sku_code, created_at: one
-- record_return call) as one compensating movement: one outflow per row with a stock
-- effect, on the product that received the eggs, deducted FIFO from today's batches
-- through record_order_outflows (all-or-nothing; INSUFFICIENT_STOCK rolls the void back).
-- Stock history is never rewritten. Idempotent: an already-voided row is a no-op, checked
-- under the lock BEFORE authorisation. Server-side auth: app admin, or the author within 48 h.
create or replace function public.void_return(p_return_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_is_admin boolean;
  v_ret returns%rowtype;
  v_outflow outflows%rowtype;
  r returns%rowtype;
  v_product text;
  v_date text;
  v_oid uuid;
  v_entries jsonb := '[]'::jsonb;
  v_tags jsonb := '[]'::jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED: must be signed in to void a return'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED: a void reason is required'; end if;

  select * into v_ret from returns where id = p_return_id;
  if not found then raise exception 'RETURN_NOT_FOUND: %', p_return_id; end if;

  -- Same lock order as record_return and void_outflow: the outflow row first.
  select * into v_outflow from outflows where id = v_ret.outflow_id for update;
  select * into v_ret from returns where id = p_return_id for update;
  if v_ret.voided_at is not null then return; end if;

  v_is_admin := public.has_role(v_user, 'admin');
  if not v_is_admin then
    if v_ret.user_id <> v_user then
      raise exception 'NOT_ALLOWED: only the person who recorded this return (or an admin) can void it';
    end if;
    if v_ret.created_at < now() - interval '48 hours' then
      raise exception 'VOID_WINDOW_CLOSED: returns can be voided within 48 hours of being recorded';
    end if;
  end if;
  v_date := to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD');   -- WIB business day of the void

  -- The save group. All its rows share user_id and created_at, so the check above covers them.
  for r in
    select * from returns
    where outflow_id = v_ret.outflow_id and sku_code is not distinct from v_ret.sku_code
      and created_at = v_ret.created_at and voided_at is null
    order by product, id for update
  loop
    --   restock on a live outflow   -> the parent product
    --   restock on a voided outflow -> nothing: void_outflow already netted it
    --   retakan                     -> the RETAKAN child (void_outflow never touches it)
    --   writeoff                    -> nothing
    v_product := case r.disposition
                   when 'restock' then case when v_outflow.voided_at is null then r.product end
                   when 'retakan' then r.product || ' (RETAKAN)'
                 end;
    if v_product is not null then
      v_oid := gen_random_uuid();
      v_entries := v_entries || jsonb_build_object('id', v_oid, 'product', v_product, 'category', r.category,
                     'quantity_butir', r.quantity, 'date', v_date, 'invoice_supplier', 'VOID RETUR');
      v_tags := v_tags || jsonb_build_object('outflow_id', v_oid, 'return_id', r.id);
    end if;
    update returns set voided_at = now(), void_reason = p_reason, voided_by = v_user where id = r.id;
  end loop;

  if jsonb_array_length(v_entries) > 0 then
    perform public.record_order_outflows(v_entries);
    update outflows o set void_return_id = (t->>'return_id')::uuid
      from jsonb_array_elements(v_tags) t where o.id = (t->>'outflow_id')::uuid;
  end if;
end;
$$;

revoke execute on function public.void_return(uuid, text) from public, anon;
grant execute on function public.void_return(uuid, text) to authenticated;

-- ── 11. v_recon_ledger ─────────────────────────────────────────────────────────
-- Full restatement of 20261029000000_recon_views.sql's view, same column list, with:
--   * a compensating outflow (void_return_id set) -> jenis 'retur_batal': negative retur,
--     keluar_* null, return_id = the voided return, disposisi = its disposition, flag
--     retur-batal, never tanpa-log;
--   * return rows stay movements when voided, flagged retur-dibatalkan (internal column
--     `dibatalkan`, not voided_at, which v_recon_daily filters on);
--   * return rows on a voided outflow take voided_at = o.voided_at (void_outflow already
--     restored around them; fixes a pre-existing overstatement);
--   * the retakan child inflow matches its return by inflows.return_id when set, else by
--     the old timestamp rule, and carries retur-dibatalkan when that return is voided.
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
    false           as tanpa_log,
    coalesce(rr.voided_at is not null, false) as dibatalkan
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
  -- compensating outflow of a voided return is 'retur_batal' (a negative retur).
  select
    case when o.void_return_id is not null then 'retur_batal'
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
    case when o.void_return_id is not null then null
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
    (o.void_return_id is null and po.oid is null),
    false
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
    (r.voided_at is not null)
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
  m.tanggal_faktur_asal
from movements m
cross join today t;

revoke all on public.v_recon_ledger from anon, authenticated;
grant select on public.v_recon_ledger to authenticated;
