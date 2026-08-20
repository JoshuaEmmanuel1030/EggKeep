# Physical Stock Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/stock-count` page where a staffer records morning physical stock per egg product across three locations (JS Warehouse / TST Warehouse / Loaded), shows total-on-hand and JS-vs-system variance, and keeps dated snapshots.

**Architecture:** A standalone `stock_counts` table (one row per date×location×product) written via batch upsert — no RPC, no contact with the outflow pipeline. Pure variance/total logic lives in a tested `src/lib/stockCount.ts`. The page reuses `useItemTypes` (product list + per-item tolerance), the existing ledger stock summary (system stock), and native-unit helpers. Entry is a Header button routed to a new page; the dashboard is untouched.

**Tech Stack:** React + TypeScript, Supabase (Postgres + RLS), @tanstack/react-query, react-router-dom, date-fns, vitest. i18n via `src/locales/{en,id}.ts`.

## Global Constraints

- **kg-native stock:** `quantity` is stored in the product's NATIVE unit — kg for weight-sold eggs (`item_types.unit='kg'`), butir otherwise. NEVER convert kg↔butir when storing or comparing. Use `getStockUnit` to label.
- **Cross-product totals** must use `butirEquivalent` — never a raw kg+butir sum.
- **Migrations applied BEFORE frontend push**, via Supabase MCP `apply_migration` against project `lgtixzpjbkzapecirbfj`.
- **i18n:** every user-facing string goes in BOTH `src/locales/en.ts` and `src/locales/id.ts`.
- **Canonical naming:** egg names are ALL CAPS; `product` is a name snapshot (do not rename-cascade).
- **Verify gate:** `npx tsc --noEmit -p tsconfig.app.json` + `npm test -- --run` must pass.
- **Repo compiles with `strict: false`** — discriminated-union narrowing does not work; avoid relying on it.
- **Locations** are exactly `js_warehouse`, `tst_warehouse`, `loaded` (a CHECK constraint + a typed constant).
- **Default tolerance:** kg products → `1`, everything else → `0` (exact). Per-item override via `item_types.count_tolerance`.

---

## File structure

- Create `supabase/migrations/20260820000000_stock_counts.sql` — table + RLS + `count_tolerance` column.
- Modify `src/integrations/supabase/types.ts` — regenerated to include `stock_counts` + `count_tolerance`.
- Create `src/lib/stockCount.ts` — `STOCK_LOCATIONS`, `StockLocation`, `defaultTolerance`, `resolveTolerance`, `computeVariance`, `totalOnHand`.
- Create `src/lib/__tests__/stockCount.test.ts` — unit tests for the above.
- Create `src/types/stockCount.ts` — `StockCountRecord`, `StockCountSaveEntry`.
- Modify `src/types/inventory.ts` — add `countTolerance?` to `ItemType`.
- Modify `src/hooks/useItemTypes.ts` — read/write `count_tolerance`.
- Modify `src/components/catalog/ItemTypeDialog.tsx` — tolerance input (egg block).
- Modify `src/components/catalog/ItemTypeList.tsx` — pass `countTolerance` through save.
- Create `src/hooks/useStockCounts.ts` — fetch-by-date + batch upsert.
- Create `src/hooks/useStockCountStatus.ts` — `countedToday` boolean for the header dot.
- Create `src/pages/StockCount.tsx` — the page.
- Modify `src/App.tsx` — add `/stock-count` route.
- Modify `src/components/Header.tsx` — optional `onExport`, entry button + dot.
- Modify `src/locales/en.ts` and `src/locales/id.ts` — all strings.

---

### Task 1: Database migration + regenerated types

**Files:**
- Create: `supabase/migrations/20260820000000_stock_counts.sql`
- Modify: `src/integrations/supabase/types.ts` (regenerated)

