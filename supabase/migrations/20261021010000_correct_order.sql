-- correct_order: edit a recorded order (Purchase Order or Cash entry) within
-- 1 hour of when it was first entered. Typical fixes: wrong invoice number,
-- wrong quantity, wrong DC or delivery date.
--
-- ONE transaction, all-or-nothing:
--   1. lock + validate the order's original activity-log rows: outflow rows,
--      not voided/edited already, entered by the caller (or caller is admin),
--      first entered < 1 hour ago, and no customer return recorded against
--      their outflows;
--   2. void each original outflow via void_outflow (restores its FIFO stock);
--   3. record the corrected entries via record_order_outflows (FIFO deduct;
--      INSUFFICIENT_STOCK rolls EVERYTHING back, so stock is never half-edited);
--   4. mark the original logs voided ("superseded") and insert the corrected
--      logs, linked both ways (original_log_id / corrected_by_log_id). The new
--      logs keep the original created_at, so editing never restarts the window.
--
-- p_old_log_ids : activity_logs.id of every row of the order being edited
-- p_entries     : record_order_outflows p_entries (new client UUIDs)
-- p_logs        : one activity-log payload per entry: id, product,
--                 quantity_butir, category, invoice_supplier, recorded_at,
--                 user_email, client_id, metadata (with relatedEntryId)
-- p_reason      : void reason stored on the superseded rows
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
    if exists (select 1 from returns where outflow_id = v_outflow_id) then
      raise exception 'HAS_RETURNS: orders with a recorded return cannot be edited';
    end if;

    perform public.void_outflow(v_outflow_id, p_reason);
    update activity_logs set voided_at = now(), void_reason = p_reason where id = v_log.id;

    v_first_old := coalesce(v_first_old, v_log.id);
    v_created := coalesce(v_created, v_log.created_at); -- earliest: rows are ordered by created_at
  end loop;

  -- 3: record the corrected entries (raises INSUFFICIENT_STOCK -> full rollback).
  perform public.record_order_outflows(p_entries);

  -- 4: corrected activity logs, linked to the originals.
  for v_new in select * from jsonb_array_elements(p_logs) loop
    v_new_id := coalesce(nullif(v_new->>'id', '')::uuid, gen_random_uuid());
    insert into activity_logs (
      id, user_id, action_type, product, quantity_butir, recorded_at, created_at,
      client_id, category, invoice_supplier, user_email, metadata, original_log_id
    ) values (
      v_new_id,
      v_user,
      'outflow',
      v_new->>'product',
      (v_new->>'quantity_butir')::numeric,
      coalesce((v_new->>'recorded_at')::timestamptz, now()),
      v_created,
      coalesce(nullif(v_new->>'client_id', ''), gen_random_uuid()::text),
      (v_new->>'category')::inventory_category,
      nullif(v_new->>'invoice_supplier', ''),
      v_new->>'user_email',
      v_new->'metadata',
      v_first_old
    );
    v_first_new := coalesce(v_first_new, v_new_id);
  end loop;

  update activity_logs set corrected_by_log_id = v_first_new where id = any(p_old_log_ids);
end;
$$;

-- Signed-in users only (the function checks ownership/admin + the 1h window itself).
revoke all on function public.correct_order(uuid[], jsonb, jsonb, text) from public, anon;
grant execute on function public.correct_order(uuid[], jsonb, jsonb, text) to authenticated;
