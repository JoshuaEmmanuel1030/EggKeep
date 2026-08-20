import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StockLocation } from "@/lib/stockCount";
import { StockCountRecord, StockCountSaveEntry } from "@/types/stockCount";

export function useStockCounts(countDate: string) {
  const [records, setRecords] = useState<StockCountRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("stock_counts")
        .select("*")
        .eq("count_date", countDate);
      if (error) throw error;
      setRecords(
        (data || []).map((row) => ({
          id: row.id,
          countDate: row.count_date,
          location: row.location as StockLocation,
          itemTypeId: row.item_type_id,
          product: row.product,
          category: row.category,
          quantity: Number(row.quantity),
          systemQty: row.system_qty != null ? Number(row.system_qty) : null,
          countedBy: row.counted_by ?? null,
        }))
      );
    } catch (e) {
      console.error("Error fetching stock counts:", e);
    } finally {
      setLoading(false);
    }
  }, [countDate]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Batch upsert on the unique key (count_date, location, item_type_id). Each
  // product/location row is independent — no atomic RPC needed. Re-saving the
  // same day updates the rows in place.
  const saveCounts = useCallback(
    async (entries: StockCountSaveEntry[], countedBy: string): Promise<boolean> => {
      if (entries.length === 0) return true;
      const nowIso = new Date().toISOString();
      const rows = entries.map((e) => ({
        count_date: countDate,
        location: e.location,
        item_type_id: e.itemTypeId,
        product: e.product,
        category: e.category,
        quantity: e.quantity,
        system_qty: e.systemQty ?? null,
        counted_by: countedBy,
        updated_at: nowIso,
      }));
      const { error } = await supabase
        .from("stock_counts")
        .upsert(rows, { onConflict: "count_date,location,item_type_id" });
      if (error) {
        console.error("Error saving stock counts:", error);
        return false;
      }
      await fetchCounts();
      return true;
    },
    [countDate, fetchCounts]
  );

  // Delete rows for this countDate matching the given (item_type_id, location)
  // pairs, then refetch. Used to remove a saved count that a staffer cleared.
  const deleteCounts = useCallback(
    async (
      keys: { itemTypeId: string; location: StockLocation }[]
    ): Promise<boolean> => {
      if (keys.length === 0) return true;
      try {
        for (const k of keys) {
          const { error } = await supabase
            .from("stock_counts")
            .delete()
            .eq("count_date", countDate)
            .eq("item_type_id", k.itemTypeId)
            .eq("location", k.location);
          if (error) throw error;
        }
      } catch (e) {
        console.error("Error deleting stock counts:", e);
        return false;
      }
      await fetchCounts();
      return true;
    },
    [countDate, fetchCounts]
  );

  return { records, loading, saveCounts, deleteCounts, refetch: fetchCounts };
}