**Interfaces:**
- Produces: table `public.stock_counts(id, count_date, location, item_type_id, product, category, quantity, system_qty, counted_by, created_at, updated_at)` with unique `(count_date, location, item_type_id)`; column `item_types.count_tolerance numeric`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260820000000_stock_counts.sql`:

```sql
-- Physical morning stock counts across locations (JS + TST warehouse, and stock
-- pre-loaded onto trucks the day before). This is a standalone dated snapshot for
-- valuation/accuracy — it does NOT touch the inflow/outflow ledger.
CREATE TABLE public.stock_counts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_date date NOT NULL DEFAULT current_date,
  location text NOT NULL CHECK (location IN ('js_warehouse', 'tst_warehouse', 'loaded')),
  item_type_id uuid NOT NULL REFERENCES public.item_types(id),
  product text NOT NULL,
  category text NOT NULL,
  quantity numeric NOT NULL,
  -- Ledger stock captured at save time (meaningful for js_warehouse rows only),
  -- so variance stays stable and reviewable on past dates.
  system_qty numeric,
  counted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_date, location, item_type_id)
);

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stock_counts"
  ON public.stock_counts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert stock_counts"
  ON public.stock_counts FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update stock_counts"
  ON public.stock_counts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Per-item variance tolerance for the physical count, in the item's native unit.
-- NULL = use the code default (kg eggs -> 1, everything else -> 0/exact).
ALTER TABLE public.item_types
  ADD COLUMN IF NOT EXISTS count_tolerance numeric;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `stock_counts` and the SQL above (project `lgtixzpjbkzapecirbfj`).

- [ ] **Step 3: Verify the table and column exist**

Run via `mcp__supabase__execute_sql`:
```sql
select count(*) from public.stock_counts;
select column_name from information_schema.columns
where table_name='item_types' and column_name='count_tolerance';
```
Expected: count `0`; one row `count_tolerance`.

- [ ] **Step 4: Regenerate Supabase types**

Run `mcp__supabase__generate_typescript_types` and overwrite `src/integrations/supabase/types.ts` with the result (this adds `stock_counts` and `item_types.count_tolerance` to the `Database` type so `supabase.from("stock_counts")` type-checks).

- [ ] **Step 5: Confirm typecheck passes**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260820000000_stock_counts.sql src/integrations/supabase/types.ts
git commit -m "feat(stock-count): stock_counts table + count_tolerance column"
```

---

### Task 2: Pure variance/total logic (`stockCount.ts`)

**Files:**
- Create: `src/lib/stockCount.ts`
- Test: `src/lib/__tests__/stockCount.test.ts`

**Interfaces:**
- Produces:
  - `STOCK_LOCATIONS: readonly ["js_warehouse","tst_warehouse","loaded"]`
  - `type StockLocation = "js_warehouse" | "tst_warehouse" | "loaded"`
  - `defaultTolerance(unit: "kg" | "butir" | "pcs"): number`
  - `resolveTolerance(configured: number | undefined, unit: "kg" | "butir" | "pcs"): number`
  - `type VarianceStatus = "match" | "within" | "off"`
  - `interface Variance { delta: number; status: VarianceStatus }`
  - `computeVariance(physicalJs: number, systemQty: number, tolerance: number): Variance`
  - `totalOnHand(counts: Partial<Record<StockLocation, number | null>>): number`
  - `parseCountInput(raw: string): number | null`

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/stockCount.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  STOCK_LOCATIONS,
  defaultTolerance,
  resolveTolerance,
  computeVariance,
  totalOnHand,
  parseCountInput,
} from "@/lib/stockCount";

describe("stockCount locations", () => {
  it("has exactly the three agreed locations in order", () => {
    expect([...STOCK_LOCATIONS]).toEqual(["js_warehouse", "tst_warehouse", "loaded"]);
  });
});

describe("defaultTolerance", () => {
  it("allows 1 kg drift for kg products", () => {
    expect(defaultTolerance("kg")).toBe(1);
  });
  it("requires exact match for butir and pcs", () => {
    expect(defaultTolerance("butir")).toBe(0);
    expect(defaultTolerance("pcs")).toBe(0);
  });
});

describe("resolveTolerance", () => {
  it("uses the configured value when present (including 0)", () => {
    expect(resolveTolerance(2, "kg")).toBe(2);
    expect(resolveTolerance(0, "kg")).toBe(0); // explicit exact override
  });
  it("falls back to the unit default when unset or negative", () => {
    expect(resolveTolerance(undefined, "kg")).toBe(1);
    expect(resolveTolerance(-5, "butir")).toBe(0);
  });
});

describe("computeVariance", () => {
  it("reports a match when physical equals system", () => {
    expect(computeVariance(300, 300, 0)).toEqual({ delta: 0, status: "match" });
  });
  it("reports within-tolerance for kg drift under the tolerance", () => {
    expect(computeVariance(120.4, 120, 1)).toEqual({ delta: 0.4, status: "within" });
  });
  it("reports off when the gap exceeds tolerance, with a signed delta", () => {
    expect(computeVariance(1760, 1800, 0)).toEqual({ delta: -40, status: "off" });
  });
});

describe("totalOnHand", () => {
  it("sums the three locations treating blanks as zero", () => {
    expect(totalOnHand({ js_warehouse: 120, tst_warehouse: 80, loaded: 45 })).toBe(245);
    expect(totalOnHand({ js_warehouse: 0, tst_warehouse: 300 })).toBe(300);
  });
});

describe("parseCountInput", () => {
  it("parses plain integers and treats blanks as not-counted (null)", () => {
    expect(parseCountInput("300")).toBe(300);
    expect(parseCountInput("")).toBeNull();
    expect(parseCountInput("   ")).toBeNull();
  });
  it("accepts the Indonesian decimal comma for kg", () => {
    expect(parseCountInput("120,5")).toBe(120.5);
  });
  it("rejects negatives and non-numbers", () => {
    expect(parseCountInput("-5")).toBeNull();
    expect(parseCountInput("abc")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/lib/__tests__/stockCount.test.ts`
