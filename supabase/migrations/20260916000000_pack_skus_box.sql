-- Box SKUs: a pack_skus row that wraps a base pack SKU in a box.
-- Non-null base_pack_code => this row is a Box SKU. box_mode names the box
-- (a BoxModeType / box item name). Packs-per-box is NOT stored here — it is
-- read live from box_capacities (the box item's Packs-per-box config).
alter table pack_skus
  add column if not exists base_pack_code text,
  add column if not exists box_mode text;

comment on column pack_skus.base_pack_code is
  'Box SKU: code of the wrapped pack SKU. Non-null => this row is a box SKU.';
comment on column pack_skus.box_mode is
  'Box SKU: which box it ships in (box item name / BoxModeType).';
