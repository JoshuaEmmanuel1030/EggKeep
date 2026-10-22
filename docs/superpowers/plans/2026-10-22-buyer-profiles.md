# Buyer Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin each buyer's usual SKUs to the top of the Purchase Order SKU dropdown, and give each buyer a Catalog profile with planning insights.

**Architecture:**
- **Data:** one additive migration adds `buyers.pinned_sku_ids uuid[]` and a read-only `purchase_orders` view (one row per order).
- **Logic:** every insight number comes from one pure module, `src/lib/buyerProfile.ts`, which is unit-tested.
- **UI:** thin React components over that module plus two small hooks.
- **Phases:** Phase 1 (Tasks 1–5) ships the pins. Phase 2 (Tasks 6–8) ships the profile page.

**Tech Stack:** React 18 + TS, TanStack Query, shadcn/ui (cmdk Command, Tabs, Checkbox), Supabase (Postgres view, PostgREST), vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-buyer-profiles-design.md`

## Global Constraints

- Base all work on `feat/tablet-sidebar-activities`, or on a branch cut from it. Do not push to `main` until the user approves; pushing to `main` deploys to production.
- **Migrations come first:** apply the DB migration through Supabase MCP `apply_migration` on project `lgtixzpjbkzapecirbfj` **before** any frontend that reads it is pushed. The `.env` may name the stale project `kpszurxnzhivrvzmcded`; ignore it.
- **No stock-path changes:** do not change `record_order_outflows`, `correct_order`, FIFO, returns, the outbox, or the `activity_logs.metadata` shape.
- **kg-native:** egg quantities stay in the native unit. A kg product displays as `X kg (≈ N butir)` via `butirEquivalent()`. Never sum kg and butir.
- **i18n:** every user-facing string goes in both `src/locales/en.ts` and `src/locales/id.ts`, under a `buyerProfile` block placed right after `catalog`.
- **Permissions:** editing pins, DCs, rename and delete is admin-only, gated in the UI with `isAdmin` from `useUserRole`. Everyone can view.
- **Phone width:** at 375px nothing may scroll the page sideways. Use `min-w-0` and `truncate` on flex children.
- **Verify gate:** `npx tsc --noEmit -p tsconfig.app.json` and `npm test -- --run`. There is no `npm run verify` script.
- The repo compiles with `strict: false`. Match the surrounding code style: comment density and naming.

## File map

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/20261022000000_buyer_profiles.sql` | create | `pinned_sku_ids` column + `purchase_orders` view |
| `src/integrations/supabase/types.ts` | modify | generated types for the column and view |
| `src/lib/buyerProfile.ts` | create | pure: date helpers, pinned grouping, all insight rules |
| `src/lib/__tests__/buyerProfile.test.ts` | create | unit tests for the above |
| `src/types/quickOutflow.ts` | modify | `Buyer.pinnedSkuIds?` |
| `src/hooks/useBuyers.ts` | modify | map `pinned_sku_ids`, add `setPinnedSkus` |
| `src/hooks/usePurchaseOrders.ts` | create | `usePurchaseOrders(buyerName)`, `useBuyerOrderStats()` |
| `src/components/OrderLineItem.tsx` | modify | two-group SKU dropdown |
| `src/components/QuickOutflowBuilder.tsx` | modify | compute and pass `pinnedSkuCodes` |
| `src/components/catalog/BuyerSkuPins.tsx` | create | pinned-SKU checklist (admin) / read-only list |
| `src/components/catalog/BuyerPlanning.tsx` | create | Planning section |
| `src/components/catalog/BuyerProfile.tsx` | create | profile header + Planning / SKUs / DCs tabs |
| `src/components/catalog/BuyerList.tsx` | modify | Phase 1: pin dialog on the table row. Phase 2: cards, drill-down, tablet split |
| `src/locales/en.ts`, `src/locales/id.ts` | modify | `buyerProfile` strings |

---

## Phase 1 — Pinned SKUs

### Task 1: Migration — column + view

**Files:**
- Create: `supabase/migrations/20261022000000_buyer_profiles.sql`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Produces: `buyers.pinned_sku_ids uuid[]` (not null, default `'{}'`), and the view `purchase_orders(recorded_at timestamptz, buyer_name text, outflow_date date, dc_id text, dc_name text, invoice_ref text, order_lines jsonb, egg_totals jsonb)`.

- [ ] **Step 1: Write the migration file**

```sql
-- Buyer profiles: pinned SKUs + a one-row-per-order view for insights.
-- Additive only: one new column with a default, one new read-only view.

-- SKUs pinned to the top of this buyer's Purchase Order SKU dropdown.
-- pack_skus ids (rename-safe); ids of deleted/inactive SKUs are ignored on read.
alter table public.buyers
  add column if not exists pinned_sku_ids uuid[] not null default '{}';

-- One row per recorded Purchase Order. An order writes one activity_logs row per
-- egg/packaging/label/box entry, all with the same metadata except relatedEntryId,
-- so that is the order key (same grouping correct_order uses). recorded_at is NOT
-- usable: rows of one order can differ by 1 ms. Voided rows are excluded, so an
-- edited order appears once, as its replacement.
create view public.purchase_orders
with (security_invoker = true) as
select
  o.recorded_at,
  o.m->>'buyerName'  as buyer_name,
  case when o.m->>'outflowDate' ~ '^\d{4}-\d{2}-\d{2}$'
       then (o.m->>'outflowDate')::date
       else (o.recorded_at at time zone 'Asia/Jakarta')::date
  end                as outflow_date,
  o.m->>'dcId'       as dc_id,
  o.m->>'dcName'     as dc_name,
  o.m->>'invoiceRef' as invoice_ref,
  coalesce(o.m->'orderLines', '[]'::jsonb) as order_lines,
  coalesce(jsonb_path_query_array(o.m->'relatedProducts', '$[*] ? (@.type == "egg")'), '[]'::jsonb) as egg_totals
from (
  select metadata - 'relatedEntryId' as m, min(recorded_at) as recorded_at
  from public.activity_logs
  where action_type = 'outflow'
    and voided_at is null
    and metadata->>'orderType' = 'quick_outflow'
  group by metadata - 'relatedEntryId'
) o;

revoke all on public.purchase_orders from anon;
grant select on public.purchase_orders to authenticated;
```

- [ ] **Step 2: Review the migration before applying it**

Dispatch the `data-integrity-reviewer` agent on this file. Act on any blocking finding before going on.

- [ ] **Step 3: Apply it to production**

Supabase MCP `apply_migration` with name `buyer_profiles` and the SQL above, on project `lgtixzpjbkzapecirbfj`.

- [ ] **Step 4: Verify on live data**

Run with Supabase MCP `execute_sql`:

```sql
select
  (select count(*) from purchase_orders) as view_orders,
  (select count(distinct metadata - 'relatedEntryId') from activity_logs
    where action_type='outflow' and voided_at is null and metadata->>'orderType'='quick_outflow') as distinct_orders,
  (select count(*) from purchase_orders where buyer_name='Osave' and extract(isodow from outflow_date)=3) as osave_wed,
  (select count(*) from buyers where pinned_sku_ids = '{}') as buyers_empty_pins;
```

Expected:
- `view_orders = distinct_orders`. It was 166 on 2026-10-22, so it may be higher now.
- `osave_wed ≥ 21`.
- `buyers_empty_pins` equals the total buyer count.

- [ ] **Step 5: Regenerate the types**

Use Supabase MCP `generate_typescript_types` and replace `src/integrations/supabase/types.ts`, then run `git diff --stat src/integrations/supabase/types.ts`.

