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

1. **DB migrations** — apply via Supabase SQL Editor or MCP `apply_migration`
   BEFORE pushing any frontend code that depends on them. Keep migrations
   backward-compatible with the currently deployed frontend (phones may run a
   stale PWA bundle for up to ~15 minutes after deploy).
2. **Edge Functions** — deployed separately from the frontend (`supabase
   functions deploy <name>` or MCP `deploy_edge_function`). A Vercel deploy
   does NOT update them.
3. **Frontend** — `git push` to `main` → Vercel auto-deploys. Note Lovable
   also auto-commits to `main`, so pull before pushing.
4. **After deploy** — open the app on one phone, confirm the new bundle loads
   (the SW checks for updates on focus and every 15 min), and watch Sentry →
   Issues for the new release.
