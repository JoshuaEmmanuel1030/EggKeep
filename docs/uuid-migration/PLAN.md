# Name → UUID Reference Migration Plan

**Status: PREPARED, NOT APPLIED. No SQL in this folder has been run against any database.**

## Problem

Four columns reference catalog items (`item_types`) by **name string** instead of the UUID
`item_types.id` that already exists:

| Column | Should reference |
|---|---|
| `inflows.product` (+ `category`) | `item_types(id)` |
| `outflows.product` (+ `category`) | `item_types(id)` |
| `pack_skus.egg_product` | `item_types(id)` where `category = 'egg'` |
| `pack_skus.packaging_item` | `item_types(id)` where `category = 'packaging'` (nullable) |

A typo'd or renamed name silently splits inventory or blocks orders. Real incident: SKU
pointer `BEBEK ASIN MATANG` vs catalog `ASIN MATENG` blocked a 1,800-egg dispatch. The
current mitigation is a rename-warning band-aid (`src/lib/catalogDependencies.ts` +
`RenameWarningDialog` used by `ItemTypeList`/`SKUList`/`BuyerList`), which warns but cannot
prevent divergence.

**Deliberately unchanged:** `activity_logs.product`, `activity_logs.invoice_supplier`, and
`outflows.invoice_supplier` are point-in-time audit snapshots. They MUST stay name strings.
The immutable log should read the way the world looked when the event happened.

**Do not disturb:** the kg-native stock design (`quantity_butir` holds kg for weight-sold
eggs). Nothing in this migration touches quantity semantics.

---

## Overview of stages

| Stage | DB | Client bundle | Rename safety |
|---|---|---|---|
| A. Add + backfill | new nullable `*_item_type_id` columns, backfill by name join, resolver triggers | unchanged (old bundle keeps working) | unchanged (warning band-aid still active) |
| B. Dual-write | (no schema change) | writes name **and** id | unchanged |
| C. Read-switch | RPC + FIFO rebuild match by id; reads join for name | reads/validates by id, name kept as display copy | rename safe for **new** flows |
| D. Enforce | NOT NULL + validated FKs; name becomes denormalized display column | drop name-matching code, retire rename warning | rename fully free |

Each stage is independently shippable and independently rollback-able. Do not start the
next stage until the previous one has soaked in production for at least a few days.

---

## Stage 0 — Pre-flight audit (run read-only, no writes)

Before any schema change, find every name that will fail the backfill join. Queries are in
`supabase/migrations/DRAFT_uuid_stage1_add_columns.sql.txt` § "PART 0 — ORPHAN DETECTION".
They report, per table, distinct `(category, name)` pairs with row counts that have **no
live match** in `item_types` (soft-deleted rows in `item_types` count as no-match, with a
flag telling you the name exists but is deleted).

For every orphan, the owner decides one of:

1. **Rename the history** to the current catalog name (e.g. `UPDATE inflows SET product =
   'ASIN MATENG' WHERE product = 'BEBEK ASIN MATANG'` — this is the incident pair; confirm
   with the owner which spelling is canonical before touching anything).
2. **Restore/create the catalog row** (un-soft-delete or insert into `item_types`) so the
   join succeeds — right choice when the history is correct and the catalog lost the item.
3. **Leave orphaned deliberately** (truly dead legacy product) — acceptable only for rows
   that will never be part of live stock (fully consumed inflows, old outflows). Stage D's
   NOT NULL must then be scoped (see Stage D options).

Known quirk to resolve now: `recalculate_inventory_fifo` currently matches inflows by
`product` **only** (no `category`), while `record_order_outflows` matches by
`product + category`. If any name exists in two categories, the rebuild and the live path
disagree today. The new definitions fix this (match includes category / id); verify with
the owner that no cross-category same-name pairs carry live stock before switching.

**Verify:** orphan queries return zero rows you haven't explicitly classified.

---

## Stage A — Add columns + backfill (DB only, no client change)

### SQL
`DRAFT_uuid_stage1_add_columns.sql.txt` PARTS 1–4:

- `inflows.item_type_id uuid REFERENCES item_types(id)` (nullable), same on `outflows`;
  `pack_skus.egg_item_type_id uuid`, `pack_skus.packaging_item_type_id uuid`.
  FKs created `NOT VALID`, then `VALIDATE CONSTRAINT` (no long lock, no false failures on
  pre-existing rows during the window).
