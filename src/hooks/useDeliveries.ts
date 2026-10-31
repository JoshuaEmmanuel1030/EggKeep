import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllRows } from "@/hooks/usePurchaseOrders";
import { buildDeliveryItems, normalizeInvoiceRef, type DeliveryItemsResult } from "@/lib/deliveryFlags";
import type { PurchaseOrderLine } from "@/lib/buyerProfile";
import type { Delivery, DeliveryPo, DeliveryStatus } from "@/types/deliveries";

// Online-only (admin fills the log at the office). All reads are TanStack
// queries; the Activities chip uses a plain effect so the feed's component
// tests need no QueryClient.

type DeliveryRow = Database["public"]["Tables"]["deliveries"]["Row"];
type PoRow = Pick<
  Database["public"]["Views"]["purchase_orders"]["Row"],
  "buyer_name" | "dc_name" | "outflow_date" | "invoice_ref" | "order_lines" | "recorded_at"
>;

export const PO_COLUMNS = "buyer_name, dc_name, outflow_date, invoice_ref, order_lines, recorded_at";

export function rowToDelivery(r: DeliveryRow): Delivery {
  return {
    id: r.id,
    invoiceRef: r.invoice_ref,
    invoiceRefNorm: r.invoice_ref_norm || normalizeInvoiceRef(r.invoice_ref),
    buyerName: r.buyer_name,
    dcName: r.dc_name,
    deliveryDate: r.delivery_date,
    driverId: r.driver_id,
    driverName: r.driver_name,
    status: r.status as DeliveryStatus,
    invoiceReturnedAt: r.invoice_returned_at,
    invoiceCheckedBy: r.invoice_checked_by,
    pic: r.pic,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToPo(r: PoRow): DeliveryPo {
  return {
    invoiceRef: r.invoice_ref ?? "",
    buyerName: r.buyer_name ?? "",
    dcName: r.dc_name,
    outflowDate: r.outflow_date ?? "",
    recordedAt: r.recorded_at ?? "",
    orderLines: (r.order_lines as unknown as PurchaseOrderLine[]) ?? [],
  };
}

export interface DateRange {
  from: string; // yyyy-MM-dd, inclusive
  to: string; // yyyy-MM-dd, inclusive
}

async function fetchPosInRange(range: DateRange): Promise<DeliveryPo[]> {
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("purchase_orders")
      .select(PO_COLUMNS)
      .gte("outflow_date", range.from)
      .lte("outflow_date", range.to)
      .order("outflow_date", { ascending: false })
      .order("recorded_at")
      .range(from, to)
  );
  return rows.map(rowToPo);
}

export async function fetchDeliveriesInRange(range: DateRange): Promise<Delivery[]> {
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("deliveries")
      .select("*")
      .gte("delivery_date", range.from)
      .lte("delivery_date", range.to)
      .order("delivery_date", { ascending: false })
      .order("invoice_ref")
      .range(from, to)
  );
  return rows.map(rowToDelivery);
}

// The /deliveries list: purchase_orders LEFT JOIN deliveries on the normalised
// invoice_ref for a delivery_date range, with the Phase 1 flags.
export function useDeliveries(range: DateRange) {
  return useQuery<DeliveryItemsResult>({
    queryKey: ["deliveries", range.from, range.to],
    queryFn: async () => {
      const [pos, deliveries] = await Promise.all([fetchPosInRange(range), fetchDeliveriesInRange(range)]);
      return buildDeliveryItems(pos, deliveries);
    },
    enabled: !!range.from && !!range.to && range.from <= range.to,
  });
}

// Header / sidebar badge: distinct fakturs delivered but not back yet
// (open_delivery_items.invoice_not_back), across all dates, plus the oldest
// one's date so the badge can open a range that shows every counted faktur.
// Undefined while loading or when the view isn't there yet (migration not
// applied) — the badge simply stays hidden.
export interface OpenDeliveries {
  count: number;
  oldestDate: string | null; // yyyy-MM-dd
}

export function useOpenDeliveries(): OpenDeliveries | undefined {
  const { data } = useQuery({
    queryKey: ["open_delivery_items", "count"],
    queryFn: async (): Promise<OpenDeliveries> => {
      const { data, error } = await supabase
        .from("open_delivery_items")
        .select("invoice_ref_norm, delivery_date")
        .eq("invoice_not_back", true);
      if (error) throw error;
      const norms = new Set<string>();
      let oldestDate: string | null = null;
      for (const r of data ?? []) {
        norms.add(r.invoice_ref_norm ?? "");
        if (r.delivery_date && (oldestDate === null || r.delivery_date < oldestDate)) oldestDate = r.delivery_date;
      }
      return { count: norms.size, oldestDate };
    },
    staleTime: 30_000,
    retry: false,
  });
  return data;
}

const CHUNK = 100;

// Delivery status per normalised invoice_ref for the Activities order cards.
// `loaded` turns true after the first fetch so the chip doesn't flash
// "belum dicatat" before the answer is in. Same effect style as usePriorReturns.
export function useDeliveryStatuses(invoiceRefs: (string | null | undefined)[]): {
  statuses: Record<string, DeliveryStatus>;
  loaded: boolean;
} {
  const [state, setState] = useState<{ statuses: Record<string, DeliveryStatus>; loaded: boolean }>({
    statuses: {},
    loaded: false,
  });
  // Stable dependency key so the effect only re-runs when the ref set changes.
  const key = Array.from(new Set(invoiceRefs.map(normalizeInvoiceRef).filter(Boolean))).sort().join("\n");

  useEffect(() => {
    const norms = key ? key.split("\n") : [];
    if (norms.length === 0) {
      setState({ statuses: {}, loaded: true });
      return;
    }
    let cancelled = false;
    (async () => {
      const statuses: Record<string, DeliveryStatus> = {};
      try {
        for (let i = 0; i < norms.length; i += CHUNK) {
          const { data, error } = await supabase
            .from("deliveries")
            .select("invoice_ref_norm, status")
            .in("invoice_ref_norm", norms.slice(i, i + CHUNK));
          if (error) throw error;
          for (const r of data ?? []) statuses[r.invoice_ref_norm] = r.status as DeliveryStatus;
        }
      } catch (e) {
        console.error("Error fetching delivery statuses:", e);
        return; // keep the chips hidden rather than wrongly "belum dicatat"
      }
      if (!cancelled) setState({ statuses, loaded: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}
