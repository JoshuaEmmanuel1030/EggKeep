// Pure helpers behind the tablet Kas Tunai drawer (walk-in cash sale, eggs
// only): sale lines -> stock entries, the "Hari ini" list of today's cash
// sales, and the picked-date label. No React / Supabase, so it stays tested.
import { isSameDay, parseISO } from "date-fns";
import type { ConversionMap, ItemType, OutflowEntry } from "@/types/inventory";
import type { ActivityLog, ActivityLogMetadata } from "@/types/activityLog";
import type { RadialItem } from "@/components/RadialAddButton";
import { parseQtyInput } from "@/lib/stockCount";
import { entryKind } from "@/lib/activityGrouping";
import { getStockUnit, toStockUnits } from "@/lib/inventory";
import { customerMetadata, type CashCustomer, type CustomerPick } from "@/lib/cashCustomers";

export interface KasLine {
  id: string;
  product: string;
  qty: string; // as typed; see parseQtyInput
  inputUnit: "butir" | "kg";
}

export interface KasSale {
  saleId: string;
  recordedAt: string; // ISO
  customerName?: string;
  lines: { product: string; quantity: number }[]; // native unit (kg / butir)
}

// The unit the line is typed in: kg only on a weight-sold egg with the switch on.
const kasInputUnit = (line: KasLine, conversionMap: ConversionMap): "kg" | "butir" =>
  conversionMap[line.product]?.unit === "kg" && line.inputUnit === "kg" ? "kg" : "butir";

// The radial egg ring (Kas Tunai and the phone's manual form): the egg products
// minus the (RETAKAN) children, which would crowd it (they stay in the
// dropdown). "NEGERI BIASA" -> NEGERI over BIASA.
export function eggRingItems(eggProductNames: string[], itemTypes: Pick<ItemType, "name" | "isRetakan">[]): RadialItem[] {
  const retakan = new Set(itemTypes.filter((it) => it.isRetakan).map((it) => it.name));
  return eggProductNames
    .filter((name) => !retakan.has(name))
    .map((name) => {
      const [label, ...rest] = name.split(" ");
      return { key: name, label, sub: rest.join(" ") || undefined };
    });
}

// Quantity in the product's NATIVE stock unit, the same rule as OutflowForm:
// kg typed on a kg product passes through, butir typed on a kg product becomes
// estimated kg (2 dp), a butir product takes the count as typed.
export function kasStockQty(line: KasLine, conversionMap: ConversionMap): number {
  const unit = kasInputUnit(line, conversionMap);
  return toStockUnits(line.product, parseQtyInput(line.qty, unit) ?? 0, unit, conversionMap);
}

export const isValidKasLine = (line: KasLine, conversionMap: ConversionMap) =>
  !!line.product && kasStockQty(line, conversionMap) > 0;

// Something typed that won't be recorded (bad number, no product, 0). Blocks
// the sale, so a line is never dropped silently next to valid ones.
export const isBrokenKasLine = (line: KasLine, conversionMap: ConversionMap) =>
  line.qty.trim() !== "" && !isValidKasLine(line, conversionMap);

// One egg outflow per valid line, dated with the sale's business date.
export function buildKasEntries(
  lines: KasLine[],
  date: string,
  conversionMap: ConversionMap,
  createdAt: string,
  newId: () => string = () => crypto.randomUUID()
): OutflowEntry[] {
  return lines
    .filter((l) => isValidKasLine(l, conversionMap))
    .map((l) => ({
      id: newId(),
      date,
      product: l.product,
      quantityInButir: kasStockQty(l, conversionMap),
      createdAt,
      category: "egg",
    }));
}

const byNewest = (a: KasSale, b: KasSale) =>
  new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime();

// Today's (local day) live Kas Tunai egg sales, newest first. Rows of one sale
// share metadata.saleId; older rows without one count as a sale each.
export function todaysKasSales(logs: ActivityLog[], now: Date = new Date()): KasSale[] {
  const sales = new Map<string, KasSale>();
  for (const log of logs) {
    if (entryKind(log) !== "manual" || log.category !== "egg" || log.voided_at) continue;
    if (!isSameDay(parseISO(log.recorded_at), now)) continue;
    const saleId = log.metadata?.saleId ?? log.id;
    let sale = sales.get(saleId);
    if (!sale) {
      sale = { saleId, recordedAt: log.recorded_at, customerName: log.metadata?.customerName, lines: [] };
      sales.set(saleId, sale);
    }
    sale.lines.push({ product: log.product, quantity: log.quantity_butir });
  }
  return [...sales.values()].sort(byNewest);
}

// Sales recorded on this device show at once, before their log rows arrive
// (realtime lag, or queued offline). A sale's log rows replace it once all of
// them are in.
export function mergeKasSales(fromLogs: KasSale[], justRecorded: KasSale[], now: Date = new Date()): KasSale[] {
  const byId = new Map(fromLogs.map((s) => [s.saleId, s]));
  for (const s of justRecorded) {
    if (!isSameDay(parseISO(s.recordedAt), now)) continue;
    const logged = byId.get(s.saleId);
    if (!logged || logged.lines.length < s.lines.length) byId.set(s.saleId, s);
  }
  return [...byId.values()].sort(byNewest);
}

