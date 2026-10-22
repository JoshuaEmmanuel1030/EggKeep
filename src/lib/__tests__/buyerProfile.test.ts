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

describe("future-dated orders move the anchor", () => {
  // Fri 23 Oct is after TODAY (Thu 22 Oct), so it is the anchor: the window is 29 Aug … 23 Oct.
  const future = [order("2026-10-21", [["N30B", 1]]), order("2026-10-23", [["KP6O", 2]])];
  it("shifts the window, typical day and weekday availability to the anchor", () => {
    expect(skuShares(future, TODAY).map((s) => s.code)).toEqual(["KP6O", "N30B"]); // both in window, 23 Oct included
    expect(typicalDay(future, TODAY, 5)).toEqual({ orderDays: 1, skus: [{ key: "KP6O", median: 2, days: 1 }], eggs: [] });
    const s = weekdayPattern(future, TODAY);
    expect(s[4]).toMatchObject({ available: 1, withOrder: 0, usual: false }); // Thu 22 Oct counts with no order
    expect(s[5]).toMatchObject({ available: 1, withOrder: 1, usual: true });  // Fri 23 Oct
  });
});

describe("56-day window boundary", () => {
  it("includes an order exactly 55 days back and excludes one 56 days back", () => {
    // TODAY 22 Oct: 28 Aug is 55 days back (in), 27 Aug is 56 days back (out).
    const s = skuShares([order("2026-08-27", [["OLD", 5]]), order("2026-08-28", [["BK4T", 3]])], TODAY);
    expect(s.map((x) => x.code)).toEqual(["BK4T"]);
  });
});

describe("weekdayPattern clips history to the window", () => {
  it("counts availability from the window start, not from an earlier first order", () => {
    // First order 1 Aug is before the window start (28 Aug). 28 Aug … 21 Oct is 55 dates;
    // the anchor 22 Oct has no order, so it is skipped. Unclipped (1 Aug … 21 Oct) would be 82.
    const h = [order("2026-08-01", [["N30B", 1]]), order("2026-10-21", [["N30B", 1]])];
    expect(weekdayPattern(h, TODAY).reduce((n, s) => n + s.available, 0)).toBe(55);
  });
});

describe("monthlyTotals caps at six months", () => {
  it("keeps the newest six months and drops the oldest", () => {
    const h = ["04", "05", "06", "07", "08", "09", "10"].map((mm) => order(`2026-${mm}-15`, [["N30B", 1]]));
    const m = monthlyTotals(h);
    expect(m.months).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(m.skus[0].total).toBe(6);
    expect(m.skus[0].byMonth["2026-04"]).toBeUndefined();
  });
});

describe("nextLikelyWeekday counts today", () => {
  it("returns today's weekday when it is usual, even if a later weekday is also usual", () => {
    // Thu 15 and Thu 22 Oct have orders (Thu usual); Mon 19 Oct is also usual, so a search starting tomorrow would return Mon.
    const h = [order("2026-10-15", [["N30B", 1]]), order("2026-10-19", [["KP6O", 1]]), order("2026-10-22", [["N30B", 1]])];
    expect(nextLikelyWeekday(weekdayPattern(h, TODAY), TODAY)).toBe(4);
  });
});