- Backfill `UPDATE ... FROM item_types` joining on `(category, name)` — includes
  soft-deleted `item_types` rows on purpose: a historical inflow of a later-deleted item
  should still get its UUID. Ties (same name live + deleted) prefer the live row.
- Indexes on the new columns (the FIFO scan will switch to them in Stage C).
- **Resolver triggers** (`BEFORE INSERT` on `inflows` and `outflows`): if the incoming row
  has `item_type_id IS NULL` but a `product` name that resolves, fill the id. This is the
  key stale-client defense — it makes Stage A/B/C indifferent to which bundle version
  inserted the row.

### Code touchpoints
None required. Optionally regenerate `src/integrations/supabase/types.ts`
(`supabase gen types` / MCP `generate_typescript_types`) so the new columns exist in types
for Stage B.

### Rows from clients on the previous bundle
Old bundle inserts name-only rows → resolver trigger fills `item_type_id` at insert time.
Rows inserted between "columns added" and "trigger created" (a one-transaction window if
the draft file is applied as a single migration — it is) are covered by the backfill
`UPDATE`. Re-run the backfill once more a day later as a belt-and-braces sweep.

### Rollback
`DROP TRIGGER`s, `DROP COLUMN`s (PART R in the draft file). Nothing reads the new columns
yet, so rollback is trivially safe.

### Verify
- Orphan queries (PART 0) now report zero unresolved live rows.
- `SELECT count(*) FROM inflows WHERE item_type_id IS NULL AND voided_at IS NULL` → only
  the deliberately-orphaned legacy rows from Stage 0, ideally 0. Same for `outflows`,
  `pack_skus` (both id columns; `packaging_item_type_id` NULL is fine where
  `packaging_item` is NULL).
- Insert a test inflow **without** `item_type_id` via the live app → confirm trigger
  populated it.

---

## Stage B — Dual-write (client change, no behavior change)

Code writes both the name (as today) and the id. Reads still key on name. Deploy frontend
(Vercel) and nothing else; DB unchanged.

