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