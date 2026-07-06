-- Idempotent order outflows (offline outbox support).
--
-- Same atomic FIFO function as 20260703000000_atomic_order_outflows.sql with ONE change:
-- any entry whose client-generated id already exists in outflows is SKIPPED ENTIRELY —
-- no outflow insert AND no FIFO deduction. A plain ON CONFLICT DO NOTHING would only
-- suppress the duplicate insert while still running the deduction loop, double-deducting
-- stock when the offline outbox replays an order whose success the client never observed
-- (e.g. connection dropped after COMMIT but before the response arrived).
--
-- Replay semantics: re-calling the RPC with the same p_entries is a no-op for entries
-- already recorded and records only the missing ones. Everything else (auth check,
-- validation, row-locked FIFO, all-or-nothing INSUFFICIENT_STOCK rollback) is unchanged.
CREATE OR REPLACE FUNCTION public.record_order_outflows(p_entries jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_entry jsonb;
  v_outflow_id uuid;
  v_qty numeric;
  v_remaining numeric;
  v_deduct numeric;
  v_product text;
  v_category inventory_category;
  inflow_rec RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: must be signed in to record outflows';
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'NO_ENTRIES: p_entries must be a non-empty json array';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_product  := v_entry->>'product';
    v_category := (v_entry->>'category')::inventory_category;
    v_qty      := (v_entry->>'quantity_butir')::numeric;

    IF v_product IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_ENTRY: product and a positive quantity_butir are required (got % / %)',
        v_product, v_qty;
    END IF;

    v_outflow_id := NULLIF(v_entry->>'id', '')::uuid;

    -- IDEMPOTENCY GUARD: this entry was already recorded by a previous call
    -- (offline-outbox replay after a partially-observed success). Skip the WHOLE
    -- entry — insert AND FIFO deduction — so stock is never deducted twice.
    -- Voided rows count too: the id was consumed and the void already restored stock.
    IF v_outflow_id IS NOT NULL AND EXISTS (SELECT 1 FROM outflows WHERE id = v_outflow_id) THEN
      CONTINUE;
    END IF;

    IF v_outflow_id IS NULL THEN
      v_outflow_id := gen_random_uuid();
    END IF;

    INSERT INTO outflows (id, date, product, quantity_butir, user_id, category, invoice_supplier)
    VALUES (
      v_outflow_id,
      v_entry->>'date',
      v_product,
      v_qty,
      v_user,
      v_category,
      NULLIF(v_entry->>'invoice_supplier', '')
    );

    v_remaining := v_qty;

    -- FIFO over live batches. FOR UPDATE locks each batch row until COMMIT, so a
    -- concurrent order touching the same product waits and then sees the updated
    -- remaining_butir (fixes the stale-read lost-update bug).
    FOR inflow_rec IN
      SELECT id, remaining_butir
      FROM inflows
      WHERE product = v_product
        AND category = v_category
        AND voided_at IS NULL
        AND remaining_butir > 0
      ORDER BY date ASC, created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_deduct := LEAST(inflow_rec.remaining_butir, v_remaining);

      UPDATE inflows
      SET remaining_butir = remaining_butir - v_deduct
      WHERE id = inflow_rec.id;

      INSERT INTO fifo_deductions (outflow_id, inflow_id, quantity_deducted)
      VALUES (v_outflow_id, inflow_rec.id, v_deduct);

      v_remaining := v_remaining - v_deduct;
    END LOOP;

    IF v_remaining > 0 THEN
      -- Rolls back EVERYTHING in this call: this entry's partial deductions AND all
      -- previously processed entries of the order. All-or-nothing by design.
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % (%) is short % butir/pcs',
        v_product, v_category, v_remaining;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_order_outflows(jsonb) TO authenticated;