The diff must touch only two things:
- `pinned_sku_ids` in `buyers` Row, Insert and Update;
- a new `Views.purchase_orders`.

If it shows unrelated drift, revert the file and hand-add just these two pieces instead:

```ts
// buyers.Row:    pinned_sku_ids: string[]
// buyers.Insert: pinned_sku_ids?: string[]
// buyers.Update: pinned_sku_ids?: string[]
    Views: {
      purchase_orders: {
        Row: {
          buyer_name: string | null
          dc_id: string | null
          dc_name: string | null
          egg_totals: Json | null
          invoice_ref: string | null
          order_lines: Json | null
          outflow_date: string | null
          recorded_at: string | null
        }
        Relationships: []
      }
    }
```

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json`. Expected: no errors.

```bash
git add supabase/migrations/20261022000000_buyer_profiles.sql src/integrations/supabase/types.ts
git commit -m "feat(db): buyers.pinned_sku_ids + purchase_orders view"
```

### Task 2: Pure module `buyerProfile.ts` (TDD)

**Files:**
- Create: `src/lib/buyerProfile.ts`
- Test: `src/lib/__tests__/buyerProfile.test.ts`

**Interfaces:**
- Produces: everything later tasks import. All dates are `yyyy-MM-dd` strings, and weekdays use `0 = Sunday … 6 = Saturday`.
  - Types: `PurchaseOrderRow`, `PurchaseOrderLine`.
  - Constant: `WINDOW_DAYS = 56`.
  - Date helpers: `localToday()`, `addDays(s, n)`, `weekdayOf(s)`, `monthStart(s, monthsBack)`, `toLocalDate(s)`, `median(xs)`.
  - Pins: `pinnedCodesFor(skus, pinnedIds): Set<string>`, `groupSkusForBuyer(skus, pinnedCodes): { pinned, others }`.
  - Insights: `anchorDate`, `windowOrders`, `spanDays`, `weekdayPattern(orders, today): WeekdayStat[]` (indexed by weekday), `nextLikelyWeekday(stats, today): number | null`, `typicalDay(orders, today, weekday): TypicalDay`, `skuShares(orders, today): SkuShare[]`, `monthlyTotals(orders, maxMonths?)`, `dayOfMonthPattern(orders, today): DayOfMonthStat[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  PurchaseOrderRow, anchorDate, dayOfMonthPattern, groupSkusForBuyer, monthlyTotals,
  nextLikelyWeekday, pinnedCodesFor, skuShares, spanDays, typicalDay, weekdayPattern,
} from "@/lib/buyerProfile";

const order = (outflowDate: string, lines: [string, number][], eggs: [string, number][] = []): PurchaseOrderRow => ({
  outflowDate,
  orderLines: lines.map(([skuCode, packQty]) => ({ skuCode, packQty })),
  eggTotals: eggs.map(([product, quantity]) => ({ product, quantity })),
});
const TODAY = "2026-10-22"; // Thursday

describe("pinned SKUs", () => {
  const skus = [
    { id: "1", code: "BK4T" }, { id: "2", code: "KP6O" },
    { id: "3", code: "N30B", isActive: false }, { id: "4", code: "OSVN10O" },
  ];
  it("maps pinned ids to codes and ignores unknown ids", () => {
    expect(pinnedCodesFor(skus, ["3", "zzz"])).toEqual(new Set(["N30B"]));
    expect(pinnedCodesFor(skus, undefined).size).toBe(0);
  });
  it("splits active SKUs into pinned/others in catalog order, dropping inactive", () => {
    const { pinned, others } = groupSkusForBuyer(skus, new Set(["OSVN10O", "KP6O", "N30B"]));
    expect(pinned.map((s) => s.code)).toEqual(["KP6O", "OSVN10O"]);
    expect(others.map((s) => s.code)).toEqual(["BK4T"]);
  });
  it("empty pins puts everything in others", () => {
    expect(groupSkusForBuyer(skus, new Set()).pinned).toEqual([]);
  });
});

// First order Tue 13 Oct; orders Wed 14, Mon 19, Wed 21; today Thu 22 has none.
const history = [
  order("2026-10-13", [["N30B", 10]]),
  order("2026-10-14", [["N30B", 100]], [["NEGERI BIASA", 10]]),
  order("2026-10-14", [["N30B", 50]], [["NEGERI BIASA", 5]]),
  order("2026-10-19", [["KP6O", 20]]),
  order("2026-10-21", [["N30B", 200], ["OSVN10O", 10]], [["NEGERI BIASA", 30]]),
];

describe("weekdayPattern", () => {
  it("counts available days from the first order and skips today until it has an order", () => {
    const s = weekdayPattern(history, TODAY);
    expect(s[3]).toMatchObject({ available: 2, withOrder: 2, orders: 3, usual: true }); // Wed 14, 21
    expect(s[2]).toMatchObject({ available: 2, withOrder: 1, usual: true });            // Tue 13, 20 — 0.5 is usual
    expect(s[4]).toMatchObject({ available: 1, withOrder: 0, usual: false });           // Thu 15 only
  });
  it("counts today once it has an order", () => {
    const s = weekdayPattern([...history, order(TODAY, [["N30B", 5]])], TODAY);
    expect(s[4]).toMatchObject({ available: 2, withOrder: 1 });
  });
  it("anchors on a future delivery date entered early", () => {
    expect(anchorDate([order("2026-10-23", [])], TODAY)).toBe("2026-10-23");
  });
});

describe("nextLikelyWeekday", () => {
  it("returns the first usual weekday from today", () => {
    expect(nextLikelyWeekday(weekdayPattern(history, TODAY), TODAY)).toBe(1); // Thu → Fri, Sat, Sun no → Mon
  });
  it("falls back to the busiest weekday, or null with no orders", () => {
    const s = weekdayPattern(history, TODAY).map((x) => ({ ...x, usual: false }));
    expect(nextLikelyWeekday(s, TODAY)).toBe(3);
    expect(nextLikelyWeekday(weekdayPattern([], TODAY), TODAY)).toBeNull();
  });
});

describe("typicalDay", () => {
  it("sums orders on the same date before taking the median", () => {
    const t = typicalDay(history, TODAY, 3);
    expect(t.orderDays).toBe(2);
    expect(t.skus[0]).toEqual({ key: "N30B", median: 175, days: 2 }); // median(150, 200)
    expect(t.skus[1]).toEqual({ key: "OSVN10O", median: 10, days: 1 });
    expect(t.eggs[0]).toEqual({ key: "NEGERI BIASA", median: 22.5, days: 2 }); // median(15, 30)
  });
  it("ignores orders outside the 56-day window", () => {
    const t = typicalDay([order("2026-08-19", [["BK4T", 9]]), ...history], TODAY, 3); // Wed, 64 days back
    expect(t.skus.map((l) => l.key)).not.toContain("BK4T");
  });
});

describe("skuShares", () => {
  it("counts an SKU once per order and ranks by share", () => {
    const s = skuShares([order("2026-10-20", [["N30B", 1], ["N30B", 2]]), order("2026-10-21", [["N30B", 1]]), order("2026-10-21", [["KP6O", 9]])], TODAY);
    expect(s[0]).toMatchObject({ code: "N30B", orders: 2, qty: 4 });
    expect(s[0].share).toBeCloseTo(2 / 3);
  });
});

