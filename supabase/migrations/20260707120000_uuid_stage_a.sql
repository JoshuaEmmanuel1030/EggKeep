-- UUID migration STAGE A — APPLIED to prod 2026-07-07 via MCP apply_migration
-- (name: uuid_stage_a_columns_backfill_triggers). This file is the repo record.
-- Companion plan: docs/uuid-migration/PLAN.md. Invisible to the app: names remain
-- the operational key until Stage C; ids are backfilled and auto-resolved.
--
-- Context at apply time: transaction tables freshly truncated; catalog renamed to
-- canonical form first (packaging ALL CAPS; label 'kampung isi 10' -> 'Kampung 10'),
-- so the backfill ran against final names with zero orphans.

-- PART 1: columns
ALTER TABLE public.inflows  ADD COLUMN IF NOT EXISTS item_type_id uuid;
ALTER TABLE public.outflows ADD COLUMN IF NOT EXISTS item_type_id uuid;
ALTER TABLE public.pack_skus
  ADD COLUMN IF NOT EXISTS egg_item_type_id uuid,
  ADD COLUMN IF NOT EXISTS packaging_item_type_id uuid;

-- PART 2: backfill by (category, name), preferring live catalog rows
WITH resolved AS (
  SELECT DISTINCT ON (category, name) id, category, name
  FROM item_types
  ORDER BY category, name, (deleted_at IS NULL) DESC, created_at ASC
)
UPDATE public.inflows f SET item_type_id = r.id
FROM resolved r
WHERE f.item_type_id IS NULL AND r.category = f.category AND r.name = f.product;

WITH resolved AS (
  SELECT DISTINCT ON (category, name) id, category, name
  FROM item_types
  ORDER BY category, name, (deleted_at IS NULL) DESC, created_at ASC
)
UPDATE public.outflows o SET item_type_id = r.id
FROM resolved r
WHERE o.item_type_id IS NULL AND r.category = o.category AND r.name = o.product;

WITH resolved AS (
  SELECT DISTINCT ON (name) id, name FROM item_types
  WHERE category = 'egg'
  ORDER BY name, (deleted_at IS NULL) DESC, created_at ASC
)
UPDATE public.pack_skus s SET egg_item_type_id = r.id
FROM resolved r
WHERE s.egg_item_type_id IS NULL AND r.name = s.egg_product;

WITH resolved AS (
  SELECT DISTINCT ON (name) id, name FROM item_types
  WHERE category = 'packaging'
  ORDER BY name, (deleted_at IS NULL) DESC, created_at ASC
)
UPDATE public.pack_skus s SET packaging_item_type_id = r.id
FROM resolved r
WHERE s.packaging_item_type_id IS NULL AND s.packaging_item IS NOT NULL AND r.name = s.packaging_item;

-- PART 3: FKs (NOT VALID -> VALIDATE) + indexes
ALTER TABLE public.inflows
  ADD CONSTRAINT inflows_item_type_id_fkey
  FOREIGN KEY (item_type_id) REFERENCES public.item_types(id) NOT VALID;
ALTER TABLE public.inflows VALIDATE CONSTRAINT inflows_item_type_id_fkey;

ALTER TABLE public.outflows
  ADD CONSTRAINT outflows_item_type_id_fkey
  FOREIGN KEY (item_type_id) REFERENCES public.item_types(id) NOT VALID;
ALTER TABLE public.outflows VALIDATE CONSTRAINT outflows_item_type_id_fkey;

ALTER TABLE public.pack_skus
  ADD CONSTRAINT pack_skus_egg_item_type_id_fkey
  FOREIGN KEY (egg_item_type_id) REFERENCES public.item_types(id) NOT VALID;
ALTER TABLE public.pack_skus VALIDATE CONSTRAINT pack_skus_egg_item_type_id_fkey;

ALTER TABLE public.pack_skus
  ADD CONSTRAINT pack_skus_packaging_item_type_id_fkey
  FOREIGN KEY (packaging_item_type_id) REFERENCES public.item_types(id) NOT VALID;
ALTER TABLE public.pack_skus VALIDATE CONSTRAINT pack_skus_packaging_item_type_id_fkey;

CREATE INDEX IF NOT EXISTS idx_inflows_item_type_live
  ON public.inflows (item_type_id, date, created_at)
  WHERE voided_at IS NULL AND remaining_butir > 0;

CREATE INDEX IF NOT EXISTS idx_outflows_item_type
  ON public.outflows (item_type_id);

-- PART 4: resolver triggers (stale-client defense: name-only inserts get their
-- id filled server-side; NULL is left as-is — enforcement is Stage D)
CREATE OR REPLACE FUNCTION public.resolve_item_type_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.item_type_id IS NULL AND NEW.product IS NOT NULL THEN
    SELECT id INTO NEW.item_type_id
    FROM item_types
    WHERE category = NEW.category AND name = NEW.product
    ORDER BY (deleted_at IS NULL) DESC, created_at ASC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inflows_resolve_item_type ON public.inflows;
CREATE TRIGGER trg_inflows_resolve_item_type
  BEFORE INSERT ON public.inflows
  FOR EACH ROW EXECUTE FUNCTION public.resolve_item_type_id();

DROP TRIGGER IF EXISTS trg_outflows_resolve_item_type ON public.outflows;
CREATE TRIGGER trg_outflows_resolve_item_type
  BEFORE INSERT ON public.outflows
  FOR EACH ROW EXECUTE FUNCTION public.resolve_item_type_id();

CREATE OR REPLACE FUNCTION public.resolve_pack_sku_item_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.egg_item_type_id IS NULL AND NEW.egg_product IS NOT NULL THEN
    SELECT id INTO NEW.egg_item_type_id
    FROM item_types
    WHERE category = 'egg' AND name = NEW.egg_product
    ORDER BY (deleted_at IS NULL) DESC, created_at ASC
    LIMIT 1;
  END IF;
  IF NEW.packaging_item_type_id IS NULL AND NEW.packaging_item IS NOT NULL THEN
    SELECT id INTO NEW.packaging_item_type_id
    FROM item_types
    WHERE category = 'packaging' AND name = NEW.packaging_item
    ORDER BY (deleted_at IS NULL) DESC, created_at ASC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pack_skus_resolve_item_types ON public.pack_skus;
CREATE TRIGGER trg_pack_skus_resolve_item_types
  BEFORE INSERT OR UPDATE OF egg_product, packaging_item ON public.pack_skus
  FOR EACH ROW EXECUTE FUNCTION public.resolve_pack_sku_item_types();

-- Trigger functions must not be directly callable via the API
REVOKE EXECUTE ON FUNCTION public.resolve_item_type_id() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.resolve_pack_sku_item_types() FROM anon, authenticated, public;
