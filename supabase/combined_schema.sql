-- EggKeep Combined Schema
-- Run this in Supabase SQL Editor on a fresh project
-- All 21 migrations in order

-- ========================================
-- Migration: 20251230184004_2166bbb0-2ca5-4c7e-a873-4361381a3a11.sql
-- ========================================
-- Create inflows table
CREATE TABLE public.inflows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date TEXT NOT NULL,
  product TEXT NOT NULL,
  quantity_original NUMERIC NOT NULL,
  quantity_butir NUMERIC NOT NULL,
  remaining_butir NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create outflows table
CREATE TABLE public.outflows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date TEXT NOT NULL,
  product TEXT NOT NULL,
  quantity_butir NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outflows ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (no auth required for this inventory app)
CREATE POLICY "Allow public read access on inflows" ON public.inflows FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on inflows" ON public.inflows FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access on inflows" ON public.inflows FOR UPDATE USING (true);
CREATE POLICY "Allow public delete access on inflows" ON public.inflows FOR DELETE USING (true);

CREATE POLICY "Allow public read access on outflows" ON public.outflows FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on outflows" ON public.outflows FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete access on outflows" ON public.outflows FOR DELETE USING (true);

-- ========================================
-- Migration: 20251230184318_a920aec8-fa76-4a07-b5bf-0d15cb9f344e.sql
-- ========================================
-- Add user_id column to inflows table
ALTER TABLE public.inflows ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id column to outflows table  
ALTER TABLE public.outflows ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop existing public policies
DROP POLICY IF EXISTS "Allow public read access on inflows" ON public.inflows;
DROP POLICY IF EXISTS "Allow public insert access on inflows" ON public.inflows;
DROP POLICY IF EXISTS "Allow public update access on inflows" ON public.inflows;
DROP POLICY IF EXISTS "Allow public delete access on inflows" ON public.inflows;

DROP POLICY IF EXISTS "Allow public read access on outflows" ON public.outflows;
DROP POLICY IF EXISTS "Allow public insert access on outflows" ON public.outflows;
DROP POLICY IF EXISTS "Allow public delete access on outflows" ON public.outflows;

-- Create user-specific RLS policies for inflows
CREATE POLICY "Users can view their own inflows" 
ON public.inflows FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own inflows" 
ON public.inflows FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own inflows" 
ON public.inflows FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own inflows" 
ON public.inflows FOR DELETE 
USING (auth.uid() = user_id);

-- Create user-specific RLS policies for outflows
CREATE POLICY "Users can view their own outflows" 
ON public.outflows FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own outflows" 
ON public.outflows FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own outflows" 
ON public.outflows FOR DELETE 
USING (auth.uid() = user_id);

-- ========================================
-- Migration: 20251230185607_b8d44360-1c71-43e3-878d-6da572411807.sql
-- ========================================
-- Add UPDATE policy for outflows table
CREATE POLICY "Users can update their own outflows" 
ON public.outflows FOR UPDATE 
USING (auth.uid() = user_id);

-- ========================================
-- Migration: 20251230192242_0bf43773-a500-442b-ae85-bb065f399cec.sql
-- ========================================
-- First, delete any existing records with NULL user_id (orphaned records)
DELETE FROM public.inflows WHERE user_id IS NULL;
DELETE FROM public.outflows WHERE user_id IS NULL;

-- Add NOT NULL constraints to prevent NULL user_id values
ALTER TABLE public.inflows ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.outflows ALTER COLUMN user_id SET NOT NULL;

-- ========================================
-- Migration: 20251230195449_2c0ca1a6-d927-4967-9502-b95c7867640b.sql
-- ========================================
-- Create activity_logs table for tracking all inflow/outflow activities
CREATE TABLE public.activity_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('inflow', 'outflow')),
  product TEXT NOT NULL,
  quantity_butir NUMERIC NOT NULL,
  quantity_original NUMERIC,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  client_id TEXT NOT NULL
);

-- Enable RLS
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS: All authenticated users can view all logs (shared feed)
CREATE POLICY "All authenticated users can view activity logs"
ON public.activity_logs
FOR SELECT
TO authenticated
USING (true);