describe("monthlyTotals", () => {
  it("buckets by delivery month, newest first", () => {
    const m = monthlyTotals([order("2026-09-30", [["N30B", 5]]), order("2026-10-01", [["N30B", 7]]), order("2026-10-02", [["KP6O", 3]], [["KAMPUNG MERAH", 18]])]);
    expect(m.months).toEqual(["2026-10", "2026-09"]);
    expect(m.skus[0]).toEqual({ key: "N30B", byMonth: { "2026-10": 7, "2026-09": 5 }, total: 12 });
    expect(m.eggs[0].byMonth["2026-10"]).toBe(18);
  });
});

describe("dayOfMonthPattern and spanDays", () => {
  const h = [order("2026-09-30", []), order("2026-10-01", [])];
  it("uses only dates inside the span as the denominator", () => {
    const d = dayOfMonthPattern(h, TODAY);
    expect(d[29]).toMatchObject({ day: 30, dates: 1, orderDays: 1, rate: 1 }); // 30 Oct not reached yet
    expect(d[0]).toMatchObject({ day: 1, dates: 1, orderDays: 1 });
    expect(d[22]).toMatchObject({ day: 23, dates: 0, rate: 0 });
  });
  it("measures the history span in days, inclusive", () => {
    expect(spanDays(h, TODAY)).toBe(23);
    expect(spanDays([], TODAY)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- --run src/lib/__tests__/buyerProfile.test.ts`. Expected: FAIL, because the module `@/lib/buyerProfile` doesn't exist yet.

- [ ] **Step 3: Implement the module**

```ts
// Buyer profile helpers: the pinned-SKU grouping for the Purchase Order SKU
// dropdown and the planning insights on Catalog → Buyers → profile. Pure (no
// React / Supabase) so the rules in
// docs/superpowers/specs/2026-10-22-buyer-profiles-design.md stay unit-tested.
// Dates are yyyy-MM-dd strings (local calendar days); they compare as strings.

export interface PurchaseOrderLine { skuCode?: string; packQty?: number; eggProduct?: string; looseQty?: number }
export interface PurchaseOrderRow {
  outflowDate: string; // delivery date
  orderLines: PurchaseOrderLine[]; // Box SKU lines: packQty = boxes
  eggTotals: { product: string; quantity: number }[]; // native unit (kg / butir)
}

export const WINDOW_DAYS = 56;

export const toLocalDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const localToday = () => fmt(new Date());
export const addDays = (s: string, n: number) => {
  const d = toLocalDate(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
};
export const weekdayOf = (s: string) => toLocalDate(s).getDay(); // 0 = Sunday … 6 = Saturday
export const monthStart = (s: string, monthsBack: number) => {
  const d = toLocalDate(s);
  return fmt(new Date(d.getFullYear(), d.getMonth() - monthsBack, 1));
};

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---- Pinned SKUs (PO dropdown) ----

// Pinned pack_skus ids → codes. Unknown (deleted) ids drop out.
export function pinnedCodesFor(skus: { id: string; code: string }[], pinnedIds: string[] | undefined): Set<string> {
  const ids = new Set(pinnedIds ?? []);
  return new Set(skus.filter((s) => ids.has(s.id)).map((s) => s.code));
}

// Active SKUs split into the buyer's pinned group and the rest, each in catalog order.
export function groupSkusForBuyer<T extends { code: string; isActive?: boolean | null }>(skus: T[], pinnedCodes: Set<string>) {
  const active = skus.filter((s) => s.isActive !== false);
  return {
    pinned: active.filter((s) => pinnedCodes.has(s.code)),
    others: active.filter((s) => !pinnedCodes.has(s.code)),
  };
}

// ---- Insights ----

const firstDate = (orders: PurchaseOrderRow[]) =>
  orders.reduce<string | null>((min, o) => (min === null || o.outflowDate < min ? o.outflowDate : min), null);

// Later of today and the latest delivery date (POs can be entered before delivery).
export const anchorDate = (orders: PurchaseOrderRow[], today: string) =>
  orders.reduce((max, o) => (o.outflowDate > max ? o.outflowDate : max), today);

export function windowOrders(orders: PurchaseOrderRow[], today: string) {
  const end = anchorDate(orders, today);
  const start = addDays(end, -(WINDOW_DAYS - 1));
  return orders.filter((o) => o.outflowDate >= start && o.outflowDate <= end);
}

export function spanDays(orders: PurchaseOrderRow[], today: string): number {
  const first = firstDate(orders);
  if (!first) return 0;
  return Math.round((toLocalDate(today).getTime() - toLocalDate(first).getTime()) / 86_400_000) + 1;
}

export interface WeekdayStat { weekday: number; available: number; withOrder: number; orders: number; usual: boolean }

// Per weekday: how many of its dates (since the first order, within the window)
// had an order. The anchor day only counts once it has an order.
export function weekdayPattern(orders: PurchaseOrderRow[], today: string): WeekdayStat[] {
  const stats: WeekdayStat[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday, available: 0, withOrder: 0, orders: 0, usual: false,
  }));
  const first = firstDate(orders);
  if (!first) return stats;
  const end = anchorDate(orders, today);
  const windowStart = addDays(end, -(WINDOW_DAYS - 1));
  const start = first > windowStart ? first : windowStart;
  const perDay = new Map<string, number>();
  for (const o of orders) perDay.set(o.outflowDate, (perDay.get(o.outflowDate) ?? 0) + 1);
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const n = perDay.get(d) ?? 0;
    if (d === end && n === 0) continue;
    const s = stats[weekdayOf(d)];
    s.available++;
    if (n > 0) {
      s.withOrder++;
      s.orders += n;
    }
  }
  for (const s of stats) s.usual = s.available > 0 && s.withOrder / s.available >= 0.5;
  return stats;
}

// First usual weekday from today (inclusive); else the busiest; null if no orders.
export function nextLikelyWeekday(stats: WeekdayStat[], today: string): number | null {
  const from = weekdayOf(today);
  for (let i = 0; i < 7; i++) {
    const wd = (from + i) % 7;
    if (stats[wd].usual) return wd;
  }
  const busiest = stats.reduce((a, b) => (b.orders > a.orders ? b : a));
  return busiest.orders > 0 ? busiest.weekday : null;
}

export interface TypicalLine { key: string; median: number; days: number }
export interface TypicalDay { orderDays: number; skus: TypicalLine[]; eggs: TypicalLine[] }

const addTo = (m: Map<string, number>, k: string, q: number) => m.set(k, (m.get(k) ?? 0) + q);
const pushTo = (m: Map<string, number[]>, k: string, q: number) => m.set(k, [...(m.get(k) ?? []), q]);
const toTypical = (perDay: Map<string, number[]>): TypicalLine[] =>
  [...perDay]
    .map(([key, qs]) => ({ key, median: median(qs), days: qs.length }))
    .sort((a, b) => b.days - a.days || b.median - a.median);

// Typical order on a weekday: same-date orders (several stores/DCs) are summed
// first, then the median is taken over the days the SKU / egg appeared.
export function typicalDay(orders: PurchaseOrderRow[], today: string, weekday: number): TypicalDay {
  const days = new Map<string, PurchaseOrderRow[]>();
  for (const o of windowOrders(orders, today)) {
    if (weekdayOf(o.outflowDate) === weekday) days.set(o.outflowDate, [...(days.get(o.outflowDate) ?? []), o]);
  }
  const skus = new Map<string, number[]>();
  const eggs = new Map<string, number[]>();
  for (const dayOrders of days.values()) {
    const skuSum = new Map<string, number>();
    const eggSum = new Map<string, number>();
    for (const o of dayOrders) {
      for (const l of o.orderLines) if (l.skuCode && l.packQty) addTo(skuSum, l.skuCode, l.packQty);
      for (const e of o.eggTotals) addTo(eggSum, e.product, e.quantity);
    }
    for (const [k, q] of skuSum) pushTo(skus, k, q);
    for (const [k, q] of eggSum) pushTo(eggs, k, q);
  }
  return { orderDays: days.size, skus: toTypical(skus), eggs: toTypical(eggs) };
}

export interface SkuShare { code: string; orders: number; qty: number; share: number }

// SKUs ordered in the window: orders containing it (once per order), total qty,
// share of the window's orders. Also drives "Suggest" and per-SKU order counts.
export function skuShares(orders: PurchaseOrderRow[], today: string): SkuShare[] {
  const w = windowOrders(orders, today);
  const counts = new Map<string, { orders: number; qty: number }>();
  for (const o of w) {
    const seen = new Set<string>();
    for (const l of o.orderLines) {
      if (!l.skuCode) continue;
      const c = counts.get(l.skuCode) ?? { orders: 0, qty: 0 };
      if (!seen.has(l.skuCode)) {
        c.orders++;
        seen.add(l.skuCode);
      }
      c.qty += l.packQty ?? 0;
      counts.set(l.skuCode, c);
    }
  }
  return [...counts]
    .map(([code, c]) => ({ code, ...c, share: c.orders / w.length }))
    .sort((a, b) => b.share - a.share || b.qty - a.qty);
}

export interface MonthlyRow { key: string; byMonth: Record<string, number>; total: number }

// Per calendar month (yyyy-MM, newest first, at most maxMonths with data):
// SKU packQty and egg quantity per product.
export function monthlyTotals(orders: PurchaseOrderRow[], maxMonths = 6) {
  const months = [...new Set(orders.map((o) => o.outflowDate.slice(0, 7)))].sort().reverse().slice(0, maxMonths);
  const keep = new Set(months);
  const skus = new Map<string, MonthlyRow>();
  const eggs = new Map<string, MonthlyRow>();
  const add = (m: Map<string, MonthlyRow>, key: string, month: string, q: number) => {
    const r = m.get(key) ?? { key, byMonth: {}, total: 0 };
    r.byMonth[month] = (r.byMonth[month] ?? 0) + q;
    r.total += q;
    m.set(key, r);
  };
  for (const o of orders) {
    const month = o.outflowDate.slice(0, 7);
    if (!keep.has(month)) continue;
    for (const l of o.orderLines) if (l.skuCode && l.packQty) add(skus, l.skuCode, month, l.packQty);
    for (const e of o.eggTotals) add(eggs, e.product, month, e.quantity);
  }
  const sorted = (m: Map<string, MonthlyRow>) => [...m.values()].sort((a, b) => b.total - a.total);
  return { months, skus: sorted(skus), eggs: sorted(eggs) };
}

export interface DayOfMonthStat { day: number; dates: number; orderDays: number; rate: number }

// Per day number 1–31: order-days on it / dates with that number between the
// first order and today.
export function dayOfMonthPattern(orders: PurchaseOrderRow[], today: string): DayOfMonthStat[] {
  const stats = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, dates: 0, orderDays: 0, rate: 0 }));
  const first = firstDate(orders);
  if (!first) return stats;
  const orderDays = new Set(orders.map((o) => o.outflowDate));
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const s = stats[toLocalDate(d).getDate() - 1];
    s.dates++;
    if (orderDays.has(d)) s.orderDays++;
  }
  for (const s of stats) s.rate = s.dates ? s.orderDays / s.dates : 0;
  return stats;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- --run src/lib/__tests__/buyerProfile.test.ts`. Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/buyerProfile.ts src/lib/__tests__/buyerProfile.test.ts
git commit -m "feat(buyers): pure helpers for pinned SKUs and planning insights"
```

