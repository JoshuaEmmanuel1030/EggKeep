-- correct_order hardening (full replace of 20261021010000_correct_order.sql's body).
-- Apply right after it (or instead of re-reading it: this is the live definition).
--
-- CHANGED vs 20261021010000:
--   * ORDER_INCOMPLETE: p_old_log_ids must be exactly ONE whole order. Before,
--     a subset (feed filtered by search) voided only some rows but re-recorded
--     every material -> double deduction; two merged orders were both voided
--     but only one re-recorded -> silent restore.
--   * The outflow row is locked BEFORE the HAS_RETURNS check (record_return's
--     lock order), so an in-flight return can't slip past it.
--   * Corrected rows keep the original owner (user_id + user_email), so the
--     person who entered the order can still edit/void it after an admin fix.
--     The editor's email is kept in metadata.editedBy.
create or replace function public.correct_order(
  p_old_log_ids uuid[],
  p_entries jsonb,
  p_logs jsonb,
  p_reason text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_is_admin boolean;
  v_log activity_logs%rowtype;
  v_outflow_id uuid;
  v_first_old uuid;
  v_first_new uuid;
  v_created timestamptz;
  v_new jsonb;
  v_new_id uuid;
  v_found int;
  v_owner uuid;
  v_owner_email text;
  v_quick boolean;
  v_products int;
  v_variants int;
  v_materials int;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED: must be signed in to edit an order';
  end if;
  if p_old_log_ids is null or coalesce(array_length(p_old_log_ids, 1), 0) = 0 then
    raise exception 'NO_ORDER: nothing to edit';
  end if;
  if p_logs is null or jsonb_typeof(p_logs) <> 'array' or jsonb_array_length(p_logs) = 0 then
    raise exception 'NO_ENTRIES: p_logs must be a non-empty json array';
  end if;

  v_is_admin := public.has_role(v_user, 'admin');

  select count(distinct id) into v_found from activity_logs where id = any(p_old_log_ids);
  if v_found <> (select count(distinct x) from unnest(p_old_log_ids) x) then
    raise exception 'ORDER_NOT_FOUND: some rows of this order no longer exist';
  end if;

  -- Exactly ONE whole order. A Cash entry is one row; a Purchase Order is all
  -- its rows: one per relatedProducts entry, each product once, same order
  -- metadata. (These fields never change after insert, so reading them before
  -- the row locks below is safe.)
  select bool_and(coalesce(metadata->>'orderType', '') = 'quick_outflow'
                  and coalesce(metadata->>'buyerName', '') <> ''),
         count(distinct product),
         count(distinct (metadata - 'relatedEntryId')),
         max(case when jsonb_typeof(metadata->'relatedProducts') = 'array'
                  then jsonb_array_length(metadata->'relatedProducts') end)
    into v_quick, v_products, v_variants, v_materials
    from activity_logs where id = any(p_old_log_ids);
  if (v_quick and (v_variants <> 1 or v_products <> v_found or v_materials is distinct from v_found))
     or (not v_quick and v_found <> 1) then
    raise exception 'ORDER_INCOMPLETE: edit the whole order at once (refresh and try again)';
  end if;

  -- 1 + 2: validate, then void each original outflow (restores stock).
  for v_log in
    select * from activity_logs where id = any(p_old_log_ids) order by created_at, id for update
  loop
    if v_log.action_type <> 'outflow' then
      raise exception 'NOT_AN_OUTFLOW: %', v_log.id;
    end if;
    if v_log.voided_at is not null then
      raise exception 'ALREADY_CHANGED: this order was already voided or edited';
    end if;
    if v_log.user_id <> v_user and not v_is_admin then
      raise exception 'NOT_ALLOWED: only the person who entered this order (or an admin) can edit it';
    end if;
    if v_log.created_at < now() - interval '1 hour' then
      raise exception 'EDIT_WINDOW_CLOSED: orders can only be edited within 1 hour of being entered';
    end if;

    v_outflow_id := nullif(v_log.metadata->>'relatedEntryId', '')::uuid;
    if v_outflow_id is null then
      raise exception 'NO_OUTFLOW_LINK: %', v_log.id;
    end if;
    -- Outflow row first (record_return's lock order): an in-flight return is
    -- then committed and visible to the check below.
    perform 1 from outflows where id = v_outflow_id for update;
    if exists (select 1 from returns where outflow_id = v_outflow_id) then
      raise exception 'HAS_RETURNS: orders with a recorded return cannot be edited';
    end if;

    perform public.void_outflow(v_outflow_id, p_reason);
    update activity_logs set voided_at = now(), void_reason = p_reason where id = v_log.id;

    if v_first_old is null then -- earliest row: rows are ordered by created_at
      v_first_old := v_log.id;
      v_created := v_log.created_at;
      v_owner := v_log.user_id;
      v_owner_email := v_log.user_email;
    end if;
  end loop;

  -- 3: record the corrected entries (raises INSUFFICIENT_STOCK -> full rollback).
  perform public.record_order_outflows(p_entries);

  -- 4: corrected activity logs, linked to the originals, still owned by whoever
  -- entered the order; the editor goes in metadata.editedBy.
  for v_new in select * from jsonb_array_elements(p_logs) loop
    v_new_id := coalesce(nullif(v_new->>'id', '')::uuid, gen_random_uuid());
    insert into activity_logs (
      id, user_id, action_type, product, quantity_butir, recorded_at, created_at,
      client_id, category, invoice_supplier, user_email, metadata, original_log_id
    ) values (
      v_new_id,
      v_owner,
      'outflow',
      v_new->>'product',
      (v_new->>'quantity_butir')::numeric,
      coalesce((v_new->>'recorded_at')::timestamptz, now()),
      v_created,
      coalesce(nullif(v_new->>'client_id', ''), gen_random_uuid()::text),
      (v_new->>'category')::inventory_category,
      nullif(v_new->>'invoice_supplier', ''),
      coalesce(v_owner_email, v_new->>'user_email'),
      coalesce(v_new->'metadata', '{}'::jsonb) || jsonb_build_object('editedBy', v_new->>'user_email'),
      v_first_old
    );
    v_first_new := coalesce(v_first_new, v_new_id);
  end loop;

  update activity_logs set corrected_by_log_id = v_first_new where id = any(p_old_log_ids);
end;
$$;

revoke all on function public.correct_order(uuid[], jsonb, jsonb, text) from public, anon;
grant execute on function public.correct_order(uuid[], jsonb, jsonb, text) to authenticated;
