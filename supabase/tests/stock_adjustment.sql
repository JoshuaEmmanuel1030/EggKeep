-- RPC tests for 20261112000000_stock_adjustments.sql and 20261112000002_stock_adjustment_guards.sql
-- (Penyesuaian Stok Fisik). Spec: docs/superpowers/specs/2026-11-12-stok-fisik-penyesuaian-design.md
--
-- Run by hand against an EMPTY Supabase BRANCH (or a local stack) on which the migrations
-- have been applied: `execute_sql` of this whole file. NEVER against production. One
-- transaction ending in ROLLBACK, so it is re-runnable and leaves nothing behind. The
-- first failing case stops the run with "A<n> failed: ...". "Empty" matters: the preview
-- covers every product counted today, so another product's count would change the
-- NOTHING_TO_ADJUST cases.
--
-- Today = (now() at time zone 'Asia/Jakarta')::date; now() is constant in one transaction.
-- Users: ADM (admin role) and U (no role), created inside the transaction.
--
-- Products (all counted today in JS):
--   P  butir  book at close 120, a sale today      -> count 90 + Load 20: delta -10
--   Q  butir  book 40                               -> count 500: delta +460 (an inflow)
--   R  butir  book 40, 15 sold today                -> count 0: only 25 left, clamp, short 15
--   T  butir  restock return dated today            -> book_at_count must exclude it
--   U  butir  an ordinary inflow dated today        -> count 45: -5, today's 30 survives
--   K  kg     fractional                            -> count 98,5 vs 100,125: -1,625
--   P (RETAKAN) counted too                         -> never covered

begin;

create temp table t_ids (k text primary key, v uuid not null);

-- ── helpers ─────────────────────────────────────────────────────────────────────
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as
  $$ insert into t_ids values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;
create function pg_temp.today() returns date language sql as
  $$ select (now() at time zone 'Asia/Jakarta')::date $$;

-- Runs p_sql as signed-in user p_user. p_sql must not reference pg_temp objects.
create function pg_temp.as_user(p_user text, p_sql text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_user), 'role', 'authenticated',
                      'email', 'adj-' || lower(p_user) || '@test.local')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
end $$;

-- Expects p_sql (as p_user) to fail with an error starting with p_code. The inner block's
-- rollback also undoes as_user's set local role / claims.
create function pg_temp.expect_error(p_case text, p_user text, p_sql text, p_code text)
returns void language plpgsql as $$
begin
  begin
    perform pg_temp.as_user(p_user, p_sql);
  exception when others then
    if sqlerrm not like p_code || '%' then
      raise exception '% failed: expected %, got %', p_case, p_code, sqlerrm;
    end if;
    return;
  end;
  raise exception '% failed: expected %, got success', p_case, p_code;
end $$;

create function pg_temp.product(p_name text, p_unit text default 'btr') returns void language sql as $$
  insert into item_types (name, category, unit, eggs_per_unit)
  values (p_name, 'egg', p_unit, case when p_unit = 'kg' then 15.5 else 1 end) $$;

create function pg_temp.batch(p_key text, p_product text, p_date date, p_qty numeric) returns uuid
language sql as $$
  insert into inflows (id, date, product, category, quantity_original, quantity_butir, remaining_butir, user_id)
  values (pg_temp.put(p_key, gen_random_uuid()), p_date::text, p_product, 'egg', p_qty, p_qty, p_qty, pg_temp.id('U'))
  returning id $$;

create function pg_temp.rem(p_key text) returns numeric language sql as
  $$ select remaining_butir from inflows where id = pg_temp.id(p_key) $$;

-- A sale through record_order_outflows as user U, dated p_date.
create function pg_temp.sell(p_key text, p_product text, p_qty numeric, p_date date) returns void
language plpgsql as $$
begin
  perform pg_temp.as_user('U', format('select public.record_order_outflows(%L::jsonb)',
    jsonb_build_array(jsonb_build_object(
      'id', pg_temp.put(p_key, gen_random_uuid()), 'product', p_product, 'category', 'egg',
      'quantity_butir', p_qty, 'date', p_date::text))));
