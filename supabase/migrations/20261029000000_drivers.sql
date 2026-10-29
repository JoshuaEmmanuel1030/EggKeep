-- Drivers (Supir) for the Delivery & Return Log — the "Daftar" tab of the
-- Google Sheet this feature replaces. Managed in Catalog → Supir (admin-only
-- edit is a UI gate, like buyers). Additive only.
-- Spec: docs/superpowers/specs/2026-10-29-delivery-return-log-design.md §4.1
create table public.drivers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- One driver per name (case/space-insensitive).
create unique index drivers_name_key on public.drivers (upper(btrim(name)));

alter table public.drivers enable row level security;

-- Same access as stock_counts: any signed-in user can read/insert/update.
create policy "Authenticated users can read drivers"
  on public.drivers for select to authenticated using (true);
create policy "Authenticated users can insert drivers"
  on public.drivers for insert to authenticated with check (true);
create policy "Authenticated users can update drivers"
  on public.drivers for update to authenticated using (true) with check (true);

-- Seed: the sheet's current driver list.
insert into public.drivers (name) values
  ('Hendi'), ('Junaedi'), ('Riyan'), ('Samsudin'), ('Ayub'),
  ('Bolu'), ('Mirdad'), ('Dede'), ('Dika')
on conflict ((upper(btrim(name)))) do nothing;
