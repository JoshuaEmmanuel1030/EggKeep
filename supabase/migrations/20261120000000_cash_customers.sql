-- Kas Tunai customers (Pelanggan Tunai): the pick list behind the customer
-- field on the tablet's Kas Tunai drawer. Managed in Catalog -> Pelanggan Tunai.
-- Separate from public.buyers on purpose: app bundles already in the field list
-- every buyers row in the Purchase Order buyer dropdown, and PO buyers and cash
-- customers never merge (Insight rule).
--
-- A sale with no customer is an anonymous walk-in ("Umum"); there is no
-- reserved row for it. A sale keeps metadata.customerName as a name snapshot
-- and gains metadata.customerId, so a later rename doesn't split its history.
--
-- Additive and replay-safe. Old bundles keep writing free-text customerName
-- with no customerId; those still read fine (matched by name).
-- This file holds no customer names: the list is filled from the sales
-- already recorded, by rule.

create table if not exists public.cash_customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- One customer per name (case/space-insensitive), like drivers_name_key.
create unique index if not exists cash_customers_name_key on public.cash_customers (upper(btrim(name)));

alter table public.cash_customers enable row level security;

-- Any signed-in user reads and adds (a new customer is added at the counter,
-- mid-sale); rename / deactivate is an admin UI gate, like drivers.
drop policy if exists "Authenticated users can read cash customers" on public.cash_customers;
create policy "Authenticated users can read cash customers"
  on public.cash_customers for select to authenticated using (true);
drop policy if exists "Authenticated users can insert cash customers" on public.cash_customers;
create policy "Authenticated users can insert cash customers"
  on public.cash_customers for insert to authenticated with check (true);
drop policy if exists "Authenticated users can update cash customers" on public.cash_customers;
create policy "Authenticated users can update cash customers"
  on public.cash_customers for update to authenticated using (true) with check (true);

-- ── Backfill from the Kas Tunai sales already recorded ───────────────────────
-- Only rows the drawer wrote: outflow logs with orderType 'manual' and a
-- customerName. Touches metadata.customerName / customerId and nothing else:
-- no stock table, no quantity, no date.

-- 1. A placeholder typed where there was no name is an anonymous sale.
--    Same list as ANONYMOUS_NAMES in src/lib/cashCustomers.ts (sync test).
update public.activity_logs
   set metadata = metadata - 'customerName'
 where action_type = 'outflow'
   and metadata->>'orderType' = 'manual'
   and upper(regexp_replace(btrim(metadata->>'customerName'), '\s+', ' ', 'g'))
       in ('', '-', 'CUSTOMER', 'CUST', 'PELANGGAN', 'UMUM', 'ANONIM', 'ANONYMOUS', 'TANPA NAMA', 'NO NAME');

-- 2. Trim and collapse inner whitespace (case is kept as typed).
update public.activity_logs
   set metadata = jsonb_set(metadata, '{customerName}',
                            to_jsonb(regexp_replace(btrim(metadata->>'customerName'), '\s+', ' ', 'g')))
 where action_type = 'outflow'
   and metadata->>'orderType' = 'manual'
   and metadata ? 'customerName'
   and metadata->>'customerName' <> regexp_replace(btrim(metadata->>'customerName'), '\s+', ' ', 'g');

-- 3. One customer per distinct name; of several casings the most used wins.
insert into public.cash_customers (name)
select distinct on (upper(n)) n
  from (select metadata->>'customerName' as n, count(*) as uses
          from public.activity_logs
         where action_type = 'outflow'
           and metadata->>'orderType' = 'manual'
           and metadata ? 'customerName'
         group by 1) s
 order by upper(n), uses desc, n
on conflict ((upper(btrim(name)))) do nothing;

-- 4. Link each sale row to its customer.
update public.activity_logs a
   set metadata = jsonb_set(a.metadata, '{customerId}', to_jsonb(c.id::text))
  from public.cash_customers c
 where a.action_type = 'outflow'
   and a.metadata->>'orderType' = 'manual'
   and a.metadata ? 'customerName'
   and not (a.metadata ? 'customerId')
   and upper(a.metadata->>'customerName') = upper(btrim(c.name));
