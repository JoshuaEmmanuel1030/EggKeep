import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sum of all prior returns.quantity per outflow_id (across ALL dispositions),
 * so the return dialog can cap each line to what's actually still returnable —
 * matching the server's cumulative cap in record_return. Returns {} until loaded.
 *
 * The `returns` table isn't in the generated Supabase types yet (same reason
 * useRecordReturn casts the RPC), hence the `from` cast.
 */
export function usePriorReturns(outflowIds: (string | null | undefined)[]): Record<string, number> {
  const [map, setMap] = useState<Record<string, number>>({});
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
        .select("outflow_id, quantity")
        .in("outflow_id", ids);
      if (cancelled || error || !data) return;
      const next: Record<string, number> = {};
      for (const r of data as { outflow_id: string; quantity: number }[]) {
        next[r.outflow_id] = (next[r.outflow_id] ?? 0) + Number(r.quantity);
      }
      setMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return map;
}