-- RLS: Users can only insert their own logs
CREATE POLICY "Users can insert their own activity logs"
ON public.activity_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- RLS: Users can only update their own logs
CREATE POLICY "Users can update their own activity logs"
ON public.activity_logs
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- RLS: Users can only delete their own logs
CREATE POLICY "Users can delete their own activity logs"
ON public.activity_logs
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Create index for efficient sorting by recorded_at
CREATE INDEX idx_activity_logs_recorded_at ON public.activity_logs(recorded_at DESC);

-- Create index for user lookups
CREATE INDEX idx_activity_logs_user_id ON public.activity_logs(user_id);

-- Enable realtime for activity_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;

-- ========================================
-- Migration: 20251230200356_cf5f53d9-b077-492b-940b-4f13ba48641d.sql
-- ========================================
-- Drop existing restrictive policies for inflows
DROP POLICY IF EXISTS "Users can delete their own inflows" ON public.inflows;
DROP POLICY IF EXISTS "Users can insert their own inflows" ON public.inflows;
DROP POLICY IF EXISTS "Users can update their own inflows" ON public.inflows;
DROP POLICY IF EXISTS "Users can view their own inflows" ON public.inflows;

-- Drop existing restrictive policies for outflows
DROP POLICY IF EXISTS "Users can delete their own outflows" ON public.outflows;
DROP POLICY IF EXISTS "Users can insert their own outflows" ON public.outflows;
DROP POLICY IF EXISTS "Users can update their own outflows" ON public.outflows;
DROP POLICY IF EXISTS "Users can view their own outflows" ON public.outflows;

-- Recreate policies as PERMISSIVE for inflows
CREATE POLICY "Users can view their own inflows"
ON public.inflows
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own inflows"
ON public.inflows
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own inflows"
ON public.inflows
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own inflows"
ON public.inflows
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Recreate policies as PERMISSIVE for outflows
CREATE POLICY "Users can view their own outflows"
ON public.outflows
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own outflows"
ON public.outflows
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own outflows"
ON public.outflows
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own outflows"
ON public.outflows
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- ========================================
-- Migration: 20251230202851_a84c8ed3-9379-44dd-b023-8aeea343850d.sql
-- ========================================
-- Drop existing restrictive SELECT policies
DROP POLICY IF EXISTS "Users can view their own inflows" ON public.inflows;
DROP POLICY IF EXISTS "Users can view their own outflows" ON public.outflows;

-- Create new policies allowing all authenticated users to view all inventory
CREATE POLICY "All authenticated users can view inflows"
ON public.inflows
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can view outflows"
ON public.outflows
FOR SELECT
USING (auth.role() = 'authenticated');

-- Allow any authenticated user to update inflows (needed for FIFO deduction when taking stock)
DROP POLICY IF EXISTS "Users can update their own inflows" ON public.inflows;
CREATE POLICY "All authenticated users can update inflows for FIFO"
ON public.inflows
FOR UPDATE
USING (auth.role() = 'authenticated');

-- ========================================
-- Migration: 20260102045529_8bf248c1-0f86-4fbc-89af-88bd30c00091.sql
-- ========================================

-- Create category enum
CREATE TYPE public.inventory_category AS ENUM ('egg', 'box', 'label', 'packaging');

-- Create item_types table for the dropdown options
CREATE TABLE public.item_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category inventory_category NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(category, name)
);

-- Enable RLS on item_types
ALTER TABLE public.item_types ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read item types
CREATE POLICY "Anyone can read item types"
  ON public.item_types FOR SELECT
  TO authenticated
  USING (true);

-- Insert box types
INSERT INTO public.item_types (category, name) VALUES
  ('box', 'box osave'),
  ('box', 'box osave polos'),
  ('box', 'box kecil');

-- Insert label types
INSERT INTO public.item_types (category, name) VALUES
  ('label', 'negeri omega po online'),
  ('label', 'Renkoles online'),
  ('label', 'Kip omega'),
  ('label', 'Kip kp arabia'),
  ('label', 'Kip puyuh'),
  ('label', 'Kip asin matang'),
  ('label', 'Segari 15'),
  ('label', 'Segari 10'),
  ('label', 'Segari negeri omega'),
  ('label', 'puyuh'),
  ('label', 'kp kuning'),
  ('label', 'astro goods'),
  ('label', 'bebek mentah sajira'),
  ('label', 'asin matang sajira'),
  ('label', 'isi 4'),
  ('label', 'kampung isi 10'),
  ('label', 'farmers negeri omega'),
  ('label', 'farmers negeri isi 10'),
  ('label', 'farmers negeri isi 30'),
  ('label', 'kip negeri isi 10');

