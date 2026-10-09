import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ReturnsSummary {
  restock: number;
  retakan: number;
  writeoff: number;
  total: number;
}

export interface OutflowReturns extends ReturnsSummary {
  bySku: Record<string, ReturnsSummary>; // key "" for null sku_code
}

type Disposition = "restock" | "retakan" | "writeoff";

/**
 * Per-disposition sum of prior returns per outflow_id, so the return dialog can
 * cap each line to what's still returnable (reads `.total`) and the Activities
 * feed can show how much came back and in what condition. Returns {} until loaded.
 *
 * The `returns` table isn't in the generated Supabase types yet, hence the cast.
 */
export function usePriorReturns(
  outflowIds: (string | null | undefined)[]
): Record<string, OutflowReturns> {
  const [map, setMap] = useState<Record<string, OutflowReturns>>({});
  // Stable dependency key so the effect only re-runs when the id set changes.
  const key = Array.from(new Set(outflowIds.filter(Boolean) as string[])).sort().join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("returns")
        .select("outflow_id, quantity, disposition, sku_code")
        .in("outflow_id", ids);
      if (cancelled || error || !data) return;
      const next: Record<string, OutflowReturns> = {};
      for (const r of data as {
        outflow_id: string; quantity: number; disposition: Disposition; sku_code: string | null;
      }[]) {
        const o =
          next[r.outflow_id] ??
          (next[r.outflow_id] = { restock: 0, retakan: 0, writeoff: 0, total: 0, bySku: {} });
        const q = Number(r.quantity);
        o[r.disposition] += q;
        o.total += q;
        const skuKey = r.sku_code ?? "";
        const s = o.bySku[skuKey] ?? (o.bySku[skuKey] = { restock: 0, retakan: 0, writeoff: 0, total: 0 });
        s[r.disposition] += q;
        s.total += q;
      }
      setMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return map;
}
