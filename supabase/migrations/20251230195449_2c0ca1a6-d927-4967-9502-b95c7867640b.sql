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