### Task 3: Buyer type and hooks

**Files:**
- Modify: `src/types/quickOutflow.ts:1-4`
- Modify: `src/hooks/useBuyers.ts`
- Create: `src/hooks/usePurchaseOrders.ts`

**Interfaces:**
- Consumes: from Task 2, `PurchaseOrderRow`, `addDays`, `localToday`, `monthStart`; from Task 1, the view.
- Produces:
  - `Buyer.pinnedSkuIds?: string[]`.
  - `useBuyers().setPinnedSkus`, a mutation taking `{ id: string; skuIds: string[] }`.
  - `usePurchaseOrders(buyerName: string)`, a query returning `PurchaseOrderRow[]`.
  - `useBuyerOrderStats()`, a query returning `Map<string, { orders30d: number; lastOrderDate: string }>`, keyed by buyer name.

- [ ] **Step 1: Extend the `Buyer` type**

```ts
export interface Buyer {
  id: string;
  name: string;
  pinnedSkuIds?: string[]; // pack_skus ids pinned to the top of this buyer's PO SKU dropdown
}
```

- [ ] **Step 2: Update `useBuyers`**

Map the column and add the mutation. In the `queryFn` map, replace `({ id: row.id, name: row.name })` with:

```ts
      return (data || []).map((row) => ({ id: row.id, name: row.name, pinnedSkuIds: row.pinned_sku_ids ?? [] }));
```

Add this after `updateBuyer`, and include `setPinnedSkus` in the returned object:

```ts
  // Admin-only in the UI. Replaces the buyer's pinned SKU list.
  const setPinnedSkus = useMutation({
    mutationFn: async ({ id, skuIds }: { id: string; skuIds: string[] }) => {
      const { error } = await supabase.from("buyers").update({ pinned_sku_ids: skuIds }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
    },
  });
```

- [ ] **Step 3: Create `src/hooks/usePurchaseOrders.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PurchaseOrderRow, addDays, localToday, monthStart } from "@/lib/buyerProfile";

const PAGE = 1000; // PostgREST max rows per request

// A buyer's Purchase Orders (one row per order, from the purchase_orders view)
// for the current month + 5 previous. Paged so insights never undercount.
async function fetchBuyerOrders(buyerName: string): Promise<PurchaseOrderRow[]> {
  const since = monthStart(localToday(), 5);
  const rows: PurchaseOrderRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("outflow_date, order_lines, egg_totals")
      .eq("buyer_name", buyerName)
      .gte("outflow_date", since)
      .order("outflow_date")
      .order("recorded_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      rows.push({
        outflowDate: r.outflow_date as string,
        orderLines: (r.order_lines as unknown as PurchaseOrderRow["orderLines"]) ?? [],
        eggTotals: (r.egg_totals as unknown as PurchaseOrderRow["eggTotals"]) ?? [],
      });
    }
    if (!data || data.length < PAGE) return rows;
  }
}

export function usePurchaseOrders(buyerName: string | null | undefined) {
  return useQuery({
    queryKey: ["purchase_orders", buyerName],
    queryFn: () => fetchBuyerOrders(buyerName as string),
    enabled: !!buyerName,
  });
}

// Orders in the last 30 days + latest delivery date, per buyer name (list cards).
// ponytail: one unpaged request (~300 rows today); page like fetchBuyerOrders past 1000.
export function useBuyerOrderStats() {
  return useQuery({
    queryKey: ["purchase_orders", "stats30d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("buyer_name, outflow_date")
        .gte("outflow_date", addDays(localToday(), -29));
      if (error) throw error;
      const stats = new Map<string, { orders30d: number; lastOrderDate: string }>();
      for (const r of data ?? []) {
        if (!r.buyer_name || !r.outflow_date) continue;
        const s = stats.get(r.buyer_name) ?? { orders30d: 0, lastOrderDate: r.outflow_date };
        s.orders30d++;
        if (r.outflow_date > s.lastOrderDate) s.lastOrderDate = r.outflow_date;
        stats.set(r.buyer_name, s);
      }
      return stats;
    },
  });
}
```