Expected: FAIL — module `@/lib/stockCount` not found.

- [ ] **Step 3: Implement `src/lib/stockCount.ts`**

```ts
// Pure logic for the physical stock-count page: locations, per-item tolerance,
// variance vs system stock, and per-product total on hand. No I/O, no React.

export const STOCK_LOCATIONS = ["js_warehouse", "tst_warehouse", "loaded"] as const;
export type StockLocation = (typeof STOCK_LOCATIONS)[number];

/** Default variance tolerance when an item has none configured:
 *  kg eggs tolerate 1 kg of weighing drift; everything else must match exactly. */
export function defaultTolerance(unit: "kg" | "butir" | "pcs"): number {
  return unit === "kg" ? 1 : 0;
}

/** Configured per-item tolerance wins (0 is a valid "exact" override); otherwise the unit default. */
export function resolveTolerance(
  configured: number | undefined,
  unit: "kg" | "butir" | "pcs"
): number {
  return configured != null && configured >= 0 ? configured : defaultTolerance(unit);
}

export type VarianceStatus = "match" | "within" | "off";

export interface Variance {
  delta: number; // physicalJs - systemQty, rounded to 2 dp
  status: VarianceStatus;
}

/** Compare a physical JS-warehouse count against system stock, given a tolerance. */
export function computeVariance(
  physicalJs: number,
  systemQty: number,
  tolerance: number
): Variance {
  const delta = Math.round((physicalJs - systemQty) * 100) / 100;
  const abs = Math.abs(delta);
  const status: VarianceStatus = abs === 0 ? "match" : abs <= tolerance ? "within" : "off";
  return { delta, status };
}

/** Sum of the three location counts (blanks treated as zero), in the product's native unit. */
export function totalOnHand(counts: Partial<Record<StockLocation, number | null>>): number {
  return STOCK_LOCATIONS.reduce((sum, loc) => sum + (counts[loc] ?? 0), 0);
}

/** Parse a raw count input. Accepts the Indonesian decimal comma. Blank, invalid,
 *  or negative -> null (meaning "not counted"). */
export function parseCountInput(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed.replace(",", "."));
  return isNaN(n) || n < 0 ? null : n;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run src/lib/__tests__/stockCount.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stockCount.ts src/lib/__tests__/stockCount.test.ts
git commit -m "feat(stock-count): variance + total-on-hand logic with tests"
```

---

### Task 3: Per-item `count_tolerance` catalog config

**Files:**
- Modify: `src/types/inventory.ts` (add `countTolerance?` to `ItemType`, ~line 25)
- Modify: `src/hooks/useItemTypes.ts` (map read + add/update payloads)
- Modify: `src/components/catalog/ItemTypeDialog.tsx` (`ItemTypeSaveData` + input)
- Modify: `src/components/catalog/ItemTypeList.tsx` (pass `countTolerance` through, ~lines 123-143)
- Modify: `src/locales/en.ts` and `src/locales/id.ts` (catalog strings)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ItemType.countTolerance?: number`; `ItemTypeSaveData.countTolerance?: number`; the Catalog dialog reads/writes it.

- [ ] **Step 1: Add the field to the `ItemType` type**

In `src/types/inventory.ts`, after the `lowStockThreshold?: number;` line inside `ItemType`:
```ts
  // Egg-only (v1): physical-count variance tolerance in the item's native unit
  // (unset = code default: kg -> 1, else 0). See src/lib/stockCount.ts.
  countTolerance?: number;
