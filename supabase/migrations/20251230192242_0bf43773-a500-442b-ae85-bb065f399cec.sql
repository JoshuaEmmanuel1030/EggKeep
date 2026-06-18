-- First, delete any existing records with NULL user_id (orphaned records)
DELETE FROM public.inflows WHERE user_id IS NULL;
DELETE FROM public.outflows WHERE user_id IS NULL;

-- Add NOT NULL constraints to prevent NULL user_id values
ALTER TABLE public.inflows ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.outflows ALTER COLUMN user_id SET NOT NULL;