# CLAUDE.md — EggKeep

Live React/TS + Supabase PWA for an Indonesian egg-distribution business (real warehouse, real users on phones). Treat production data as sacred.

## Skills
- **Reading a photo of a hand-filled paper form** (Formulir Penerimaan/Pengiriman, "barang masuk/keluar", daftar ambil) → use the `read-egg-form` skill (`.claude/skills/read-egg-form/`). It OCRs the handwriting, snaps values to the catalog, enforces Osave box math, and returns a reviewable table with per-cell confidence flags. It never writes to the DB — data entry is a separate, human-confirmed step.

## Deploy model
- Frontend: push to `main` → Vercel auto-builds (egg-keep.vercel.app). PWA is `registerType: "prompt"`: the SW checks for a new bundle on focus and every 15 min, but it only applies when the user taps the update toast — a phone can run an old bundle indefinitely, so keep DB changes backward-compatible.
- Edge Functions (`supabase/functions/inventory-assistant`, `supabase/functions/admin-users`): deploy separately (Supabase MCP `deploy_edge_function` or CLI). Git push does NOT touch them.
- Migrations: applied via Supabase MCP `apply_migration` (or SQL Editor) against project `lgtixzpjbkzapecirbfj`. **Apply DB migrations BEFORE pushing frontend code that depends on them.**

## Commands
- Dev server: `npm run dev` · Lint: `npm run lint` · Build: `npm run build`.
- **Verify gate (run before every push): `npm run verify`** — chains the Supabase ref guard (fails if `.env` points at the stale project), `tsc --noEmit -p tsconfig.app.json`, and the full vitest run.
- Single test file: `npm test -- --run src/path/to.test.ts` · by name: `npm test -- --run -t "cap tightens"`.
- vitest flakes/OOMs on long sessions (workers exit, `tests 0ms`, hangs): rerun with `NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <path> --pool=forks --no-file-parallelism`. A hang at `tests 0ms` on a *component* file usually means an infinite render loop (an effect/memo depending on an unstable object identity), not the environment.

## CRITICAL: kg-native stock design
The `quantity_butir` / `remaining_butir` columns hold each product's NATIVE unit:
- **kg** for weight-sold eggs (catalog `item_types.unit='kg'`, e.g. NEGERI BIASA at `eggs_per_unit≈15.5` eggs/kg)
- **butir** for count-sold eggs
- **pcs** for boxes/labels/packaging

The column names are legacy — do NOT "fix" them and do NOT convert kg↔butir when storing or deducting. The conversion factor is ONLY for: pack sales of kg eggs (egg count → estimated kg) and butir-equivalent estimates on aggregate displays. Core helpers: `src/lib/inventory.ts` (`getStockUnit`, `toStockUnits`, `butirEquivalent`).

### Load-bearing display helpers — keep these when restyling UI
- `InventoryDashboard.tsx`: `isKgProduct`, `butirEstimate`, `formatStock`, and the lib `butirEquivalent` (cross-product aggregates must use butir-equivalents, never sum kg + butir raw)
- `PickListDialog.tsx`: `formatButir` · `OrderSummaryPanel.tsx`: `eggUnit` · `GroupedActivityLog.tsx`: `useStockUnitLabel`
- Rule of thumb: per-product numbers display in native unit (kg gets `(≈ N butir)` parenthetical); cross-product totals display as estimated butir-equivalent.

## Outflow pipeline (do not reintroduce client-side FIFO)
- ALL outflows go through the Postgres RPC `record_order_outflows(p_entries jsonb)`: atomic per order (eggs+packaging+labels+boxes all-or-nothing), row-locked FIFO with relative updates, idempotent by client entry UUID (replay-safe). Client-side FIFO with absolute writes caused silent stock inflation — never bring it back.
- Other stock-changing RPCs, same rule (server-side only): `correct_order` (order edit), `void_outflow`, `reconcile_inventory`, `recalculate_inventory_fifo`.
- Offline outbox: network-failed orders queue in localStorage (`src/lib/outflowOutbox.ts`, `useOutflowOutbox`) and replay FIFO on reconnect. INSUFFICIENT_STOCK is never queued.
- Catalog-driven config: egg conversions (`unit`/`eggs_per_unit`), box capacities (`box_capacities` JSONB keyed by SKU code), labels-per-pack (`labels_per_pack`), freshness window (`freshness_days`, default 5), low-stock threshold (`low_stock_threshold`). All editable in Catalog UI; hardcoded dicts in code are offline fallbacks only.

## Returns pipeline (retur)
- ALL returns go through the Postgres RPC `record_return(p_return jsonb)`: atomic, SECURITY DEFINER, idempotent by client line id, with a cumulative cap per `outflow_id` (prior returns + this line ≤ qty sold). Latest definition lives in the newest `supabase/migrations/*retakan*|*returns*` file — a change means a full `create or replace` of the whole body.
- Three dispositions per returned line (a single line can split across all three): **restock** → eggs back into the outflow's original FIFO batches (bounded by deducted−already-restored, writes `return_restocks`); **retakan** → a fresh inflow on the parent's tagged child item_type `"<PRODUCT> (RETAKAN)"` (`is_retakan=true`, `parent_item_type_id`), never touching the parent's batches; **writeoff** → logged only, no stock change.
- Eggs pool **per egg product** (one outflow row per egg, even across SKUs), so returns key by `outflow_id`; `returns.sku_code` is a display label only (which order line a pooled-egg return belongs to) — null for loose/manual. `usePriorReturns` returns the cumulative cap (`.total`) plus a per-SKU `bySku` breakdown.
- Return **entry is per order line in PIECES**; `src/lib/returnsCap.ts` (`piecesToNative`/`nativeToPieces`) converts at a flat `NEGERI_PIECES_PER_KG = 15.5` for kg-native eggs (NOT the catalog `eggs_per_unit`). Box SKUs carry no egg count — resolve eggs via base pack × box capacity (mirrors `resolveBoxLine`). Shared-egg rows (two SKUs → one egg) share one combined cap.
- Offline outbox mirrors outflows: `src/lib/returnOutbox.ts` / `useReturnOutbox` / `returnRpc.ts`.
- Feed display (`GroupedActivityLog.tsx`): shows delivered = sold − returned, with code `returnCode` (`src/lib/activityGrouping.ts`) → **O/R/H** (OK/Retak/Hancur = restock/retakan/writeoff), zero buckets omitted. Letters are fixed, not translated.

## Delivery log (Log Pengiriman & Retur) — Phase 1
- Spec: `docs/superpowers/specs/2026-10-29-delivery-return-log-design.md`. Routed page `/deliveries` (🚚 in Header / sidebar), one `deliveries` row per faktur keyed on the PO's `invoiceRef` (`invoice_ref_norm = upper(trim())`, unique). Opening a PO writes nothing; the first saved edit creates the row. The list is `purchase_orders` LEFT JOIN `deliveries` (`src/lib/deliveryFlags.ts` mirrors the `open_delivery_items` view). Never touches stock, outflows, returns or any RPC.
- Drivers (Supir) live in `drivers` (Catalog → Supir, admin-only edit UI gate). `expiry_rules` is table + seed only until Phase 2.
- Export (`src/lib/deliveryExport.ts`) emits the sheet's column order with fixed Indonesian headers, `dd/mm/yyyy`, decimal comma, `;` separator; Phase 1 fills columns 1–8 only.

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
