# CLAUDE.md — EggKeep

Live React/TS + Supabase PWA for an Indonesian egg-distribution business (real warehouse, real users on phones). Treat production data as sacred.

## Skills
- **Reading a photo of a hand-filled paper form** (Formulir Penerimaan/Pengiriman, "barang masuk/keluar", daftar ambil) → use the `read-egg-form` skill (`.claude/skills/read-egg-form/`). It OCRs the handwriting, snaps values to the catalog, enforces Osave box math, and returns a reviewable table with per-cell confidence flags. It never writes to the DB — data entry is a separate, human-confirmed step.

## Deploy model
- Frontend: push to `main` → Vercel auto-builds (egg-keep.vercel.app). PWA auto-updates on focus.
- Edge Functions (`supabase/functions/inventory-assistant`): deploy separately (Supabase MCP `deploy_edge_function` or CLI). Git push does NOT touch them.
- Migrations: applied via Supabase MCP `apply_migration` (or SQL Editor) against project `lgtixzpjbkzapecirbfj`. **Apply DB migrations BEFORE pushing frontend code that depends on them.**
- Verify gate: `npx tsc --noEmit -p tsconfig.app.json` + `npm test -- --run` (vitest).

## CRITICAL: kg-native stock design
The `quantity_butir` / `remaining_butir` columns hold each product's NATIVE unit:
- **kg** for weight-sold eggs (catalog `item_types.unit='kg'`, e.g. NEGERI BIASA at `eggs_per_unit≈15.5` eggs/kg)
- **butir** for count-sold eggs
- **pcs** for boxes/labels/packaging

The column names are legacy — do NOT "fix" them and do NOT convert kg↔butir when storing or deducting. The conversion factor is ONLY for: pack sales of kg eggs (egg count → estimated kg) and butir-equivalent estimates on aggregate displays. Core helpers: `src/lib/inventory.ts` (`getStockUnit`, `toStockUnits`, `butirEquivalent`).

### Load-bearing display helpers — keep these when restyling UI
- `InventoryDashboard.tsx`: `isKgProduct`, `butirEstimate`, `formatStock`, `toButirEquivalent` (cross-product aggregates must use butir-equivalents, never sum kg + butir raw)
- `PickListDialog.tsx`: `formatButir` · `OrderSummaryPanel.tsx`: `eggUnit` · `GroupedActivityLog.tsx`: `useStockUnitLabel`
- Rule of thumb: per-product numbers display in native unit (kg gets `(≈ N butir)` parenthetical); cross-product totals display as estimated butir-equivalent.

## Outflow pipeline (do not reintroduce client-side FIFO)
- ALL outflows go through the Postgres RPC `record_order_outflows(p_entries jsonb)`: atomic per order (eggs+packaging+labels+boxes all-or-nothing), row-locked FIFO with relative updates, idempotent by client entry UUID (replay-safe). Client-side FIFO with absolute writes caused silent stock inflation — never bring it back.
- Offline outbox: network-failed orders queue in localStorage (`src/lib/outflowOutbox.ts`, `useOutflowOutbox`) and replay FIFO on reconnect. INSUFFICIENT_STOCK is never queued.
- Catalog-driven config: egg conversions (`unit`/`eggs_per_unit`), box capacities (`box_capacities` JSONB keyed by SKU code), labels-per-pack (`labels_per_pack`), freshness window (`freshness_days`, default 5), low-stock threshold (`low_stock_threshold`). All editable in Catalog UI; hardcoded dicts in code are offline fallbacks only.

## UUID migration (in progress — see docs/uuid-migration/PLAN.md)
- Stage A APPLIED (2026-07-07): `item_type_id` on inflows/outflows, `egg/packaging_item_type_id` on pack_skus, FK-validated, resolver triggers auto-fill ids on name-only inserts.
- Names are STILL the operational key until Stage C. Until then: renaming catalog items does NOT cascade to `pack_skus` name pointers (SQL pass required) and box names must equal the `BoxModeType` union — do not rename boxes.
- Canonical naming: eggs and packaging ALL CAPS; `activity_logs.product`/`invoice_supplier` stay name snapshots by design.

## Gotchas
- `.env`/`config.toml` may carry a STALE Supabase ref `kpszurxnzhivrvzmcded` — the live project is `lgtixzpjbkzapecirbfj`.
- vitest excludes `.claude/**` (agent worktrees live there — keep it that way).
- Sentry is wired but inert until `VITE_SENTRY_DSN` is set in Vercel (see docs/OPERATIONS.md).
- i18n: every user-facing string goes in BOTH `src/locales/en.ts` and `id.ts`.
- Repo compiles with `strict: false`; discriminated-union narrowing doesn't work.
