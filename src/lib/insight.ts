// Numbers behind the Insight page. Pure (no React / Supabase) so they stay
// unit-tested, like buyerProfile.ts. Spec: docs/superpowers/specs/design_handoff_insight.
// Hard rules: a quantity is always per product in its native unit, nothing here
// sums across products; buyer trends are order counts; PO buyers and Kas Tunai
// customers never merge. Dates are yyyy-MM-dd local (WIB) days.
import { format, parseISO } from "date-fns";
import { entryKind } from "@/lib/activityGrouping";
import {
  PurchaseOrderRow,
  WeekdayStat,
  addDays,
  toLocalDate,
  weekdayOf,
  weekdayPattern,
  windowOrders,
} from "@/lib/buyerProfile";
import { computeVariance } from "@/lib/stockCount";
import type { ActivityLog } from "@/types/activityLog";
import type { Delivery, DeliveryLine } from "@/types/deliveries";

// ---- Thresholds. All placeholders until the owner confirms them. ----
export const MATERIAL_RED_DAYS = 3;
export const MATERIAL_AMBER_DAYS = 7;
export const TURNOVER_RED_DAYS = 4.5;
export const DOWN_RATIO = -0.2; // "Turun": orders down 20 % or more
export const RETURN_RATE_RED = 0.15;
export const RELIABILITY_MIN_LOGGED = 0.5; // share of fakturs in the delivery log before Terkirim / Ditolak mean anything
export const COVER_WINDOW_DAYS = 28;
// No return recorded this long before the latest business date: the log has
// stopped (backfill on hold), so a quiet period is unknown, not zero returns.
export const RETURNS_STALE_DAYS = 7;
// One or two orders make every weekday look "usual"; don't call those buyers late.
export const MIN_ORDER_DAYS_FOR_RHYTHM = 3;
export const TREND_WEEKS = 16;

const round2 = (n: number) => Math.round(n * 100) / 100;
export const localDateOf = (iso: string) => format(parseISO(iso), "yyyy-MM-dd");
export const daysBetween = (from: string, to: string) =>
  Math.round((toLocalDate(to).getTime() - toLocalDate(from).getTime()) / 86_400_000);

// ---- Coverage: can this dataset answer the question at all? ----

export interface Coverage {
  start: string | null; // first date in the dataset
  staleSince: string | null; // last date, only when recording has stopped
}

export function dataCoverage(dates: string[], asOf: string, staleDays?: number): Coverage {
  if (dates.length === 0) return { start: null, staleSince: null };
  const start = dates.reduce((m, d) => (d < m ? d : m));
  const last = dates.reduce((m, d) => (d > m ? d : m));
  return { start, staleSince: staleDays != null && last < addDays(asOf, -staleDays) ? last : null };
}

// The latest business date with data, capped at today. POs are back-entered a
// day or two late, so measuring from today would call every buyer late and every
// recent week down. Periods and "Telat" run from here instead.
export const dataAsOf = (dates: string[], today: string) =>
  dates.reduce((m, d) => (d <= today && d > m ? d : m), "") || today;

// True only when both the period and the one before it are fully covered. A
// partly covered previous period would read as false growth, and "Turun" or
// "Baru" could be wrong the same way.
export const isComparable = (cov: Coverage, asOf: string, days: number) =>
  !!cov.start && !cov.staleSince && addDays(asOf, -(2 * days - 1)) >= cov.start;

export interface PeriodCompare {
  cur: number | null; // null: the dataset has stopped before this period began
  prev: number;
  delta: number | null; // null: "Belum cukup data"
}

export function periodSum(
  rows: { date: string; qty: number }[],
  asOf: string,
  days: number,
  cov: Coverage
): PeriodCompare {
  const curStart = addDays(asOf, -(days - 1));
  const prevStart = addDays(asOf, -(2 * days - 1));
  let cur = 0;
  let prev = 0;
  for (const r of rows) {
    // POs can be dated ahead of their entry: those count as the current period.
    if (r.date >= curStart) cur += r.qty;
    else if (r.date >= prevStart) prev += r.qty;
  }
  cur = round2(cur);
  prev = round2(prev);
  return {
    cur: cov.staleSince && curStart > cov.staleSince ? null : cur,
    prev,
    delta: isComparable(cov, asOf, days) ? round2(cur - prev) : null,
  };
}

