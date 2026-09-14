// Duplicate-order detection for the quick-outflow builder.
//
// A single real order is often recorded twice — a double-tap, a page refresh
// mid-submit, or someone re-recording an order a colleague already entered.
// The record_order_outflows RPC is idempotent per client entry UUID, but a
// genuine re-entry generates NEW UUIDs, so it isn't caught there. This is a
// business-level near-duplicate check: same buyer + same order lines + same
// delivery date, recorded within a short window. Per the audit spec it FLAGS
// for review (a confirm dialog) — it never blocks, because two identical real
// orders can be legitimate.

export interface DupOrderLine {
  skuCode?: string | null;
  packQty?: number | null;
  eggProduct?: string | null;
  looseQty?: number | null;
}

// How recently a matching order must have been recorded to count as a possible
// duplicate. Deliberately a module constant, not a magic number in the query.
export const DUPLICATE_WINDOW_MINUTES = 15;

// Order-independent, empty-field-insensitive signature of an order's lines.
// Two orders with the same lines in any order produce the same signature.
export function orderLinesSignature(lines: DupOrderLine[] | null | undefined): string {
  return (lines ?? [])
    .map((l) => `${l.skuCode ?? ""}|${l.packQty ?? 0}|${l.eggProduct ?? ""}|${l.looseQty ?? 0}`)
    .sort()
    .join(";");
}

// Full match key: an order is a possible duplicate of another only when buyer,
// delivery date, AND line signature all agree.
export function orderDuplicateKey(
  buyerName: string,
  outflowDate: string,
  lines: DupOrderLine[] | null | undefined
): string {
  return `${buyerName} ${outflowDate} ${orderLinesSignature(lines)}`;
}
