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