### Code touchpoints (writes)
| Location | Change |
|---|---|
| `src/hooks/useInventorySync.ts` : `addInflow`, `addMultipleInflows` | include `item_type_id: entry.itemTypeId` in the insert payload |
| `src/hooks/useInventorySync.ts` : `submitOrderOutflows` | include `item_type_id` per entry in the `record_order_outflows` RPC payload (RPC ignores unknown keys today, so this can ship before Stage C's RPC) |
| `src/hooks/usePackSKUs.ts` : `createSKU`, `updateSKU` mutations | write `egg_item_type_id` / `packaging_item_type_id` alongside `egg_product` / `packaging_item` |
| `src/hooks/useItemTypes.ts` : `eggProductNames`, `getTypesByCategory` | expose `{id, name}` pairs (or a `nameToId` map) so forms can attach ids |
| `src/components/InflowForm.tsx` (item rows → `handleSubmit`) | carry `itemTypeId` from the selected dropdown option into the built `InflowEntry` |
| `src/components/OutflowForm.tsx` (item rows → submit) | same for direct outflows |
| `src/components/QuickOutflowBuilder.tsx` + `src/lib/outflowCalculator.ts` : `calculateLineMaterials`, `aggregateOrderMaterials` | material aggregation currently keys maps by name (`eggsByProduct` etc.); attach the id to each aggregate line (SKU now carries `eggItemTypeId`/`packagingItemTypeId`; boxes/labels resolve via the item_types list) |
| `src/components/catalog/SKUDialog.tsx` | dropdown option value becomes the item id; keep name in the form for display; submit both |
| `src/types/inventory.ts` (`InflowEntry`, `OutflowEntry`, `PackSKU` in `outflowCalculator.ts`) | add optional `itemTypeId` / `eggItemTypeId` / `packagingItemTypeId` fields |
| `src/integrations/supabase/types.ts` | regenerate |

`useOfflineSync.ts` (activity_logs) intentionally unchanged — snapshots. Optionally add the
id to `metadata` for future forensics, but do not make it load-bearing.

### Rows from clients on the previous bundle
Old bundle writes name-only → Stage A trigger fills the id. **No data divergence.** This is
why the trigger lives in Stage A, not here.

### Rollback
Redeploy previous frontend bundle. DB accepts both shapes; trigger keeps ids populated.

### Verify
- Create an inflow and a full order in the new bundle; confirm rows carry `item_type_id`
  *set by the client* (temporarily disable the trigger on a **dev branch** to prove the
  client writes it, or compare `pg_trigger` fire counts — never disable in prod).
- Rename-warning flow still fires (band-aid stays until Stage D).

---

## Stage C — Read-switch (DB functions + client reads)

Matching moves to id; name becomes a display/denormalized copy. This is the stage that
actually fixes the incident class.

### SQL
`DRAFT_uuid_stage1_add_columns.sql.txt` PART 5 (apply as its own migration when Stage C
ships, not together with Stage A):

- **`record_order_outflows` v2**: per entry, resolve `v_item_type_id` :=
  `entry.item_type_id`, else look up by `(category, name)` among live catalog rows, else
  `RAISE 'UNKNOWN_PRODUCT'` (fail loud — this exact error would have turned the
  1,800-egg silent blockage into an immediate, diagnosable message). FIFO scan matches
  `inflows.item_type_id = v_item_type_id` with a name fallback branch for any inflow row
  whose id is still NULL (deliberate Stage-0 orphans). Outflow insert stores **both** id
  and name (name = catalog display name at time of sale — it doubles as the snapshot).
- **`recalculate_inventory_fifo` v2**: same matching rule (id first, name+category
  fallback), and now includes `category` in the fallback match — fixing the current
  cross-category quirk. Return shape unchanged (`product_name` via join/COALESCE), so
  `src/hooks/useRecalculateInventory.ts` needs no change.

### Code touchpoints (reads)
| Location | Change |
|---|---|
| `src/lib/catalogDependencies.ts` : `checkItemTypeDependencies` | count by `.eq("item_type_id", id)` / `.eq("egg_item_type_id", id)` instead of name — signature takes the item id |
| `src/components/catalog/ItemTypeList.tsx` (lines ~79, ~157) | pass `item.id` to the dependency check |
| `src/lib/outflowCalculator.ts` : `validateStockAgainstInventory` | match stock summary rows by id (fallback to name for rows without one) |
| `src/lib/inventory.ts` : `calculateStockSummary`, `getTotalAvailableStock`, `processOutflowFIFO` | key product map by `(category, itemTypeId ?? name)`; keep `product` name on the summary rows for display; `processOutflowFIFO` is the legacy client-side FIFO — verify it is only used for previews, not persistence, before/while switching |
| `src/components/PickListDialog.tsx` (line ~115) | look up `stockSummary` by id |
| `src/components/InventoryDashboard.tsx` (lines ~69, ~156) | `stockMap` key and low-stock matching switch from `${category}-${product}` to `${category}-${itemTypeId}` |
| `src/hooks/useVoidEntry.ts` : `findRelatedEntryId` (line ~224) | primary path is already id-based (`metadata.relatedEntryId`); in the legacy name fallback, prefer `item_type_id` match when the log has one, keep name match for pre-migration logs. `voidOutflow` restore path is already keyed by `fifo_deductions.inflow_id` — no change |
| `src/hooks/useInventorySync.ts` : `fetchData` | map `row.item_type_id` into entries; also note line 31's hardcoded `"NEGERI BIASA"/"NEGERI OMEGA"` unit check — an existing name-keyed landmine worth switching to the conversion map while in the file |
| `supabase/functions/inventory-assistant/index.ts` (lines ~59–165) | analytics grouping by `product` string; group by `item_type_id` and join `item_types` for the display name so a rename doesn't split its time series. Read-only, low risk, deploys independently (Edge Functions deploy separately from the Vercel frontend — coordinate) |

**Display-only, no change:** `GroupedActivityLog.tsx`, `ActivityLogList.tsx` (+ its CSV
export), `VoidEntryDialog.tsx`, `BuyerList.tsx` history tab, `useActivityLogs.ts`,
`InventoryStackedBarChart.tsx`, `InventoryTrendLineChart.tsx`, `Index.tsx` CSV export
(`exportInflowsToCSV` — name column in the CSV is a feature, keep it; optionally append an
`item_type_id` column for spreadsheet joins).

**Deliberately name-keyed, review-but-keep:** `conversionMap` / `boxCapacityMap` /
`freshnessDaysByProduct` in `useItemTypes.ts` + `inventory.ts` are keyed by name. They are
rebuilt from the live catalog each load, so a rename self-heals for *catalog* data — but
historical inflow rows with the old name lose their conversion. Re-keying these by id is
the natural follow-up; scope it into Stage C or explicitly defer (open question 4).

### Rows from clients on the previous (Stage-B) bundle
Old bundle sends id + name in the RPC → v2 RPC uses the id: identical behavior. A
*pre-Stage-B* bundle sends name only → v2 RPC resolves it server-side; if the name doesn't
resolve, the order fails with `UNKNOWN_PRODUCT` instead of silently mis-deducting —
strictly better than today.

### Rollback
`CREATE OR REPLACE` the Stage-A-era function bodies back (keep them in the migration file
as comments / in git). Client rollback = redeploy previous bundle; the v2 RPC still accepts
name-only payloads, so mixed versions are safe in both directions.

### Verify (on a dev branch first — see Testing)
- Rename an egg type in the catalog, then immediately place an order for it via SKU →
  succeeds (the incident scenario, now green).
- Submit an order with a bogus name and no id → `UNKNOWN_PRODUCT`, nothing deducted.
- Run `recalculate_inventory_fifo` before/after the switch on identical data → identical
  `remaining_butir` per inflow row (diff the table).
- Concurrency: two simultaneous orders on the same product still serialize (FOR UPDATE
  path unchanged).

---

## Stage D — Enforcement (rename becomes free)

Only after Stage C has soaked and `item_type_id IS NULL` counts are stable at the known
legacy set.

### SQL (sketch — write the real migration at the time)
- `pack_skus`: `ALTER COLUMN egg_item_type_id SET NOT NULL` (SKUs are few and all live —
  no legacy exception needed). `packaging_item_type_id` stays nullable (mirrors
  `packaging_item`).
- `inflows`/`outflows`: either full `SET NOT NULL` (if Stage 0 left zero orphans) or a
  `CHECK (item_type_id IS NOT NULL OR created_at < 'YYYY-MM-DD') NOT VALID`-style guard
  scoped to post-migration rows, plus a `BEFORE INSERT` trigger raising on NULL after
  resolution fails. Trigger-enforced is simpler here than a partial constraint.
- Add a rename-propagation trigger on `item_types` (`AFTER UPDATE OF name`) that rewrites
  the denormalized `inflows.product`/`outflows.product`/`pack_skus.egg_product`/
  `pack_skus.packaging_item` copies — OR decide names on transactional rows are frozen
  display snapshots and skip this (open question 2). `pack_skus` at minimum should get the
  propagation, since its names feed dropdown display.
- Keep FKs as plain `REFERENCES` (no CASCADE): `item_types` uses soft-delete, hard deletes
  shouldn't happen; RESTRICT-by-default protects history.

### Code touchpoints
- Retire `RenameWarningDialog` usage for item renames in `ItemTypeList.tsx` (rename is now
  free); keep dependency checks for **delete** (soft-delete of an in-use item still
  deserves a warning) and for buyers (name-keyed by design).
- `src/lib/catalogDependencies.ts`: `checkItemTypeDependencies` shrinks to a delete-guard.

### Rows from clients on the previous bundle
Any still-alive pre-Stage-B PWA session inserts name-only → resolver trigger fills the id →
passes NOT NULL. If the name is unresolvable, insert **fails loudly** — correct behavior at
this stage. (PWA sessions "stay open all day on the warehouse phones" — check
Vercel/analytics for stragglers and force-refresh devices before enforcing.)

### Rollback
Drop the NOT NULL / enforcement trigger. Everything else keeps working (Stage C code never
assumed enforcement).

---

## Complete code-touchpoint inventory

Every `src/` + Edge Function location that reads or writes the name-keyed fields, one line
each. **W** = writes name-keyed data, **R** = reads/matches by name, **D** = display-only
(no change), **S** = snapshot by design (no change).

| # | Location | Type | Note |
|---|---|---|---|
| 1 | `src/hooks/useInventorySync.ts:addInflow` | W | add `item_type_id` to insert (Stage B) |
| 2 | `src/hooks/useInventorySync.ts:addMultipleInflows` | W | same (Stage B) |
| 3 | `src/hooks/useInventorySync.ts:submitOrderOutflows` | W | add `item_type_id` per RPC entry (Stage B) |
| 4 | `src/hooks/useInventorySync.ts:fetchData` (line 31) | R | hardcoded `NEGERI BIASA/OMEGA` unit inference — replace with conversion-map lookup (Stage C) |
| 5 | `src/hooks/usePackSKUs.ts` create/update mutations | W | write `egg_item_type_id`/`packaging_item_type_id` (Stage B) |
| 6 | `src/hooks/usePackSKUs.ts` fetch mapping (lines 24–25) | R | map new id columns onto `PackSKU` (Stage B) |
| 7 | `src/hooks/useItemTypes.ts:eggProductNames` / `getTypesByCategory` | R | expose ids alongside names for form options (Stage B) |
| 8 | `src/hooks/useVoidEntry.ts:findRelatedEntryId` | R | legacy fallback matches `.eq('product', ...)` — prefer id when log has one (Stage C) |
| 9 | `src/hooks/useVoidEntry.ts:voidOutflow` | — | already id-keyed via `fifo_deductions.inflow_id`; no change |
| 10 | `src/hooks/useOfflineSync.ts` (lines 75, 136) | S | `activity_logs.product` snapshot — no change; queued offline logs from old bundles sync unchanged |
| 11 | `src/hooks/useActivityLogs.ts` | S/D | reads snapshots for display |
| 12 | `src/hooks/useRecalculateInventory.ts` | — | RPC signature/return unchanged by v2; no change |
| 13 | `src/lib/catalogDependencies.ts:checkItemTypeDependencies` | R | switch counts to id columns (Stage C); shrinks to delete-guard (Stage D) |
| 14 | `src/lib/catalogDependencies.ts:checkSKUDependencies` / `checkBuyerDependencies` | S | ilike over `invoice_supplier` snapshot — unchanged |
| 15 | `src/lib/inventory.ts:calculateStockSummary` | R | key product map by `(category, id)`; keep name for display (Stage C) |
| 16 | `src/lib/inventory.ts:getTotalAvailableStock` / `processOutflowFIFO` | R | filter by id with name fallback; confirm preview-only usage (Stage C) |
| 17 | `src/lib/inventory.ts:exportInflowsToCSV` | D | CSV keeps name column; optional extra id column |
| 18 | `src/lib/outflowCalculator.ts:calculateLineMaterials` / `aggregateOrderMaterials` | R/W | aggregation maps keyed by name; carry ids through to outflow entries (Stage B) |
| 19 | `src/lib/outflowCalculator.ts:validateStockAgainstInventory` | R | match summary rows by id (Stage C) |
| 20 | `src/components/InflowForm.tsx` | W | dropdown → carry `itemTypeId` into entries (Stage B) |
| 21 | `src/components/OutflowForm.tsx` | W/R | same, plus `getAvailableStock` name filter → id (Stages B+C) |
| 22 | `src/components/QuickOutflowBuilder.tsx` + `OrderLineItem.tsx` + `OrderSummaryPanel.tsx` | W | SKU-driven order build; ids flow from `PackSKU` through aggregation (Stage B) |
| 23 | `src/components/PickListDialog.tsx` (line 115) | R | stock lookup by name → id (Stage C) |
| 24 | `src/components/InventoryDashboard.tsx` (lines 69, 156) | R | `stockMap`/low-stock keys name → id (Stage C) |
| 25 | `src/components/catalog/SKUDialog.tsx` | W | option values become ids; name kept for display (Stage B) |
| 26 | `src/components/catalog/ItemTypeList.tsx` (lines 79, 157) | R | pass id to dependency check (Stage C); drop rename warning (Stage D) |
| 27 | `src/components/catalog/SKUList.tsx` / `RenameWarningDialog.tsx` | D | display + band-aid UI; retire warning at Stage D |
| 28 | `src/components/catalog/BuyerList.tsx` | S | buyer names in `invoice_supplier` snapshots — out of scope |
| 29 | `src/components/ActivityLogList.tsx` (CSV export, lines 13, 245) | S/D | exports log snapshots — no change |
| 30 | `src/components/GroupedActivityLog.tsx` / `VoidEntryDialog.tsx` | D | render `log.product` snapshots |
| 31 | `src/components/InventoryStackedBarChart.tsx` / `InventoryTrendLineChart.tsx` | D | group by name for chart labels; safe (feeds off summary rows) |
| 32 | `src/pages/Index.tsx` (lines 94–96) | D | CSV export handoff — no change |
| 33 | `src/types/inventory.ts` / `src/types/activityLog.ts` | W | add optional `itemTypeId` fields (Stage B) |
| 34 | `src/integrations/supabase/types.ts` | — | regenerate after each DB stage |
| 35 | `supabase/functions/inventory-assistant/index.ts` (lines 59–228) | R | analytics group-by-name; switch to id + joined display name so renames don't split series (Stage C; separate deploy) |
| 36 | `supabase/migrations/*` — `record_order_outflows`, `recalculate_inventory_fifo` | R/W | v2 definitions in the draft file (Stage C) |

Roughly **36 locations touched by the audit; ~20 need code changes** (9 in Stage B,
~10 in Stage C, 2 retired in Stage D); the rest are verified-no-change.

---

## Testing strategy (before production)

1. **Supabase dev branch via MCP** (project ref `lgtix` — NOT the stale `kpsz`):
   `mcp__supabase__create_branch` → apply Stage A migration on the branch →
   run PART 0 orphan queries and PART V verification queries against branch data →
   `reset_branch` to iterate. Branch databases start from migrations, so **seed the branch
   with a realistic copy** of `item_types`, `pack_skus`, and a slice of
   `inflows`/`outflows` (including the ASIN MATENG history) before judging the backfill.
2. **Frontend against the branch**: point a local `vite` dev build at the branch URL/keys
   (`get_project_url`/`get_publishable_keys` for the branch) — never point Lovable/Vercel
   prod env at the branch. Walk the four flows: inflow entry, SKU order (QuickOutflowBuilder),
   direct outflow, void — then run `recalculate_inventory_fifo` and diff `remaining_butir`.
3. **FIFO equivalence test** (the one non-negotiable): snapshot
   `inflows(id, remaining_butir)` → run old rebuild → snapshot → run v2 rebuild → snapshot;
   the two result sets must be identical on backfilled data. Any diff = a name/category
   resolution mismatch to chase before Stage C.
4. **Mixed-version test**: with the Stage-C branch DB, submit an order using a
   name-only payload (simulating the old bundle, e.g. `execute_sql` calling the RPC) —
   must succeed via server-side resolution.
5. **Production rollout order**: Stage A migration (quiet hours; it takes brief locks for
   `ADD COLUMN` — fast — and row-level locks during backfill) → verify → Stage B frontend
   deploy → soak → Stage C migration + frontend + Edge Function deploy (same day, DB first;
   v2 RPC is backward compatible so the ordering is safe) → soak → Stage D.
   Remember EggKeep deploy topology: **Lovable auto-commits to main and frontend deploys to
   Vercel while Edge Functions deploy separately** — coordinate so a Lovable auto-deploy
   can't ship half of Stage C. Take `mcp__supabase__get_advisors` + a backup/PITR point
   before each DB stage.

---

## Open questions for the owner

1. **Canonical name for the incident pair**: is `ASIN MATENG` (catalog) or
   `BEBEK ASIN MATANG` (old SKU pointer) the real product name? Stage 0 must rewrite one
   of them; wrong choice mislabels history on invoices/logs.
2. **Rename propagation on historical rows** (Stage D): after a rename, should old
   inflow/outflow rows *display* the new name (propagate denormalized copy) or the name in
   effect at the time (freeze)? Recommendation: propagate on `pack_skus`, freeze on
   `inflows`/`outflows` (activity_logs freeze regardless), but this is a business call.
3. **Scope of NOT NULL** (Stage D): are the Stage-0 "leave orphaned" legacy rows
   acceptable, forcing trigger-based enforcement instead of a clean column-level
   NOT NULL? Cleanest outcome is fixing every orphan and using real NOT NULL.
4. **Conversion/capacity maps keyed by name** (`conversionMap`, `boxCapacityMap`,
   `freshnessDaysByProduct`): re-key by id inside Stage C, or defer to a follow-up? They
   self-heal for live catalog data but leave historical old-name rows without conversions
   after a rename. Deferring is safe but leaves a known wart.
5. **`recalculate_inventory_fifo` category fix**: v2 adds `category` to the match. Confirm
   no product name legitimately spans categories with live stock, otherwise the first
   post-switch rebuild will (correctly) reallocate — the owner should expect the diff.
6. **Buyers**: `checkBuyerDependencies` shows buyers are also name-keyed (via
   `invoice_supplier` free text). Out of scope here — flag for a future pass, or accept
   free-text forever?
