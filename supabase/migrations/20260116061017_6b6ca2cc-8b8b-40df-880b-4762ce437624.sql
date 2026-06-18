-- Soft delete all Retakan egg products from item_types table
UPDATE item_types 
SET deleted_at = now() 
WHERE category = 'egg' 
AND name LIKE '%(Retakan)%';