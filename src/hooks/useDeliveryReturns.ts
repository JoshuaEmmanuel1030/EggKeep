import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchReturnsForOutflows, priorReturnsKey } from "@/hooks/usePriorReturns";
import { callRecordReturn, callVoidReturn, type ReturnSubmitResult } from "@/lib/returnRpc";
import { summarizeReturns, type OutflowReturns, type ReturnRow } from "@/lib/returnsSummary";
import type { RecordReturnInput } from "@/types/returns";

// The rows one record_return call wrote for one outflow row and SKU (same
// outflow_id, sku_code, created_at). Riwayat retur lists these; void_return
// voids one as a whole.
export interface SaveGroup {
  key: string;
  outflowId: string;
  skuCode: string | null;
  createdAt: string;
  userId: string;
  userEmail: string | null;
  returnDate: string;
  reason: string | null;
  rows: ReturnRow[];
  voided: boolean;
}

export function groupSaveGroups(rows: ReturnRow[]): SaveGroup[] {
  const m = new Map<string, SaveGroup>();
  for (const r of rows) {
    const key = `${r.outflow_id}|${r.sku_code ?? ""}|${r.created_at}`;
    const g =
      m.get(key) ??
      m
        .set(key, {
          key,
          outflowId: r.outflow_id,
          skuCode: r.sku_code,
          createdAt: r.created_at,
          userId: r.user_id,
          userEmail: r.user_email,
          returnDate: r.return_date,
          reason: r.reason,
          rows: [],
          voided: true,
        })
        .get(key)!;
    g.rows.push(r);
    if (!r.voided_at) g.voided = false;
  }
  return [...m.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Every return on the faktur's egg outflow rows, voided included (Riwayat retur),
// plus the non-voided summary the caps use. Online-only: no outbox.
export function useDeliveryReturns(eggOutflowIds: string[]) {
  const queryClient = useQueryClient();
  const key = priorReturnsKey(eggOutflowIds);
  const query = useQuery<ReturnRow[]>({
    queryKey: key,
    queryFn: () => fetchReturnsForOutflows(eggOutflowIds, { includeVoided: true }),
    enabled: eggOutflowIds.length > 0,
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const summary = useMemo<Record<string, OutflowReturns>>(() => summarizeReturns(rows), [rows]);
  const saveGroups = useMemo(() => groupSaveGroups(rows), [rows]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
    ]);

  // "Coba lagi" resends the same input (same entry ids, same expected_prior):
  // record_return skips entries that already exist.
  const record = async (input: RecordReturnInput): Promise<ReturnSubmitResult> => {
    const res = await callRecordReturn(input);
    if (res.ok || res.kind === "server") await refresh();
    return res;
  };

  const voidSaveGroup = async (rowId: string, reason: string): Promise<ReturnSubmitResult> => {
    const res = await callVoidReturn(rowId, reason);
    await refresh();
    return res;
  };

  return { ...query, rows, summary, saveGroups, record, voidSaveGroup, refresh };
}
