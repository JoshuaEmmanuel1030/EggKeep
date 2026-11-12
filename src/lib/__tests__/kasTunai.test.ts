import { describe, it, expect } from "vitest";
import {
  buildKasEntries,
  eggRingItems,
  isBrokenKasLine,
  isValidKasLine,
  kasDateLabel,
  kasSaleSummary,
  kasStockQty,
  mergeKasSales,
  todaysKasSales,
  type KasLine,
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
