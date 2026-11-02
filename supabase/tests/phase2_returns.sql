-- RPC tests for 20261103000000_delivery_lines_void_return.sql (Phase 2 "Retur per faktur").
-- Spec: docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md,
-- Verification plan R1-R20, plus R21-R22 from the data-integrity review.
--
-- Run by hand against a Supabase BRANCH (or a local stack) on which the migration has been
-- applied: `execute_sql` of this whole file. NEVER against production. Everything runs in
-- one transaction that ends in ROLLBACK, so it is re-runnable and leaves nothing behind.
-- The first failing case stops the run with "R<n> failed: ...".
--
-- Users: two throwaway auth users are created inside the transaction (A, B; neither has
-- the admin role), so the run does not depend on who exists on the branch. RPCs run as a
-- signed-in user (role authenticated + request.jwt.claims); asserts run as the owner.
--
-- One transaction means now() is constant: every record_return call would share
-- created_at, so each call uses its own sku_code to keep save groups apart.

begin;

create temp table t_ids (k text primary key, v uuid not null);

-- ── helpers ─────────────────────────────────────────────────────────────────────
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as
  $$ insert into t_ids values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;

-- Runs p_sql as signed-in user p_user. p_sql must not reference pg_temp objects (the
-- authenticated role may not see this session's temp schema): resolve ids before calling.
create function pg_temp.as_user(p_user text, p_sql text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_user), 'role', 'authenticated',
                      'email', 'phase2-' || lower(p_user) || '@test.local')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
end $$;

create function pg_temp.product(p_name text) returns void language sql as $$
  insert into item_types (name, category, unit) values (p_name, 'egg', 'butir') $$;

create function pg_temp.batch(p_key text, p_product text, p_date text, p_qty numeric) returns uuid
language sql as $$
  insert into inflows (id, date, product, category, quantity_original, quantity_butir, remaining_butir, user_id)
  values (pg_temp.put(p_key, gen_random_uuid()), p_date, p_product, 'egg', p_qty, p_qty, p_qty, pg_temp.id('A'))
  returning id $$;

create function pg_temp.rem(p_key text) returns numeric language sql as
  $$ select remaining_butir from inflows where id = pg_temp.id(p_key) $$;

-- A sale through record_order_outflows as user A; returns the outflow id.
create function pg_temp.sell(p_key text, p_product text, p_qty numeric) returns uuid language plpgsql as $$
declare v_id uuid := pg_temp.put(p_key, gen_random_uuid());
begin
  perform pg_temp.as_user('A', format('select public.record_order_outflows(%L::jsonb)',
    jsonb_build_array(jsonb_build_object(
      'id', v_id, 'product', p_product, 'category', 'egg', 'quantity_butir', p_qty, 'date', '2026-10-01'))));
  return v_id;
end $$;

-- record_return as p_user. p_lines: [{key, outflow, product, qty, disp, sku, prior?}];
-- keys become return-entry ids (reused when the key exists, so a resend is a replay).
create function pg_temp.ret(p_user text, p_lines jsonb) returns void language plpgsql as $$
declare l jsonb; v_lines jsonb := '[]'::jsonb; v_e jsonb;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    v_e := jsonb_build_object(
      'id', coalesce(pg_temp.id(l->>'key'), pg_temp.put(l->>'key', gen_random_uuid())),
      'outflow_id', pg_temp.id(l->>'outflow'), 'product', l->>'product', 'category', 'egg',
      'quantity', (l->>'qty')::numeric, 'disposition', l->>'disp', 'sku_code', l->>'sku');
    if l ? 'prior' then v_e := v_e || jsonb_build_object('expected_prior', (l->>'prior')::numeric); end if;
    v_lines := v_lines || v_e;
  end loop;
  perform pg_temp.as_user(p_user, format('select public.record_return(%L::jsonb)',
    jsonb_build_object('return_date', '2026-10-02', 'buyer_name', 'TEST BUYER', 'reason', 'pecah', 'lines', v_lines)));
