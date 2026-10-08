# Per-SKU returns + class rename (O/R/H) + Negeri pieces→kg

**Date:** 2026-10-08
**Status:** Design — for spec review
**Builds on:** `2026-10-08-returns-in-activities-design.md` (branch `feat/returns-in-activities`, PR #7). This supersedes that branch's per-SKU *display* bubble (which doubled on shared eggs) and the B/R/A code.

## Problem

The return window asks "how many of this **egg type** came back on the whole order?" But a buyer's eggs are pooled per egg product across SKUs, so when two SKUs share an egg (KP10B + KP6B → KAMPUNG BIASA) the user must mentally sum the per-SKU returns before typing, and the feed can't show which SKU a return belonged to (it doubles the one egg return onto every SKU line).

Users want to enter returns **per order line (SKU)** in **pieces**; the app sums per egg product for the stock deduction and shows each SKU's own return on the feed.

Two more rules land in the same change:
1. **Return classes renamed** and recoded: **OK** (good, restock) → `O`, **Retak** (cracked, retakan) → `R`, **Hancur** (destroyed, writeoff) → `H`. (Was Baik/Retak/Afkir = B/R/A.)
2. **Negeri (kg-native) returns are entered in pieces** and converted to kg at `1/eggsPerUnit` (≈1/15.5). Non-Negeri (butir-native) stay 1 piece = 1 butir.

## What stays the same (invariants)

- Eggs are still deducted/pooled **per egg product** — one outflow row per egg (see `outflowCalculator.ts` `eggsByProduct`). We do NOT split outflows per SKU.
- Retakan still lands as a **fresh inflow on the parent's tagged `… (RETAKAN)` child** item_type — `record_return`'s retakan branch is unchanged.
- Restock still returns eggs to the **egg's own FIFO batches**; the SKU is a reporting label only.
- The `record_return` cumulative cap stays **keyed by `outflow_id`** (per egg): sum of all a line's returns ≤ that egg's sold qty.
- Stock/cap math stays in the product's **native unit** (kg for Negeri, butir otherwise). Pieces↔kg conversion happens **client-side** before the RPC (mirrors how pack sales convert in the outflow builder) — so the RPC keeps receiving native quantities.

## Component 1 — DB: add `sku_code` to returns

**Migration (new file):**
```sql
alter table public.returns add column if not exists sku_code text;
```
No backfill (existing rows stay null — they predate per-SKU and match by product on the feed). No index needed (returns are queried by `outflow_id`, already indexed).

**`record_return` RPC (redefine the current version — latest is in `20260921000000_retakan_reuse_guard.sql`):** the ONLY change is to persist the new field. In the `insert into returns (...)` column list add `sku_code`, and in `values (...)` add `nullif(v_line->>'sku_code','')`. The cap, retakan, and restock logic are untouched — quantities still arrive in native units.

Apply via Supabase MCP `apply_migration` against `lgtixzpjbkzapecirbfj` **before** pushing frontend (per EggKeep deploy rules).

## Component 2 — types

- `ReturnLineInput` (`src/types/returns.ts`): add `skuCode?: string` (null for loose egg lines). `returnRpc.ts` maps it to `sku_code` in the RPC payload.
- `ReturnsSummary` (`src/hooks/usePriorReturns.ts`): unchanged shape `{restock, retakan, writeoff, total}`, but the hook now also exposes a per-SKU breakdown — see Component 4.

## Component 3 — Return dialog: per-order-line entry

**File:** `src/components/RecordReturnDialog.tsx` (significant rework)

**New inputs from the caller:** the dialog currently takes `eggLogs: ActivityLog[]`. Add `orderLines: OrderLineLike[]` (the buyer order's lines: `{ skuCode?, packQty?, eggProduct?, looseQty? }`) so it can render one row per line. The egg-log list is still needed to resolve each egg's `outflow_id` (via `findRelatedEntryId`) and its sold/remaining cap.

**Row model:** one input row per order line.
- **Pack line** (`skuCode` + `packQty`): egg product = `usePackSKUs` `code→eggProduct`; sold **pieces** = `packQty × eggsPerPack` (from the SKU catalog). `skuCode` is carried onto the emitted return lines.
- **Loose egg line** (`eggProduct` + `looseQty`): egg product = `eggProduct`; sold pieces = `looseQty` for butir eggs, or `looseQty × eggsPerUnit` if the loose line is a kg egg. `skuCode` = undefined.

Each row still splits across the three classes, now labelled **OK / Retak / Hancur**.

**Units:** the user types **pieces** in every box. Convert to native per egg product:
`native = unit==='kg' ? round(pieces / eggsPerUnit, 2) : pieces` (eggsPerUnit from `conversionMap`, fallback 15.5).

**Shared-egg cap (the careful part):** several rows can map to the same egg product. The returnable budget is that egg's `remaining_native = outflow.quantity_butir − priorReturns.total` (from `usePriorReturns`, already native). Group rows by egg product and enforce that the **sum of all rows' converted-native quantities for that egg ≤ remaining_native**. Display the cap in pieces (`remaining_native × eggsPerUnit` for kg). The combined clamp, not just per-row, prevents KP10B+KP6B together exceeding Kampung Biasa's sold. Keep a running native remainder on submit (like the existing per-bucket clamp) so rounding can never push the summed native qty over the RPC cap.

**Submit:** emit one `ReturnLineInput` per (row, non-zero class): `{ id, outflowId (the egg's pooled outflow), skuCode, product (egg), category, quantity (native), disposition }`. The RPC sums them per `outflow_id` under the one cap.

## Component 4 — feed: match returns to SKU lines

**File:** `src/hooks/usePriorReturns.ts` + `src/components/GroupedActivityLog.tsx`

- `usePriorReturns` query: add `sku_code` to the `select`. Return, per `outflow_id`:
  `{ restock, retakan, writeoff, total, bySku: Record<string, ReturnsSummary> }`
  where `bySku` buckets rows by `sku_code` (null → key `""`). The top-level totals (used by the dialog cap) are unchanged.
- **BuyerOrderCard:**
  - **Pack line:** look up the SKU's egg log → its `outflow_id` → `returnsMap[outflowId].bySku[skuCode]`. Show the `ReturnBubble` with that per-SKU summary. This **removes the doubling** — each SKU shows only its own.
  - **Loose egg line:** unchanged `DeliveredLine` matched by egg product (`bySku[""]` for that egg's outflow, or the product total if no loose/sku split exists).
  - **Materials breakdown (egg row):** show the egg's **total** return (summed across SKUs) — this is the pooled number that "comes out" of the egg — via `DeliveredLine`, plus the unit note (Component 5).
- **ManualOutflowEntry / ChronologicalEntry:** single egg log → use the outflow's **total** summary (no SKU context there).

## Component 5 — code letters O/R/H + unit note

- `returnCode` (`src/lib/activityGrouping.ts`): letters become `O` (restock), `R` (retakan), `H` (writeoff). Order O/R/H, zero buckets omitted, `toLocaleString()` quantities. Update the existing unit tests (`25B 25R` → `25O 25R`, `20B 25R 5A` → `20O 25R 5H`).
- **Unit note in materials:** the materials-row return indicator appends the egg's native unit — `pcs` for butir eggs, `kg` for Negeri — so a converted Negeri return reads e.g. `(2 returned · 2O) kg`. Use the existing `unitLabel` the materials row already has; surface it in `DeliveredLine` via a prop or a trailing span.

## Component 6 — dialog class labels + i18n

Both `src/locales/en.ts` and `id.ts`:
- `returnRestock` → **OK** · `returnRetakan` → **Retak** · `returnWriteOff` → **Hancur** (warehouse vocabulary, same in both locales so the O/R/H letters match the labels).
- `returnedBadge` already `{n} returned` / `{n} retur`.
- Add any new strings (unit note) to both.

The retakan help text (`returnRetakanHelp`) stays — Retak still means the tagged reusable child.

## Out of scope

- No per-SKU outflow rows; no change to `record_order_outflows`, FIFO, or how stock pools.
- No backfill of `sku_code` on existing return rows (they keep matching by product).
- No change to offline outbox plumbing beyond carrying the new `skuCode`/`sku_code` field through the existing payload.

## Open decisions for review

1. **EN class labels** — spec uses the Indonesian warehouse terms **OK / Retak / Hancur** in both locales (so the O/R/H letters match). Prefer English (OK / Cracked / Destroyed) with letters still O/R/H? 
2. **Loose egg lines** — assumed rare alongside pack SKUs; they store `sku_code = null` and match by egg product. Confirm that's acceptable.
3. **Negeri conversion factor** — per-product `eggsPerUnit` from the catalog (so Merah vs Biasa can differ), fallback 15.5. Confirm not a flat 15.5 for all Negeri.

## Verify gate

Apply migration first. Then `npx tsc --noEmit -p tsconfig.app.json` + `npm test -- --run`, including: updated `returnCode` O/R/H tests, a Negeri pieces→kg conversion test, a shared-egg combined-cap test, and feed per-SKU bubble (no doubling) + materials-total tests.
