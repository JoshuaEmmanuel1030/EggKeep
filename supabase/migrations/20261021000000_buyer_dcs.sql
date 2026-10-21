-- Distribution centers (DCs) per buyer, e.g. OSAVE -> BKS, TGR, KRW.
-- Managed in Catalog -> Buyers; the Purchase Order builder lists only the
-- selected buyer's DCs. The chosen DC is stored on the order's activity-log
-- metadata (dcId + dcName snapshot), so no outflow/RPC change is needed.
-- Additive only: no existing table or row is touched.
create table public.buyer_dcs (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

-- One DC name per buyer (case/space-insensitive); also serves buyer_id lookups.
create unique index buyer_dcs_buyer_name_key on public.buyer_dcs (buyer_id, lower(btrim(name)));

alter table public.buyer_dcs enable row level security;

-- Same access as public.buyers: any signed-in user can manage the catalog.
create policy "Authenticated users can read buyer DCs"
  on public.buyer_dcs for select to authenticated using (true);
create policy "Authenticated users can insert buyer DCs"
  on public.buyer_dcs for insert to authenticated with check (true);
create policy "Authenticated users can update buyer DCs"
  on public.buyer_dcs for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete buyer DCs"
  on public.buyer_dcs for delete to authenticated using (true);
