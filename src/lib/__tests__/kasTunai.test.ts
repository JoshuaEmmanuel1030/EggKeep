import { describe, it, expect } from "vitest";
import {
  buildKasEntries,
  buildKasSale,
  eggRingItems,
  isBlankKasForm,
  isBrokenKasLine,
  isValidKasLine,
  kasDateLabel,
  kasSaleSummary,
  kasQueuedTotals,
  kasStockQty,
  kasTotalsSummary,
  mergeKasSales,
  snapshotKasSale,
  submitKasQueue,
  todaysKasSales,
  type KasLine,
  type KasQueuedSale,
  type KasSale,
} from "../kasTunai";
import type { ActivityLog } from "@/types/activityLog";
import type { ConversionMap } from "@/types/inventory";

const cm: ConversionMap = {
  "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
  PUYUH: { unit: "btr", eggs_per_unit: 1 },
};

const line = (over: Partial<KasLine>): KasLine => ({ id: "l", product: "PUYUH", qty: "", inputUnit: "butir", ...over });

// Local-time "now" so day boundaries don't depend on the test machine's TZ.
const now = new Date(2026, 10, 3, 14, 30);
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString();

function log(over: Partial<ActivityLog>): ActivityLog {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: "u1",
    action_type: "outflow",
    product: "PUYUH",
    quantity_butir: 30,
    recorded_at: at(3, 9),
    created_at: at(3, 9),
    client_id: "c1",
    category: "egg",
    ...over,
  };
}

describe("eggRingItems", () => {
  it("drops the retakan children and splits the name into label over sub", () => {
    const names = ["KAMPUNG", "KAMPUNG (RETAKAN)", "NEGERI BIASA", "ASIN MATENG KECIL"];
    const types = [{ name: "KAMPUNG" }, { name: "KAMPUNG (RETAKAN)", isRetakan: true }, { name: "NEGERI BIASA", isRetakan: false }];
    expect(eggRingItems(names, types)).toEqual([
      { key: "KAMPUNG", label: "KAMPUNG", sub: undefined },
      { key: "NEGERI BIASA", label: "NEGERI", sub: "BIASA" },
      { key: "ASIN MATENG KECIL", label: "ASIN", sub: "MATENG KECIL" },
    ]);
  });
});

