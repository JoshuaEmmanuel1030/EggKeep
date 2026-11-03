import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { fetchAllRows } from "@/hooks/usePurchaseOrders";
import { fetchReturnsForOutflows } from "@/hooks/usePriorReturns";
import { useItemTypes } from "@/hooks/useItemTypes";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { buildDeliveryItems, eggOutflowIdsOf, normalizeInvoiceRef, type DeliveryItemsResult } from "@/lib/deliveryFlags";
import { buildSkuEggMap } from "@/lib/returnLines";
import type { ReturnRow } from "@/lib/returnsSummary";
import type { PurchaseOrderLine } from "@/lib/buyerProfile";
import type { Delivery, DeliveryLine, DeliveryPo, DeliveryStatus } from "@/types/deliveries";

// Online-only (admin fills the log at the office). All reads are TanStack
// queries; the Activities chip uses a plain effect so the feed's component
// tests need no QueryClient.

type DeliveryRow = Database["public"]["Tables"]["deliveries"]["Row"];
type PoRow = Pick<
  Database["public"]["Views"]["purchase_orders"]["Row"],
  "buyer_name" | "dc_name" | "outflow_date" | "invoice_ref" | "order_lines" | "recorded_at" | "egg_totals"
>;

export const PO_COLUMNS = "buyer_name, dc_name, outflow_date, invoice_ref, order_lines, recorded_at, egg_totals";

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

// delivery_lines isn't in the generated types until they are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToLine(r: any): DeliveryLine {
  return {
    id: r.id,
    deliveryId: r.delivery_id,
    skuCode: r.sku_code,
    unitLabel: r.unit_label,
    piecesPerUnit: Number(r.pieces_per_unit),
    quantity: Number(r.quantity),
    reason: r.reason,
    note: r.note,
    claimRef: r.claim_ref,
    claimRefNorm: r.claim_ref_norm,
    expectedExpiry: r.expected_expiry,
    source: r.source,
    createdBy: r.created_by,
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
    // outflow_id: added to egg_totals in Phase 2; null on legacy rows.
    eggTotals: ((r.egg_totals as unknown as { product: string; quantity: number; outflow_id?: string | null }[]) ?? []).map(
      (e) => ({ product: e.product, quantity: Number(e.quantity), outflowId: e.outflow_id ?? null })
    ),
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

// Deliveries with their delivery lines embedded (the FK makes PostgREST join).
export async function fetchDeliveriesInRange(range: DateRange): Promise<{ deliveries: Delivery[]; lines: DeliveryLine[] }> {
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("deliveries")
      .select("*, delivery_lines(*)")
      .gte("delivery_date", range.from)
      .lte("delivery_date", range.to)
      .order("delivery_date", { ascending: false })
      .order("invoice_ref")
      .range(from, to)
  );
  return {
    deliveries: rows.map(rowToDelivery),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: rows.flatMap((r) => ((r as any).delivery_lines ?? []).map(rowToLine)),
  };
}

// buyers.requires_claim_ref by lower-cased name ("Perlu No. Retur": red flag).
async function fetchRequiresRef(): Promise<Record<string, boolean>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from as any)("buyers").select("name, requires_claim_ref");
  if (error) throw error;
  const m: Record<string, boolean> = {};
  for (const b of (data ?? []) as { name: string; requires_claim_ref: boolean }[]) {
    if (b.requires_claim_ref) m[b.name.trim().toLowerCase()] = true;
  }
  return m;
}

interface DeliveriesRaw {
  pos: DeliveryPo[];
  deliveries: Delivery[];
  lines: DeliveryLine[];
  returns: ReturnRow[];
  requiresRef: Record<string, boolean>;
}

// The /deliveries list: purchase_orders LEFT JOIN deliveries on the normalised
// invoice_ref for a delivery_date range, with their delivery lines, the
// non-voided returns on the POs' egg outflow rows and the line flags.
export function useDeliveries(range: DateRange) {
  const { conversionMap, boxCapacityMap } = useItemTypes();
  const { skus } = usePackSKUs();
  const query = useQuery<DeliveriesRaw>({
    queryKey: ["deliveries", range.from, range.to],
    queryFn: async () => {
      const [pos, { deliveries, lines }, requiresRef] = await Promise.all([
        fetchPosInRange(range),
        fetchDeliveriesInRange(range),
        fetchRequiresRef(),
      ]);
      const returns = await fetchReturnsForOutflows(pos.flatMap(eggOutflowIdsOf));
      return { pos, deliveries, lines, returns, requiresRef };
    },
    enabled: !!range.from && !!range.to && range.from <= range.to,
  });
  const raw = query.data;
  const data = useMemo<DeliveryItemsResult | undefined>(() => {
    if (!raw) return undefined;
    const unitByProduct: Record<string, string | undefined> = {};
    for (const [product, c] of Object.entries(conversionMap)) unitByProduct[product] = c.unit;
    return buildDeliveryItems(raw.pos, raw.deliveries, raw.lines, raw.returns, raw.requiresRef, unitByProduct, buildSkuEggMap(skus, boxCapacityMap));
  }, [raw, conversionMap, skus, boxCapacityMap]);
  return { ...query, data };
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
