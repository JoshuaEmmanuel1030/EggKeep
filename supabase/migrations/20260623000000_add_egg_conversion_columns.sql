-- Make egg unit conversions catalog-driven.
-- Adds unit + eggs_per_unit to item_types so each egg type carries its own
-- kg->butir factor, instead of relying on the hardcoded CONVERSION_DICT in code.
-- Non-egg categories (box/label/packaging) are always counted in pcs and leave
-- these columns null.

ALTER TABLE public.item_types
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS eggs_per_unit numeric;

-- Optional guard: a 'kg' egg must have a positive factor. 'btr' eggs are 1:1.
ALTER TABLE public.item_types
  DROP CONSTRAINT IF EXISTS item_types_unit_check;
ALTER TABLE public.item_types
  ADD CONSTRAINT item_types_unit_check
  CHECK (unit IS NULL OR unit IN ('kg', 'btr'));

-- Backfill the canonical eggs from the current CONVERSION_DICT values so nothing
-- recalculates differently. Idempotent — safe to re-run.
UPDATE public.item_types SET unit = 'kg', eggs_per_unit = 15.5
  WHERE category = 'egg' AND name IN ('NEGERI BIASA', 'NEGERI OMEGA');

UPDATE public.item_types SET unit = 'btr', eggs_per_unit = 1
  WHERE category = 'egg'
    AND name IN (
      'KAMPUNG BIASA', 'KAMPUNG MERAH', 'BEBEK TAWAR',
      'ASIN MATENG', 'ASIN MENTAH', 'PUYUH', 'KUNING MANIK'
    );