describe("kasStockQty", () => {
  it("kg typed on a kg product passes through, decimal comma included", () => {
    expect(kasStockQty(line({ product: "NEGERI BIASA", qty: "2,5", inputUnit: "kg" }), cm)).toBe(2.5);
  });
  it("butir typed on a kg product becomes estimated kg (2 dp)", () => {
    expect(kasStockQty(line({ product: "NEGERI BIASA", qty: "31", inputUnit: "butir" }), cm)).toBe(2);
    expect(kasStockQty(line({ product: "NEGERI BIASA", qty: "10" }), cm)).toBe(0.65);
  });
  it("a butir product takes the count as typed", () => {
    expect(kasStockQty(line({ qty: "30" }), cm)).toBe(30);
  });
  it("blank / invalid is 0 and not a valid line", () => {
    expect(kasStockQty(line({ qty: "abc" }), cm)).toBe(0);
    expect(isValidKasLine(line({ qty: "" }), cm)).toBe(false);
    expect(isValidKasLine(line({ product: "", qty: "5" }), cm)).toBe(false);
    expect(isValidKasLine(line({ qty: "5" }), cm)).toBe(true);
  });
  it("reads an Indonesian thousands dot in a count", () => {
    expect(kasStockQty(line({ qty: "1.000" }), cm)).toBe(1000);
    expect(kasStockQty(line({ qty: "12.500" }), cm)).toBe(12500);
    expect(kasStockQty(line({ product: "NEGERI BIASA", qty: "1.000" }), cm)).toBe(64.52);
  });
  it("a fractional count is invalid; kg takes one decimal separator", () => {
    expect(isValidKasLine(line({ qty: "2,5" }), cm)).toBe(false);
    expect(isValidKasLine(line({ qty: "1.20" }), cm)).toBe(false);
    expect(kasStockQty(line({ product: "NEGERI BIASA", qty: "9,5", inputUnit: "kg" }), cm)).toBe(9.5);
    expect(kasStockQty(line({ product: "NEGERI BIASA", qty: "9.5", inputUnit: "kg" }), cm)).toBe(9.5);
    expect(isValidKasLine(line({ product: "NEGERI BIASA", qty: "1,500.5", inputUnit: "kg" }), cm)).toBe(false);
    // The Kg switch means nothing on a butir product.
    expect(isValidKasLine(line({ qty: "2,5", inputUnit: "kg" }), cm)).toBe(false);
  });
  it("a typed line that won't be recorded is broken (blocks the sale); blank is not", () => {
    expect(isBrokenKasLine(line({ qty: "2,5" }), cm)).toBe(true);
    expect(isBrokenKasLine(line({ product: "", qty: "5" }), cm)).toBe(true);
    expect(isBrokenKasLine(line({ qty: "0" }), cm)).toBe(true);
    expect(isBrokenKasLine(line({ qty: " " }), cm)).toBe(false);
    expect(isBrokenKasLine(line({ qty: "5" }), cm)).toBe(false);
  });
  it("kg reads the thousands dot as the screens print it, the same as on Masuk", () => {
    const kg = (qty: string) => kasStockQty(line({ product: "NEGERI BIASA", qty, inputUnit: "kg" }), cm);
    expect(kg("1.500")).toBe(1500);
    expect(kg("12.345,67")).toBe(12345.67);
    expect(kg("1.200,5")).toBe(1200.5);
    expect(isBrokenKasLine(line({ product: "NEGERI BIASA", qty: "12.34.567", inputUnit: "kg" }), cm)).toBe(true);
    // A dot in butir is still thousands: 1550 butir is 100 kg.
    expect(kasStockQty(line({ product: "NEGERI BIASA", qty: "1.550", inputUnit: "butir" }), cm)).toBe(100);
  });
});

describe("buildKasEntries", () => {
  it("one egg entry per valid line, native unit, sale date", () => {
    let n = 0;
    const entries = buildKasEntries(
      [
        line({ product: "NEGERI BIASA", qty: "2", inputUnit: "kg" }),
        line({ qty: "" }),
        line({ qty: "30" }),
      ],
      "2026-11-02",
      cm,
      "2026-11-03T07:00:00.000Z",
      () => `id${++n}`
    );
    expect(entries).toEqual([
      { id: "id1", date: "2026-11-02", product: "NEGERI BIASA", quantityInButir: 2, createdAt: "2026-11-03T07:00:00.000Z", category: "egg" },
      { id: "id2", date: "2026-11-02", product: "PUYUH", quantityInButir: 30, createdAt: "2026-11-03T07:00:00.000Z", category: "egg" },
    ]);
  });
});

