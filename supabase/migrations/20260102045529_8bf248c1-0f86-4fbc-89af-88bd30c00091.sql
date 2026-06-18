
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
