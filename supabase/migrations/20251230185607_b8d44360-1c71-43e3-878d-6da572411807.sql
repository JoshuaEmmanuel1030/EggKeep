-- Add UPDATE policy for outflows table
CREATE POLICY "Users can update their own outflows" 
ON public.outflows FOR UPDATE 
USING (auth.uid() = user_id);