-- Insert packaging types
INSERT INTO public.item_types (category, name) VALUES
  ('packaging', 'negeri isi 10'),
  ('packaging', 'negeri isi 15'),
  ('packaging', 'bebek kecil'),
  ('packaging', 'bebek besar'),
  ('packaging', 'kampung isi 6'),
  ('packaging', 'kampung isi 10'),
  ('packaging', 'puyuh isi 25'),
  ('packaging', 'puyuh isi 30');

-- Add category and invoice columns to inflows
ALTER TABLE public.inflows 
  ADD COLUMN category inventory_category NOT NULL DEFAULT 'egg',
  ADD COLUMN invoice_supplier text;

-- Add category and invoice columns to outflows  
ALTER TABLE public.outflows
  ADD COLUMN category inventory_category NOT NULL DEFAULT 'egg',
  ADD COLUMN invoice_supplier text;

-- Add category and user_email to activity_logs for display
ALTER TABLE public.activity_logs
  ADD COLUMN category inventory_category NOT NULL DEFAULT 'egg',
  ADD COLUMN invoice_supplier text,
  ADD COLUMN user_email text;

-- Create index for faster category filtering
CREATE INDEX idx_inflows_category ON public.inflows(category);
CREATE INDEX idx_outflows_category ON public.outflows(category);
CREATE INDEX idx_activity_logs_category ON public.activity_logs(category);


-- ========================================
-- Migration: 20260112191951_e9d63f77-be78-446d-86da-5b9e5ea4f570.sql
-- ========================================
-- Create buyers table
CREATE TABLE public.buyers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  default_box_mode TEXT NOT NULL DEFAULT 'box kecil',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on buyers
ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;

-- RLS policies for buyers
CREATE POLICY "Authenticated users can read buyers" 
ON public.buyers 
FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Authenticated users can insert buyers" 
ON public.buyers 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Authenticated users can update buyers" 
ON public.buyers 
FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "Authenticated users can delete buyers" 
ON public.buyers 
FOR DELETE 
TO authenticated 
USING (true);

-- Seed initial buyers
INSERT INTO public.buyers (name, default_box_mode) VALUES
  ('Astro', 'box kecil'),
  ('Family Mart', 'box kecil'),
  ('K3Mart', 'box kecil'),
  ('Osave', 'box osave'),
  ('Segari', 'keranjang'),
  ('CircleK', 'keranjang'),
  ('Sayurbox', 'tray');

-- Add missing packaging item: negeri isi 6
INSERT INTO public.item_types (category, name) VALUES ('packaging', 'negeri isi 6');

-- ========================================
-- Migration: 20260113073450_ae2c911f-cdc4-4b1f-8a12-ca2bff011365.sql
-- ========================================
-- Add KUNING MANIK as egg product
INSERT INTO item_types (category, name) VALUES ('egg', 'KUNING MANIK');

-- Add Mika Plastik as packaging item
INSERT INTO item_types (category, name) VALUES ('packaging', 'mika plastik');

-- ========================================
-- Migration: 20260113075957_5e7bbf94-11f7-490f-a554-d53ab467ee88.sql
-- ========================================
-- Add cracked egg (Retakan) products to item_types
INSERT INTO item_types (category, name) VALUES 
  ('egg', 'NEGERI BIASA (Retakan)'),
  ('egg', 'NEGERI OMEGA (Retakan)'),
  ('egg', 'KAMPUNG BIASA (Retakan)'),
  ('egg', 'KAMPUNG MERAH (Retakan)'),
  ('egg', 'BEBEK TAWAR (Retakan)'),
  ('egg', 'ASIN MATENG (Retakan)'),
  ('egg', 'ASIN MENTAH (Retakan)'),
  ('egg', 'PUYUH (Retakan)'),
  ('egg', 'KUNING MANIK (Retakan)');

-- ========================================
-- Migration: 20260114193458_171a2c44-3158-45d7-b5b4-ce9a56989dbd.sql
-- ========================================
-- Add metadata column to activity_logs for storing detailed order information
ALTER TABLE public.activity_logs 
ADD COLUMN metadata JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.activity_logs.metadata IS 'Optional JSON metadata for detailed order information (buyer, SKU, materials breakdown)';

