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
