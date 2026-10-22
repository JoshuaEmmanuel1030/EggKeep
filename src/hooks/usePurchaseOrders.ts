import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PurchaseOrderRow, addDays, localToday, monthStart } from "@/lib/buyerProfile";

const PAGE = 1000; // PostgREST max rows per request

// Pages an (ordered) query past the 1000-row cap so counts never silently undercount.
async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// A buyer's Purchase Orders (one row per order, from the purchase_orders view)
// for the current month + 5 previous. Paged so insights never undercount.
async function fetchBuyerOrders(buyerName: string): Promise<PurchaseOrderRow[]> {
  const since = monthStart(localToday(), 5);
  const data = await fetchAllRows((from, to) =>
    supabase
      .from("purchase_orders")
      .select("outflow_date, order_lines, egg_totals")
      .eq("buyer_name", buyerName)
      .gte("outflow_date", since)
      .order("outflow_date")
      .order("recorded_at")
      .range(from, to)
  );
  return data.map((r) => ({
    outflowDate: r.outflow_date as string,
    orderLines: (r.order_lines as unknown as PurchaseOrderRow["orderLines"]) ?? [],
    eggTotals: (r.egg_totals as unknown as PurchaseOrderRow["eggTotals"]) ?? [],
  }));
}

export function usePurchaseOrders(buyerName: string | null | undefined) {
  return useQuery({
    queryKey: ["purchase_orders", buyerName],
    queryFn: () => fetchBuyerOrders(buyerName as string),
    enabled: !!buyerName,
  });
}

// Orders in the last 30 days + latest delivery date, per buyer name (list cards).
export function useBuyerOrderStats() {
  return useQuery({
    queryKey: ["purchase_orders", "stats30d"],
    queryFn: async () => {
      const since = addDays(localToday(), -29);
      const data = await fetchAllRows((from, to) =>
        supabase
          .from("purchase_orders")
          .select("buyer_name, outflow_date")
          .gte("outflow_date", since)
          .order("outflow_date")
          .order("recorded_at")
          .range(from, to)
      );
      const stats = new Map<string, { orders30d: number; lastOrderDate: string }>();
      for (const r of data) {
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
