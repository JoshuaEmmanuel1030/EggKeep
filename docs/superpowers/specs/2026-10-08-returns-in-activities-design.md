# Show returned quantities on the Activities feed

**Date:** 2026-10-08
**Status:** Design — approved for spec review

## Problem

The Activities feed shows every outflow line at its **sold** quantity. Once a
return (retur) is recorded against that line, the feed still shows the original
number, giving no sign the customer sent eggs back. Users want each affected
line to read as **actually delivered** (sold minus returned), with a compact
indicator of how much came back and in what condition.

Example: an order delivers KP6O ×200. 50 come back — 25 good, 25 cracked. The
line should read `150 delivered` (← was 200) with `(50 returned · 25B 25R)`.

## Scope

Read-only display over data the returns feature already writes. **No DB,
migration, or RPC changes.** Returns are recorded exactly as today
(`record_return` RPC, `returns` table, three dispositions).

## Background: the data

- Returns live in the `returns` table, one row per returned bucket, keyed by
  `outflow_id`, with a `disposition` of `restock` | `retakan` | `writeoff` and
  a `quantity` in the product's native unit (kg / butir).
- Each egg outflow **activity log** carries `metadata.relatedEntryId` = the
  `outflows.id` it came from (the reliable path used by void + return). This is
  the join key between a feed line and its returns.
- Legacy logs created before `relatedEntryId` existed won't have it. Those lines
  show no annotation (acceptable: returns shipped 2026-09-21; every returnable
  order since carries the id).

## Disposition code

Three fixed Indonesian letters, always in this order, **zero buckets omitted**:

| Bucket | Disposition | Meaning |
|--------|-------------|---------|
| `B` | `restock` | Baik — good, restocked |
| `R` | `retakan` | Retak — cracked, reusable (tagged variant) |
| `A` | `writeoff` | Afkir — scrapped / written off |

- A good+cracked-only return reads `25B 25R` (no `0A`).
- A full three-way return reads `20B 25R 5A`.
- Letters are fixed regardless of UI language (they match what staff write on
  the paper forms).

## Component 1 — `usePriorReturns` returns a per-disposition breakdown

**File:** `src/hooks/usePriorReturns.ts`

Generalize the existing hook. It already fetches `returns` rows by
`outflow_id`; extend the `select` to include `disposition` and change the return
shape from `Record<string, number>` to:

```ts
export interface ReturnsSummary {
  restock: number;
  retakan: number;
  writeoff: number;
  total: number;
}
// Record<outflowId, ReturnsSummary>
```

- Sum each row into its disposition bucket and into `total`.
- Outflows with no returns are simply absent from the map (callers default).

**Consumer update:** `RecordReturnDialog.tsx` currently reads
`priorByOutflow[outflowId] ?? 0`. Change to `priorByOutflow[outflowId]?.total ?? 0`.
Its cap behaviour is unchanged. Update `RecordReturnDialog.test.tsx` mocks that
assume the old numeric map.

Keeping one hook (one query, one aggregation path) for both the dialog cap and
the feed annotation avoids a second, drifting copy of the same logic.

## Component 2 — one pure helper

**File:** `src/lib/activityGrouping.ts` (alongside `clampReturnQty`)

```ts
import { ReturnsSummary } from "@/hooks/usePriorReturns";

// "25B 25R" — B/R/A order, zero buckets omitted. "" when nothing returned.
export function returnCode(returns: ReturnsSummary): string;
```

- Formats each non-zero bucket as `<qty><letter>` joined by a space; quantities
  use `toLocaleString()` (kg decimals preserved, e.g. `12,5B`).

Delivered is just `sold - (returns?.total ?? 0)` — inlined at the render sites,
not a named function.

**Test** (`src/lib/__tests__/activityGrouping.test.ts`): zero-suppression
(`25B 25R`, no `0A`), full three-way (`20B 25R 5A`), empty (`""`).

## Component 3 — feed wiring

**File:** `src/components/GroupedActivityLog.tsx`

- At the top of `GroupedActivityLog`, collect every egg outflow log's
  `metadata.relatedEntryId` from `logs` (filter `category === "egg" &&
  action_type === "outflow"`), call the generalized `usePriorReturns` once with
  that id list, and thread the resulting `Record<outflowId, ReturnsSummary>` map
  down through `DateSection` → the three entry components.
- A small local helper resolves a log's returns:
  `returnsForLog(log) = map[log.metadata?.relatedEntryId ?? ""]`.

## Component 4 — rendering

A shared presentational snippet (local to `GroupedActivityLog.tsx`) given a
`sold` quantity, a `ReturnsSummary | undefined`, and a unit label renders:

- **No returns** → the number exactly as today.
- **Has returns** → `<delivered> <unit>` as the primary number, a muted
  `← was <sold>` next to it, and on the line below an amber indicator
  `({total} returned · {code})` using
  `t.activity.returnedBadge` (e.g. `{n} returned`).

> Ultra note: `← was {sold}` is redundant — sold = delivered + returned, so the
> `{total} returned` badge already implies it. It's kept only because it was in
> the approved mockup. Dropping it removes the `wasQty` i18n key and one number
> from each line. Say the word and it goes.

Wired into the existing egg-line render sites:

1. **BuyerOrderCard**
   - **Loose egg order lines** (`line.eggProduct && line.looseQty`): match the
     line's `eggProduct` to the order's egg logs to get its
     `relatedEntryId`/returns, then render delivered + indicator in place of the
     current `looseQty`.
   - **Materials breakdown** (`item.type === 'egg'`): match `item.product` to the
     order's egg logs the same way; render delivered + `(↩{total})` compact form
     next to the quantity.
   - **Pack-SKU lines** (`line.skuCode`): untouched.
   - A loose-egg product can appear both as an order line and a materials row;
     it is annotated in both — intended (collapsed line vs. expandable detail).
2. **ManualOutflowEntry** — single egg log; swap `log.quantity_butir` for the
   delivered form + indicator when it has returns.
3. **ChronologicalEntry** — same single-egg-log treatment inline.

Matching is by product name within one order's egg logs; if more than one egg
log shares a product in the same order, sum their returns for that product.

## i18n

New keys in **both** `src/locales/en.ts` and `id.ts`:

- `activity.deliveredLabel` — EN `delivered` / ID `terkirim`
- `activity.wasQty` — EN `was {qty}` / ID `semula {qty}`
- `activity.returnedBadge` — EN `{n} returned` / ID `{n} diretur`

The B/R/A letters are not translated.

## Out of scope

- No change to how returns are recorded or capped.
- No new "returns" summary tile on the status strip (the earlier note in
  `GroupedActivityLog.tsx` about not faking returns from voids stays accurate).
- No backfill of `relatedEntryId` on legacy logs.

## Verify gate

`npx tsc --noEmit -p tsconfig.app.json` + `npm test -- --run` (vitest),
including the new `activityGrouping` cases and the updated
`RecordReturnDialog.test.tsx`.
