// O/R/H sums of `returns` rows per outflow row and per SKU. Pure, shared by
// usePriorReturns (feed bubbles, dialog cap) and the /deliveries page.
// Voided rows never count; `anyReturns` still sees them (the Edit pesanan guard
// must match correct_order's HAS_RETURNS, which counts voided returns too).
import type { ReturnDisposition } from "@/types/returns";

export interface ReturnsSummary {
  restock: number;
  retakan: number;
  writeoff: number;
  total: number;
}

export interface OutflowReturns extends ReturnsSummary {
  bySku: Record<string, ReturnsSummary>; // key "" for null sku_code
  anyReturns: boolean;
}

// The selected columns of a `returns` row.
export interface ReturnRow {
  id: string;
  outflow_id: string;
  sku_code: string | null;
  product: string;
  category: string;
  quantity: number;
  disposition: ReturnDisposition;
  reason: string | null;
  return_date: string;
  created_at: string;
  user_id: string;
  user_email: string | null;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
}

export const RETURN_ROW_COLUMNS =
  "id, outflow_id, sku_code, product, category, quantity, disposition, reason, return_date, created_at, user_id, user_email, voided_at, void_reason, voided_by";

const emptySummary = (): ReturnsSummary => ({ restock: 0, retakan: 0, writeoff: 0, total: 0 });

export function summarizeReturns(rows: Pick<ReturnRow, "outflow_id" | "quantity" | "disposition" | "sku_code" | "voided_at">[]): Record<string, OutflowReturns> {
  const next: Record<string, OutflowReturns> = {};
  for (const r of rows) {
    const o = next[r.outflow_id] ?? (next[r.outflow_id] = { ...emptySummary(), bySku: {}, anyReturns: false });
    o.anyReturns = true;
    if (r.voided_at) continue;
    const q = Number(r.quantity);
    o[r.disposition] += q;
    o.total += q;
    const s = o.bySku[r.sku_code ?? ""] ?? (o.bySku[r.sku_code ?? ""] = emptySummary());
    s[r.disposition] += q;
    s.total += q;
  }
  return next;
}
