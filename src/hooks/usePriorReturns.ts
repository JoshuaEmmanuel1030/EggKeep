import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RETURN_ROW_COLUMNS, summarizeReturns, type OutflowReturns, type ReturnRow } from "@/lib/returnsSummary";

export type { ReturnsSummary, OutflowReturns, ReturnRow } from "@/lib/returnsSummary";

// Query key for a set of outflow ids (react-query readers on /deliveries).
export const priorReturnsKey = (ids: string[]) => ["prior-returns", [...new Set(ids)].sort()] as const;

// `returns` rows for these outflow rows, chunked by 100 ids. Non-voided only
// unless includeVoided (Riwayat retur, and the anyReturns flag).
export async function fetchReturnsForOutflows(ids: string[], opts?: { includeVoided?: boolean }): Promise<ReturnRow[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows: ReturnRow[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from as any)("returns").select(RETURN_ROW_COLUMNS).in("outflow_id", unique.slice(i, i + 100));
    if (!opts?.includeVoided) q = q.is("voided_at", null);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...((data ?? []) as ReturnRow[]));
  }
  return rows;
}

/**
 * Per-disposition sum of prior non-voided returns per outflow_id, so the return
 * dialog can cap each line to what's still returnable (reads `.total`) and the
 * Activities feed can show how much came back and in what condition. Returns {}
 * until loaded. `anyReturns` also counts voided rows.
 */
export function usePriorReturns(
  outflowIds: (string | null | undefined)[],
  // Bump this to force a refetch (e.g. right after a return is recorded) — the
  // id set is unchanged by a new return, so without it the feed wouldn't update.
  refreshToken?: number
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
    fetchReturnsForOutflows(ids, { includeVoided: true })
      .then((rows) => {
        if (!cancelled) setMap(summarizeReturns(rows));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, refreshToken]);

  return map;
}