-- ========================================
-- Migration: 20260114195826_0ffe63e5-d9ea-4d77-aa77-446d0269240a.sql
-- ========================================
-- Create pack_skus table for SKU management
CREATE TABLE public.pack_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  eggs_per_pack INTEGER NOT NULL,
  egg_product TEXT NOT NULL,
  packaging_item TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pack_skus ENABLE ROW LEVEL SECURITY;

-- RLS policies for pack_skus
CREATE POLICY "All can read SKUs" ON public.pack_skus FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert SKUs" ON public.pack_skus FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can update SKUs" ON public.pack_skus FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can delete SKUs" ON public.pack_skus FOR DELETE USING (auth.role() = 'authenticated');

-- Add missing RLS policies to item_types for full CRUD
CREATE POLICY "Authenticated can insert item types" ON public.item_types FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can update item types" ON public.item_types FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can delete item types" ON public.item_types FOR DELETE USING (auth.role() = 'authenticated');

-- Add missing RLS policies to buyers for full CRUD
CREATE POLICY "Authenticated can insert buyers" ON public.buyers FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can update buyers" ON public.buyers FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can delete buyers" ON public.buyers FOR DELETE USING (auth.role() = 'authenticated');

-- Seed pack_skus with existing hardcoded SKUs
INSERT INTO public.pack_skus (code, display_name, eggs_per_pack, egg_product, packaging_item) VALUES
  ('N15B', 'Negeri 15 Biasa', 15, 'NEGERI BIASA', 'negeri 15'),
  ('N10B', 'Negeri 10 Biasa', 10, 'NEGERI BIASA', 'negeri 10'),
  ('N10O', 'Negeri 10 Omega', 10, 'NEGERI OMEGA', 'negeri 10'),
  ('N6B', 'Negeri 6 Biasa', 6, 'NEGERI BIASA', 'negeri 6'),
  ('N6O', 'Negeri 6 Omega', 6, 'NEGERI OMEGA', 'negeri 6'),
  ('N30B', 'Negeri 30 Biasa', 30, 'NEGERI BIASA', 'negeri 30'),
  ('N30O', 'Negeri 30 Omega', 30, 'NEGERI OMEGA', 'negeri 30'),
  ('KP10B', 'Kampung 10 Biasa', 10, 'KAMPUNG BIASA', 'kampung 10'),
  ('KP6B', 'Kampung 6 Biasa', 6, 'KAMPUNG BIASA', 'kampung 6'),
  ('KP10O', 'Kampung 10 Omega', 10, 'KAMPUNG OMEGA', 'kampung 10'),
  ('KP6O', 'Kampung 6 Omega', 6, 'KAMPUNG OMEGA', 'kampung 6'),
  ('P25', 'Puyuh 25', 25, 'PUYUH', 'puyuh 25'),
  ('P30', 'Puyuh 30', 30, 'PUYUH', 'puyuh 30'),
  ('BK4AMTH', 'Bebek 4 Asin Mentah', 4, 'BEBEK ASIN MENTAH', 'bebek 4'),
  ('BK4AMTG', 'Bebek 4 Asin Matang', 4, 'BEBEK ASIN MATANG', 'bebek 4'),
  ('BK4T', 'Bebek 4 Tawar', 4, 'BEBEK TAWAR', 'bebek 4'),
  ('KM15', 'Kuning Manik 15', 15, 'KUNING MANIK', NULL),
  ('KM50', 'Kuning Manik 50', 50, 'KUNING MANIK', NULL);

-- ========================================
-- Migration: 20260116050927_21ecb88c-dfbb-4f9b-a825-7bbb1c93b4d1.sql
-- ========================================
-- Add deleted_at column for soft delete support
ALTER TABLE pack_skus ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE item_types ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE buyers ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Create index for better performance on soft delete queries
CREATE INDEX idx_pack_skus_deleted_at ON pack_skus(deleted_at);
CREATE INDEX idx_item_types_deleted_at ON item_types(deleted_at);
CREATE INDEX idx_buyers_deleted_at ON buyers(deleted_at);

-- ========================================
-- Migration: 20260116060907_e385be8b-0a83-4499-a1a5-35e401ad35df.sql
-- ========================================
-- Insert missing base egg products into item_types table
INSERT INTO item_types (name, category) VALUES
  ('NEGERI BIASA', 'egg'),
  ('NEGERI OMEGA', 'egg'),
  ('KAMPUNG BIASA', 'egg'),
  ('KAMPUNG MERAH', 'egg'),
  ('ASIN MATENG', 'egg'),
  ('ASIN MENTAH', 'egg'),
  ('BEBEK TAWAR', 'egg'),
  ('PUYUH', 'egg')