end $$;

create function pg_temp.count(p_product text, p_loc text, p_qty numeric) returns void language sql as $$
  insert into stock_counts (count_date, location, item_type_id, product, category, quantity)
  values (pg_temp.today(), p_loc, (select id from item_types where name = p_product), p_product, 'egg', p_qty)
  on conflict (count_date, location, item_type_id) do update set quantity = excluded.quantity $$;

-- The current preview as the p_expected the dialog sends.
create function pg_temp.expected() returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_type_id', item_type_id, 'delta', delta, 'applied', applied)), '[]'::jsonb)
  from public.stock_count_adjustment_preview() $$;

create function pg_temp.apply_sql(p_expected jsonb) returns text language sql as
  $$ select format('select public.apply_stock_count_adjustment(%L::jsonb)', p_expected) $$;

create function pg_temp.book(p_product text) returns numeric language sql as $$
  select coalesce(sum(remaining_butir), 0) from inflows where product = p_product and voided_at is null $$;

-- ── setup ───────────────────────────────────────────────────────────────────────
do $$
declare d date := pg_temp.today();
begin
  insert into auth.users (id, email, aud, role)
  values (pg_temp.put('ADM', gen_random_uuid()), 'adj-adm@test.local', 'authenticated', 'authenticated'),
         (pg_temp.put('U',   gen_random_uuid()), 'adj-u@test.local',   'authenticated', 'authenticated');
  insert into user_roles (user_id, role) values (pg_temp.id('ADM'), 'admin');
  if public.has_role(pg_temp.id('U'), 'admin') then raise exception 'setup failed: U is admin'; end if;
  if exists (select 1 from stock_counts where count_date = d) then
    raise exception 'setup failed: this database already has a count for today, use an empty branch';
  end if;

  perform pg_temp.product('TEST ADJ P');
  perform pg_temp.batch('P.old', 'TEST ADJ P', d - 2, 50);
  perform pg_temp.batch('P.new', 'TEST ADJ P', d - 1, 100);
  perform pg_temp.sell('P.y', 'TEST ADJ P', 30, d - 1);   -- P.old 50 -> 20
  perform pg_temp.sell('P.t', 'TEST ADJ P', 10, d);       -- P.old 20 -> 10
  perform pg_temp.count('TEST ADJ P', 'js_warehouse', 90);
  perform pg_temp.count('TEST ADJ P', 'loaded', 20);
  perform pg_temp.count('TEST ADJ P', 'tst_warehouse', 999); -- ignored by design

  perform pg_temp.product('TEST ADJ Q');
  perform pg_temp.batch('Q.b', 'TEST ADJ Q', d - 1, 40);
  perform pg_temp.count('TEST ADJ Q', 'js_warehouse', 500);

  perform pg_temp.product('TEST ADJ R');
  perform pg_temp.batch('R.b', 'TEST ADJ R', d - 1, 40);
  perform pg_temp.sell('R.t', 'TEST ADJ R', 15, d);
  perform pg_temp.count('TEST ADJ R', 'js_warehouse', 0);

  -- T: 100 in, 40 sold yesterday, 10 of it restocked by a return dated today.
  perform pg_temp.product('TEST ADJ T');
  perform pg_temp.batch('T.b', 'TEST ADJ T', d - 1, 100);
  perform pg_temp.sell('T.s', 'TEST ADJ T', 40, d - 1);
  perform pg_temp.as_user('U', format('select public.record_return(%L::jsonb)', jsonb_build_object(
    'return_date', d::text, 'buyer_name', 'TEST BUYER', 'reason', 'pecah',
    'lines', jsonb_build_array(jsonb_build_object(
      'id', pg_temp.put('T.r', gen_random_uuid()), 'outflow_id', pg_temp.id('T.s'),
      'product', 'TEST ADJ T', 'category', 'egg', 'quantity', 10, 'disposition', 'restock', 'sku_code', 'TT')))));
  perform pg_temp.count('TEST ADJ T', 'js_warehouse', 60);

  -- U: an ordinary receipt dated today must survive the adjustment.
  perform pg_temp.product('TEST ADJ U');
  perform pg_temp.batch('U.b', 'TEST ADJ U', d - 1, 50);
  perform pg_temp.batch('U.t', 'TEST ADJ U', d, 30);
  perform pg_temp.count('TEST ADJ U', 'js_warehouse', 45);

  perform pg_temp.product('TEST ADJ K', 'kg');
  perform pg_temp.batch('K.b', 'TEST ADJ K', d - 1, 100.125);
  perform pg_temp.count('TEST ADJ K', 'js_warehouse', 98.5);

  insert into item_types (name, category, unit, eggs_per_unit, is_retakan)
  values ('TEST ADJ P (RETAKAN)', 'egg', 'btr', 1, true);
  perform pg_temp.count('TEST ADJ P (RETAKAN)', 'js_warehouse', 7);
