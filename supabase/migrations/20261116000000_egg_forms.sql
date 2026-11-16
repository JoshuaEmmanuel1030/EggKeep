-- Masuk "Bentuk": the form an egg delivery arrived in, plus Tonase's per-load weight.
-- Spec: docs/superpowers/specs/2026-11-16-masuk-bentuk-tonase-design.md
--
-- forms is display-ordered. A line stores the form's id, so renaming a form in the
-- Catalog does not corrupt history. Sizes are the warehouse sheet's; the owner edits
-- them afterwards.

alter table public.item_types
  add column if not exists forms jsonb;

comment on column public.item_types.forms is
  'Egg-only: the forms this product can arrive in, in display order. Array of '
  '{id, name, size?, unit, unitWord?}; unit is kg | butir | native | weighed. '
  'weighed (Tonase) has no size: the weight lives on the line.';

alter table public.inflows
  add column if not exists form text,
  add column if not exists form_count numeric,
  add column if not exists tonase_kg numeric;

comment on column public.inflows.form is
  'item_types.forms[].id this line was entered in; null = Langsung (native amount as typed).';
comment on column public.inflows.form_count is
  'How many of that form were entered. quantity_butir still holds the native-unit result.';
comment on column public.inflows.tonase_kg is
  'kg per satuan used for a weighed form, so history stays right when later loads differ.';

update public.item_types t set forms = v.forms
from (values
  ('NEGERI BIASA', '[
     {"id":"iket15kg","name":"Iket 15 kg","size":15,"unit":"kg","unitWord":"iket"},
     {"id":"iket10kg","name":"Iket 10 kg","size":10,"unit":"kg","unitWord":"iket"},
     {"id":"negeri15","name":"Negeri 15''s","size":15,"unit":"butir","unitWord":"pack"},
     {"id":"negeri10","name":"Negeri 10''s","size":10,"unit":"butir","unitWord":"pack"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"kartonosave","name":"Karton Osave","size":180,"unit":"butir","unitWord":"karton"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"tonase","name":"Tonase","unit":"weighed","unitWord":"satuan"},
     {"id":"iketanosave","name":"Iketan Osave","size":150,"unit":"butir","unitWord":"iket"},
     {"id":"negeri6","name":"Negeri 6''s","size":6,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('NEGERI OMEGA', '[
     {"id":"iket15kg","name":"Iket 15 kg","size":15,"unit":"kg","unitWord":"iket"},
     {"id":"iket10kg","name":"Iket 10 kg","size":10,"unit":"kg","unitWord":"iket"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack6","name":"Pack 6''s","size":6,"unit":"butir","unitWord":"pack"},
     {"id":"kartonosave","name":"Karton Osave","size":180,"unit":"butir","unitWord":"karton"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"pack10","name":"Pack 10''s","size":10,"unit":"butir","unitWord":"pack"},
     {"id":"pack15","name":"Pack 15''s","size":15,"unit":"butir","unitWord":"pack"},
     {"id":"no6","name":"No''6","size":6,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('KAMPUNG MERAH', '[
     {"id":"iket300","name":"Iket 300","size":300,"unit":"butir","unitWord":"iket"},
     {"id":"pack15","name":"Pack 15''s","size":15,"unit":"butir","unitWord":"pack"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack6","name":"Pack 6''s","size":6,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"pack10","name":"Pack 10''s","size":10,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('KAMPUNG BIASA', '[
     {"id":"iket300","name":"Iket 300","size":300,"unit":"butir","unitWord":"iket"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack10","name":"Pack 10''s","size":10,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"pack6","name":"Pack 6''s","size":6,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('PUYUH', '[
     {"id":"ikat900","name":"Ikat 900","size":900,"unit":"butir","unitWord":"ikat"},
     {"id":"ikat1350","name":"Ikat 1350","size":1350,"unit":"butir","unitWord":"ikat"},
     {"id":"pack25","name":"Pack 25''s","size":25,"unit":"butir","unitWord":"pack"},
     {"id":"tray90","name":"Tray 90","size":90,"unit":"butir","unitWord":"tray"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"},
     {"id":"puyuh30","name":"Puyuh 30''s","size":30,"unit":"butir","unitWord":"pack"}
   ]'::jsonb),
  ('ASIN MATENG', '[
     {"id":"ikat300","name":"Ikat 300","size":300,"unit":"butir","unitWord":"ikat"},
     {"id":"ikat270","name":"Ikat 270","size":270,"unit":"butir","unitWord":"ikat"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack4","name":"Pack 4''s","size":4,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"}
   ]'::jsonb),
  ('BEBEK TAWAR', '[
     {"id":"ikat300","name":"Ikat 300","size":300,"unit":"butir","unitWord":"ikat"},
     {"id":"ikat270","name":"Ikat 270","size":270,"unit":"butir","unitWord":"ikat"},
     {"id":"tray30","name":"Tray 30","size":30,"unit":"butir","unitWord":"tray"},
     {"id":"pack4","name":"Pack 4''s","size":4,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"}
   ]'::jsonb),
  ('ASIN MENTAH', '[
     {"id":"ikat200","name":"Ikat 200","size":200,"unit":"butir","unitWord":"ikat"},
     {"id":"tray20","name":"Tray 20","size":20,"unit":"butir","unitWord":"tray"},
     {"id":"pack4","name":"Pack 4''s","size":4,"unit":"butir","unitWord":"pack"},
     {"id":"curah","name":"Curah","size":1,"unit":"native"}
   ]'::jsonb)
) as v(name, forms)
where t.name = v.name
  and t.category = 'egg'
  and t.deleted_at is null
  and coalesce(t.is_retakan, false) = false;
