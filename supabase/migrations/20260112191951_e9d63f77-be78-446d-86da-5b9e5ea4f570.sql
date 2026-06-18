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