describe("todaysKasSales", () => {
  it("groups by saleId, newest first, keeps only today's live Kas egg rows", () => {
    const logs = [
      log({ product: "NEGERI BIASA", quantity_butir: 2, recorded_at: at(3, 10), metadata: { orderType: "manual", saleId: "s2", customerName: "Bu Rina" } }),
      log({ recorded_at: at(3, 10), metadata: { orderType: "manual", saleId: "s2", customerName: "Bu Rina" } }),
      log({ recorded_at: at(3, 8), metadata: { orderType: "manual", saleId: "s1" } }),
      log({ recorded_at: at(2, 23), metadata: { orderType: "manual", saleId: "s0" } }), // yesterday
      log({ recorded_at: at(3, 11), voided_at: at(3, 12), metadata: { orderType: "manual", saleId: "s3" } }),
      log({ recorded_at: at(3, 11), category: "box", metadata: { orderType: "manual", saleId: "s4" } }),
      log({ recorded_at: at(3, 11), metadata: { orderType: "quick_outflow", buyerName: "OSAVE BKS" } }),
      log({ recorded_at: at(3, 11), action_type: "inflow" }),
    ];
    const sales = todaysKasSales(logs, now);
    expect(sales.map((s) => s.saleId)).toEqual(["s2", "s1"]);
    expect(sales[0].customerName).toBe("Bu Rina");
    expect(sales[0].lines).toEqual([
      { product: "NEGERI BIASA", quantity: 2 },
      { product: "PUYUH", quantity: 30 },
    ]);
  });

  it("legacy rows (no saleId, no metadata) are one sale each", () => {
    const logs = [log({ id: "a" }), log({ id: "b", metadata: { relatedEntryId: "x" } })];
    expect(todaysKasSales(logs, now).map((s) => s.saleId).sort()).toEqual(["a", "b"]);
  });
});

describe("mergeKasSales", () => {
  const sale = (saleId: string, h: number, n = 1): KasSale => ({
    saleId,
    recordedAt: at(3, h),
    lines: Array.from({ length: n }, () => ({ product: "PUYUH", quantity: 30 })),
  });

  it("shows a just-recorded sale until all its log rows are in", () => {
    const local = [sale("s2", 10, 2)];
    expect(mergeKasSales([sale("s1", 8)], local, now).map((s) => s.saleId)).toEqual(["s2", "s1"]);
    expect(mergeKasSales([sale("s2", 10, 1)], local, now)[0].lines).toHaveLength(2);
    const logged = sale("s2", 10, 2);
    expect(mergeKasSales([logged], local, now)[0]).toBe(logged);
  });

  it("drops just-recorded sales from another day", () => {
    expect(mergeKasSales([], [{ ...sale("old", 9), recordedAt: at(2, 9) }], now)).toEqual([]);
  });
});

describe("labels", () => {
  it("summarises lines in native units with the locale number format", () => {
    const s: KasSale = {
      saleId: "s",
      recordedAt: at(3, 9),
      lines: [
        { product: "NEGERI BIASA", quantity: 2.5 },
        { product: "PUYUH", quantity: 1200 },
      ],
    };
    expect(kasSaleSummary(s, cm, "id-ID")).toBe("2,5 kg NEGERI BIASA · 1.200 butir PUYUH");
    expect(kasSaleSummary(s, cm, "en-US")).toBe("2.5 kg NEGERI BIASA · 1,200 butir PUYUH");
  });

  it("formats a picked date as short weekday + day + month", () => {
    expect(kasDateLabel("2026-11-02", "id-ID")).toBe("Sen, 2 Nov");
    expect(kasDateLabel("2026-11-02", "en-US")).toBe("Mon, Nov 2");
  });
});

