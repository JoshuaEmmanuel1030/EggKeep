-- A pack SKU may carry its own eggs-per-kilo rate.
--
-- Weight-sold eggs deduct stock in kg, so a pack line converts its egg count
-- with the PRODUCT's eggs_per_unit. That assumes every bundle of a product is
-- packed from eggs of the same average size, which is not true: bundles packed
-- for one buyer can be deliberately filled with smaller eggs, so the same egg
-- count weighs less than the product average predicts. Converting those at the
-- product rate deducts more kilograms than left the warehouse.
--
-- Nullable with NO default, on purpose. A SKU with no value here keeps falling
-- through to item_types.eggs_per_unit exactly as before, so configuring one SKU
-- changes that SKU's arithmetic and nothing else. No backfill, and no value is
-- seeded here: the rate is a warehouse measurement, set in the Catalog UI.
--
-- Forward-only. inflows/outflows rows are written at entry time and never
-- recomputed, so stock already banked is untouched by setting this.
--
-- Box SKUs: resolveBoxLine() rewrites a box line to its base_pack_code before
-- the conversion, so a box SKU's own value is never read -- the base pack's
-- rate governs. That is the intended reading (a box holds that pack), but it
-- means a box cannot carry a rate differing from the pack it contains.

alter table public.pack_skus
  add column if not exists eggs_per_kg numeric;

comment on column public.pack_skus.eggs_per_kg is
  'Eggs per kg for THIS SKU''s bundles, overriding item_types.eggs_per_unit on outflow. Null = use the product rate.';

alter table public.pack_skus
  add constraint pack_skus_eggs_per_kg_positive
  check (eggs_per_kg is null or eggs_per_kg > 0);
