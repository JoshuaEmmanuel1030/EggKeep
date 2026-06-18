-- Add metadata column to activity_logs for storing detailed order information
ALTER TABLE public.activity_logs 
ADD COLUMN metadata JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.activity_logs.metadata IS 'Optional JSON metadata for detailed order information (buyer, SKU, materials breakdown)';