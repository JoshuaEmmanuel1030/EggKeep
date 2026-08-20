-- Allow authenticated users to delete their physical-count rows. Needed so the
-- StockCount page can remove a saved count when a staffer clears a cell to
-- correct a mistake. Consistent with the table's other authenticated policies.
CREATE POLICY "Authenticated users can delete stock_counts"
  ON public.stock_counts FOR DELETE TO authenticated USING (true);