export const periodCompare = (dates: string[], asOf: string, days: number, cov: Coverage) =>
  periodSum(dates.map((date) => ({ date, qty: 1 })), asOf, days, cov);

// Seven-day buckets ending at asOf, oldest first, so 1 / 4 / 8 buckets line up
// with the period control. A bucket with no data behind it is null, never 0.
export function weeklySums(
  rows: { date: string; qty: number }[],
  asOf: string,
  weeks: number,
  cov: Coverage
): (number | null)[] {
  const out = Array.from({ length: weeks }, (_, i): number | null => {
    const start = addDays(asOf, -(7 * (weeks - i) - 1));
    return !cov.start || start < cov.start || (cov.staleSince && start > cov.staleSince) ? null : 0;
  });
  for (const r of rows) {
    const i = weeks - 1 - Math.floor(Math.max(daysBetween(r.date, asOf), 0) / 7);
    if (i >= 0 && out[i] !== null) out[i] = round2((out[i] as number) + r.qty);
  }
  return out;
}

export const weeklyCounts = (dates: string[], asOf: string, weeks: number, cov: Coverage) =>
  weeklySums(dates.map((date) => ({ date, qty: 1 })), asOf, weeks, cov);

// Last day of bucket i in weeklySums.
export const weekEnd = (asOf: string, i: number, weeks: number) => addDays(asOf, -7 * (weeks - 1 - i));

// ---- Buyers ----

export interface OrderRow extends PurchaseOrderRow {
  recordedAt?: string;
  invoiceRef?: string;
  dcName?: string | null;
  outflowIds?: string[];
}

// Days since the latest usual weekday strictly before asOf when no order came
// on or after it; null when not overdue or the buyer has no real rhythm yet.
export function overdue(stats: WeekdayStat[], lastOrderDate: string | null, asOf: string): number | null {
  if (!lastOrderDate) return null;
  if (stats.reduce((n, s) => n + s.withOrder, 0) < MIN_ORDER_DAYS_FOR_RHYTHM) return null;
  for (let n = 1; n <= 7; n++) {
    const day = addDays(asOf, -n);
    if (stats[weekdayOf(day)].usual) return lastOrderDate < day ? n : null;
  }
  return null;
}

const breadthOf = (orders: OrderRow[]) => {
  if (orders.length === 0) return null;
  const total = orders.reduce(
    (n, o) => n + new Set(o.orderLines.filter((l) => l.skuCode && l.packQty > 0).map((l) => l.skuCode)).size,
    0
  );
  return round2(total / orders.length);
};

// Average distinct SKUs per order, current vs previous period.
export function basketBreadth(orders: OrderRow[], asOf: string, days: number) {
  const curStart = addDays(asOf, -(days - 1));
  const prevStart = addDays(asOf, -(2 * days - 1));
  return {
    cur: breadthOf(orders.filter((o) => o.outflowDate >= curStart)),
    prev: breadthOf(orders.filter((o) => o.outflowDate >= prevStart && o.outflowDate < curStart)),
  };
}

// Average days from PO entry to delivery, over the POs entered ahead of it. A PO
// entered on or after its delivery date says nothing about lead time, so this is
// null unless most POs are entered ahead (today: none of them are).
export function leadTime(orders: OrderRow[]): number | null {
  const gaps = orders.filter((o) => o.recordedAt).map((o) => daysBetween(localDateOf(o.recordedAt as string), o.outflowDate));
  const ahead = gaps.filter((g) => g > 0);
  if (ahead.length === 0 || ahead.length < gaps.length / 2) return null;
  return round2(ahead.reduce((a, b) => a + b, 0) / ahead.length);
}

export interface Reliability {
  orders: number;
  logged: number; // of those, how many have a row in the delivery log
  delivered: number;
  rejected: number;
  withReturn: number;
  reasons: { reason: string; count: number }[];
}