- [ ] **Step 4: Typecheck, test and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm test -- --run`. Expected: no type errors, and all tests pass.

```bash
git add src/types/quickOutflow.ts src/hooks/useBuyers.ts src/hooks/usePurchaseOrders.ts
git commit -m "feat(buyers): pinned SKU mutation and purchase order hooks"
```

### Task 4: PO SKU dropdown — pinned group on top

**Files:**
- Modify: `src/components/OrderLineItem.tsx` (props; SKU `CommandList` at ~L131–153)
- Modify: `src/components/QuickOutflowBuilder.tsx` (near the `packSKUs` map ~L72 and the `<OrderLineItem` call ~L647)
- Modify: `src/locales/en.ts`, `src/locales/id.ts`

**Interfaces:**
- Consumes: from Task 2, `pinnedCodesFor` and `groupSkusForBuyer`; from Task 3, `Buyer.pinnedSkuIds`.
- Produces: the `OrderLineItem` prop `pinnedSkuCodes?: Set<string>`, and the locale block `buyerProfile` (first key: `otherSkus`).

- [ ] **Step 1: Add the `buyerProfile` locale block**

Add it right after the `catalog` block, in both files. The Phase 2 keys go in now too, so the block is written once.

`src/locales/en.ts`:

```ts
  buyerProfile: {
    otherSkus: 'Other SKUs',
    pinSkus: 'Pinned SKUs',
    suggestFromHistory: 'Suggest from history',
    ordersIn8Weeks: '{n} orders in 8 weeks',
    noPins: 'No SKUs pinned — the order form shows all SKUs.',
    planning: 'Planning',
    skus: 'SKUs',
    dcs: 'DCs',
    back: 'Back to buyers',
    pickBuyer: 'Pick a buyer',
    stats30d: '{n} orders in 30 days · last {date}',
    noOrders30d: 'No orders in 30 days',
    pinnedCount: '{n} SKUs pinned',
    thinData: 'Based on {weeks} weeks of history. Patterns firm up after ~8 weeks.',
    byWeekday: 'Weeks with an order, by delivery day',
    typicalDay: 'Typical {day}',
    medianOf: 'median of {n} days',
    prep: 'Prep (SKU)',
    buy: 'Buy (eggs)',
    mostFrequent: 'Most frequent SKUs',
    perMonth: 'Per month',
    soFar: 'so far',
    dayOfMonth: 'Day of month',
    needsMonths: 'needs ~3 months of history',
    noOrders: 'No Purchase Orders for {buyer} yet.',
    loadFailed: "Couldn't load order history",
    retry: 'Retry',
    pack: 'pack',
    box: 'box',
  },
```

`src/locales/id.ts`:

```ts
  buyerProfile: {
    otherSkus: 'SKU lainnya',
    pinSkus: 'SKU utama',
    suggestFromHistory: 'Sarankan dari riwayat',
    ordersIn8Weeks: '{n} order dalam 8 minggu',
    noPins: 'Belum ada SKU utama — form order menampilkan semua SKU.',
    planning: 'Perencanaan',
    skus: 'SKU',
    dcs: 'DC',
    back: 'Kembali ke buyer',
    pickBuyer: 'Pilih buyer',
    stats30d: '{n} order dalam 30 hari · terakhir {date}',
    noOrders30d: 'Tidak ada order dalam 30 hari',
    pinnedCount: '{n} SKU utama',
    thinData: 'Berdasarkan riwayat {weeks} minggu. Pola makin akurat setelah ~8 minggu.',
    byWeekday: 'Minggu dengan order, per hari kirim',
    typicalDay: '{day} biasanya',
    medianOf: 'median dari {n} hari',
    prep: 'Siapkan (SKU)',
    buy: 'Beli (telur)',
    mostFrequent: 'SKU paling sering',
    perMonth: 'Per bulan',
    soFar: 'sejauh ini',
    dayOfMonth: 'Tanggal dalam bulan',
    needsMonths: 'butuh riwayat ~3 bulan',
    noOrders: 'Belum ada Purchase Order untuk {buyer}.',
    loadFailed: 'Gagal memuat riwayat order',
    retry: 'Coba lagi',
    pack: 'pack',
    box: 'box',
  },
