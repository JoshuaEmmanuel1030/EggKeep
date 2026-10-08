import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ReturnsSummary {
  restock: number;
  retakan: number;
  writeoff: number;
  total: number;
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
): Record<string, ReturnsSummary> {
  const [map, setMap] = useState<Record<string, ReturnsSummary>>({});
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
        .select("outflow_id, quantity, disposition")
        .in("outflow_id", ids);
      if (cancelled || error || !data) return;
      const next: Record<string, ReturnsSummary> = {};
      for (const r of data as { outflow_id: string; quantity: number; disposition: Disposition }[]) {
        const s =
          next[r.outflow_id] ??
          (next[r.outflow_id] = { restock: 0, retakan: 0, writeoff: 0, total: 0 });
        const q = Number(r.quantity);
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
