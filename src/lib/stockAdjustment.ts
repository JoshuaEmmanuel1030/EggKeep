// Penyesuaian Stok Fisik: thin wrappers over the two RPCs in
// supabase/migrations/20261112000000_stock_adjustments.sql. All the arithmetic is
// server-side; the client only shows the preview and sends back the deltas it
// showed, so the server can refuse a stale confirm (PREVIEW_STALE).
import { supabase } from "@/integrations/supabase/client";

/** Typed to confirm. Fixed, not translated. */
export const CONFIRM_WORD = "SESUAIKAN";

/** One line of stock_count_adjustment_preview(), in the product's native unit. */
export interface AdjustmentLine {
  item_type_id: string;
  product: string;
  unit: string | null;
  physical_js: number;
  physical_loaded: number;
  target: number;
  book_at_count: number;
  book_now: number;
  delta: number;
  applied: number;
  shortfall: number;
}

export type AdjustmentErrorCode = "PREVIEW_STALE" | "NOTHING_TO_ADJUST" | "NOT_ADMIN" | "NO_COUNT_TODAY";
const CODES: AdjustmentErrorCode[] = ["PREVIEW_STALE", "NOTHING_TO_ADJUST", "NOT_ADMIN", "NO_COUNT_TODAY"];

/** The RPC raises "<CODE>: message"; anything else is an unexpected failure. */
export function adjustmentErrorCode(err: unknown): AdjustmentErrorCode | null {
  const msg = (err as { message?: string } | null)?.message ?? "";
  return CODES.find((c) => msg.startsWith(c)) ?? null;
}

const NUMERIC = ["physical_js", "physical_loaded", "target", "book_at_count", "book_now", "delta", "applied", "shortfall"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPCs are not in the generated types (repo pattern)
const rpc = supabase.rpc as any;

export async function fetchAdjustmentPreview(): Promise<AdjustmentLine[]> {
  const { data, error } = await rpc("stock_count_adjustment_preview");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const line = { ...r } as unknown as AdjustmentLine;
    for (const k of NUMERIC) line[k] = Number(r[k] ?? 0);
    return line;
  });
}

export async function applyAdjustment(lines: AdjustmentLine[]): Promise<void> {
  const { error } = await rpc("apply_stock_count_adjustment", {
    p_expected: lines.map((l) => ({ item_type_id: l.item_type_id, delta: l.delta, applied: l.applied })),
  });
  if (error) throw error;
}
