import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PO_COLUMNS, fetchDeliveriesInRange, rowToPo } from "@/hooks/useDeliveries";
import { fetchAllRows } from "@/hooks/usePurchaseOrders";
import { addDays, localToday } from "@/lib/buyerProfile";
import { eggOutflowIdsOf } from "@/lib/deliveryFlags";
import type { OrderRow, StockCountRow } from "@/lib/insight";

export interface InsightOrder extends OrderRow {
  buyerName: string;
}

export interface InsightReturn {
  outflowId: string;
  product: string;
  disposition: "restock" | "retakan" | "writeoff";
  quantity: number;
  date: string;
}

export interface InsightDeduction {
  outflow_id: string;
  inflow_id: string;
  quantity_deducted: number;
}

// Long enough for the 8-week reliability card at the longest period.
const DELIVERY_LOG_DAYS = 120;

async function fetchInsightData() {
  // Every read pages past PostgREST's 1000-row cap. The tables tie-break on id
  // because created_at isn't unique; the purchase_orders view has no id, so its
  // sort runs through the columns that tell two orders apart.
  const [poRows, returnRows, deductions, countRows, log] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("purchase_orders")
        .select(PO_COLUMNS)
        .order("outflow_date")
        .order("recorded_at")
        .order("buyer_name")
        .order("invoice_ref")
        .order("dc_name")
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("returns") // not in the generated types yet
        .select("outflow_id, product, disposition, quantity, return_date")
        .is("voided_at", null)
        .order("created_at")
        .order("id")
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("fifo_deductions")
        .select("outflow_id, inflow_id, quantity_deducted")
        .order("created_at")
        .order("id")
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("stock_counts")
        .select("product, count_date, quantity, system_qty")
        .eq("location", "js_warehouse")
        .order("count_date")
        .order("id")
        .range(from, to)
    ),
    fetchDeliveriesInRange({ from: addDays(localToday(), -DELIVERY_LOG_DAYS), to: addDays(localToday(), 1) }),
  ]);

  const orders: InsightOrder[] = poRows
    .map(rowToPo)
    .filter((p) => p.buyerName && p.outflowDate)
    .map((p) => ({
      buyerName: p.buyerName,
      outflowDate: p.outflowDate,
      orderLines: p.orderLines,
      eggTotals: p.eggTotals,
      recordedAt: p.recordedAt,
      invoiceRef: p.invoiceRef,
      dcName: p.dcName,
      outflowIds: eggOutflowIdsOf(p),
    }));
  const returns: InsightReturn[] = (returnRows as { outflow_id: string; product: string; disposition: string; quantity: number; return_date: string }[]).map((r) => ({
    outflowId: r.outflow_id,
    product: r.product,
    disposition: r.disposition as InsightReturn["disposition"],
    quantity: Number(r.quantity),
    date: r.return_date,
  }));
  const counts: StockCountRow[] = countRows.map((r) => ({
    product: r.product,
    countDate: r.count_date,
    quantity: Number(r.quantity),
    systemQty: r.system_qty == null ? null : Number(r.system_qty),
  }));
  return { orders, returns, deductions: deductions as InsightDeduction[], counts, deliveries: log.deliveries, deliveryLines: log.lines };
}

export type InsightData = Awaited<ReturnType<typeof fetchInsightData>>;

// Read-only. Only runs while the Insight page is mounted (tablet, Insight tab).
export function useInsightData() {
  return useQuery({ queryKey: ["insight"], queryFn: fetchInsightData, staleTime: 5 * 60_000 });
}
