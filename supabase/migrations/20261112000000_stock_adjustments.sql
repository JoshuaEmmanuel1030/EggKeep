-- Penyesuaian Stok Fisik: one admin button that resets egg stock to today's physical count.
-- Spec: docs/superpowers/specs/2026-11-12-stok-fisik-penyesuaian-design.md
--
-- For each egg product with a js_warehouse row in today's stock_counts (not RETAKAN, not
-- deleted): target = JS + Loaded; book_at_count = stock at the close of yesterday =
-- book_now - movements dated today or later; delta = target - book_at_count, applied now
-- (an inflow for +, record_order_outflows FIFO for -, clamped to what is on hand).
--
-- Adjustment rows (stock_adjustment_id set) are NOT movements: they belong to the book at
-- count time. So a second press recomputes delta 0 (NOTHING_TO_ADJUST), a recount applies
-- only the difference, and voiding an adjustment row brings its delta back.
--
-- Stock reader rule (CLAUDE.md): returns.voided_at is NOT filtered here; a voided return's
-- compensating outflow is itself a live outflow movement.
--
-- Backward compatible: new table, nullable columns, new functions. Old bundles keep working.

-- ── 1. Header table ──────────────────────────────────────────────────────────────
create table public.stock_adjustments (
  id               uuid primary key default gen_random_uuid(),
  count_date       date not null,
  applied_by       uuid not null,
  applied_by_email text,
  applied_at       timestamptz not null default now(),
  -- Every computed line (zero and clamped ones too), as the preview returned it.
  lines            jsonb not null
);

alter table public.stock_adjustments enable row level security;

-- Written only by apply_stock_count_adjustment (SECURITY DEFINER); readable by staff.
create policy "Authenticated users can read stock_adjustments"
  on public.stock_adjustments for select to authenticated using (true);

-- ── 2. Mark the stock rows an adjustment wrote ───────────────────────────────────
alter table public.inflows  add column stock_adjustment_id uuid references public.stock_adjustments(id);
alter table public.outflows add column stock_adjustment_id uuid references public.stock_adjustments(id);

create index inflows_stock_adjustment_id_idx  on public.inflows  (stock_adjustment_id) where stock_adjustment_id is not null;
create index outflows_stock_adjustment_id_idx on public.outflows (stock_adjustment_id) where stock_adjustment_id is not null;