// One buyer's fakturs in the 8-week window. Delivered / rejected only exist for
// logged fakturs, so `logged` travels with them: 0 logged is "not recorded", not
// "nothing delivered". A return is either a warehouse return on the PO's egg
// outflows or a store-side line in the delivery log.
export function reliability(
  orders: OrderRow[],
  asOf: string,
  deliveries: Pick<Delivery, "id" | "invoiceRefNorm" | "status">[],
  lines: Pick<DeliveryLine, "deliveryId" | "reason">[],
  returnedOutflowIds: Set<string>
): Reliability {
  const byRef = new Map(deliveries.map((d) => [d.invoiceRefNorm, d]));
  const r: Reliability = { orders: 0, logged: 0, delivered: 0, rejected: 0, withReturn: 0, reasons: [] };
  const reasons = new Map<string, number>();
  for (const o of windowOrders(orders, asOf)) {
    r.orders++;
    const d = byRef.get((o.invoiceRef ?? "").trim().toUpperCase());
    const dLines = d ? lines.filter((l) => l.deliveryId === d.id) : [];
    if (d) {
      r.logged++;
      if (d.status === "terkirim") r.delivered++;
      if (d.status === "ditolak") r.rejected++;
    }
    for (const l of dLines) reasons.set(l.reason, (reasons.get(l.reason) ?? 0) + 1);
    if (dLines.length > 0 || (o.outflowIds ?? []).some((id) => returnedOutflowIds.has(id))) r.withReturn++;
  }
  r.reasons = [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  return r;
}

// "Retur naik": more fakturs with returns this period than the usual rate over
// the 8 weeks before it. Needs return data covering both, so never on thin data.
export function returnSpike(orders: OrderRow[], asOf: string, days: number, returnedOutflowIds: Set<string>, cov: Coverage) {
  if (!isComparable(cov, asOf, days)) return { cur: 0, usual: 0, spike: false };
  const curStart = addDays(asOf, -(days - 1));
  const usualStart = addDays(curStart, -56);
  const hit = (o: OrderRow) => (o.outflowIds ?? []).some((id) => returnedOutflowIds.has(id));
  const cur = orders.filter((o) => o.outflowDate >= curStart && hit(o)).length;
  const before = orders.filter((o) => o.outflowDate >= usualStart && o.outflowDate < curStart && hit(o)).length;
  const usual = round2(before / (56 / days));
  return { cur, usual, spike: cur >= 2 && cur > usual };
}

export interface BuyerSummary {
  id: string;
  kind: "po" | "cash" | "cashAll";
  name: string;
  orders: OrderRow[];
  compare: PeriodCompare;
  firstDate: string | null;
  lastDate: string | null;
  pattern: WeekdayStat[];
  late: number | null;
  down: boolean;
  isNew: boolean;
  returnsUp: boolean;
}

export function summarizeBuyer(
  id: string,
  kind: BuyerSummary["kind"],
  name: string,
  orders: OrderRow[],
  asOf: string,
  days: number,
  cov: Coverage,
  returns?: { outflowIds: Set<string>; cov: Coverage }
): BuyerSummary {
  const dates = orders.map((o) => o.outflowDate).sort();
  const firstDate = dates[0] ?? null;
  const lastDate = dates[dates.length - 1] ?? null;
  const compare = periodCompare(dates, asOf, days, cov);
  const isNew = compare.delta !== null && !!firstDate && firstDate >= addDays(asOf, -(days - 1));
  const pattern = weekdayPattern(orders, asOf);
  return {
    id,
    kind,
    name,
    orders,
    compare,
    firstDate,
    lastDate,
    pattern,
    late: kind === "cashAll" ? null : overdue(pattern, lastDate, asOf),
    down: compare.delta !== null && !isNew && compare.prev > 0 && compare.delta / compare.prev <= DOWN_RATIO,
    isNew,
    returnsUp: returns ? returnSpike(orders, asOf, days, returns.outflowIds, returns.cov).spike : false,
  };
}

export const needsAttention = (b: BuyerSummary) => b.late !== null || b.down || b.isNew || b.returnsUp;

// Share of order counts held by the three busiest buyers (never volume: rule 1).
export function concentration(rows: { name: string; count: number }[]) {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((n, r) => n + r.count, 0);
  const top = sorted.slice(0, 3).filter((r) => r.count > 0);
  if (total === 0) return null;
  return { pct: Math.round((top.reduce((n, r) => n + r.count, 0) / total) * 100), names: top.map((r) => r.name) };
}

const INITIALS_DROP = /^(bu|pak|mas|toko|warung|pt|ud|cv)\s+/i;

// Two letters for the identity tile: first letters of the first two words after
// dropping an honorific or company form; a single word gives its first two.
export function initials(name: string): string {
  const words = name.trim().replace(INITIALS_DROP, "").split(/\s+/).filter(Boolean);
  const raw = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 2);
  return raw.toUpperCase();
}