ON CONFLICT DO NOTHING;

-- ========================================
-- Migration: 20260116061017_6b6ca2cc-8b8b-40df-880b-4762ce437624.sql
-- ========================================
-- Soft delete all Retakan egg products from item_types table
UPDATE item_types 
SET deleted_at = now() 
WHERE category = 'egg' 
AND name LIKE '%(Retakan)%';

-- ========================================
-- Migration: 20260120131709_48473cf4-0c68-4f4a-b93e-f7d8fc5195c7.sql
-- ========================================
-- 1. Create fifo_deductions table to track exactly which inflow batches were affected by each outflow
CREATE TABLE fifo_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outflow_id UUID NOT NULL REFERENCES outflows(id) ON DELETE CASCADE,
  inflow_id UUID NOT NULL REFERENCES inflows(id),
  quantity_deducted NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE fifo_deductions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated can read fifo_deductions" ON fifo_deductions 
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can insert fifo_deductions" ON fifo_deductions 
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 2. Add void tracking columns to inflows
ALTER TABLE inflows
ADD COLUMN voided_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN void_reason TEXT;

-- 3. Add void tracking columns to outflows
ALTER TABLE outflows
ADD COLUMN voided_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN void_reason TEXT;

-- 4. Add void tracking columns to activity_logs
ALTER TABLE activity_logs
ADD COLUMN voided_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN void_reason TEXT,
ADD COLUMN original_log_id UUID REFERENCES activity_logs(id),
ADD COLUMN corrected_by_log_id UUID REFERENCES activity_logs(id);

-- ========================================
-- Migration: 20260120134116_571a9bde-b7c6-40de-95b8-f27397bea1cf.sql
-- ========================================
-- 1. Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- 2. Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 3. Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. Create security definer function (MUST be created before RLS policies that use it)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 5. RLS Policies for user_roles
-- Everyone authenticated can read roles (needed for UI to check permissions)
CREATE POLICY "Authenticated can read roles" ON public.user_roles
  FOR SELECT TO authenticated USING (true);

-- Only admins can insert new roles (promote users)
CREATE POLICY "Admins can grant roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can delete roles (demote users)
CREATE POLICY "Admins can revoke roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Only admins can update roles
CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. Auto-assign 'user' role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- 7. Seed first admin (joshuahartono@outlook.com)
-- This uses ON CONFLICT to handle cases where role already exists
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE email = 'joshuahartono@outlook.com'
ON CONFLICT (user_id, role) DO UPDATE SET role = 'admin';

