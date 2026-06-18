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