-- Bundles that exist only to be COUNTED, not received.
--
-- item_types.forms answers "how did this delivery arrive" and drives Masuk. The
-- owner established (2026-11-18) that several seeded forms are not arrivals at all:
-- Karton Osave, Iketan Osave and the Negeri 6/10/15 packs are the previous day's
-- PACKED stock, sitting in the warehouse and tallied at the next physical count.
-- They were removed from `forms` the same day so Masuk stops offering receipts that
-- never happen.
--
-- They still have to be countable, so they land here instead. Stok Fisik reads
-- forms UNION count_forms; Masuk keeps reading forms alone.
--
-- A separate column rather than a `scope` field on `forms`, deliberately. The PWA
-- is registerType "prompt", so a phone can serve an old bundle for days. An old
-- bundle does not know about a scope field and would show count-only entries in the
-- Masuk picker again; it cannot see a column it never selects. Backward-compatible
-- by construction, which is the rule this repo holds itself to for DB changes.
--
-- Seeded with exactly the objects removed from `forms` earlier today -- a restore,
-- not an invention. One of them is knowingly left wrong: Iketan Osave stays at
-- 150 butir, so counting it converts at the product's eggs_per_unit. The owner has
-- established the Osave tray is 1,85 kg, i.e. 5 x 1,85 = 9,25 kg per iketan, so
-- this entry should become {"unit":"kg","size":9.25} -- exact, and independent of
-- the product rate. That is a deliberate owner edit, not something to bake in here.

alter table public.item_types
  add column if not exists count_forms jsonb;

comment on column public.item_types.count_forms is
  'Bundles countable at a physical count but never received: packed leftovers. Stok Fisik reads forms UNION count_forms; Masuk reads forms only. Same object shape as forms.';

update public.item_types
set count_forms = '[
  {"id":"iketanosave","name":"Iketan Osave","size":150,"unit":"butir","unitWord":"iket"},
  {"id":"kartonosave","name":"Karton Osave","size":180,"unit":"butir","unitWord":"karton"},
  {"id":"negeri15","name":"Negeri 15''s","size":15,"unit":"butir","unitWord":"pack"},
  {"id":"negeri10","name":"Negeri 10''s","size":10,"unit":"butir","unitWord":"pack"},
  {"id":"negeri6","name":"Negeri 6''s","size":6,"unit":"butir","unitWord":"pack"}
]'::jsonb
where category = 'egg' and name = 'NEGERI BIASA' and count_forms is null;

update public.item_types
set count_forms = '[
  {"id":"kartonosave","name":"Karton Osave","size":180,"unit":"butir","unitWord":"karton"},
  {"id":"pack15","name":"Pack 15''s","size":15,"unit":"butir","unitWord":"pack"},
  {"id":"pack10","name":"Pack 10''s","size":10,"unit":"butir","unitWord":"pack"},
  {"id":"pack6","name":"Pack 6''s","size":6,"unit":"butir","unitWord":"pack"},
  {"id":"no6","name":"No''6","size":6,"unit":"butir","unitWord":"pack"}
]'::jsonb
where category = 'egg' and name = 'NEGERI OMEGA' and count_forms is null;
