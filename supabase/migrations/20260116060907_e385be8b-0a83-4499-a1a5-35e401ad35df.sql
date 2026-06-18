-- Insert missing base egg products into item_types table
INSERT INTO item_types (name, category) VALUES
  ('NEGERI BIASA', 'egg'),
  ('NEGERI OMEGA', 'egg'),
  ('KAMPUNG BIASA', 'egg'),
  ('KAMPUNG MERAH', 'egg'),
  ('ASIN MATENG', 'egg'),
  ('ASIN MENTAH', 'egg'),
  ('BEBEK TAWAR', 'egg'),
  ('PUYUH', 'egg')
ON CONFLICT DO NOTHING;