-- ── 3. Preview (also the apply's calculation) ────────────────────────────────────
create or replace function public.stock_count_adjustment_preview()
returns table (
  item_type_id    uuid,
  product         text,
  unit            text,
  physical_js     numeric,
  physical_loaded numeric,
  target          numeric,
  book_at_count   numeric,
  book_now        numeric,
  delta           numeric,
  applied         numeric,
  shortfall       numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with today as (
    select (now() at time zone 'Asia/Jakarta')::date as d
  ),
  counted as (
    select it.id, it.name, it.unit,
           sum(sc.quantity) filter (where sc.location = 'js_warehouse')        as js,
           coalesce(sum(sc.quantity) filter (where sc.location = 'loaded'), 0) as loaded
    from stock_counts sc
    join item_types it on it.id = sc.item_type_id
    cross join today
    where sc.count_date = today.d
      and it.category = 'egg'
      and not coalesce(it.is_retakan, false)
      and it.deleted_at is null
    group by it.id, it.name, it.unit
    having bool_or(sc.location = 'js_warehouse')
  ),
  book as (
    select
      c.id,
      -- The pool FIFO draws from (same filter as record_order_outflows).
      coalesce((select sum(i.remaining_butir) from inflows i
                where i.product = c.name and i.category = 'egg' and i.voided_at is null), 0)
        as book_now,
      -- Real movements dated today or later (after the morning count).
      coalesce((select sum(i.quantity_butir) from inflows i cross join today t
                where i.product = c.name and i.category = 'egg' and i.voided_at is null
                  and i.stock_adjustment_id is null
                  and pg_input_is_valid(i.date, 'date') and i.date::date >= t.d), 0)
      - coalesce((select sum(o.quantity_butir) from outflows o cross join today t
                where o.product = c.name and o.category = 'egg' and o.voided_at is null
                  and o.stock_adjustment_id is null
                  and pg_input_is_valid(o.date, 'date') and o.date::date >= t.d), 0)
      + coalesce((select sum(rr.quantity_restored)
                from return_restocks rr
                join returns r  on r.id = rr.return_id
                join outflows o on o.id = r.outflow_id and o.voided_at is null
                join inflows i  on i.id = rr.inflow_id and i.voided_at is null
                cross join today t
                where i.product = c.name and i.category = 'egg' and r.return_date >= t.d), 0)
        as moved_since
    from counted c
  ),
  lines as (
    select c.id, c.name, c.unit, c.js, c.loaded,
           c.js + c.loaded              as target,
           b.book_now,
           b.book_now - b.moved_since   as book_at_count
    from counted c
    join book b on b.id = c.id
  )
  select l.id, l.name, l.unit, l.js, l.loaded, l.target, l.book_at_count, l.book_now,
         l.target - l.book_at_count               as delta,
         x.applied,
         x.applied - (l.target - l.book_at_count) as shortfall
  from lines l
  cross join lateral (
    select case
             when l.target >= l.book_at_count then l.target - l.book_at_count
             -- Can't take more than is on hand: clamp to 0, the rest is the shortfall.
             else -least(l.book_at_count - l.target, greatest(l.book_now, 0))
           end as applied
  ) x
  order by l.name;
$$;

revoke all on function public.stock_count_adjustment_preview() from public, anon;
grant execute on function public.stock_count_adjustment_preview() to authenticated;

-- ── 4. Apply ─────────────────────────────────────────────────────────────────────
-- p_expected: [{item_type_id, delta, applied}] exactly as the dialog showed. Any
-- difference from the recomputed preview (a back-entered row, a recount, an order today
-- that changes a clamped line) refuses with PREVIEW_STALE.
create or replace function public.apply_stock_count_adjustment(p_expected jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_lines jsonb;
  v_adj   uuid;
  v_id    uuid;
  l       record;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED: must be signed in to adjust stock';
  end if;
  if not public.has_role(v_user, 'admin') then
    raise exception 'NOT_ADMIN: only an admin can adjust stock to the count';
  end if;

  -- Two admins pressing together must not both apply the same delta.
  perform pg_advisory_xact_lock(hashtext('public.apply_stock_count_adjustment'));

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_lines
  from public.stock_count_adjustment_preview() p;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'NO_COUNT_TODAY: save today''s Stok Fisik (JS) first';
  end if;

  -- Deltas round-trip through JS doubles, hence the tolerance.
  if exists (
    select 1
    from jsonb_array_elements(v_lines) as cur(v)
    full join jsonb_array_elements(coalesce(p_expected, '[]'::jsonb)) as exp(v)
      on exp.v ->> 'item_type_id' = cur.v ->> 'item_type_id'
    where cur.v is null
       or exp.v is null
       or exp.v ->> 'delta' is null
       or exp.v ->> 'applied' is null
       or abs((exp.v ->> 'delta')::numeric - (cur.v ->> 'delta')::numeric) > 0.0005
       or abs((exp.v ->> 'applied')::numeric - (cur.v ->> 'applied')::numeric) > 0.0005
  ) then
    raise exception 'PREVIEW_STALE: stock changed since the preview, reload it';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_lines) as cur(v)
    where (cur.v ->> 'applied')::numeric <> 0
  ) then
    raise exception 'NOTHING_TO_ADJUST: EggKeep already matches today''s count';
  end if;

  insert into stock_adjustments (count_date, applied_by, applied_by_email, lines)
  values (v_today, v_user, v_email, v_lines)
  returning id into v_adj;

  for l in
    select * from jsonb_to_recordset(v_lines) as x(item_type_id uuid, product text, applied numeric)
  loop
    continue when l.applied = 0;
    v_id := gen_random_uuid();

    if l.applied > 0 then
      insert into inflows (id, date, product, category, quantity_original, quantity_butir,
                           remaining_butir, user_id, invoice_supplier, item_type_id, stock_adjustment_id)
      values (v_id, v_today::text, l.product, 'egg', l.applied, l.applied,
              l.applied, v_user, 'PENYESUAIAN STOK FISIK', l.item_type_id, v_adj);
    else
      -- FIFO lives in one place: the same row-locked deduction every order uses.
      perform public.record_order_outflows(jsonb_build_array(jsonb_build_object(
        'id', v_id, 'date', v_today::text, 'product', l.product, 'category', 'egg',
        'quantity_butir', -l.applied, 'invoice_supplier', 'PENYESUAIAN STOK FISIK')));
      update outflows set stock_adjustment_id = v_adj where id = v_id;
    end if;

    -- Feed row; relatedEntryId makes the line voidable with the existing Void.
    insert into activity_logs (user_id, action_type, product, quantity_butir, quantity_original,
                               recorded_at, client_id, category, invoice_supplier, user_email, metadata)
    values (v_user, case when l.applied > 0 then 'inflow' else 'outflow' end, l.product,
            abs(l.applied), abs(l.applied), now(), 'server:stock_adjustment', 'egg',
            'PENYESUAIAN STOK FISIK', v_email,
            jsonb_build_object(
              'relatedEntryId', v_id,
              'orderType', 'stock_adjustment',
              'stockAdjustmentId', v_adj,
              case when l.applied > 0 then 'inflowDate' else 'outflowDate' end, v_today::text));
  end loop;

  return jsonb_build_object('id', v_adj, 'lines', v_lines);
end;
$$;

revoke all on function public.apply_stock_count_adjustment(jsonb) from public, anon;
grant execute on function public.apply_stock_count_adjustment(jsonb) to authenticated;