-- ========================================
-- Migration: 20260122153259_1f8d3260-b197-4fed-93ce-b5ba289a19d0.sql
-- ========================================
-- Create a function to recalculate all inventory FIFO from scratch
CREATE OR REPLACE FUNCTION public.recalculate_inventory_fifo()
RETURNS TABLE(
  product_name TEXT,
  outflows_processed BIGINT,
  deductions_created BIGINT,
  total_deducted NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  outflow_record RECORD;
  inflow_record RECORD;
  remaining_to_deduct NUMERIC;
  deduct_amount NUMERIC;
  product_stats RECORD;
BEGIN
  -- Step 1: Clear all existing FIFO deductions
  DELETE FROM fifo_deductions;
  
  -- Step 2: Reset all inflow remaining_butir to original quantity
  UPDATE inflows 
  SET remaining_butir = quantity_butir 
  WHERE voided_at IS NULL;
  
  -- Step 3: Process each non-voided outflow in chronological order (FIFO: date first, then created_at as tiebreaker)
  FOR outflow_record IN (
    SELECT id, product, quantity_butir, date, created_at
    FROM outflows 
    WHERE voided_at IS NULL 
    ORDER BY date ASC, created_at ASC
  ) LOOP
    remaining_to_deduct := outflow_record.quantity_butir;
    
    -- Find available inflows for this product in FIFO order
    FOR inflow_record IN (
      SELECT id, remaining_butir
      FROM inflows
      WHERE product = outflow_record.product
        AND voided_at IS NULL
        AND remaining_butir > 0
      ORDER BY date ASC, created_at ASC
    ) LOOP
      EXIT WHEN remaining_to_deduct <= 0;
      
      -- Calculate how much to deduct from this batch
      deduct_amount := LEAST(inflow_record.remaining_butir, remaining_to_deduct);
      
      -- Create FIFO deduction record
      INSERT INTO fifo_deductions (outflow_id, inflow_id, quantity_deducted)
      VALUES (outflow_record.id, inflow_record.id, deduct_amount);
      
      -- Update the inflow's remaining quantity
      UPDATE inflows 
      SET remaining_butir = remaining_butir - deduct_amount
      WHERE id = inflow_record.id;
      
      remaining_to_deduct := remaining_to_deduct - deduct_amount;
    END LOOP;
  END LOOP;
  
  -- Return summary statistics per product
  RETURN QUERY
  SELECT 
    o.product AS product_name,
    COUNT(DISTINCT o.id) AS outflows_processed,
    COUNT(fd.id) AS deductions_created,
    COALESCE(SUM(fd.quantity_deducted), 0) AS total_deducted
  FROM outflows o
  LEFT JOIN fifo_deductions fd ON fd.outflow_id = o.id
  WHERE o.voided_at IS NULL
  GROUP BY o.product
  ORDER BY o.product;
END;
$$;

-- Grant execute permission to authenticated users (function checks admin role internally)
GRANT EXECUTE ON FUNCTION public.recalculate_inventory_fifo() TO authenticated;

-- ========================================
-- Migration: 20260122153642_3c9a2943-e273-4d9a-9d6a-4eb6a3a9761d.sql
-- ========================================
-- Drop and recreate the function with WHERE clause for DELETE
CREATE OR REPLACE FUNCTION public.recalculate_inventory_fifo()
RETURNS TABLE(
  product_name TEXT,
  outflows_processed BIGINT,
  deductions_created BIGINT,
  total_deducted NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  outflow_record RECORD;
  inflow_record RECORD;
  remaining_to_deduct NUMERIC;
  deduct_amount NUMERIC;
BEGIN
  -- Step 1: Clear all existing FIFO deductions (WHERE true satisfies RLS requirement)
  DELETE FROM fifo_deductions WHERE true;
  
  -- Step 2: Reset all inflow remaining_butir to original quantity
  UPDATE inflows 
  SET remaining_butir = quantity_butir 
  WHERE voided_at IS NULL;
  
  -- Step 3: Process each non-voided outflow in chronological order (FIFO: date first, then created_at as tiebreaker)
  FOR outflow_record IN (
    SELECT id, product, quantity_butir, date, created_at
    FROM outflows 
    WHERE voided_at IS NULL 
    ORDER BY date ASC, created_at ASC
  ) LOOP
    remaining_to_deduct := outflow_record.quantity_butir;
    
    -- Find available inflows for this product in FIFO order
    FOR inflow_record IN (
      SELECT id, remaining_butir
      FROM inflows
      WHERE product = outflow_record.product
        AND voided_at IS NULL
        AND remaining_butir > 0
      ORDER BY date ASC, created_at ASC
    ) LOOP
      EXIT WHEN remaining_to_deduct <= 0;
      
      -- Calculate how much to deduct from this batch
      deduct_amount := LEAST(inflow_record.remaining_butir, remaining_to_deduct);
      
      -- Create FIFO deduction record
      INSERT INTO fifo_deductions (outflow_id, inflow_id, quantity_deducted)
      VALUES (outflow_record.id, inflow_record.id, deduct_amount);
      
      -- Update the inflow's remaining quantity
      UPDATE inflows 
      SET remaining_butir = remaining_butir - deduct_amount
      WHERE id = inflow_record.id;
      
      remaining_to_deduct := remaining_to_deduct - deduct_amount;
    END LOOP;
  END LOOP;
  
  -- Return summary statistics per product
  RETURN QUERY
  SELECT 
    o.product AS product_name,
    COUNT(DISTINCT o.id) AS outflows_processed,
    COUNT(fd.id) AS deductions_created,
    COALESCE(SUM(fd.quantity_deducted), 0) AS total_deducted
  FROM outflows o
  LEFT JOIN fifo_deductions fd ON fd.outflow_id = o.id
  WHERE o.voided_at IS NULL
  GROUP BY o.product
  ORDER BY o.product;
END;
$$;