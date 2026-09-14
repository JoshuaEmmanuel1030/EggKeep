-- Defense-in-depth stock invariants on the inflow ledger.
--
-- remaining_butir is the per-batch on-hand projection, mutated only by the
-- row-locked RPCs (record_order_outflows deducts; record_return / void_outflow
-- restore, capped at what was deducted). By design it always stays within
-- [0, quantity_butir]. This constraint makes that a hard DB guarantee so NO code
-- path — a future bug, a manual SQL edit, a bad import — can silently drive stock
-- negative (oversell) or above the batch's intake (the historical inflation bug).
-- Verified 2026-09-14: 0 of 168 live rows violate either bound.
do $$ begin
  alter table public.inflows
    add constraint inflows_remaining_bounds
    check (remaining_butir >= 0 and remaining_butir <= quantity_butir);
exception when duplicate_object then null; end $$;
