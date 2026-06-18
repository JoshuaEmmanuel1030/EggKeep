-- 1. Create fifo_deductions table to track exactly which inflow batches were affected by each outflow
CREATE TABLE fifo_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outflow_id UUID NOT NULL REFERENCES outflows(id) ON DELETE CASCADE,
  inflow_id UUID NOT NULL REFERENCES inflows(id),
  quantity_deducted NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE fifo_deductions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated can read fifo_deductions" ON fifo_deductions 
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated can insert fifo_deductions" ON fifo_deductions 
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 2. Add void tracking columns to inflows
ALTER TABLE inflows
ADD COLUMN voided_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN void_reason TEXT;

-- 3. Add void tracking columns to outflows
ALTER TABLE outflows
ADD COLUMN voided_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN void_reason TEXT;

-- 4. Add void tracking columns to activity_logs
ALTER TABLE activity_logs
ADD COLUMN voided_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN void_reason TEXT,
ADD COLUMN original_log_id UUID REFERENCES activity_logs(id),
ADD COLUMN corrected_by_log_id UUID REFERENCES activity_logs(id);