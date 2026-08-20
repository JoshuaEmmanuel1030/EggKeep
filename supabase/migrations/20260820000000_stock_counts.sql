-- Physical morning stock counts across locations (JS + TST warehouse, and stock
-- pre-loaded onto trucks the day before). This is a standalone dated snapshot for
-- valuation/accuracy — it does NOT touch the inflow/outflow ledger.
CREATE TABLE public.stock_counts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_date date NOT NULL DEFAULT current_date,
  location text NOT NULL CHECK (location IN ('js_warehouse', 'tst_warehouse', 'loaded')),
  item_type_id uuid NOT NULL REFERENCES public.item_types(id),
  product text NOT NULL,
  category text NOT NULL,
  quantity numeric NOT NULL,
  -- Ledger stock captured at save time (meaningful for js_warehouse rows only),
  -- so variance stays stable and reviewable on past dates.
  system_qty numeric,
  counted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_date, location, item_type_id)
);

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stock_counts"
  ON public.stock_counts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert stock_counts"
  ON public.stock_counts FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update stock_counts"
  ON public.stock_counts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Per-item variance tolerance for the physical count, in the item's native unit.
-- NULL = use the code default (kg eggs -> 1, everything else -> 0/exact).
ALTER TABLE public.item_types
  ADD COLUMN IF NOT EXISTS count_tolerance numeric;
