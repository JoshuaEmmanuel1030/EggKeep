-- Add deleted_at column for soft delete support
ALTER TABLE pack_skus ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE item_types ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE buyers ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Create index for better performance on soft delete queries
CREATE INDEX idx_pack_skus_deleted_at ON pack_skus(deleted_at);
CREATE INDEX idx_item_types_deleted_at ON item_types(deleted_at);
CREATE INDEX idx_buyers_deleted_at ON buyers(deleted_at);