end $$;

-- A1: preview numbers.
do $$
declare p record; n int;
begin
  select * into p from public.stock_count_adjustment_preview() where product = 'TEST ADJ P';
  if p.physical_js <> 90 or p.physical_loaded <> 20 or p.target <> 110 or p.book_at_count <> 120
     or p.book_now <> 110 or p.delta <> -10 or p.applied <> -10 or p.shortfall <> 0 then
    raise exception 'A1 failed: P %', row_to_json(p);
  end if;
  select * into p from public.stock_count_adjustment_preview() where product = 'TEST ADJ Q';
  if p.delta <> 460 or p.applied <> 460 or p.shortfall <> 0 then raise exception 'A1 failed: Q %', row_to_json(p); end if;
  select * into p from public.stock_count_adjustment_preview() where product = 'TEST ADJ R';
  if p.book_at_count <> 40 or p.book_now <> 25 or p.delta <> -40 or p.applied <> -25 or p.shortfall <> 15 then
    raise exception 'A1 failed: R %', row_to_json(p);
  end if;
  -- The restock dated today is after the count: book at count = 70 - 10.
  select * into p from public.stock_count_adjustment_preview() where product = 'TEST ADJ T';
  if p.book_now <> 70 or p.book_at_count <> 60 or p.delta <> 0 then raise exception 'A1 failed: T %', row_to_json(p); end if;
  select * into p from public.stock_count_adjustment_preview() where product = 'TEST ADJ U';
  if p.book_now <> 80 or p.book_at_count <> 50 or p.delta <> -5 then raise exception 'A1 failed: U %', row_to_json(p); end if;
  select * into p from public.stock_count_adjustment_preview() where product = 'TEST ADJ K';
  if p.unit <> 'kg' or p.delta <> -1.625 or p.applied <> -1.625 then raise exception 'A1 failed: K %', row_to_json(p); end if;
  select count(*) into n from public.stock_count_adjustment_preview();
  if n <> 6 then raise exception 'A1 failed: % lines (RETAKAN must be skipped)', n; end if;
end $$;

-- A2: non-admin refused.
select pg_temp.expect_error('A2', 'U', pg_temp.apply_sql(pg_temp.expected()), 'NOT_ADMIN');

-- A3: a delta or applied that differs from the recomputed preview, or a missing line, is stale.
select pg_temp.expect_error('A3a', 'ADM',
  pg_temp.apply_sql((select jsonb_agg(case when e->>'item_type_id' = (select id::text from item_types where name = 'TEST ADJ P')
                                           then jsonb_set(e, '{delta}', '-9') else e end)
                     from jsonb_array_elements(pg_temp.expected()) e)),
  'PREVIEW_STALE');
select pg_temp.expect_error('A3b', 'ADM', pg_temp.apply_sql('[]'::jsonb), 'PREVIEW_STALE');
select pg_temp.expect_error('A3c', 'ADM',
  pg_temp.apply_sql((select jsonb_agg(case when e->>'item_type_id' = (select id::text from item_types where name = 'TEST ADJ R')
                                           then jsonb_set(e, '{applied}', '-20') else e end)
                     from jsonb_array_elements(pg_temp.expected()) e)),
  'PREVIEW_STALE');