end $$;

create function pg_temp.void_ret(p_user text, p_key text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_user, format('select public.void_return(%L::uuid, %L)', pg_temp.id(p_key), 'test void'));
end $$;

create function pg_temp.void_out(p_key text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user('A', format('select public.void_outflow(%L::uuid, %L)', pg_temp.id(p_key), 'test void order'));
end $$;

create function pg_temp.reconciled() returns boolean language sql as
  $$ select not exists (select 1 from reconcile_inventory() where product like 'TEST PHASE2%') $$;

-- ── setup ───────────────────────────────────────────────────────────────────────
do $$
begin
  insert into auth.users (id, email, aud, role)
  values (pg_temp.put('A', gen_random_uuid()), 'phase2-a@test.local', 'authenticated', 'authenticated'),
         (pg_temp.put('B', gen_random_uuid()), 'phase2-b@test.local', 'authenticated', 'authenticated');
  if public.has_role(pg_temp.id('A'), 'admin') or public.has_role(pg_temp.id('B'), 'admin') then
    raise exception 'setup failed: a test user has the admin role';
  end if;
  perform pg_temp.product('TEST PHASE2 S1');
  perform pg_temp.batch('S1.B', 'TEST PHASE2 S1', '2026-01-01', 100);
  perform pg_temp.batch('S1.C', 'TEST PHASE2 S1', '2026-01-02', 100);
  perform pg_temp.sell('S1.O', 'TEST PHASE2 S1', 50);                       -- B 50
end $$;

-- R1: restock + retakan with expected_prior 0 -> both rows, user_email, child return_id.
do $$
begin
  perform pg_temp.ret('A', '[{"key":"e1","outflow":"S1.O","product":"TEST PHASE2 S1","qty":30,"disp":"restock","sku":"T1","prior":0},
                             {"key":"e2","outflow":"S1.O","product":"TEST PHASE2 S1","qty":10,"disp":"retakan","sku":"T1","prior":0}]');
  if (select count(*) from returns where outflow_id = pg_temp.id('S1.O')) <> 2 then raise exception 'R1 failed: row count'; end if;
  if exists (select 1 from returns where outflow_id = pg_temp.id('S1.O') and user_email is distinct from 'phase2-a@test.local') then
    raise exception 'R1 failed: user_email'; end if;
  if (select count(*) from inflows where return_id = pg_temp.id('e2') and product = 'TEST PHASE2 S1 (RETAKAN)' and remaining_butir = 10) <> 1 then
    raise exception 'R1 failed: retakan child inflow return_id'; end if;
  if pg_temp.rem('S1.B') <> 80 then raise exception 'R1 failed: B = % (want 80)', pg_temp.rem('S1.B'); end if;
  if not pg_temp.reconciled() then raise exception 'R1 failed: reconcile'; end if;
end $$;

-- R2: expected_prior 1 (actual 40) -> PRIOR_MISMATCH, nothing written.
do $$
begin
  begin
    perform pg_temp.ret('A', '[{"key":"e3","outflow":"S1.O","product":"TEST PHASE2 S1","qty":1,"disp":"restock","sku":"T2","prior":1}]');
    raise exception 'R2 failed: no error';
  exception when others then
    if sqlerrm not like 'PRIOR_MISMATCH%' then raise exception 'R2 failed: %', sqlerrm; end if;
  end;
  if exists (select 1 from returns where id = pg_temp.id('e3')) then raise exception 'R2 failed: row written'; end if;
  if pg_temp.rem('S1.B') <> 80 then raise exception 'R2 failed: B changed'; end if;
end $$;

-- R3: R1 resent with the same ids -> success, no new rows.
do $$
begin
  perform pg_temp.ret('A', '[{"key":"e1","outflow":"S1.O","product":"TEST PHASE2 S1","qty":30,"disp":"restock","sku":"T1","prior":0},
                             {"key":"e2","outflow":"S1.O","product":"TEST PHASE2 S1","qty":10,"disp":"retakan","sku":"T1","prior":0}]');
  if (select count(*) from returns where outflow_id = pg_temp.id('S1.O')) <> 2 then raise exception 'R3 failed: row count'; end if;
  if pg_temp.rem('S1.B') <> 80 then raise exception 'R3 failed: B = %', pg_temp.rem('S1.B'); end if;
  if (select count(*) from inflows where product = 'TEST PHASE2 S1 (RETAKAN)') <> 1 then raise exception 'R3 failed: child batch duplicated'; end if;
end $$;

-- R4: a sale empties B, then void_return on e1 -> whole group voided, two compensating
-- outflows, parent one deducted from C (oldest with stock), child one from the child batch.
do $$
declare v_parent uuid; v_child uuid;
begin
  perform pg_temp.sell('S1.sale', 'TEST PHASE2 S1', 80);                    -- B 0
  perform pg_temp.void_ret('A', 'e1');
  if exists (select 1 from returns where id in (pg_temp.id('e1'), pg_temp.id('e2')) and voided_at is null) then
    raise exception 'R4 failed: group not voided'; end if;
  select id into v_parent from outflows where void_return_id = pg_temp.id('e1') and product = 'TEST PHASE2 S1' and quantity_butir = 30;
  select id into v_child from outflows where void_return_id = pg_temp.id('e2') and product = 'TEST PHASE2 S1 (RETAKAN)' and quantity_butir = 10;
  if v_parent is null or v_child is null then raise exception 'R4 failed: compensating outflows missing'; end if;
  perform pg_temp.put('S1.V', v_parent);
  if not exists (select 1 from fifo_deductions where outflow_id = v_parent and inflow_id = pg_temp.id('S1.C') and quantity_deducted = 30) then
    raise exception 'R4 failed: parent compensation not taken from C'; end if;
  if pg_temp.rem('S1.C') <> 70 then raise exception 'R4 failed: C = %', pg_temp.rem('S1.C'); end if;
  if (select remaining_butir from inflows where return_id = pg_temp.id('e2')) <> 0 then raise exception 'R4 failed: child batch'; end if;
  if not pg_temp.reconciled() then raise exception 'R4 failed: reconcile'; end if;
end $$;

-- R5: void again -> no error, nothing changes.
do $$
begin
  perform pg_temp.void_ret('A', 'e2');
  if (select count(*) from outflows where void_return_id in (pg_temp.id('e1'), pg_temp.id('e2'))) <> 2 then
    raise exception 'R5 failed: extra compensating outflow'; end if;
  if pg_temp.rem('S1.C') <> 70 then raise exception 'R5 failed: C changed'; end if;
end $$;

-- R19: the ledger after R4.
do $$
begin
  if not exists (select 1 from v_recon_ledger where id = pg_temp.id('S1.V') and jenis = 'retur_batal' and retur = -30
                   and return_id = pg_temp.id('e1') and disposisi = 'restock' and 'retur-batal' = any(flags)
                   and not ('tanpa-log' = any(flags)) and keluar_po is null and keluar_tunai is null) then
    raise exception 'R19 failed: retur_batal row'; end if;
  if not exists (select 1 from v_recon_ledger where id = pg_temp.id('e1') and jenis = 'return_restock'
                   and 'retur-dibatalkan' = any(flags) and not voided) then
    raise exception 'R19 failed: voided return row flag'; end if;
  if not exists (select 1 from v_recon_ledger where return_id = pg_temp.id('e2') and jenis = 'return_retakan'
                   and 'retur-dibatalkan' = any(flags)) then
    raise exception 'R19 failed: retakan child inflow flag'; end if;
  if (select stok_akhir from v_recon_daily where nama_katalog = 'TEST PHASE2 S1' order by tanggal desc limit 1)
     <> (select sum(remaining_butir) from inflows where product = 'TEST PHASE2 S1' and voided_at is null) then
    raise exception 'R19 failed: daily closing balance (parent)'; end if;
  if (select stok_akhir from v_recon_daily where nama_katalog = 'TEST PHASE2 S1 (RETAKAN)' order by tanggal desc limit 1)
     <> (select sum(remaining_butir) from inflows where product = 'TEST PHASE2 S1 (RETAKAN)' and voided_at is null) then
    raise exception 'R19 failed: daily closing balance (RETAKAN)'; end if;
end $$;

-- R12: re-record after the void with the same quantities -> accepted. Per-batch room is
-- ded + vd - rs_all: B 50 + 0 - 30 = 20, C 0 + 30 - 0 = 30 -> B gets 20, C gets 10.
do $$
begin
  perform pg_temp.ret('A', '[{"key":"e5","outflow":"S1.O","product":"TEST PHASE2 S1","qty":30,"disp":"restock","sku":"T3","prior":0},
                             {"key":"e6","outflow":"S1.O","product":"TEST PHASE2 S1","qty":10,"disp":"retakan","sku":"T3","prior":0}]');
  if pg_temp.rem('S1.B') <> 20 or pg_temp.rem('S1.C') <> 80 then
    raise exception 'R12 failed: B % C % (want 20 / 80)', pg_temp.rem('S1.B'), pg_temp.rem('S1.C'); end if;
  if not exists (select 1 from return_restocks where return_id = pg_temp.id('e5') and inflow_id = pg_temp.id('S1.B')) then
    raise exception 'R12 failed: not restocked into B'; end if;
  if not pg_temp.reconciled() then raise exception 'R12 failed: reconcile'; end if;
end $$;

-- R6: user B (not admin) voids A's group -> NOT_ALLOWED.
do $$
begin
  begin
    perform pg_temp.void_ret('B', 'e5');
    raise exception 'R6 failed: no error';
  exception when others then
    if sqlerrm not like 'NOT_ALLOWED%' then raise exception 'R6 failed: %', sqlerrm; end if;
  end;
end $$;

-- R9: the RETAKAN child holds less than the group's retakan quantity -> INSUFFICIENT_STOCK,
-- nothing written, the group stays live.
do $$
begin
  perform pg_temp.ret('A', '[{"key":"e7","outflow":"S1.O","product":"TEST PHASE2 S1","qty":10,"disp":"retakan","sku":"T4","prior":40}]');
  perform pg_temp.sell('S1.childsale', 'TEST PHASE2 S1 (RETAKAN)', 15);    -- child stock 20 -> 5
  begin
    perform pg_temp.void_ret('A', 'e7');
    raise exception 'R9 failed: no error';
  exception when others then
    if sqlerrm not like 'INSUFFICIENT_STOCK%' then raise exception 'R9 failed: %', sqlerrm; end if;
  end;
  if (select voided_at from returns where id = pg_temp.id('e7')) is not null then raise exception 'R9 failed: voided'; end if;
  if exists (select 1 from outflows where void_return_id = pg_temp.id('e7')) then raise exception 'R9 failed: outflow written'; end if;
  if not pg_temp.reconciled() then raise exception 'R9 failed: reconcile'; end if;
end $$;

-- R10: a retakan return whose child inflow has no return_id (legacy) -> voided the same way.
do $$
begin
  perform pg_temp.sell('S1.O3', 'TEST PHASE2 S1', 5);                       -- S1.O is fully returned by now
  perform pg_temp.ret('A', '[{"key":"e9","outflow":"S1.O3","product":"TEST PHASE2 S1","qty":2,"disp":"retakan","sku":"T6"}]');
  update inflows set return_id = null where return_id = pg_temp.id('e9');
  perform pg_temp.void_ret('A', 'e9');
  if (select voided_at from returns where id = pg_temp.id('e9')) is null then raise exception 'R10 failed: not voided'; end if;
  if not exists (select 1 from outflows where void_return_id = pg_temp.id('e9') and product = 'TEST PHASE2 S1 (RETAKAN)' and quantity_butir = 2) then
    raise exception 'R10 failed: compensating outflow'; end if;
  if not pg_temp.reconciled() then raise exception 'R10 failed: reconcile'; end if;
end $$;

-- R7: A's own group recorded 49 h ago -> VOID_WINDOW_CLOSED.
do $$
begin
  update returns set created_at = created_at - interval '49 hours' where id in (pg_temp.id('e5'), pg_temp.id('e6'));
  begin
    perform pg_temp.void_ret('A', 'e5');
    raise exception 'R7 failed: no error';
  exception when others then
    if sqlerrm not like 'VOID_WINDOW_CLOSED%' then raise exception 'R7 failed: %', sqlerrm; end if;
  end;
end $$;

-- R8: A, after 48 h, voids a group that is already voided -> no-op, no error.
do $$
begin
  update returns set created_at = created_at - interval '49 hours' where id in (pg_temp.id('e1'), pg_temp.id('e2'));
  perform pg_temp.void_ret('A', 'e1');
  if (select count(*) from outflows where void_return_id in (pg_temp.id('e1'), pg_temp.id('e2'))) <> 2 then
    raise exception 'R8 failed: something changed'; end if;
end $$;

-- R11: a restock return on an outflow that void_outflow has voided -> voided, no compensating outflow.
do $$
begin
  perform pg_temp.sell('S1.O2', 'TEST PHASE2 S1', 10);
  perform pg_temp.ret('A', '[{"key":"e8","outflow":"S1.O2","product":"TEST PHASE2 S1","qty":5,"disp":"restock","sku":"T5"}]');
  perform pg_temp.void_out('S1.O2');
  perform pg_temp.void_ret('A', 'e8');
  if (select voided_at from returns where id = pg_temp.id('e8')) is null then raise exception 'R11 failed: not voided'; end if;
  if exists (select 1 from outflows where void_return_id = pg_temp.id('e8')) then raise exception 'R11 failed: compensating outflow written'; end if;
  if not pg_temp.reconciled() then raise exception 'R11 failed: reconcile'; end if;
end $$;

-- R13: §6.3.3 example 1 -> after void_outflow(O): B 0, C 100, V voided. R2 restocks into C
-- (B's room is 50 - 50 = 0; C's is V's 50), so the live state is B 0, C 100, not the
-- design's B 50, C 50; the end state is the same.
do $$
begin
  perform pg_temp.product('TEST PHASE2 E1');
  perform pg_temp.batch('E1.B', 'TEST PHASE2 E1', '2026-01-01', 100);
  perform pg_temp.batch('E1.C', 'TEST PHASE2 E1', '2026-01-02', 100);
  perform pg_temp.sell('E1.O', 'TEST PHASE2 E1', 50);
  perform pg_temp.ret('A', '[{"key":"E1.R","outflow":"E1.O","product":"TEST PHASE2 E1","qty":50,"disp":"restock","sku":"X1"}]');
  perform pg_temp.sell('E1.sale', 'TEST PHASE2 E1', 100);
  perform pg_temp.void_ret('A', 'E1.R');                                     -- V takes 50 from C
  perform pg_temp.ret('A', '[{"key":"E1.R2","outflow":"E1.O","product":"TEST PHASE2 E1","qty":50,"disp":"restock","sku":"X2"}]');
  if pg_temp.rem('E1.B') <> 0 or pg_temp.rem('E1.C') <> 100 then
    raise exception 'R13 failed: live state B % C %', pg_temp.rem('E1.B'), pg_temp.rem('E1.C'); end if;
  perform pg_temp.void_out('E1.O');
  if pg_temp.rem('E1.B') <> 0 or pg_temp.rem('E1.C') <> 100 then
    raise exception 'R13 failed: after void B % C %', pg_temp.rem('E1.B'), pg_temp.rem('E1.C'); end if;
  if exists (select 1 from outflows where void_return_id = pg_temp.id('E1.R') and voided_at is null) then
    raise exception 'R13 failed: V not voided'; end if;
  if not pg_temp.reconciled() then raise exception 'R13 failed: reconcile'; end if;
end $$;

-- R14: example 2, made reachable by FIFO (a prior sale of 95 leaves B1 at 5, so O takes
-- 5 from B1 and 45 from B2). True state without O and its returns: B1 5, B2 100.
do $$
begin
  perform pg_temp.product('TEST PHASE2 E2');
  perform pg_temp.batch('E2.B1', 'TEST PHASE2 E2', '2026-01-01', 100);
  perform pg_temp.batch('E2.B2', 'TEST PHASE2 E2', '2026-01-02', 100);
  perform pg_temp.sell('E2.pre', 'TEST PHASE2 E2', 95);
  perform pg_temp.sell('E2.O', 'TEST PHASE2 E2', 50);                       -- B1 0, B2 55
  perform pg_temp.ret('A', '[{"key":"E2.R","outflow":"E2.O","product":"TEST PHASE2 E2","qty":10,"disp":"restock","sku":"X1"}]');
  perform pg_temp.void_ret('A', 'E2.R');
  perform pg_temp.ret('A', '[{"key":"E2.R2","outflow":"E2.O","product":"TEST PHASE2 E2","qty":10,"disp":"restock","sku":"X2"}]');
  perform pg_temp.void_out('E2.O');
  if pg_temp.rem('E2.B1') <> 5 or pg_temp.rem('E2.B2') <> 100 then
    raise exception 'R14 failed: B1 % B2 %', pg_temp.rem('E2.B1'), pg_temp.rem('E2.B2'); end if;
  if not pg_temp.reconciled() then raise exception 'R14 failed: reconcile'; end if;
end $$;

-- R15: example 3 -> B 100.
do $$
begin
  perform pg_temp.product('TEST PHASE2 E3');
  perform pg_temp.batch('E3.B', 'TEST PHASE2 E3', '2026-01-01', 100);
  perform pg_temp.sell('E3.O', 'TEST PHASE2 E3', 100);
  perform pg_temp.ret('A', '[{"key":"E3.R","outflow":"E3.O","product":"TEST PHASE2 E3","qty":100,"disp":"restock","sku":"X1"}]');
  perform pg_temp.void_ret('A', 'E3.R');
  perform pg_temp.ret('A', '[{"key":"E3.R2","outflow":"E3.O","product":"TEST PHASE2 E3","qty":100,"disp":"restock","sku":"X2"}]');
  perform pg_temp.void_out('E3.O');
  if pg_temp.rem('E3.B') <> 100 then raise exception 'R15 failed: B %', pg_temp.rem('E3.B'); end if;
  if not pg_temp.reconciled() then raise exception 'R15 failed: reconcile'; end if;
end $$;

-- R16: example 4 -> B 40, C 100.
do $$
begin
  perform pg_temp.product('TEST PHASE2 E4');
  perform pg_temp.batch('E4.B', 'TEST PHASE2 E4', '2026-01-01', 100);
  perform pg_temp.batch('E4.C', 'TEST PHASE2 E4', '2026-01-02', 100);
  perform pg_temp.sell('E4.O', 'TEST PHASE2 E4', 50);
  perform pg_temp.ret('A', '[{"key":"E4.R","outflow":"E4.O","product":"TEST PHASE2 E4","qty":10,"disp":"restock","sku":"X1"}]');
  perform pg_temp.sell('E4.sale', 'TEST PHASE2 E4', 60);
  perform pg_temp.void_ret('A', 'E4.R');
  perform pg_temp.void_out('E4.O');
  if pg_temp.rem('E4.B') <> 40 or pg_temp.rem('E4.C') <> 100 then
    raise exception 'R16 failed: B % C %', pg_temp.rem('E4.B'), pg_temp.rem('E4.C'); end if;
  if not pg_temp.reconciled() then raise exception 'R16 failed: reconcile'; end if;
end $$;

-- R17: example 1 continued by a sale of 50 after R2 -> the void succeeds with the true state
-- (B 0, C 50): the per-batch restock room keeps every delta >= 0, so VOID_BLOCKED stays a
-- backstop. (The design's "example 3 + a sale of 50 -> VOID_BLOCKED" does not hold: delta 0.)
do $$
begin
  perform pg_temp.product('TEST PHASE2 E5');
  perform pg_temp.batch('E5.B', 'TEST PHASE2 E5', '2026-01-01', 100);
  perform pg_temp.batch('E5.C', 'TEST PHASE2 E5', '2026-01-02', 100);
  perform pg_temp.sell('E5.O', 'TEST PHASE2 E5', 50);
  perform pg_temp.ret('A', '[{"key":"E5.R","outflow":"E5.O","product":"TEST PHASE2 E5","qty":50,"disp":"restock","sku":"X1"}]');
  perform pg_temp.sell('E5.sale', 'TEST PHASE2 E5', 100);
  perform pg_temp.void_ret('A', 'E5.R');
  perform pg_temp.ret('A', '[{"key":"E5.R2","outflow":"E5.O","product":"TEST PHASE2 E5","qty":50,"disp":"restock","sku":"X2"}]');
  perform pg_temp.sell('E5.sale2', 'TEST PHASE2 E5', 50);                   -- C 100 -> 50
  perform pg_temp.void_out('E5.O');
  if pg_temp.rem('E5.B') <> 0 or pg_temp.rem('E5.C') <> 50 then
    raise exception 'R17 failed: B % C %', pg_temp.rem('E5.B'), pg_temp.rem('E5.C'); end if;
  if not pg_temp.reconciled() then raise exception 'R17 failed: reconcile'; end if;
end $$;

-- R18: void_outflow on an order with no returns -> batch restored exactly as before.
do $$
begin
  perform pg_temp.product('TEST PHASE2 E6');
  perform pg_temp.batch('E6.B', 'TEST PHASE2 E6', '2026-01-01', 100);
  perform pg_temp.batch('E6.C', 'TEST PHASE2 E6', '2026-01-02', 100);
  perform pg_temp.sell('E6.O', 'TEST PHASE2 E6', 130);
  perform pg_temp.void_out('E6.O');
  if pg_temp.rem('E6.B') <> 100 or pg_temp.rem('E6.C') <> 100 then raise exception 'R18 failed'; end if;
  if not pg_temp.reconciled() then raise exception 'R18 failed: reconcile'; end if;
end $$;

-- R20: correct_order on an order whose only return is voided -> HAS_RETURNS.
do $$
declare v_log uuid := gen_random_uuid();
begin
  perform pg_temp.product('TEST PHASE2 E7');
  perform pg_temp.batch('E7.B', 'TEST PHASE2 E7', '2026-01-01', 100);
  perform pg_temp.sell('E7.O', 'TEST PHASE2 E7', 20);
  insert into activity_logs (id, user_id, action_type, product, quantity_butir, recorded_at, created_at,
                             client_id, category, user_email, metadata)
  values (v_log, pg_temp.id('A'), 'outflow', 'TEST PHASE2 E7', 20, now(), now(), gen_random_uuid()::text, 'egg',
          'phase2-a@test.local',
          jsonb_build_object('orderType', 'quick_outflow', 'buyerName', 'TEST BUYER', 'invoiceRef', 'TEST-R20',
                             'relatedEntryId', pg_temp.id('E7.O'),
                             'relatedProducts', jsonb_build_array(jsonb_build_object('product', 'TEST PHASE2 E7'))));
  perform pg_temp.ret('A', '[{"key":"E7.R","outflow":"E7.O","product":"TEST PHASE2 E7","qty":5,"disp":"restock","sku":"X1"}]');
  perform pg_temp.void_ret('A', 'E7.R');
  begin
    perform pg_temp.as_user('A', format('select public.correct_order(%L::uuid[], %L::jsonb, %L::jsonb, %L)',
      array[v_log],
      jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'product', 'TEST PHASE2 E7', 'category', 'egg',
                                           'quantity_butir', 10, 'date', '2026-10-01')),
      jsonb_build_array(jsonb_build_object('product', 'TEST PHASE2 E7', 'quantity_butir', 10, 'category', 'egg')),
      'test edit'));
    raise exception 'R20 failed: no error';
  exception when others then
    if sqlerrm not like 'HAS_RETURNS%' then raise exception 'R20 failed: %', sqlerrm; end if;
  end;
end $$;

-- R21 (review finding): another order's restock sits in the older batch, so V drains it
-- first. Re-recording must not push B over its intake: A 100, B 100; X sells 100 (A 0); O
-- sells 50 (B 50); X's return restocks 10 (A 10); R on O restocks 50 (B 100); void R: V takes
-- 10 from A, 40 from B (A 0, B 60); R2 = 50 -> A 10, B 100 (room A 0+10-0, B 50+40-50).
do $$
begin
  perform pg_temp.product('TEST PHASE2 E8');
  perform pg_temp.batch('E8.A', 'TEST PHASE2 E8', '2026-01-01', 100);
  perform pg_temp.batch('E8.B', 'TEST PHASE2 E8', '2026-01-02', 100);
  perform pg_temp.sell('E8.X', 'TEST PHASE2 E8', 100);
  perform pg_temp.sell('E8.O', 'TEST PHASE2 E8', 50);
  perform pg_temp.ret('A', '[{"key":"E8.RX","outflow":"E8.X","product":"TEST PHASE2 E8","qty":10,"disp":"restock","sku":"X0"}]');
  perform pg_temp.ret('A', '[{"key":"E8.R","outflow":"E8.O","product":"TEST PHASE2 E8","qty":50,"disp":"restock","sku":"X1"}]');
  perform pg_temp.void_ret('A', 'E8.R');
  if pg_temp.rem('E8.A') <> 0 or pg_temp.rem('E8.B') <> 60 then raise exception 'R21 failed: after void A % B %', pg_temp.rem('E8.A'), pg_temp.rem('E8.B'); end if;
  perform pg_temp.ret('A', '[{"key":"E8.R2","outflow":"E8.O","product":"TEST PHASE2 E8","qty":50,"disp":"restock","sku":"X2"}]');
  if pg_temp.rem('E8.A') <> 10 or pg_temp.rem('E8.B') <> 100 then raise exception 'R21 failed: after R2 A % B %', pg_temp.rem('E8.A'), pg_temp.rem('E8.B'); end if;
  if not pg_temp.reconciled() then raise exception 'R21 failed: reconcile'; end if;
  perform pg_temp.void_out('E8.O');                                          -- true state: A 10, B 100
  if pg_temp.rem('E8.A') <> 10 or pg_temp.rem('E8.B') <> 100 then raise exception 'R21 failed: after void_outflow A % B %', pg_temp.rem('E8.A'), pg_temp.rem('E8.B'); end if;
  if not pg_temp.reconciled() then raise exception 'R21 failed: reconcile after void_outflow'; end if;
end $$;

-- R22: a compensating outflow cannot be voided or returned against directly -> IS_RETURN_VOID.
do $$
begin
  perform pg_temp.put('S1.Vc', pg_temp.id('S1.V'));
  begin
    perform pg_temp.void_out('S1.Vc');
    raise exception 'R22 failed: no error (void_outflow)';
  exception when others then
    if sqlerrm not like 'IS_RETURN_VOID%' then raise exception 'R22 failed: %', sqlerrm; end if;
  end;
  begin
    perform pg_temp.ret('A', '[{"key":"e10","outflow":"S1.Vc","product":"TEST PHASE2 S1","qty":1,"disp":"restock","sku":"T9"}]');
    raise exception 'R22 failed: no error (record_return)';
  exception when others then
    if sqlerrm not like 'IS_RETURN_VOID%' then raise exception 'R22 failed: %', sqlerrm; end if;
  end;
end $$;

select 'phase2_returns: R1-R22 passed' as result;

rollback;