```

- [ ] **Step 2: Read `count_tolerance` in `useItemTypes`**

In `src/hooks/useItemTypes.ts`, in the `mapped` object (after the `lowStockThreshold:` mapping, ~line 40):
```ts
        countTolerance:
          (row as { count_tolerance?: number | null }).count_tolerance ?? undefined,
```

- [ ] **Step 3: Add `countTolerance` to the add + update mutations**

In `useItemTypes.ts`, add `countTolerance` to BOTH `addItemType` and `updateItemType`: to the destructured args, to their param type (`countTolerance?: number;`), and to the Supabase payload:
```ts
          count_tolerance: countTolerance ?? null,
```
(Place it next to `low_stock_threshold` in each `.insert({...})` / `.update({...})`.)

- [ ] **Step 4: Extend `ItemTypeSaveData` and the dialog**

In `src/components/catalog/ItemTypeDialog.tsx`:

Add to `ItemTypeSaveData` (after `lowStockThreshold?`):
```ts
  countTolerance?: number;
```

Add state (after the `lowStockThreshold` state, ~line 65):
```ts
  const [countTolerance, setCountTolerance] = useState("");
```

Seed it in the `useEffect` (after the `setLowStockThreshold(...)` line):
```ts
      setCountTolerance(item?.countTolerance != null ? String(item.countTolerance) : "");
```

Parse + include on save. In `handleSubmit`, compute:
```ts
    const tol = parseFloat(countTolerance);
    const countToleranceValue = !isNaN(tol) && tol >= 0 ? tol : undefined;
```
Then pass `countTolerance: countToleranceValue` in the `isEgg` branch's `onSave({...})` call (alongside `unit`/`eggsPerUnit`).

Render the input inside the existing `{isEgg && ( ... )}` block, after the freshness-days field (before its closing `</>`):
```tsx
              <div className="space-y-2">
                <Label htmlFor="countTolerance">{t.catalog.countTolerance}</Label>
                <Input
                  id="countTolerance"
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  value={countTolerance}
                  onChange={(e) => setCountTolerance(e.target.value)}
                  placeholder={unit === "kg" ? "1" : "0"}
                />
                <p className="text-xs text-muted-foreground">{t.catalog.countToleranceHelp}</p>
              </div>
```

- [ ] **Step 5: Pass `countTolerance` through `ItemTypeList`**

In `src/components/catalog/ItemTypeList.tsx` `performSave`, add `countTolerance: data.countTolerance,` to BOTH the `updateItemType.mutateAsync({...})` and `addItemType.mutateAsync({...})` calls (next to `lowStockThreshold: data.lowStockThreshold,`).

- [ ] **Step 6: Add catalog locale strings**

In `src/locales/en.ts`, in the `catalog:` block (near `lowStockThreshold`/`lowStockThresholdHelp`, ~line 345):
```ts
    countTolerance: 'Count match tolerance',
    countToleranceHelp: "Morning physical count is flagged as matching system stock when it's within this much of the JS-warehouse ledger, in the item's stock unit (kg for weight-sold eggs, butir otherwise). Blank uses the default (1 kg for kg eggs, exact for the rest).",
```
In `src/locales/id.ts`, the same keys in its `catalog:` block:
```ts
    countTolerance: 'Toleransi kecocokan hitungan',
    countToleranceHelp: 'Hitungan fisik pagi dianggap cocok dengan stok sistem jika selisihnya tidak lebih dari nilai ini terhadap catatan gudang JS, dalam satuan stok barang (kg untuk telur timbang, butir untuk lainnya). Kosongkan untuk memakai default (1 kg untuk telur kg, tepat untuk lainnya).',
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/types/inventory.ts src/hooks/useItemTypes.ts src/components/catalog/ItemTypeDialog.tsx src/components/catalog/ItemTypeList.tsx src/locales/en.ts src/locales/id.ts
git commit -m "feat(stock-count): per-item count_tolerance in Catalog"
```

---

### Task 4: `useStockCounts` data hook

**Files:**
- Create: `src/types/stockCount.ts`
- Create: `src/hooks/useStockCounts.ts`

**Interfaces:**
- Consumes: `StockLocation` from `src/lib/stockCount.ts`.
- Produces:
  - `interface StockCountRecord { id: string; countDate: string; location: StockLocation; itemTypeId: string; product: string; category: string; quantity: number; systemQty: number | null; countedBy: string | null; }`
  - `interface StockCountSaveEntry { itemTypeId: string; product: string; category: string; location: StockLocation; quantity: number; systemQty?: number | null; }`
  - `useStockCounts(countDate: string)` → `{ records: StockCountRecord[]; loading: boolean; saveCounts(entries: StockCountSaveEntry[], countedBy: string): Promise<boolean>; refetch(): void; }`

- [ ] **Step 1: Create the types file**

`src/types/stockCount.ts`:
```ts
import { StockLocation } from "@/lib/stockCount";

