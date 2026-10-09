// How much of an order line can still be returned. `priorReturned` MUST be the sum
// of ALL prior returns.quantity for the outflow across ALL dispositions
// (restock + retakan + writeoff), so this UI cap matches the server's cumulative cap
// in record_return (which counts every disposition). See
// docs/superpowers/plans/2026-09-04-returns-backend.md (Task 4).
export function remainingReturnable(outflowQty: number, priorReturned: number): number {
  return Math.max(0, outflowQty - priorReturned);
}

// Negeri (kg-native eggs) are counted back in pieces and converted to kg at a
// flat 15.5 pieces/kg (owner's rule — not the per-product catalog factor).
export const NEGERI_PIECES_PER_KG = 15.5;

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Pieces entered by the user -> the product's native stock unit.
export function piecesToNative(pieces: number, unit: string | undefined): number {
  return unit === "kg" ? round2(pieces / NEGERI_PIECES_PER_KG) : pieces;
}

// Native remaining/sold -> pieces, for showing caps in the entry unit.
export function nativeToPieces(native: number, unit: string | undefined): number {
  return unit === "kg" ? Math.round(native * NEGERI_PIECES_PER_KG) : native;
}
