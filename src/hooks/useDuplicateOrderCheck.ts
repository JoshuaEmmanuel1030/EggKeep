import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DupOrderLine,
  DUPLICATE_WINDOW_MINUTES,
  findRefDuplicates,
  orderDuplicateKey,
  type RefCarrier,
} from "@/lib/duplicateOrder";

// An order the builder is about to submit, reduced to what identifies a duplicate.
export interface OrderToCheck {
  buyerName: string;
  outflowDate: string;
  orderLines: DupOrderLine[];
  dcId?: string;
  invoiceRef?: string;
}

// A previously-recorded order that matches one being submitted: "near" = same
// order recorded within the window; "ref" = its No. Faktur is already used by
// the PO named here (buyerName / outflowDate), any date.
export interface DuplicateMatch {
  kind: "near" | "ref";
  buyerName: string;
  outflowDate: string;
  minutesAgo: number;
  invoiceRef?: string;
}

const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// Live POs (the view excludes voided rows) carrying any of these refs, exact and
// case-insensitive, any date.
async function posWithRefs(refs: string[]): Promise<RefCarrier[]> {
  const out: RefCarrier[] = [];
  for (const ref of refs) {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("invoice_ref, buyer_name, outflow_date")
      .ilike("invoice_ref", likeExact(ref))
      .limit(5);
    if (error || !data) continue;
    for (const r of data) out.push({ invoiceRef: r.invoice_ref, buyerName: r.buyer_name ?? "", outflowDate: r.outflow_date ?? "" });
  }
  return out;
}

// Checks the orders being submitted against recently-recorded quick-outflow
// orders (same buyer + DC + delivery date + line signature, within the window).
// Best-effort: on any query error it returns [] so a lookup failure never
// blocks a real submission (the check only warns, it isn't a gate).
export function useDuplicateOrderCheck() {
  const check = useCallback(async (orders: OrderToCheck[]): Promise<DuplicateMatch[]> => {
    if (orders.length === 0) return [];
    const nowMs = Date.now();
    const cutoff = new Date(nowMs - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString();

    const { data, error } = await supabase
      .from("activity_logs")
      .select("recorded_at, metadata")
      .eq("action_type", "outflow")
      .is("voided_at", null)
      .gte("recorded_at", cutoff);

    const refs = [...new Set(orders.map((o) => (o.invoiceRef ?? "").trim()).filter(Boolean))];
    const refMatches: DuplicateMatch[] = findRefDuplicates(orders, refs.length ? await posWithRefs(refs) : []).map((m) => ({
      kind: "ref",
      buyerName: m.buyerName,
      outflowDate: m.outflowDate,
      minutesAgo: 0,
      invoiceRef: m.ref,
    }));

    if (error || !data) return refMatches;

    // Most-recent recorded_at per existing order key (rows repeat per line/entry).
    const recentByKey = new Map<string, string>();
    for (const row of data) {
      const m = (row.metadata ?? {}) as {
        orderType?: string;
        buyerName?: string;
        outflowDate?: string;
        orderLines?: DupOrderLine[];
        dcId?: string;
      };
      if (m.orderType !== "quick_outflow" || !m.buyerName || !m.outflowDate) continue;
      const key = orderDuplicateKey(m.buyerName, m.outflowDate, m.orderLines, m.dcId);
      const existing = recentByKey.get(key);
      if (!existing || row.recorded_at > existing) recentByKey.set(key, row.recorded_at);
    }

    const matches: DuplicateMatch[] = [];
    for (const o of orders) {
      const key = orderDuplicateKey(o.buyerName, o.outflowDate, o.orderLines, o.dcId);
      const recordedAt = recentByKey.get(key);
      if (recordedAt) {
        matches.push({
          kind: "near",
          buyerName: o.buyerName,
          outflowDate: o.outflowDate,
          minutesAgo: Math.max(0, Math.round((nowMs - new Date(recordedAt).getTime()) / 60_000)),
        });
      }
    }
    return [...matches, ...refMatches];
  }, []);

  return { check };
}
