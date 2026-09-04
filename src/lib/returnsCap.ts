// How much of an order line can still be returned. `priorReturned` MUST be the sum
// of ALL prior returns.quantity for the outflow across BOTH dispositions
// (restock + writeoff), so this UI cap matches the server's cumulative cap in
// record_return (which counts every disposition). See
// docs/superpowers/plans/2026-09-04-returns-backend.md (Task 4).
export function remainingReturnable(outflowQty: number, priorReturned: number): number {
  return Math.max(0, outflowQty - priorReturned);
}
