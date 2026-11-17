-- Catalogue writes are admin-only.
--
-- The original policies let ANY authenticated user insert, update or delete an
-- item type; the app only hid the buttons behind isAdmin. Every staff login
-- could therefore rewrite eggs_per_unit, forms or box_capacities through the
-- API, and those values decide the quantities written to stock.
--
-- Reads are unchanged, so nothing that only displays the catalogue is affected.
-- The only client writers are the four mutations in src/hooks/useItemTypes.ts,
-- all called from the admin-gated Catalog screen. RETAKAN child rows are created
-- by record_return, which is SECURITY DEFINER and bypasses RLS.

drop policy if exists "Authenticated can insert item types" on public.item_types;
drop policy if exists "Authenticated can update item types" on public.item_types;
drop policy if exists "Authenticated can delete item types" on public.item_types;

create policy "Admins can insert item types"
  on public.item_types for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can update item types"
  on public.item_types for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can delete item types"
  on public.item_types for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));
