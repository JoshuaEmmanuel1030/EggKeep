import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DupOrderLine,
  DUPLICATE_WINDOW_MINUTES,
  orderDuplicateKey,
} from "@/lib/duplicateOrder";

// An order the builder is about to submit, reduced to what identifies a duplicate.
export interface OrderToCheck {
  buyerName: string;
  outflowDate: string;
  orderLines: DupOrderLine[];
}

// A previously-recorded order that matches one being submitted.
export interface DuplicateMatch {
  buyerName: string;
  outflowDate: string;
  minutesAgo: number;
}

// Checks the orders being submitted against recently-recorded quick-outflow
// orders (same buyer + delivery date + line signature, within the window).
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

    if (error || !data) return [];

    // Most-recent recorded_at per existing order key (rows repeat per line/entry).
    const recentByKey = new Map<string, string>();
    for (const row of data) {
      const m = (row.metadata ?? {}) as {
        orderType?: string;
        buyerName?: string;
        outflowDate?: string;
        orderLines?: DupOrderLine[];
      };
      if (m.orderType !== "quick_outflow" || !m.buyerName || !m.outflowDate) continue;
      const key = orderDuplicateKey(m.buyerName, m.outflowDate, m.orderLines);
      const existing = recentByKey.get(key);
      if (!existing || row.recorded_at > existing) recentByKey.set(key, row.recorded_at);
    }

    const matches: DuplicateMatch[] = [];
    for (const o of orders) {
      const key = orderDuplicateKey(o.buyerName, o.outflowDate, o.orderLines);
      const recordedAt = recentByKey.get(key);
      if (recordedAt) {
        matches.push({
          buyerName: o.buyerName,
          outflowDate: o.outflowDate,
          minutesAgo: Math.max(0, Math.round((nowMs - new Date(recordedAt).getTime()) / 60_000)),
        });
      }
    }
    return matches;
  }, []);

  return { check };
}