// ---- Kas Tunai ----

// Rule 5: same name typed with different casing or spacing. Nothing fuzzier.
export const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export interface KasSaleRow extends OrderRow {
  saleId: string;
  customerName?: string;
  tracked: boolean; // recorded by the Kas Tunai drawer (has a saleId)
}

// Same rows the Activities "Kas Tunai" tab shows, minus stock corrections typed
// into the old manual form. One row per sale; older rows without a saleId count
// as a sale each (kasTunai.ts). Egg products ride in orderLines so buyerProfile's
// skuShares / typicalDay and basketBreadth work on them unchanged.
export function kasSalesFromLogs(logs: ActivityLog[]): KasSaleRow[] {
  const sales = new Map<string, KasSaleRow>();
  for (const log of logs) {
    if (entryKind(log) !== "manual" || log.category !== "egg" || log.voided_at) continue;
    if ((log.invoice_supplier ?? "").trim().toUpperCase() === "CORRECTION") continue;
    const saleId = log.metadata?.saleId ?? log.id;
    let sale = sales.get(saleId);
    if (!sale) {
      sale = {
        saleId,
        customerName: log.metadata?.customerName,
        tracked: !!log.metadata?.saleId,
        outflowDate: log.metadata?.outflowDate ?? localDateOf(log.recorded_at),
        recordedAt: log.recorded_at,
        orderLines: [],
        eggTotals: [],
      };
      sales.set(saleId, sale);
    }
    sale.orderLines.push({ skuCode: log.product, packQty: log.quantity_butir });
    sale.eggTotals.push({ product: log.product, quantity: log.quantity_butir });
  }
  return [...sales.values()];
}

export interface KasCustomer {
  key: string;
  name: string; // most frequent spelling
  variants: string[];
  sales: KasSaleRow[];
  firstDate: string;
}

export function kasTunaiCustomers(sales: KasSaleRow[]): KasCustomer[] {
  const groups = new Map<string, KasSaleRow[]>();
  for (const s of sales) {
    if (!s.customerName?.trim()) continue;
    const k = normName(s.customerName);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups].map(([key, rows]) => {
    const spellings = new Map<string, number>();
    for (const r of rows) spellings.set(r.customerName as string, (spellings.get(r.customerName as string) ?? 0) + 1);
    const ranked = [...spellings].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    return {
      key,
      name: ranked[0].trim().replace(/\s+/g, " "),
      variants: ranked,
      sales: rows,
      firstDate: rows.map((r) => r.outflowDate).sort()[0],
    };
  });
}

// ---- Stock ----

const SUPPLIER_GRADE = /\s+(CREAM|TONASE|JUMBO|SUPER|OMEGA)$/;
const NOT_A_SUPPLIER = /^(STOCK\b|.$|$)/;

// Masuk's Faktur/Pemasok is free text: "SUMBER JAYA (CREAM)", "MAKMUR (CR",
// "STOCK FISIK AWAL". This keeps the supplier and drops the egg grade; opening
// balances, stock adjustments and stray letters aren't suppliers, so they give null.
// ponytail: pattern list for display only, a suppliers table replaces it if the owner reopens that.
export function supplierName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").toUpperCase().replace(/\(.*$/, "").trim().replace(SUPPLIER_GRADE, "").replace(/\s+/g, " ");
  return NOT_A_SUPPLIER.test(name) ? null : name;
}

export interface Batch {
  id: string;
  product: string;
  date: string; // Masuk date
  remaining: number; // native unit
  supplier?: string;
}