-- A4: apply. P loses 10 FIFO from the oldest batch; Q gains 460; R drops to 0; U keeps
-- today's receipt; K lands exactly on 98,5 kg; T is untouched.
do $$
declare v_out uuid; v_adj uuid;
begin
  perform pg_temp.as_user('ADM', pg_temp.apply_sql(pg_temp.expected()));

  select id, stock_adjustment_id into v_out, v_adj from outflows
  where product = 'TEST ADJ P' and stock_adjustment_id is not null;
  if v_out is null then raise exception 'A4 failed: no adjustment outflow for P'; end if;
  perform pg_temp.put('P.adj', v_out);
  if (select quantity_butir from outflows where id = v_out) <> 10 then raise exception 'A4 failed: P outflow qty'; end if;
  if (select inflow_id from fifo_deductions where outflow_id = v_out) <> pg_temp.id('P.old')
     or pg_temp.rem('P.old') <> 0 then
    raise exception 'A4 failed: FIFO did not take the oldest batch';
  end if;
  if pg_temp.book('TEST ADJ P') <> 100 then raise exception 'A4 failed: P book %', pg_temp.book('TEST ADJ P'); end if;
  if not exists (select 1 from activity_logs
                 where metadata->>'relatedEntryId' = v_out::text
                   and metadata->>'orderType' = 'stock_adjustment'
                   and metadata->>'stockAdjustmentId' = v_adj::text
                   and action_type = 'outflow' and user_id = pg_temp.id('ADM')) then
    raise exception 'A4 failed: activity log';
  end if;
  if (select applied_by from stock_adjustments where id = v_adj) <> pg_temp.id('ADM')
     or (select jsonb_array_length(lines) from stock_adjustments where id = v_adj) <> 6 then
    raise exception 'A4 failed: header';
  end if;
  if pg_temp.book('TEST ADJ U') <> 75 or pg_temp.rem('U.t') <> 30 then
    raise exception 'A4 failed: U book % (today''s receipt must survive)', pg_temp.book('TEST ADJ U');
  end if;
  if pg_temp.book('TEST ADJ K') <> 98.5 then raise exception 'A4 failed: K book %', pg_temp.book('TEST ADJ K'); end if;
  if pg_temp.book('TEST ADJ T') <> 70
     or exists (select 1 from outflows where product = 'TEST ADJ T' and stock_adjustment_id is not null) then
    raise exception 'A4 failed: T must be untouched';
  end if;
end $$;

-- A4b: an adjustment line can be voided, never returned against or edited.
select pg_temp.expect_error('A4b-return', 'ADM', format('select public.record_return(%L::jsonb)', jsonb_build_object(
  'return_date', pg_temp.today()::text, 'buyer_name', 'TEST BUYER', 'reason', 'pecah',
  'lines', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'outflow_id', pg_temp.id('P.adj'),
    'product', 'TEST ADJ P', 'category', 'egg', 'quantity', 1, 'disposition', 'restock', 'sku_code', 'TP')))),
  'IS_ADJUSTMENT');
select pg_temp.expect_error('A4b-edit', 'ADM', format('select public.correct_order(%L::uuid[], %L::jsonb, %L::jsonb, %L)',
  array[(select id from activity_logs where metadata->>'relatedEntryId' = pg_temp.id('P.adj')::text)],
  jsonb_build_array(jsonb_build_object('product', 'TEST ADJ P', 'category', 'egg', 'quantity_butir', 8,
                                       'date', pg_temp.today()::text)),
  jsonb_build_array(jsonb_build_object('product', 'TEST ADJ P', 'category', 'egg', 'quantity_butir', 8)),
  'test edit'), 'IS_ADJUSTMENT');