describe("queue", () => {
  const kg = (qty: string, id = "k"): KasLine => line({ id, product: "NEGERI BIASA", qty, inputUnit: "kg" });
  const form = (lines: KasLine[], over: Partial<{ date: string | null; customerName: string; note: string }> = {}) => ({
    date: null,
    customerName: "",
    note: "",
    lines,
    ...over,
  });
  const queued = (id: string, lines: KasLine[], over: Partial<KasQueuedSale> = {}): KasQueuedSale => ({
    id,
    date: null,
    customerName: "",
    note: "",
    lines,
    ...over,
  });

  it("snapshots only the valid lines, trimmed, and keeps the picked date", () => {
    const sale = snapshotKasSale(
      form([kg("2"), line({ id: "blank" }), line({ id: "p", qty: "30" })], { date: "2026-11-02", customerName: " Bu Rina ", note: " lunas " }),
      cm,
      "s1"
    );
    expect(sale).toEqual({
      id: "s1",
      date: "2026-11-02",
      customerName: "Bu Rina",
      note: "lunas",
      lines: [kg("2"), line({ id: "p", qty: "30" })],
    });
  });

  it("won't snapshot an empty form or one with a line that would be dropped", () => {
    expect(snapshotKasSale(form([line({})]), cm)).toBeNull();
    expect(snapshotKasSale(form([kg("2"), line({ id: "bad", qty: "2,5" })]), cm)).toBeNull(); // 2,5 butir
    expect(snapshotKasSale(form([kg("2"), line({ id: "x", product: "", qty: "3" })]), cm)).toBeNull(); // qty, no egg
  });

  it("a form is blank only when nothing at all is typed", () => {
    expect(isBlankKasForm(form([line({ product: "" })]))).toBe(true);
    expect(isBlankKasForm(form([line({ product: "" })], { customerName: " " }))).toBe(true);
    expect(isBlankKasForm(form([line({})]))).toBe(false); // an egg picked
    expect(isBlankKasForm(form([line({ product: "", qty: "3" })]))).toBe(false);
    expect(isBlankKasForm(form([line({ product: "" })], { note: "x" }))).toBe(false);
  });

  it("builds one sale's payload: queued id as saleId, null date as today, no empty name or note", () => {
    let n = 0;
    const { entries, metadata } = buildKasSale(queued("s1", [kg("2"), line({ id: "p", qty: "30" })]), cm, "T", "2026-11-03", () => `e${++n}`);
    expect(entries).toEqual([
      { id: "e1", date: "2026-11-03", product: "NEGERI BIASA", quantityInButir: 2, createdAt: "T", category: "egg" },
      { id: "e2", date: "2026-11-03", product: "PUYUH", quantityInButir: 30, createdAt: "T", category: "egg" },
    ]);
    expect(metadata).toEqual({ orderType: "manual", outflowDate: "2026-11-03", saleId: "s1" });

    const dated = buildKasSale(queued("s2", [kg("1")], { date: "2026-11-01", customerName: "Pak Budi", note: "titip" }), cm, "T", "2026-11-03");
    expect(dated.entries[0].date).toBe("2026-11-01");
    expect(dated.metadata).toEqual({ orderType: "manual", outflowDate: "2026-11-01", saleId: "s2", customerName: "Pak Budi", note: "titip" });
  });

  it("totals the queue per egg in native units, never kg and butir together", () => {
    const q = [
      queued("a", [kg("0,1"), line({ id: "p", qty: "30" })]),
      queued("b", [kg("0,2"), line({ id: "b", product: "NEGERI BIASA", qty: "31", inputUnit: "butir" })]), // 31 butir ≈ 2 kg
    ];
    const totals = kasQueuedTotals(q, cm);
    expect([...totals]).toEqual([
      ["NEGERI BIASA", 2.3],
      ["PUYUH", 30],
    ]);
    expect(kasTotalsSummary(totals, cm, "id-ID")).toBe("2,3 kg NEGERI BIASA · 30 butir PUYUH");
    expect(kasQueuedTotals([], cm).size).toBe(0);
  });

  it("records every sale in order; a rejection or a throw doesn't stop the rest and stays queued, marked", async () => {
    const seen: string[] = [];
    const result = await submitKasQueue(
      [queued("a", [kg("1")]), queued("b", [kg("1")], { failed: true }), queued("c", [kg("1")]), queued("d", [kg("1")])],
      async (sale) => {
        seen.push(sale.id);
        if (sale.id === "c") throw new Error("boom");
        return sale.id !== "a";
      }
    );
    expect(seen).toEqual(["a", "b", "c", "d"]);
    expect(result.recorded.map((s) => [s.id, s.failed])).toEqual([
      ["b", undefined],
      ["d", undefined],
    ]);
    expect(result.failed.map((s) => [s.id, s.failed])).toEqual([
      ["a", true],
      ["c", true],
    ]);
  });
});