// One product's stock split by age. The risky band starts at its freshness
// window (catalog freshness_days, default 5), the same window the dashboard uses.
export function ageBands(batches: Batch[], today: string, freshnessDays: number) {
  const bands = { fresh: 0, mid: 0, risk: 0 };
  for (const b of batches) {
    const age = daysBetween(b.date, today);
    if (age >= freshnessDays) bands.risk += b.remaining;
    else if (age <= 2) bands.fresh += b.remaining;
    else bands.mid += b.remaining;
  }
  return { fresh: round2(bands.fresh), mid: round2(bands.mid), risk: round2(bands.risk) };
}

// Batches crossing their freshness window between today and Sunday, soonest first.
export function atRiskThisWeek(batches: Batch[], today: string, freshnessOf: (product: string) => number) {
  const sunday = addDays(today, (7 - weekdayOf(today)) % 7);
  return batches
    .filter((b) => b.remaining > 0)
    .map((b) => ({ ...b, crossDate: addDays(b.date, freshnessOf(b.product)) }))
    .filter((b) => b.crossDate >= today && b.crossDate <= sunday)
    .sort((a, b) => a.crossDate.localeCompare(b.crossDate) || a.product.localeCompare(b.product));
}

export const oldestBatches = (batches: Batch[], today: string, n = 4) =>
  batches
    .filter((b) => b.remaining > 0)
    .map((b) => ({ ...b, age: daysBetween(b.date, today) }))
    .sort((a, b) => b.age - a.age || a.product.localeCompare(b.product))
    .slice(0, n);

export interface FifoAge {
  product: string;
  outflowDate: string;
  inflowId: string;
  outflowId: string;
  qty: number;
  days: number;
}

// fifo_deductions joined to the (non-voided) rows they link, so a deduction on a
// voided outflow or batch drops out here.
export function fifoAges(
  deductions: { outflow_id: string; inflow_id: string; quantity_deducted: number }[],
  outflows: { id: string; date: string; product: string; category?: string }[],
  inflows: { id: string; date: string }[]
): FifoAge[] {
  const out = new Map(outflows.map((o) => [o.id, o]));
  const inf = new Map(inflows.map((i) => [i.id, i]));
  const rows: FifoAge[] = [];
  for (const d of deductions) {
    const o = out.get(d.outflow_id);
    const i = inf.get(d.inflow_id);
    if (!o || !i) continue;
    rows.push({
      product: o.product,
      outflowDate: o.date,
      inflowId: i.id,
      outflowId: o.id,
      qty: Number(d.quantity_deducted),
      days: daysBetween(i.date, o.date),
    });
  }
  return rows;
}

// Average days from Masuk to going out, per product, weighted by quantity, for
// outflows in the period. A negative gap means the outflow was back-dated before
// the batch it drew from, so its real age is unknown: left out, not clamped.
export function turnoverDays(ages: FifoAge[], product: string, asOf: string, days: number): number | null {
  const start = addDays(asOf, -(days - 1));
  let qty = 0;
  let weighted = 0;
  for (const a of ages) {
    if (a.product !== product || a.outflowDate < start || a.days < 0) continue;
    qty += a.qty;
    weighted += a.qty * a.days;
  }
  return qty > 0 ? Math.round((weighted / qty) * 10) / 10 : null;
}

export interface StockCountRow {
  product: string;
  countDate: string;
  quantity: number; // JS warehouse physical count
  systemQty: number | null;
}

// Latest n JS-warehouse counts (physical - system), oldest first; same rule as
// the Stok Fisik page. null when the product has no comparable count.
export function countVariance(rows: StockCountRow[], product: string, n: number, tolerance: number) {
  const mine = rows
    .filter((r) => r.product === product && r.systemQty != null)
    .sort((a, b) => a.countDate.localeCompare(b.countDate))
    .slice(-n)
    .map((r) => computeVariance(r.quantity, r.systemQty as number, tolerance));
  if (mine.length === 0) return null;
  const last = mine[mine.length - 1];
  return { series: mine.map((v) => v.delta), latest: last.delta, off: last.status === "off" };
}

export type CoverTone = "ok" | "amber" | "red";
export const materialTone = (coverDays: number): CoverTone =>
  coverDays < MATERIAL_RED_DAYS ? "red" : coverDays < MATERIAL_AMBER_DAYS ? "amber" : "ok";