-- A8: Q got one inflow of 460; R clamped to 0 with no negative stock.
do $$
begin
  if (select count(*) from inflows where product = 'TEST ADJ Q' and stock_adjustment_id is not null
        and quantity_butir = 460 and remaining_butir = 460 and invoice_supplier = 'PENYESUAIAN STOK FISIK') <> 1 then
    raise exception 'A8 failed: Q inflow';
  end if;
  if pg_temp.book('TEST ADJ Q') <> 500 then raise exception 'A8 failed: Q book'; end if;
  if pg_temp.book('TEST ADJ R') <> 0 then raise exception 'A8 failed: R book %', pg_temp.book('TEST ADJ R'); end if;
end $$;

-- A5: a second press with a fresh preview does nothing.
select pg_temp.expect_error('A5', 'ADM', pg_temp.apply_sql(pg_temp.expected()), 'NOTHING_TO_ADJUST');

-- A6: recount P (JS 95) -> only the difference, +5, as one inflow.
do $$
begin
  perform pg_temp.count('TEST ADJ P', 'js_warehouse', 95);
  if (select delta from public.stock_count_adjustment_preview() where product = 'TEST ADJ P') <> 5 then
    raise exception 'A6 failed: recount delta';
  end if;
  perform pg_temp.as_user('ADM', pg_temp.apply_sql(pg_temp.expected()));
  if (select count(*) from inflows where product = 'TEST ADJ P' and stock_adjustment_id is not null and quantity_butir = 5) <> 1
     or pg_temp.book('TEST ADJ P') <> 105 then
    raise exception 'A6 failed: P book %', pg_temp.book('TEST ADJ P');
  end if;
end $$;

-- A7: voiding the A4 adjustment outflow brings its -10 back.
do $$
begin
  perform pg_temp.as_user('ADM', format('select public.void_outflow(%L::uuid, %L)', pg_temp.id('P.adj'), 'test void'));
  if (select delta from public.stock_count_adjustment_preview() where product = 'TEST ADJ P') <> -10 then
    raise exception 'A7 failed: delta after void %',
      (select delta from public.stock_count_adjustment_preview() where product = 'TEST ADJ P');
  end if;
end $$;

-- A11: voiding the plus line the way the app does (useVoidEntry.voidInflow: unconsumed
-- batch, two updates) brings +460 back.
do $$
begin
  update inflows set voided_at = now(), void_reason = 'test void'
  where product = 'TEST ADJ Q' and stock_adjustment_id is not null and remaining_butir = quantity_butir;
  if (select delta from public.stock_count_adjustment_preview() where product = 'TEST ADJ Q') <> 460 then
    raise exception 'A11 failed: Q delta after void';
  end if;
end $$;

-- A12: voiding T's return today: the compensating outflow is dated today too, so the
-- book at count stays 60 (returns.voided_at must NOT be filtered by the preview).
do $$
declare p record;
begin
  perform pg_temp.as_user('U', format('select public.void_return(%L::uuid, %L)', pg_temp.id('T.r'), 'test void'));
  select * into p from public.stock_count_adjustment_preview() where product = 'TEST ADJ T';
  if p.book_now <> 60 or p.book_at_count <> 60 or p.delta <> 0 then raise exception 'A12 failed: T %', row_to_json(p); end if;
end $$;

-- A13: staff (not admin) can read the preview through RLS.
select pg_temp.as_user('U',
  'do $x$ begin if (select count(*) from public.stock_count_adjustment_preview()) <> 6 then '
  'raise exception ''A13 failed: preview as authenticated''; end if; end $x$');

-- A9: the ledger invariant holds for every test product.
do $$
begin
  if exists (select 1 from reconcile_inventory() where product like 'TEST ADJ%') then
    raise exception 'A9 failed: drift';
  end if;
end $$;

-- A10: no count today -> NO_COUNT_TODAY.
delete from stock_counts where count_date = pg_temp.today();
select pg_temp.expect_error('A10', 'ADM', pg_temp.apply_sql('[]'::jsonb), 'NO_COUNT_TODAY');

select 'stock_adjustment tests passed' as result;

rollback;