export interface StockCountRecord {
  id: string;
  countDate: string; // YYYY-MM-DD
  location: StockLocation;
  itemTypeId: string;
  product: string;
  category: string;
  quantity: number;
  systemQty: number | null;
  countedBy: string | null;
}

export interface StockCountSaveEntry {
  itemTypeId: string;
  product: string;
  category: string;
  location: StockLocation;
  quantity: number;
  systemQty?: number | null;
}
```

- [ ] **Step 2: Create the hook**

`src/hooks/useStockCounts.ts`:
```ts
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StockLocation } from "@/lib/stockCount";
import { StockCountRecord, StockCountSaveEntry } from "@/types/stockCount";

export function useStockCounts(countDate: string) {
  const [records, setRecords] = useState<StockCountRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("stock_counts")
        .select("*")
        .eq("count_date", countDate);
      if (error) throw error;
      setRecords(
        (data || []).map((row) => ({
          id: row.id,
          countDate: row.count_date,
          location: row.location as StockLocation,
          itemTypeId: row.item_type_id,
          product: row.product,
          category: row.category,
          quantity: Number(row.quantity),
          systemQty: row.system_qty != null ? Number(row.system_qty) : null,
          countedBy: row.counted_by ?? null,
        }))
      );
    } catch (e) {
      console.error("Error fetching stock counts:", e);
    } finally {
      setLoading(false);
    }
  }, [countDate]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Batch upsert on the unique key (count_date, location, item_type_id). Each
  // product/location row is independent — no atomic RPC needed. Re-saving the
  // same day updates the rows in place.
  const saveCounts = useCallback(
    async (entries: StockCountSaveEntry[], countedBy: string): Promise<boolean> => {
      if (entries.length === 0) return true;
      const nowIso = new Date().toISOString();
      const rows = entries.map((e) => ({
        count_date: countDate,
        location: e.location,
        item_type_id: e.itemTypeId,
        product: e.product,
        category: e.category,
        quantity: e.quantity,
        system_qty: e.systemQty ?? null,
        counted_by: countedBy,
        updated_at: nowIso,
      }));
      const { error } = await supabase
        .from("stock_counts")
        .upsert(rows, { onConflict: "count_date,location,item_type_id" });
      if (error) {
        console.error("Error saving stock counts:", error);
        return false;
      }
      await fetchCounts();
      return true;
    },
    [countDate, fetchCounts]
  );

  return { records, loading, saveCounts, refetch: fetchCounts };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors (relies on Task 1's regenerated `types.ts` for the `stock_counts` table).

- [ ] **Step 4: Commit**

```bash
git add src/types/stockCount.ts src/hooks/useStockCounts.ts
git commit -m "feat(stock-count): useStockCounts fetch + batch upsert hook"
```

---

### Task 5: `StockCount` page

**Files:**
- Create: `src/pages/StockCount.tsx`
- Modify: `src/locales/en.ts` and `src/locales/id.ts` (page strings)

**Interfaces:**
- Consumes: `useItemTypes` (`itemTypes`, `conversionMap`), `useInventorySync` (`inflows`), `calculateStockSummary`, `getStockUnit`, `butirEquivalent` (from `@/lib/inventory`), `STOCK_LOCATIONS`, `resolveTolerance`, `computeVariance`, `totalOnHand` (from `@/lib/stockCount`), `useStockCounts` (Task 4), `Header`.
- Produces: default-exported `StockCount` React component (rendered by the `/stock-count` route in Task 6).

- [ ] **Step 1: Add page locale strings**

In `src/locales/en.ts`, add a top-level `stockCount:` block (sibling of `dashboard:`):
```ts
  stockCount: {
    title: 'Physical Stock',
    subtitle: 'Morning count',
    back: 'Back',
    locationJs: 'JS',
    locationTst: 'TST',
    locationLoaded: 'Loaded',
    totalOnHand: 'Total on hand',
    grandTotal: 'Total (≈ butir)',
    matches: 'matches system',
    off: 'vs system',
    save: 'Save count',
    saved: 'Count saved',
    saveError: 'Could not save — try again',
    readOnly: 'Past date — view only',
    changeDate: 'Change date',
    empty: 'No egg products in the catalog yet.',
  },
```
In `src/locales/id.ts`, the same `stockCount:` block:
```ts
  stockCount: {
    title: 'Stok Fisik',
    subtitle: 'Hitungan pagi',
    back: 'Kembali',
    locationJs: 'JS',
    locationTst: 'TST',
    locationLoaded: 'Dimuat',
    totalOnHand: 'Total di tangan',
    grandTotal: 'Total (≈ butir)',
    matches: 'cocok dgn sistem',
    off: 'vs sistem',
    save: 'Simpan hitungan',
    saved: 'Hitungan disimpan',
    saveError: 'Gagal menyimpan — coba lagi',
    readOnly: 'Tanggal lampau — hanya lihat',
    changeDate: 'Ganti tanggal',
    empty: 'Belum ada produk telur di katalog.',
  },
```

- [ ] **Step 2: Create the page component**

`src/pages/StockCount.tsx`:
```tsx
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useInventorySync } from "@/hooks/useInventorySync";
import { useStockCounts } from "@/hooks/useStockCounts";
import { calculateStockSummary, getStockUnit, butirEquivalent } from "@/lib/inventory";
import {
  STOCK_LOCATIONS,
  StockLocation,
  resolveTolerance,
  computeVariance,
  totalOnHand,
  parseCountInput,
} from "@/lib/stockCount";
import { StockCountSaveEntry } from "@/types/stockCount";

// Raw string inputs keyed `${itemTypeId}:${location}` (blank = not counted).
type Draft = Record<string, string>;

const todayStr = () => format(new Date(), "yyyy-MM-dd");

export default function StockCount() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { itemTypes, conversionMap } = useItemTypes();
  const { inflows } = useInventorySync();

  const [countDate, setCountDate] = useState<string>(todayStr());
  const isToday = countDate === todayStr();
  const { records, loading, saveCounts } = useStockCounts(countDate);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  // Egg products only in v1.
  const eggs = useMemo(
    () => itemTypes.filter((it) => it.category === "egg"),
    [itemTypes]
  );

  // System (ledger) stock per product — the JS-warehouse perpetual number.
  const systemStock = useMemo(() => {
    const summary = calculateStockSummary(inflows, conversionMap, {});
    const map: Record<string, number> = {};
    for (const s of summary) if (s.category === "egg") map[s.product] = s.totalStock;
    return map;
  }, [inflows, conversionMap]);

  // Seed the draft from saved rows whenever the date's records load.
  const seededKey = `${countDate}:${records.length}:${loading}`;
  useMemo(() => {
    const next: Draft = {};
    for (const r of records) next[`${r.itemTypeId}:${r.location}`] = String(r.quantity);
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seededKey]);

  const draftValue = (itemTypeId: string, loc: StockLocation): number | null =>
    parseCountInput(draft[`${itemTypeId}:${loc}`] ?? "");

  const setDraftValue = (itemTypeId: string, loc: StockLocation, v: string) =>
    setDraft((prev) => ({ ...prev, [`${itemTypeId}:${loc}`]: v }));

  const handleSave = async () => {
    setSaving(true);
    const entries: StockCountSaveEntry[] = [];
    for (const it of eggs) {
      for (const loc of STOCK_LOCATIONS) {
        const val = draftValue(it.id, loc);
        if (val == null) continue; // blank = not counted -> no row
        entries.push({
          itemTypeId: it.id,
          product: it.name,
          category: it.category,
          location: loc,
          quantity: val,
          // Snapshot the ledger for the JS bucket only.
          systemQty: loc === "js_warehouse" ? systemStock[it.name] ?? 0 : null,
        });
      }
    }
    const ok = await saveCounts(entries, user?.email ?? "");
    setSaving(false);
    toast(ok ? { title: t.stockCount.saved } : { title: t.stockCount.saveError });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4 sm:px-6 max-w-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" /> {t.stockCount.back}
          </Button>
          <div className="ml-1">
            <h1 className="font-display font-bold text-lg leading-tight">{t.stockCount.title}</h1>
            <p className="text-xs text-muted-foreground">{t.stockCount.subtitle}</p>
          </div>
        </div>

        <div className="mb-4">
          <Input
            type="date"
            value={countDate}
            max={todayStr()}
            onChange={(e) => setCountDate(e.target.value || todayStr())}
            className="w-full sm:w-56"
          />
          {!isToday && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t.stockCount.readOnly}</p>
          )}
        </div>

        {eggs.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t.stockCount.empty}</CardContent></Card>
        ) : (
          <div className="space-y-2.5">
            {eggs.map((it) => {
              const unit = getStockUnit(it.name, "egg", conversionMap);
              const counts: Partial<Record<StockLocation, number | null>> = {};
              for (const loc of STOCK_LOCATIONS) counts[loc] = draftValue(it.id, loc);
              const total = totalOnHand(counts);
              const physicalJs = counts.js_warehouse;
              const tol = resolveTolerance(it.countTolerance, unit);
              const sys = systemStock[it.name] ?? 0;
              const variance =
                physicalJs != null ? computeVariance(physicalJs, sys, tol) : null;

              return (
                <Card key={it.id}>
                  <CardContent className="p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="font-semibold text-sm">{it.name}</span>
                      <span className="text-[11px] text-muted-foreground">{unit}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {STOCK_LOCATIONS.map((loc) => (
                        <div key={loc}>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                            {loc === "js_warehouse" ? t.stockCount.locationJs
                              : loc === "tst_warehouse" ? t.stockCount.locationTst
                              : t.stockCount.locationLoaded}
                          </div>
                          <Input
                            type="text"
                            inputMode="decimal"
                            disabled={!isToday}
                            value={draft[`${it.id}:${loc}`] ?? ""}
                            onChange={(e) => setDraftValue(it.id, loc, e.target.value)}
                            className="h-9 text-center"
                            placeholder="—"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] pt-2 border-t border-dashed">
                      <span className="font-semibold">
                        {t.stockCount.totalOnHand}: {total.toLocaleString()} {unit}
                      </span>
                      {variance && (
                        <span
                          className={`px-2 py-0.5 rounded-full font-semibold ${
                            variance.status === "off"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-success/15 text-success"
                          }`}
                        >
                          {variance.status === "off"
                            ? `${t.stockCount.off} ${variance.delta > 0 ? "+" : ""}${variance.delta.toLocaleString()}`
                            : `✓ ${t.stockCount.matches}`}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Cross-product grand total: butir-equivalents ONLY — never sum kg+butir raw. */}
            <Card className="bg-muted/40">
              <CardContent className="p-3 flex items-center justify-between text-sm">
                <span className="font-semibold">{t.stockCount.grandTotal}</span>
                <span className="font-display font-bold">
                  {eggs
                    .reduce((sum, it) => {
                      const counts: Partial<Record<StockLocation, number | null>> = {};
                      for (const loc of STOCK_LOCATIONS) counts[loc] = draftValue(it.id, loc);
                      return sum + butirEquivalent(it.name, totalOnHand(counts), conversionMap);
                    }, 0)
                    .toLocaleString()}
                </span>
              </CardContent>
            </Card>

            {isToday && (
              <Button className="w-full mt-2" onClick={handleSave} disabled={saving}>
                {t.stockCount.save}
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
```

Note: `Header` is called with no props — Task 6 makes `onExport` optional. `bg-success`/`text-success` classes already exist in the app (used on the dashboard).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors (this will fail until Task 6 makes `Header`'s `onExport` optional — do Task 6 next; if verifying standalone, temporarily pass `onExport={() => {}}`).

- [ ] **Step 4: Commit**

```bash
git add src/pages/StockCount.tsx src/locales/en.ts src/locales/id.ts
git commit -m "feat(stock-count): StockCount page (3-location capture + variance)"
```

---

### Task 6: Route + Header entry button + "counted today" dot

**Files:**
- Create: `src/hooks/useStockCountStatus.ts`
- Modify: `src/components/Header.tsx` (optional `onExport`, entry button + dot)
- Modify: `src/App.tsx` (route)
- Modify: `src/locales/en.ts` and `src/locales/id.ts` (`nav.stockCount`)

**Interfaces:**
- Consumes: `StockCount` page (Task 5), `useStockCounts` pattern.
- Produces: `useStockCountStatus()` → `{ countedToday: boolean }`; route `/stock-count`; header button navigating there.

- [ ] **Step 1: Create the status hook**

`src/hooks/useStockCountStatus.ts`:
```ts
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

/** Whether any physical-count row exists for today (drives the header reminder dot). */
export function useStockCountStatus() {
  const [countedToday, setCountedToday] = useState(true); // assume done until known, to avoid a flash
  useEffect(() => {
    let active = true;
    (async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { count } = await supabase
        .from("stock_counts")
        .select("id", { count: "exact", head: true })
        .eq("count_date", today);
      if (active) setCountedToday((count ?? 0) > 0);
    })();
    return () => {
      active = false;
    };
  }, []);
  return { countedToday };
}
```

- [ ] **Step 2: Make `onExport` optional and add the entry button in `Header`**

In `src/components/Header.tsx`:
- Change the prop: `interface HeaderProps { onExport?: () => void; }`
- Add imports: `import { Egg, Download, LogOut, ClipboardList } from "lucide-react";` and `useStockCountStatus`.
- Inside the component: `const { countedToday } = useStockCountStatus();`
- In the actions `div` (before the Export button), add:
```tsx
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/stock-count")}
            title={t.nav.stockCount}
            className="relative gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-3"
          >
            <ClipboardList className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">{t.nav.stockCount}</span>
            {!countedToday && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
            )}
          </Button>
```
- Guard the Export button so it only renders when `onExport` is provided:
```tsx
          {onExport && (
            <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-3">
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">{t.header.exportCsv}</span>
            </Button>
          )}
```

- [ ] **Step 3: Add the route**

In `src/App.tsx`:
- Import: `import StockCount from "./pages/StockCount";`
- Add above the catch-all `*` route:
```tsx
            <Route path="/stock-count" element={<ProtectedRoute><StockCount /></ProtectedRoute>} />
```

- [ ] **Step 4: Add the `nav.stockCount` locale string**

In `src/locales/en.ts` `nav:` block: `stockCount: 'Physical Stock',`
In `src/locales/id.ts` `nav:` block: `stockCount: 'Stok Fisik',`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useStockCountStatus.ts src/components/Header.tsx src/App.tsx src/locales/en.ts src/locales/id.ts
git commit -m "feat(stock-count): route + header entry button with reminder dot"
```

---

### Task 7: Verify gate + manual QA

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test -- --run`
Expected: all pass, including `stockCount.test.ts`.

- [ ] **Step 3: Manual smoke test (dev server)**

Run: `npm run dev`, then verify:
1. Header shows a 📋 "Physical Stock" button with a dot (no count saved today).
2. Clicking it opens `/stock-count`; back arrow returns to the dashboard (dashboard layout unchanged).
3. Entering JS/TST/Loaded numbers updates "Total on hand"; a JS value shows a green ✓ (within tolerance) or red variance vs system.
4. Save → toast "Count saved"; reload the page → values persist; header dot is gone.
5. Pick a past date → inputs are read-only and show that day's snapshot.
6. In Catalog, edit an egg → set "Count match tolerance" to 2 → the JS variance chip on `/stock-count` respects it.

- [ ] **Step 4: Final review + push**

- Confirm the migration was applied to `lgtixzpjbkzapecirbfj` before any push.
- Push the branch and open a PR (only when the user asks).

---

## Notes for the implementer

- **Do not** route stock counts through `record_order_outflows` or touch inflows/outflows — this feature is a standalone snapshot by design.
- `quantity` and `system_qty` are native-unit numerics; never kg↔butir convert them.
- The `useMemo`-for-side-effect draft seeding in the page (Task 5, Step 2) is intentional to reset the draft when the date changes; if it trips a lint rule, convert to a `useEffect` keyed on `[countDate, records]` with the same body.
- v1 is eggs-only: the tolerance UI lives in the egg branch of the catalog dialog, and the page filters `category === "egg"`. Extending to packaging later = widen those two filters.
