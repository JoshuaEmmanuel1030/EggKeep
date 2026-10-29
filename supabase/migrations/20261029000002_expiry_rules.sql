-- Aturan Expired (shelf-life rules per buyer / SKU) from the Google Sheet's
-- "Aturan Expired" tab. Phase 1 creates the table and seeds it only; the
-- resolver (expected_expiry on delivery lines) and the editor are Phase 2.
-- Spec: docs/superpowers/specs/2026-10-29-delivery-return-log-design.md §4.5
-- Additive only.
create table public.expiry_rules (
  id             uuid primary key default gen_random_uuid(),
  buyer_keyword  text,          -- null = any buyer; case-insensitive substring of "<buyer> <dc>"
  sku_code       text,          -- null = any SKU (Phase 2 resolver matches case/space-insensitively)
  shelf_days     integer not null check (shelf_days > 0),
  note           text,
  created_at     timestamptz not null default now()
);

alter table public.expiry_rules enable row level security;

-- Same access as stock_counts: any signed-in user can read/insert/update
-- (the editor is Phase 2 and will be admin-gated in the UI, like buyers).
create policy "Authenticated users can read expiry_rules"
  on public.expiry_rules for select to authenticated using (true);
create policy "Authenticated users can insert expiry_rules"
  on public.expiry_rules for insert to authenticated with check (true);
create policy "Authenticated users can update expiry_rules"
  on public.expiry_rules for update to authenticated using (true) with check (true);

-- Seed from the sheet. "1 Bulan" = 30 days. A (buyer, sku) rule beats a
-- buyer-only rule, which beats the default (null, null) row.
insert into public.expiry_rules (buyer_keyword, sku_code, shelf_days, note) values
  ('Astro',    null,    22, 'Astro default'),
  ('Astro',    'N15',   21, null),
  ('Astro',    'N 30',  21, null),
  ('Astro',    'AMTG',  14, null),
  ('Segari',   null,    30, 'Segari default (1 Bulan)'),
  ('Segari',   'AMTG',  14, null),
  ('Sayurbox', null,    14, 'Sayurbox default'),
  ('Sayurbox', 'P 25',  21, null),
  ('Sayurbox', 'KP 6',  30, '1 Bulan'),
  ('Sayurbox', 'N4',    30, '1 Bulan'),
  (null,       null,    30, 'Default (1 Bulan)');
