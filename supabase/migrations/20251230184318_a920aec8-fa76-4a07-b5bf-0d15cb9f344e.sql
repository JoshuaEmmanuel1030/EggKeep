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