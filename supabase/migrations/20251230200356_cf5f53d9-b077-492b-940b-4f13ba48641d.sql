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