```

- [ ] **Step 2: Group the dropdown in `OrderLineItem.tsx`**

- Add the import: `import { groupSkusForBuyer } from "@/lib/buyerProfile";`.
- Add `pinnedSkuCodes?: Set<string>;` to `OrderLineItemProps`, and destructure it.
- Replace the single `<CommandGroup>…</CommandGroup>` inside the SKU `CommandList` with:

```tsx
                    {(() => {
                      const { pinned, others } = groupSkusForBuyer(skus, pinnedSkuCodes ?? new Set());
                      const item = (sku: PackSKU) => (
                        <CommandItem
                          key={sku.code}
                          value={`${sku.code} ${sku.displayName}`}
                          onSelect={() => {
                            onUpdate({ skuCode: sku.code });
                            setSkuOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", line.skuCode === sku.code ? "opacity-100" : "opacity-0")} />
                          <span className="font-mono text-xs mr-2">{sku.code}</span>
                          {sku.displayName}
                        </CommandItem>
                      );
                      // Buyer's pinned SKUs first; nothing hidden. No pins → one group, as before.
                      return pinned.length > 0 ? (
                        <>
                          <CommandGroup heading={selectedBuyer?.name}>{pinned.map(item)}</CommandGroup>
                          <CommandGroup heading={t.buyerProfile.otherSkus}>{others.map(item)}</CommandGroup>
                        </>
                      ) : (
                        <CommandGroup>{others.map(item)}</CommandGroup>
                      );
                    })()}
```

- [ ] **Step 3: Pass the pinned codes from `QuickOutflowBuilder.tsx`**

- Add the import: `import { pinnedCodesFor } from "@/lib/buyerProfile";`.
- After the `packSKUs` mapping, add the snippet below.
- Pass `pinnedSkuCodes={pinnedSkuCodes}` to `<OrderLineItem`.

```ts
  // Pins of the selected buyer, read from the live buyers list so an admin's
  // edit shows without re-picking the buyer. Catalog skus carry ids; packSKUs don't.
  const pinnedSkuCodes = useMemo(
    () => pinnedCodesFor(skus, buyers.find((b) => b.id === selectedBuyer?.id)?.pinnedSkuIds),
    [skus, buyers, selectedBuyer?.id]
  );
```

Make sure this sits **after** the `selectedBuyer` `useState` (~L84). Move it below that line if needed.

- [ ] **Step 4: Typecheck, test and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm test -- --run`. Expected: no errors, all tests pass.

```bash
git add src/components/OrderLineItem.tsx src/components/QuickOutflowBuilder.tsx src/locales/en.ts src/locales/id.ts
git commit -m "feat(orders): pin the buyer's SKUs to the top of the SKU dropdown"
```

### Task 5: Pinned-SKU editor (Phase 1 entry: dialog on the Buyers table)

**Files:**
- Create: `src/components/catalog/BuyerSkuPins.tsx`
- Modify: `src/components/catalog/BuyerList.tsx` (row actions and dialogs)

**Interfaces:**
- Consumes: from Task 2, `skuShares` and `localToday`; from Task 3, `useBuyers().setPinnedSkus` and `usePurchaseOrders`.
- Produces: `<BuyerSkuPins buyer isAdmin onSaved? onCancel? />`, which Task 7 reuses unchanged.

- [ ] **Step 1: Create `BuyerSkuPins.tsx`**

```tsx
import { useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBuyers } from "@/hooks/useBuyers";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { localToday, skuShares } from "@/lib/buyerProfile";
import type { Buyer } from "@/types/quickOutflow";

interface BuyerSkuPinsProps {
  buyer: Buyer;
  isAdmin: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}

// Which SKUs float to the top of this buyer's PO SKU dropdown. Admins tick and
// save; "Suggest" adds SKUs ordered in the last 8 weeks (never removes ticks).
export function BuyerSkuPins({ buyer, isAdmin, onSaved, onCancel }: BuyerSkuPinsProps) {
  const { t } = useLanguage();
  const { skus } = usePackSKUs();
  const { setPinnedSkus } = useBuyers();
  const { data: orders = [] } = usePurchaseOrders(buyer.name);
  const active = useMemo(() => skus.filter((s) => s.isActive !== false), [skus]);
  const counts = useMemo(() => new Map(skuShares(orders, localToday()).map((s) => [s.code, s.orders])), [orders]);
  const saved = buyer.pinnedSkuIds ?? [];
  const [ticked, setTicked] = useState(() => new Set(saved));

  if (!isAdmin) {
    const pinned = active.filter((s) => saved.includes(s.id));
    if (pinned.length === 0) return <p className="text-sm text-muted-foreground">{t.buyerProfile.noPins}</p>;
    return (
      <ul className="space-y-1 text-sm">
        {pinned.map((s) => (
          <li key={s.id} className="truncate"><span className="font-mono text-xs mr-2">{s.code}</span>{s.displayName}</li>
        ))}
      </ul>
    );
  }

  const toggle = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const suggest = () =>
    setTicked((prev) => new Set([...prev, ...active.filter((s) => counts.has(s.code)).map((s) => s.id)]));
  const cancel = () => {
    setTicked(new Set(saved));
    onCancel?.();
  };
  const save = async () => {
    try {
      // Only active ids are written, which also drops pins of retired SKUs.
      await setPinnedSkus.mutateAsync({ id: buyer.id, skuIds: active.filter((s) => ticked.has(s.id)).map((s) => s.id) });
      toast.success(t.catalog.updateSuccess);
      onSaved?.();
    } catch (error: any) {
      toast.error(error.message || t.common.error);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={suggest} className="gap-2">
          <Sparkles className="h-4 w-4" />
          {t.buyerProfile.suggestFromHistory}
        </Button>
      </div>
      <div className="divide-y rounded-lg border">
        {active.map((s) => (
          <label key={s.id} className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm">
            <Checkbox checked={ticked.has(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} />
            <span className="min-w-0 flex-1 truncate"><span className="font-mono text-xs mr-2">{s.code}</span>{s.displayName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {t.buyerProfile.ordersIn8Weeks.replace("{n}", String(counts.get(s.code) ?? 0))}
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={cancel}>{t.common.cancel}</Button>
        <Button onClick={save} disabled={setPinnedSkus.isPending}>
          {setPinnedSkus.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t.common.save}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Open it from the Buyers table**

In `BuyerList.tsx`:
- Import `Pin` from `lucide-react` and `BuyerSkuPins` from `./BuyerSkuPins`.
- Add state: `const [pinsBuyer, setPinsBuyer] = useState<Buyer | null>(null);`.
- Inside the admin actions, before the `MapPin` button, add:

```tsx
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t.buyerProfile.pinSkus}
                              title={t.buyerProfile.pinSkus}
                              onClick={() => setPinsBuyer(buyer)}
                            >
                              <Pin className="h-4 w-4" />
                            </Button>
```

Next to the other dialogs, add:

```tsx
      <Dialog open={!!pinsBuyer} onOpenChange={(open) => { if (!open) setPinsBuyer(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{pinsBuyer?.name} — {t.buyerProfile.pinSkus}</DialogTitle>
          </DialogHeader>
          {pinsBuyer && (
            <BuyerSkuPins buyer={pinsBuyer} isAdmin={isAdmin} onSaved={() => setPinsBuyer(null)} onCancel={() => setPinsBuyer(null)} />
          )}
        </DialogContent>
      </Dialog>
```

- [ ] **Step 3: Verify Phase 1 in the running app**

Use `npm run dev` or the `run` skill.

1. As an admin, open Catalog → Buyers → the pin icon on Osave, then **Suggest from history**. Expected: the 7 SKUs Osave has ordered get ticked (KP6O, N10B, N10O, N30B, OSVKP6O, OSVN10B, OSVN10O).
2. Untick N10O and **Save**.
3. On Orders → Purchase Order, pick Osave and open a line's SKU dropdown. Expected: an "Osave" group with 6 SKUs, then "Other SKUs". Search for `BK4` and expect it to be found under Other SKUs.
4. Pick a buyer with no pins. Expected: a single list, as before.
5. At 375px wide, the dialog fits and nothing scrolls sideways.

Afterwards, restore Osave's real pins to whatever the user wants. These are production rows.

- [ ] **Step 4: Typecheck, test and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm test -- --run`. Expected: no errors, all tests pass.

```bash
git add src/components/catalog/BuyerSkuPins.tsx src/components/catalog/BuyerList.tsx
git commit -m "feat(catalog): pinned-SKU editor for buyers"
```

**Phase 1 can ship here.** The migration is already live, so push or merge only when the user says to.

---

## Phase 2 — Buyer profile page

### Task 6: Planning section

**Files:**
- Create: `src/components/catalog/BuyerPlanning.tsx`

**Interfaces:**
- Consumes: from Task 2, `weekdayPattern`, `nextLikelyWeekday`, `typicalDay`, `skuShares`, `monthlyTotals`, `dayOfMonthPattern`, `spanDays`, `localToday` and `toLocalDate`; from Task 3, `usePurchaseOrders`; `getStockUnit` and `butirEquivalent` from `@/lib/inventory`; `conversionMap` from `useItemTypes()`.
- Produces: `<BuyerPlanning buyerName: string />`.

- [ ] **Step 1: Create `BuyerPlanning.tsx`**

```tsx
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { useItemTypes } from "@/hooks/useItemTypes";
import { butirEquivalent, getStockUnit } from "@/lib/inventory";
import { cn } from "@/lib/utils";
import {
  dayOfMonthPattern, localToday, monthlyTotals, nextLikelyWeekday, skuShares, spanDays, toLocalDate, typicalDay, weekdayPattern,
} from "@/lib/buyerProfile";

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">
        {title} {hint && <span className="font-normal text-muted-foreground">· {hint}</span>}
      </h4>
      {children}
    </section>
  );
}

// Planning view of one buyer's Purchase Orders (rules: src/lib/buyerProfile.ts).
export function BuyerPlanning({ buyerName }: { buyerName: string }) {
  const { t, language } = useLanguage();
  const locale = language === "id" ? "id-ID" : "en-US";
  const { data: orders = [], isLoading, error, refetch } = usePurchaseOrders(buyerName);
  const { skus } = usePackSKUs();
  const { conversionMap } = useItemTypes();
  const today = localToday();

  const stats = useMemo(() => weekdayPattern(orders, today), [orders, today]);
  const [picked, setPicked] = useState<number | null>(null);
  const weekday = picked ?? nextLikelyWeekday(stats, today);
  const typical = useMemo(() => (weekday === null ? null : typicalDay(orders, today, weekday)), [orders, today, weekday]);
  const top = useMemo(() => skuShares(orders, today).slice(0, 5), [orders, today]);
  const monthly = useMemo(() => monthlyTotals(orders), [orders]);
  const dom = useMemo(() => dayOfMonthPattern(orders, today), [orders, today]);
  const span = spanDays(orders, today);

  // 18 Oct 2026 is a Sunday, so 18 + wd is weekday wd.
  const dayName = (wd: number, style: "short" | "long" = "short") =>
    new Date(2026, 9, 18 + wd).toLocaleDateString(locale, { weekday: style });
  const unitOf = (code: string) => (skus.find((s) => s.code === code)?.basePackCode ? t.buyerProfile.box : t.buyerProfile.pack);
  const eggQty = (product: string, q: number) =>
    getStockUnit(product, "egg", conversionMap) === "kg"
      ? `${num(q)} kg (≈ ${butirEquivalent(product, q, conversionMap).toLocaleString()} butir)`
      : `${num(q)} butir`;
  const monthLabel = (m: string) =>
    toLocalDate(`${m}-01`).toLocaleDateString(locale, { month: "short", year: "2-digit" }) +
    (m === today.slice(0, 7) ? ` (${t.buyerProfile.soFar})` : "");

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error) {
    return (
      <div className="flex items-center gap-3 py-6 text-sm">
        {t.buyerProfile.loadFailed}
        <Button variant="outline" size="sm" onClick={() => refetch()}>{t.buyerProfile.retry}</Button>
      </div>
    );
  }
  if (orders.length === 0) return <p className="py-6 text-sm text-muted-foreground">{t.buyerProfile.noOrders.replace("{buyer}", buyerName)}</p>;

  return (
    <div className="min-w-0 space-y-6">
      {span < 56 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t.buyerProfile.thinData.replace("{weeks}", String(Math.max(1, Math.round(span / 7))))}
        </p>
      )}

      <Section title={t.buyerProfile.byWeekday}>
        <div className="space-y-1">
          {WEEK_ORDER.map((wd) => {
            const s = stats[wd];
            const pct = s.available ? (s.withOrder / s.available) * 100 : 0;
            return (
              <button
                key={wd}
                type="button"
                onClick={() => setPicked(wd)}
                className={cn("grid w-full grid-cols-[3rem_1fr_5.5rem] items-center gap-2 rounded px-1 py-1 text-left text-sm", wd === weekday && "bg-accent")}
              >
                <span className={cn(s.usual && "font-semibold")}>{dayName(wd)}</span>
                <span className="h-2 rounded-full bg-muted">
                  <span className="block h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">{s.withOrder}/{s.available} · {s.orders}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {typical && weekday !== null && (
        <Section
          title={t.buyerProfile.typicalDay.replace("{day}", dayName(weekday, "long"))}
          hint={t.buyerProfile.medianOf.replace("{n}", String(typical.orderDays))}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t.buyerProfile.prep}</p>
              {typical.skus.map((l) => (
                <div key={l.key} className="flex justify-between gap-2 border-b py-1 text-sm">
                  <span className="font-mono text-xs">{l.key}</span>
                  <span className="tabular-nums">
                    {num(l.median)} {unitOf(l.key)}
                    {l.days < typical.orderDays && <span className="ml-1 text-muted-foreground">{l.days}/{typical.orderDays}</span>}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t.buyerProfile.buy}</p>
              {typical.eggs.map((l) => (
                <div key={l.key} className="flex justify-between gap-2 border-b py-1 text-sm">
                  <span className="min-w-0 truncate">{l.key}</span>
                  <span className="shrink-0 tabular-nums">{eggQty(l.key, l.median)}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      <Section title={t.buyerProfile.mostFrequent}>
        <div className="flex flex-wrap gap-1.5">
          {top.map((s) => (
            <span key={s.code} className="rounded-md border px-2 py-0.5 text-xs">
              <span className="font-mono">{s.code}</span> {Math.round(s.share * 100)}%
            </span>
          ))}
        </div>
      </Section>

      <Section title={t.buyerProfile.perMonth}>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-normal" />
                {monthly.months.map((m) => <th key={m} className="whitespace-nowrap px-2 py-1 text-right font-normal">{monthLabel(m)}</th>)}
              </tr>
            </thead>
            <tbody>
              {monthly.skus.map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="py-1 font-mono text-xs">{r.key}</td>
                  {monthly.months.map((m) => (
                    <td key={m} className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                      {r.byMonth[m] ? `${num(r.byMonth[m])} ${unitOf(r.key)}` : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              {monthly.eggs.map((r) => (
                <tr key={r.key} className="border-t text-muted-foreground">
                  <td className="py-1 text-xs">{r.key}</td>
                  {monthly.months.map((m) => (
                    <td key={m} className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                      {r.byMonth[m] ? eggQty(r.key, r.byMonth[m]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t.buyerProfile.dayOfMonth} hint={span < 90 ? t.buyerProfile.needsMonths : undefined}>
        <div className="grid grid-cols-8 gap-1 sm:grid-cols-16">
          {dom.map((d) => (
            <span
              key={d.day}
              title={`${d.orderDays}/${d.dates}`}
              className="rounded border py-0.5 text-center text-xs tabular-nums"
              style={{ backgroundColor: d.rate ? `hsl(var(--primary) / ${0.15 + d.rate * 0.6})` : undefined }}
            >
              {d.day}
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
```

If Tailwind has no `grid-cols-16`, use `sm:grid-cols-[repeat(16,minmax(0,1fr))]`. If `--primary` isn't an HSL triplet in `src/index.css`, use the existing `bg-primary/…` opacity classes, picked by bucket: `rate > .66` / `> .33` / `> 0`.

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json`. Expected: no errors.

```bash
git add src/components/catalog/BuyerPlanning.tsx
git commit -m "feat(catalog): buyer planning insights section"
```

### Task 7: Profile page, card list, drill-down and tablet split

**Files:**
- Create: `src/components/catalog/BuyerProfile.tsx`
- Modify: `src/components/catalog/BuyerList.tsx`

**Interfaces:**
- Consumes:
  - From Task 5: `BuyerSkuPins`. From Task 6: `BuyerPlanning`. From Task 3: `useBuyerOrderStats`.
  - From Task 2: `pinnedCodesFor` and `toLocalDate`.
  - Existing: `useIsTabletLandscape` from `@/hooks/use-mobile`, `BuyerDcsDialog`, `useBuyerDcs`.
- Produces:
  - `<BuyerProfile buyer isAdmin onBack? onEdit onDelete onHistory />`.
  - `buyerStatsLine(t, stat, locale): string`.

- [ ] **Step 1: Create `BuyerProfile.tsx`**

```tsx
import { useState } from "react";
import { ArrowLeft, History, MapPin, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBuyerDcs } from "@/hooks/useBuyerDcs";
import { useBuyerOrderStats } from "@/hooks/usePurchaseOrders";
import { toLocalDate } from "@/lib/buyerProfile";
import type { Buyer } from "@/types/quickOutflow";
import { BuyerDcsDialog } from "./BuyerDcsDialog";
import { BuyerPlanning } from "./BuyerPlanning";
import { BuyerSkuPins } from "./BuyerSkuPins";

type T = ReturnType<typeof useLanguage>["t"];

export function buyerStatsLine(t: T, stat: { orders30d: number; lastOrderDate: string } | undefined, locale: string) {
  if (!stat) return t.buyerProfile.noOrders30d;
  return t.buyerProfile.stats30d
    .replace("{n}", String(stat.orders30d))
    .replace("{date}", toLocalDate(stat.lastOrderDate).toLocaleDateString(locale, { day: "numeric", month: "short" }));
}

interface BuyerProfileProps {
  buyer: Buyer;
  isAdmin: boolean;
  onBack?: () => void; // phone / portrait only
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
}

export function BuyerProfile({ buyer, isAdmin, onBack, onEdit, onDelete, onHistory }: BuyerProfileProps) {
  const { t, language } = useLanguage();
  const { dcsForBuyer } = useBuyerDcs();
  const { data: stats } = useBuyerOrderStats();
  const [dcsOpen, setDcsOpen] = useState(false);
  const dcs = dcsForBuyer(buyer.id);
  const locale = language === "id" ? "id-ID" : "en-US";

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-start gap-2">
        {onBack && (
          <Button variant="ghost" size="icon" aria-label={t.buyerProfile.back} onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{buyer.name}</h3>
          <p className="text-sm text-muted-foreground">{buyerStatsLine(t, stats?.get(buyer.name), locale)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" aria-label="View buyer history" onClick={onHistory}><History className="h-4 w-4" /></Button>
          {isAdmin && (
            <>
              <Button variant="ghost" size="icon" aria-label="Edit buyer" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="Delete buyer" onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="planning">
        <TabsList>
          <TabsTrigger value="planning">{t.buyerProfile.planning}</TabsTrigger>
          <TabsTrigger value="skus">{t.buyerProfile.skus}</TabsTrigger>
          <TabsTrigger value="dcs">{t.buyerProfile.dcs}</TabsTrigger>
        </TabsList>
        <TabsContent value="planning"><BuyerPlanning buyerName={buyer.name} /></TabsContent>
        <TabsContent value="skus"><BuyerSkuPins buyer={buyer} isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="dcs" className="space-y-3">
          {dcs.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="flex flex-wrap gap-1">{dcs.map((dc) => <Badge key={dc.id} variant="outline">{dc.name}</Badge>)}</div>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDcsOpen(true)}>
              <MapPin className="h-4 w-4" />
              {t.catalog.manageDcs}
            </Button>
          )}
        </TabsContent>
      </Tabs>

      <BuyerDcsDialog buyer={buyer} open={dcsOpen} onOpenChange={setDcsOpen} />
    </div>
  );
}
```

- [ ] **Step 2: Rework `BuyerList.tsx` into cards with a drill-down**

- Keep every handler and dialog that's already there: add/edit/save, rename warning, delete with undo, `BuyerHistoryDialog` and `DeleteConfirmDialog`.
- Remove the Task 5 pin button and pin dialog, and the row `MapPin` button with its `BuyerDcsDialog`; the DCs tab now covers both.
- Remove the `Table` imports.
- Add these imports:
  - `useIsTabletLandscape` from `@/hooks/use-mobile`;
  - `useBuyerOrderStats` from `@/hooks/usePurchaseOrders`;
  - `usePackSKUs`;
  - `pinnedCodesFor` from `@/lib/buyerProfile`;
  - `BuyerProfile` and `buyerStatsLine` from `./BuyerProfile`;
  - `cn` from `@/lib/utils`.

Add state and derived values in the component:

```tsx
  const { t, language } = useLanguage(); // replaces the existing `const { t } = useLanguage();`
  const isTablet = useIsTabletLandscape();
  const { data: orderStats } = useBuyerOrderStats();
  const { skus } = usePackSKUs();
  const activeSkus = skus.filter((s) => s.isActive !== false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A deleted buyer drops out of `buyers`, which returns the view to the list.
  const selected = buyers.find((b) => b.id === selectedId) ?? null;
  const locale = language === "id" ? "id-ID" : "en-US";
```

Replace the returned JSX's toolbar and table section, and keep the dialogs below it:

```tsx
  const list = (
    <div className="min-w-0 space-y-3">
      {/* existing search + Add buyer toolbar, unchanged */}
      {filteredBuyers.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t.catalog.noData}</p>
      ) : (
        <div className="space-y-2">
          {filteredBuyers.map((buyer) => {
            const pins = pinnedCodesFor(activeSkus, buyer.pinnedSkuIds).size;
            return (
              <button
                key={buyer.id}
                type="button"
                onClick={() => setSelectedId(buyer.id)}
                className={cn(
                  "w-full min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
                  selectedId === buyer.id && isTablet && "border-primary bg-accent"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{buyer.name}</span>
                  {pins > 0 && (
                    <Badge variant="secondary" className="shrink-0">{t.buyerProfile.pinnedCount.replace("{n}", String(pins))}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{buyerStatsLine(t, orderStats?.get(buyer.name), locale)}</p>
                {dcsForBuyer(buyer.id).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {dcsForBuyer(buyer.id).map((dc) => <Badge key={dc.id} variant="outline" className="max-w-full"><span className="truncate">{dc.name}</span></Badge>)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const profile = selected && (
    <BuyerProfile
      key={selected.id}
      buyer={selected}
      isAdmin={isAdmin}
      onBack={isTablet ? undefined : () => setSelectedId(null)}
      onEdit={() => handleEdit(selected)}
      onDelete={() => handleDeleteClick(selected)}
      onHistory={() => { setHistoryBuyer(selected); setHistoryOpen(true); }}
    />
  );

  return (
    <div className="space-y-4">
      {isTablet ? (
        <div className="flex gap-4">
          <div className="w-[280px] shrink-0">{list}</div>
          <div className="min-w-0 flex-1 border-l pl-4">
            {profile ?? <p className="py-8 text-center text-muted-foreground">{t.buyerProfile.pickBuyer}</p>}
          </div>
        </div>
      ) : (
        profile ?? list
      )}
      {/* existing BuyerDialog, BuyerHistoryDialog, DeleteConfirmDialog, RenameWarningDialog — unchanged */}
    </div>
  );
```

`list` and `profile` are plain JSX values declared after the `isLoading` early return; no hooks are added after that return.

- [ ] **Step 3: Verify in the running app**

1. **Phone (375×812):**
   - Buyers shows as cards. Tapping Osave opens the profile, and back returns to the list.
   - Planning shows the thin-data banner, weekday bars, a typical day, top SKUs, the month table and the day-of-month strip.
   - Nothing scrolls the page sideways. Only the month table scrolls inside itself.
2. **Tablet landscape (1024×768 or wider):** the list sits on the left and "Pick a buyer" on the right until a buyer is tapped. Switching buyers resets the tab to Planning.
3. **Numbers:** compare against the spot-check. On Osave, tap Wednesday: N30B ≈ 428 pack, OSVN10O ≈ 135 box, OSVN10B ≈ 115 box, NEGERI BIASA ≈ 5,617 kg. These may drift as new orders arrive.
4. **Non-admin:** no edit, delete or Manage DCs buttons, and the SKUs tab is read-only.
5. **Admin:**
   - Rename shows the warning.
   - Delete returns to the list, and Undo restores the buyer.
   - Manage DCs opens the existing dialog.

- [ ] **Step 4: Typecheck, test and commit**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm test -- --run`. Expected: no errors, all tests pass.

```bash
git add src/components/catalog/BuyerProfile.tsx src/components/catalog/BuyerList.tsx
git commit -m "feat(catalog): buyer profile page with drill-down and tablet split"
```

### Task 8: Final review and hand-off

- [ ] **Step 1:** Run the full gate, `npx tsc --noEmit -p tsconfig.app.json && npm test -- --run`, and confirm it passes.
- [ ] **Step 2:** Dispatch `data-integrity-reviewer` on the full diff against `feat/tablet-sidebar-activities`. It should confirm there are no stock-path changes and that kg is never summed with butir.
- [ ] **Step 3:** Check i18n parity: every `buyerProfile` key exists in both `en.ts` and `id.ts`.
- [ ] **Step 4:** Report to the user with the branch name, commits, and anything unverified. Do not push to `main` or merge without their go-ahead.
