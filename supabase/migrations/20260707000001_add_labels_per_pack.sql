-- Catalog-configurable labels-per-pack rate.
-- Adds a numeric rate to label rows of item_types: how many of this label are
-- deducted per pack when the label is selected on an order line.
-- NULL (unset) means the default rate of 1 — the previously hardcoded behavior
-- in src/lib/outflowCalculator.ts (labelPcs = packQty) — so no backfill is
-- needed and behavior is unchanged on day one.

ALTER TABLE public.item_types
  ADD COLUMN IF NOT EXISTS labels_per_pack numeric;
