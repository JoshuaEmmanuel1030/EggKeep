import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PurchaseOrderRow, addDays, localToday, monthStart } from "@/lib/buyerProfile";

const PAGE = 1000; // PostgREST max rows per request

// A buyer's Purchase Orders (one row per order, from the purchase_orders view)
// for the current month + 5 previous. Paged so insights never undercount.
async function fetchBuyerOrders(buyerName: string): Promise<PurchaseOrderRow[]> {
  const since = monthStart(localToday(), 5);
  const rows: PurchaseOrderRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("outflow_date, order_lines, egg_totals")
      .eq("buyer_name", buyerName)
      .gte("outflow_date", since)
      .order("outflow_date")
      .order("recorded_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      rows.push({
        outflowDate: r.outflow_date as string,
        orderLines: (r.order_lines as unknown as PurchaseOrderRow["orderLines"]) ?? [],
        eggTotals: (r.egg_totals as unknown as PurchaseOrderRow["eggTotals"]) ?? [],
      });
    }
    if (!data || data.length < PAGE) return rows;
  }
}

export function usePurchaseOrders(buyerName: string | null | undefined) {
  return useQuery({
    queryKey: ["purchase_orders", buyerName],
    queryFn: () => fetchBuyerOrders(buyerName as string),
    enabled: !!buyerName,
  });
}

// Orders in the last 30 days + latest delivery date, per buyer name (list cards).
// ponytail: one unpaged request (~300 rows today); page like fetchBuyerOrders past 1000.
export function useBuyerOrderStats() {
  return useQuery({
    queryKey: ["purchase_orders", "stats30d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("buyer_name, outflow_date")
        .gte("outflow_date", addDays(localToday(), -29));
      if (error) throw error;
      const stats = new Map<string, { orders30d: number; lastOrderDate: string }>();
      for (const r of data ?? []) {
        if (!r.buyer_name || !r.outflow_date) continue;
        const s = stats.get(r.buyer_name) ?? { orders30d: 0, lastOrderDate: r.outflow_date };
        s.orders30d++;
        if (r.outflow_date > s.lastOrderDate) s.lastOrderDate = r.outflow_date;
        stats.set(r.buyer_name, s);
      }
      return stats;
    },
  });
}