// "2 kg NEGERI BIASA · 30 butir PUYUH" (native units, locale number format).
export function kasSaleSummary(sale: KasSale, conversionMap: ConversionMap, locale: string): string {
  return sale.lines
    .map((l) => `${l.quantity.toLocaleString(locale)} ${getStockUnit(l.product, "egg", conversionMap)} ${l.product}`)
    .join(" · ");
}

// A picked yyyy-MM-dd as "Sen, 2 Nov" (id-ID) / "Mon, Nov 2" (en-US).
export const kasDateLabel = (date: string, locale: string) =>
  parseISO(date).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });

// ── Queue (several cash sales built up, then recorded together) ──────────────
// Mirrors the PO builder's "Tambah ke Antrian": a sale is snapshotted, the form
// clears for the next customer, and "Catat Semua" records each sale as its own
// atomic record_order_outflows call. In memory only, like the PO queue: the
// drawer stays mounted, so the queue survives closing it but not a reload.
export interface KasQueuedSale {
  id: string; // becomes the sale's metadata.saleId
  date: string | null; // null = today, resolved when it is recorded
  customer: CustomerPick; // null = Umum (anonymous walk-in)
  note: string;
  lines: KasLine[]; // valid lines only
  failed?: boolean; // the server rejected it on the last "Catat Semua"
}

// Snapshot of the form, or null when there is nothing to record or a line
// would be dropped (broken lines block the queue just as they block a sale).
export function snapshotKasSale(
  form: { date: string | null; customer: CustomerPick; note: string; lines: KasLine[] },
  conversionMap: ConversionMap,
  id: string = crypto.randomUUID()
): KasQueuedSale | null {
  if (form.lines.some((l) => isBrokenKasLine(l, conversionMap))) return null;
  const lines = form.lines.filter((l) => isValidKasLine(l, conversionMap));
  if (lines.length === 0) return null;
  return { id, date: form.date, customer: form.customer, note: form.note.trim(), lines };
}

// Nothing typed: loading a queued sale into the form can't lose anything.
export const isBlankKasForm = (form: { customer: CustomerPick; note: string; lines: KasLine[] }) =>
  !form.customer && !form.note.trim() && form.lines.every((l) => !l.product && !l.qty.trim());

// The RPC payload of one sale: one egg entry per line + the Kas metadata. The
// customer resolves at record time (customerMetadata), so a name added while
// offline picks up its id if the row has arrived since it was queued.
export function buildKasSale(
  sale: KasQueuedSale,
  conversionMap: ConversionMap,
  recordedAt: string,
  today: string,
  customers: Pick<CashCustomer, "id" | "name">[] = [],
  newId?: () => string
): { entries: OutflowEntry[]; metadata: ActivityLogMetadata } {
  const outflowDate = sale.date ?? today;
  return {
    entries: buildKasEntries(sale.lines, outflowDate, conversionMap, recordedAt, newId),
    metadata: {
      orderType: "manual",
      outflowDate,
      saleId: sale.id,
      ...customerMetadata(sale.customer, customers),
      ...(sale.note ? { note: sale.note } : {}),
    },
  };
}

// Native quantity per egg across the queue (2 dp, so 0,1 + 0,2 kg reads 0,3).
// Per product only: kg and butir are never summed together.
export function kasQueuedTotals(queue: KasQueuedSale[], conversionMap: ConversionMap): Map<string, number> {
  const totals = new Map<string, number>();
  for (const sale of queue) {
    for (const l of sale.lines) {
      const sum = (totals.get(l.product) ?? 0) + kasStockQty(l, conversionMap);
      totals.set(l.product, Math.round(sum * 100) / 100);
    }
  }
  return totals;
}

// "2 kg NEGERI BIASA · 30 butir KAMPUNG" from per-egg totals (native units).
export function kasTotalsSummary(totals: Map<string, number>, conversionMap: ConversionMap, locale: string): string {
  return [...totals]
    .map(([product, qty]) => `${qty.toLocaleString(locale)} ${getStockUnit(product, "egg", conversionMap)} ${product}`)
    .join(" · ");
}

// Record queued sales one by one, each its own atomic call. A rejected sale
// never stops the ones after it; it comes back marked failed so it stays in
// the queue, and the recorded ones are gone so a re-press can't record them
// twice. `submit` is false only when the server rejected (already toasted).
export async function submitKasQueue(
  queue: KasQueuedSale[],
  submit: (sale: KasQueuedSale) => Promise<boolean>
): Promise<{ recorded: KasQueuedSale[]; failed: KasQueuedSale[] }> {
  const recorded: KasQueuedSale[] = [];
  const failed: KasQueuedSale[] = [];
  for (const sale of queue) {
    let ok = false;
    try {
      ok = await submit(sale);
    } catch (error) {
      console.error("Kas Tunai sale failed:", error);
    }
    if (ok) recorded.push({ ...sale, failed: undefined });
    else failed.push({ ...sale, failed: true });
  }
  return { recorded, failed };
}
