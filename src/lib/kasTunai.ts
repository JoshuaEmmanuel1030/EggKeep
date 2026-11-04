// Pure helpers behind the tablet Kas Tunai drawer (walk-in cash sale, eggs
// only): sale lines -> stock entries, the "Hari ini" list of today's cash
// sales, and the picked-date label. No React / Supabase, so it stays tested.
import { isSameDay, parseISO } from "date-fns";
import type { ConversionMap, ItemType, OutflowEntry } from "@/types/inventory";
import type { ActivityLog } from "@/types/activityLog";
import type { RadialItem } from "@/components/RadialAddButton";
import { parseCountInput } from "@/lib/stockCount";
import { entryKind } from "@/lib/activityGrouping";
import { getStockUnit, toStockUnits } from "@/lib/inventory";

export interface KasLine {
  id: string;
  product: string;
  qty: string; // as typed; see parseKasQty
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

// The screen prints counts in id-ID ("1.200 butir"), so a typed "1.000" is a
// thousand, not 1. A count is a whole number: "2,5" butir is invalid (null).
// kg takes one decimal separator, comma or dot ("9,5"); "1.200,5" is invalid.
export function parseKasQty(raw: string, unit: "kg" | "butir"): number | null {
  const s = (raw ?? "").trim();
  if (unit === "butir") {
    return /^\d+$/.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, "")) : null;
  }
  return /^\d+([.,]\d+)?$/.test(s) ? parseCountInput(s) : null;
}

// Quantity in the product's NATIVE stock unit, the same rule as OutflowForm:
// kg typed on a kg product passes through, butir typed on a kg product becomes
// estimated kg (2 dp), a butir product takes the count as typed.
export function kasStockQty(line: KasLine, conversionMap: ConversionMap): number {
  const unit = kasInputUnit(line, conversionMap);
  return toStockUnits(line.product, parseKasQty(line.qty, unit) ?? 0, unit, conversionMap);
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
