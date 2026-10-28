# Box SKUs — order in whole boxes (design)

**Date:** 2026-09-15
**Status:** Approved for planning

## Problem

Osave orders exclusively in **whole boxes** (box osave), never in packs. Today the
outflow builder only accepts a **pack** quantity per line, so staff receive "5 boxes"
and must hand-multiply 5 × 18 = 90 to type packs. Manual math on every Osave order —
error-prone, and data-entry accuracy is the business's #1 pain point.

## Goal

Let staff pick a **Box SKU** (e.g. "Box Osave N10B") from the outflow SKU list and enter
a **box** quantity. The order deducts exactly what a box-osave order deducts today:
eggs, packs, physical boxes, and labels — no new stock math.

Out of scope: multi-pack-type boxes (one box = one pack type), buyer-specific box
profiles ([[per-buyer-packaging]]), changing how loose-egg lines work.

## Core idea: a Box SKU is a named shortcut that desugars to a pack line

A Box SKU stores **no quantities of its own**. It only references:

- **base pack SKU** — the pack it wraps (e.g. `N10B`)
- **box** — which box it ships in (e.g. `box osave`)

The packs-per-box number (18) is **read live** from that box's existing
**Packs-per-box** config in the Catalog (`box_capacities`, set in the box item's edit
dialog, `ItemTypeDialog.tsx:269`). There is exactly **one** copy of "18" in the system;
the Box SKU never duplicates it.

When an order line selects a Box SKU with quantity `N` (boxes), it **desugars** to the
equivalent pack line:

```
packQty      = N × box_capacities[box][basePack]      // 5 × 18 = 90
skuCode      = basePack                                // N10B
boxModeOverride = box                                  // box osave  (so physical boxes deduct)
```

…and then flows through the **existing** `calculateLineMaterials` pack branch unchanged.

## Why this is the whole implementation

`calculateLineMaterials` (`src/lib/outflowCalculator.ts`) is the single choke point every
outflow path routes through:

- outflow submit / stock validation (`aggregateOrderMaterials`, `validateStockAgainstInventory`)
- the per-SKU CSV export (`outflowSkuExport.ts` re-runs `calculateLineMaterials` on stored `orderLines`)

Desugar the box line **at the top of `calculateLineMaterials`** and all three consumers
work for free — including historical export, because it recomputes from the stored line.

## Data model

Extend `pack_skus` with two nullable columns (reuses `usePackSKUs`, the SKU picker,
soft-delete, and `is_active` — no new table, no new hook):

| column | type | meaning |
|---|---|---|
| `base_pack_code` | `text null` | code of the wrapped pack SKU. **Non-null ⇒ this row is a Box SKU.** |
| `box_mode` | `text null` | which box it ships in (a `BoxModeType` / box item name) |

`box_mode` must be explicit, not derived: a base pack can fit several boxes (`N10B` is in
both `box kecil` and `box osave`).

For a Box SKU, `eggs_per_pack` / `egg_product` / `packaging_item` are **null and unused** —
those come from the base pack after desugaring. (Stage-A resolver triggers set the id
columns to null for box rows; harmless.)

**Migration:** two nullable columns, no backfill. Apply **before** pushing frontend
(per EggKeep deploy rule).

## Components / changes

1. **Migration** — add `base_pack_code`, `box_mode` to `pack_skus`.

2. **Types + hook** (`types/catalog.ts`, `usePackSKUs.ts`, `outflowCalculator.ts`'s
   `PackSKU`) — add optional `basePackCode?`, `boxMode?`. A row is a Box SKU iff
   `basePackCode` is set.

3. **Desugaring helper** (`outflowCalculator.ts`) — `resolveBoxLine(line, skus, boxCapacityMap)`:
   if the line's SKU is a Box SKU, return an effective pack line (base pack, `packQty × capacity`,
   `boxModeOverride = box_mode`). Called at the top of `calculateLineMaterials`. If the base
   pack is missing or the box has no capacity configured for it → return `null` (line yields
   the same "not configured" warning path that exists today).

4. **Catalog SKU dialog** (`components/catalog/SKUList.tsx` + its dialog) — a **kind** toggle:
   **Pack** (today's fields) vs **Box** (pick base pack SKU + pick box; hide egg/packaging
   fields). List shows Box SKUs distinctly.

5. **Exclude Box SKUs from the Packs-per-box config** (`ItemTypeDialog.tsx:88` seeds from
   `activeSkus`) — a box can't contain a box. One `.filter(s => !s.basePackCode)`.

6. **Outflow line UI** (`OrderLineItem.tsx`) — when the selected SKU is a Box SKU, the
   quantity label reads **"Quantity (boxes)"** and the mini-calculator shows the expansion
   ("→ 90 packs · 5 pcs box osave · … butir NEGERI"). Picker already lists all active SKUs,
   so Box SKUs appear naturally.

7. **i18n** — new strings in **both** `src/locales/en.ts` and `id.ts` (`packsPerBox`-style keys:
   kind toggle labels, "Quantity (boxes)", base-pack / box pickers).

## Edge cases

- **Base pack deleted / capacity unset for that box×pack** → desugar returns `null`, line
  shows the existing amber "not configured" warning; nothing deducts silently.
- **`boxesRequired = false` on the order** → packs still deduct, physical boxes don't —
  identical to a normal box-mode pack line today. No special-casing.
- **Quantities are exact integers** (boxes × capacity), no rounding introduced.
- **CSV export** re-runs the recipe, so materials are correct automatically; the `Pack Qty`
  column will show the *box* count for box lines — acceptable, and the `SKU Name` makes it
  obvious. (Note during planning; not a blocker.)

## Testing

One runnable check (vitest) on the choke point: `calculateLineMaterials` for a Box SKU
"5 boxes of N10B" (box osave, 18/box) asserts → 90 packs, 90 pcs packaging, 5 boxes, and
eggs = 90 × N10B's `eggsPerPack` converted per the kg/butir rule. This fails if the desugar
math or the base-pack inheritance breaks.

## Alternative considered (rejected)

- **Separate `box_skus` table** — cleaner namespace, but needs a new hook, a new list
  section, and a union in the outflow picker; more code for no real gain. Extending
  `pack_skus` reuses everything for the cost of one `.filter()`.
- **Store packs-per-box on the Box SKU directly** — creates a second copy of "18" that can
  drift from the box's Packs-per-box config. Rejected: derive it live instead.
