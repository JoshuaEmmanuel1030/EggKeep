-- Drop and recreate the function with WHERE clause for DELETE
CREATE OR REPLACE FUNCTION public.recalculate_inventory_fifo()
RETURNS TABLE(
  product_name TEXT,
  outflows_processed BIGINT,
  deductions_created BIGINT,
  total_deducted NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  outflow_record RECORD;
  inflow_record RECORD;
  remaining_to_deduct NUMERIC;
  deduct_amount NUMERIC;
BEGIN
  -- Step 1: Clear all existing FIFO deductions (WHERE true satisfies RLS requirement)
  DELETE FROM fifo_deductions WHERE true;
  
  -- Step 2: Reset all inflow remaining_butir to original quantity
  UPDATE inflows 
  SET remaining_butir = quantity_butir 
  WHERE voided_at IS NULL;
  
  -- Step 3: Process each non-voided outflow in chronological order (FIFO: date first, then created_at as tiebreaker)
  FOR outflow_record IN (
    SELECT id, product, quantity_butir, date, created_at
    FROM outflows 
    WHERE voided_at IS NULL 
    ORDER BY date ASC, created_at ASC
  ) LOOP
    remaining_to_deduct := outflow_record.quantity_butir;
    
    -- Find available inflows for this product in FIFO order
    FOR inflow_record IN (
      SELECT id, remaining_butir
      FROM inflows
      WHERE product = outflow_record.product
        AND voided_at IS NULL
        AND remaining_butir > 0
      ORDER BY date ASC, created_at ASC
    ) LOOP
      EXIT WHEN remaining_to_deduct <= 0;
      
      -- Calculate how much to deduct from this batch
      deduct_amount := LEAST(inflow_record.remaining_butir, remaining_to_deduct);
      
      -- Create FIFO deduction record
      INSERT INTO fifo_deductions (outflow_id, inflow_id, quantity_deducted)
      VALUES (outflow_record.id, inflow_record.id, deduct_amount);
      
      -- Update the inflow's remaining quantity
      UPDATE inflows 
      SET remaining_butir = remaining_butir - deduct_amount
      WHERE id = inflow_record.id;
      
      remaining_to_deduct := remaining_to_deduct - deduct_amount;
    END LOOP;
  END LOOP;
  
  -- Return summary statistics per product
  RETURN QUERY
  SELECT 
    o.product AS product_name,
    COUNT(DISTINCT o.id) AS outflows_processed,
    COUNT(fd.id) AS deductions_created,
    COALESCE(SUM(fd.quantity_deducted), 0) AS total_deducted
  FROM outflows o
  LEFT JOIN fifo_deductions fd ON fd.outflow_id = o.id
  WHERE o.voided_at IS NULL
  GROUP BY o.product
  ORDER BY o.product;
END;
$$;