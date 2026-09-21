-- ─────────────────────────────────────────────────────────────────────────────
-- Merge the legacy lowercase retakan duplicate into its canonical (RETAKAN) line.
--
-- Context: the `record_return` RPC targets the UPPERCASE parenthesized name
-- `<PARENT> (RETAKAN)`. A legacy row `KAMPUNG BIASA (retakan)` (lowercase,
-- is_retakan=false) exists from an earlier hand-created seed. Because the unique
-- index is UNIQUE(category, name) — case-sensitive — the two coexist, and any
-- stock on the lowercase row is stranded from the canonical line and from
-- retakan analytics (which filter on is_retakan).
--
-- This script re-points every operational reference (inflows/outflows/returns/
-- pack_skus — the name IS the FIFO key) from the lowercase row to the canonical
-- one, then soft-deletes the lowercase row. activity_logs.product is a historical
-- name snapshot BY DESIGN (see EggKeep/CLAUDE.md) and is intentionally left alone.
--
-- Run against project lgtixzpjbkzapecirbfj in the Supabase SQL editor.
-- STEP 1: run the PREVIEW below and eyeball the counts.
-- STEP 2: run the MERGE block. It is transactional and idempotent (safe to re-run).
--
-- If you find OTHER lowercase/mixed-case dups later, change the two names at the
-- top of the DO block and re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── STEP 1: PREVIEW (read-only) ──────────────────────────────────────────────
-- What exists, and how much would move.
select 'item_types' as tbl, id::text, name, is_retakan::text as flag,
       coalesce(remaining::text,'') as remaining
from (
  select it.id, it.name, it.is_retakan,
         (select sum(remaining_butir) from inflows i
            where i.product = it.name and i.voided_at is null) as remaining
  from item_types it
  where it.category = 'egg' and it.name ilike 'KAMPUNG BIASA (%RETAKAN%)'
) x
union all
select 'inflows(live) on lowercase', count(*)::text, coalesce(sum(remaining_butir),0)::text, '', ''
  from inflows where product = 'KAMPUNG BIASA (retakan)' and voided_at is null
union all
select 'outflows on lowercase', count(*)::text, '', '', '' from outflows where product = 'KAMPUNG BIASA (retakan)'
union all
select 'returns on lowercase', count(*)::text, '', '', '' from returns where product = 'KAMPUNG BIASA (retakan)'
union all
select 'pack_skus on lowercase', count(*)::text, '', '', '' from pack_skus where egg_product = 'KAMPUNG BIASA (retakan)';

-- ── STEP 2: MERGE (transactional, idempotent) ────────────────────────────────
do $$
declare
  v_cat      text := 'egg';
  v_src_name text := 'KAMPUNG BIASA (retakan)';  -- legacy lowercase row to retire
  v_dst_name text := 'KAMPUNG BIASA (RETAKAN)';  -- canonical row to keep
  v_src uuid;
  v_dst uuid;
  n int;
begin
  select id into v_dst from item_types
    where category = v_cat::inventory_category and name = v_dst_name and deleted_at is null;
  if v_dst is null then
    raise exception 'Canonical target "%" not found (active). Aborting — nothing changed.', v_dst_name;
  end if;

  select id into v_src from item_types
    where category = v_cat::inventory_category and name = v_src_name;
  if v_src is null then
    raise notice 'Source "%" not found — already merged or never existed. Nothing to do.', v_src_name;
    return;
  end if;

  -- Re-point operational rows (name is the FIFO/lookup key; also fix item_type_id).
  update inflows  set product = v_dst_name, item_type_id = v_dst where product = v_src_name;
  get diagnostics n = row_count; raise notice 'inflows re-pointed: %', n;

  update outflows set product = v_dst_name, item_type_id = v_dst where product = v_src_name;
  get diagnostics n = row_count; raise notice 'outflows re-pointed: %', n;

  update returns  set product = v_dst_name, item_type_id = v_dst where product = v_src_name;
  get diagnostics n = row_count; raise notice 'returns re-pointed: %', n;

  update pack_skus set egg_product = v_dst_name, egg_item_type_id = v_dst where egg_product = v_src_name;
  get diagnostics n = row_count; raise notice 'pack_skus re-pointed: %', n;

  -- fifo_deductions reference inflow_id (not name), so they follow automatically.
  -- The lowercase row now has no operational references -> safe to soft-delete.
  update item_types set deleted_at = now() where id = v_src and deleted_at is null;
  raise notice 'Source "%" soft-deleted. Merge complete.', v_src_name;
end $$;
