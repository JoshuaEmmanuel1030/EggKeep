# EggKeep

Inventory and operations PWA for JS, an egg distributor in Jabodetabek / West Java.
Warehouse staff and admins use it on phones to record intake (masuk), orders (pesanan),
returns (retur) and stock counts.

Live: https://egg-keep.vercel.app

## Stack

Vite + React + TypeScript, shadcn-ui + Tailwind, TanStack Query, Supabase (Postgres, RPCs,
Edge Functions), vite-plugin-pwa, vitest, Sentry.

## Develop

```sh
npm i
npm run dev      # http://localhost:8080
npm run verify   # Supabase ref guard + typecheck + tests; run before every push
```

`.env` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`).

## Deploy

- Frontend: push to `main` → Vercel builds and deploys.
- Database: apply migrations in `supabase/migrations/` **before** pushing code that needs them.
- Edge Functions (`supabase/functions/`): deployed separately; a push does not update them.

See [CLAUDE.md](CLAUDE.md) for the design rules (kg-native stock, server-side FIFO, returns)
and [docs/OPERATIONS.md](docs/OPERATIONS.md) for monitoring, backups and the deploy checklist.
