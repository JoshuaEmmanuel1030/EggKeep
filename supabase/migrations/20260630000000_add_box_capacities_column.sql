-- Catalog-driven box capacities.
-- Adds a JSONB map (skuCode -> packsPerBox) to box rows of item_types, and backfills
-- the existing boxes from the values previously hardcoded in BOX_CAPACITIES
-- (src/lib/outflowCalculator.ts) so behavior is unchanged on day one.

ALTER TABLE public.item_types
  ADD COLUMN IF NOT EXISTS box_capacities jsonb;

-- Backfill: copy current hardcoded capacities verbatim.
UPDATE public.item_types
SET box_capacities = '{
  "N15B": 8, "N15O": 8,
  "N10B": 12, "N10O": 12,
  "N6B": 20, "N6O": 20,
  "KP10B": 14, "KP10O": 14,
  "KP6B": 20, "KP6O": 20,
  "P25": 15,
  "BK4AMTG": 20
}'::jsonb
WHERE category = 'box' AND name = 'box kecil';

UPDATE public.item_types
SET box_capacities = '{
  "N10B": 18, "N10O": 18,
  "KP6B": 20, "KP6O": 20
}'::jsonb
WHERE category = 'box' AND name = 'box osave';

UPDATE public.item_types
SET box_capacities = '{
  "N10B": 18, "N10O": 18
}'::jsonb
WHERE category = 'box' AND name = 'box osave polos';
