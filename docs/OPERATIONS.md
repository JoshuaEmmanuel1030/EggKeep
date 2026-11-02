# Operations Guide

Operational hygiene for EggKeep — a live business app with ~3 users on phones.
Everything here is owner-actionable; nothing requires code changes.

## 1. Error monitoring (Sentry)

The app ships with Sentry integrated but **dormant**: it only activates when
`VITE_SENTRY_DSN` is set at build time. No DSN = no-op (local dev and builds
stay clean).

What's wired up:

- `src/lib/monitoring.ts` — init + `captureError(error, context)` helper
- `src/main.tsx` — `initMonitoring()` before React renders
- `src/components/ErrorBoundary.tsx` — render crashes reported with component stack
- `src/hooks/useInventorySync.ts` — failed inflow inserts and
  `record_order_outflows` RPC failures reported with operation context

Defaults: `tracesSampleRate: 0.1`, environment from `import.meta.env.MODE`,
release tagged from `VITE_VERCEL_GIT_COMMIT_SHA` when Vercel exposes it.

### Setup (one time, ~10 minutes)

1. Create a free account/org at [sentry.io](https://sentry.io) and create a
   project: platform **React**.
2. Copy the **DSN** (Project Settings → Client Keys (DSN)). It looks like
   `https://<key>@<org>.ingest.sentry.io/<id>`. The DSN is not a secret — it
   is safe in client bundles.
3. In **Vercel → EggKeep project → Settings → Environment Variables**, add
   `VITE_SENTRY_DSN` = the DSN, for the **Production** environment (add
   Preview too if you want).
4. (Optional, for release tagging) Vercel → Settings → Environment Variables →
   enable **"Automatically expose System Environment Variables"** so
   `VITE_VERCEL_GIT_COMMIT_SHA` is available. If the plain
   `VERCEL_GIT_COMMIT_SHA` is exposed instead, add a Vercel env var
   `VITE_VERCEL_GIT_COMMIT_SHA` referencing it — Vite only exposes `VITE_`-prefixed vars.
5. **Redeploy** (env vars are baked in at build time — a redeploy is required,
   not just a save).
6. Verify: open the deployed app, then check Sentry → Issues. You can force a
   test event from the browser console of the deployed site.

## 2. Supabase backups

- **Free tier**: no automated backups. **Pro tier**: daily automated backups
  with 7-day retention.
- Check what you have: **Dashboard → Database → Backups** (project `lgtix...`).
- **PITR (point-in-time recovery)**: Pro add-on, restores to any second. For a
  small inventory app, daily backups are usually enough — inflow/outflow rows
  are re-enterable from paper invoices. Skip PITR unless losing up to a day of
  entries becomes unacceptable.
- **Manual export fallback** (do this regardless of tier):
  - `pg_dump "<connection string>" > eggkeep_YYYYMMDD.sql` — connection string
    from Dashboard → Project Settings → Database (use the direct/session
    connection, not the pooler, for pg_dump).
  - Or download a backup from Dashboard → Database → Backups (Pro tier).
  - **Suggested cadence**: weekly manual dump on free tier (calendar reminder);
    monthly sanity-check dump if on Pro with daily backups.
  - Store dumps somewhere off-Supabase (local disk + cloud drive).

## 3. Leaked-password protection (one toggle)

**Dashboard → Authentication → Passwords → enable "Leaked password
protection"** (checks new passwords against HaveIBeenPwned). Free, no code
change, no effect on existing sessions.

## 4. Deploy checklist

Order matters: **database first, frontend second** — old frontend code must
keep working against the new schema, never the reverse.

0. **Verify** — `npm run verify` (Supabase ref guard + typecheck + tests) must
   pass before pushing.
1. **DB migrations** — apply via Supabase SQL Editor or MCP `apply_migration`
   BEFORE pushing any frontend code that depends on them. Keep migrations
   backward-compatible with the currently deployed frontend (a phone keeps
   running the old PWA bundle until someone taps the update toast — possibly
   for days).
2. **Edge Functions** — deployed separately from the frontend (`supabase
   functions deploy <name>` or MCP `deploy_edge_function`). A Vercel deploy
   does NOT update them.
3. **Frontend** — `git push` to `main` → Vercel auto-deploys.
4. **After deploy** — open the app on one phone, tap the update toast (the SW
   checks on focus and every 15 min), confirm the new bundle loads, and watch
   Sentry → Issues for the new release.

## 5. Voiding a return (`void_return`, Phase 2)

Spec: `docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md` §6.3.

- **Who:** the person who recorded the return within 48 hours, or an app admin
  (`has_role(uid, 'admin')`) at any time. Checked on the server; the
  "Batalkan retur ini" button in Riwayat retur (`/deliveries`) only mirrors it.
- **What it does:** voids the whole save group (every row one `record_return`
  call wrote for that outflow row and SKU) and records the opposite movement as
  its own outflow (`outflows.void_return_id` set; jenis `retur_batal` in the
  reconciliation export): OK eggs are taken back out of the parent product,
  Retakan eggs out of "<PRODUCT> (RETAKAN)", FIFO from today's batches. History
  is never rewritten; voided rows stay, struck through.
- **`INSUFFICIENT_STOCK`:** the product no longer holds what the group put back
  (the eggs were sold on). Nothing changed. Stock is right as it is; only the
  business record is wrong. Retry when stock allows, or note it and correct
  after the next physical count.
- **`VOID_BLOCKED` (from `void_outflow`):** voiding an order would push a batch
  outside `[0, quantity]`. A backstop: unreachable while every restock goes
  through `record_return`. If it fires, stop and investigate with
  `reconcile_inventory()`; do not hand-edit `remaining_butir`.
- **`void_outflow` after a voided return:** restores each batch by
  `ded − restocks (voided included) + compensating deductions` and voids the
  order's compensating outflows with it, so the end state is as if the order,
  its returns and their voids never happened. `reconcile_inventory()` must
  return 0 rows afterwards.
- **Do not run `recalculate_inventory_fifo` after Phase 2 voids exist.** It
  replays outflows before re-applying restocks, so a compensating outflow (or
  any sale of restocked eggs) is under-deducted and stock over-states.
  `reconcile_inventory()` is the correctness check.
- **Stop all voids:** `revoke execute on function public.void_return(uuid, text) from authenticated;`

## 6. One-time sheet import (October 2026)

`node --env-file=.env scripts/import-sheet-lines.mjs --xlsx <file> --dry-run`
(Node 20.6+; `IMPORT_EMAIL` / `IMPORT_PASSWORD` in the environment, never in a
file). Review the report, then run without `--dry-run`; a second run must add
zero rows. Writes only `deliveries` / `delivery_lines` (`source =
'sheet_import'`), never `returns`. A dry run also writes the report file
(`--report`, default `docs/sheet-import-2026-10.md`). Reverse with
`delete from delivery_lines where source = 'sheet_import';` then the
`deliveries` ids the live report lists as created (only those with no other line).
