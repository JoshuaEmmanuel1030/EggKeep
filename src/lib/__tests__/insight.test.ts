import { describe, expect, it } from "vitest";
import { addDays, weekdayPattern } from "@/lib/buyerProfile";
import {
  OrderRow,
  ageBands,
  atRiskThisWeek,
  basketBreadth,
  concentration,
  countVariance,
  dataAsOf,
  dataCoverage,
  fifoAges,
  initials,
  isComparable,
  kasSalesFromLogs,
  kasTunaiCustomers,
  leadTime,
  materialTone,
  normName,
  oldestBatches,
  overdue,
  periodCompare,
  periodSum,
  reliability,
  returnSpike,
  summarizeBuyer,
  supplierName,
  turnoverDays,
  weekEnd,
  weeklyCounts,
  weeklySums,
} from "@/lib/insight";
import type { ActivityLog } from "@/types/activityLog";

const AS_OF = "2026-11-03"; // Tuesday
const covered = { start: "2026-01-01", staleSince: null };
const order = (outflowDate: string, skus: string[] = ["A"], extra: Partial<OrderRow> = {}): OrderRow => ({
  outflowDate,
  orderLines: skus.map((skuCode) => ({ skuCode, packQty: 1 })),
  eggTotals: [],
  ...extra,
});

describe("coverage", () => {
  it("takes the latest business date up to today, ignoring future-dated rows", () => {
    expect(dataAsOf(["2026-11-01", "2026-11-03", "2026-11-09"], "2026-11-05")).toBe("2026-11-03");
    expect(dataAsOf([], "2026-11-05")).toBe("2026-11-05");
  });

  it("marks a dataset stale only when its last date is older than the limit", () => {
    expect(dataCoverage(["2026-10-14", "2026-09-30"], AS_OF, 7)).toEqual({ start: "2026-09-30", staleSince: "2026-10-14" });
    expect(dataCoverage(["2026-10-30"], AS_OF, 7).staleSince).toBeNull();
    expect(dataCoverage(["2026-10-14"], AS_OF).staleSince).toBeNull();
    expect(dataCoverage([], AS_OF)).toEqual({ start: null, staleSince: null });
  });

  it("is comparable only when the previous period is fully inside the data", () => {
    const live = { start: "2026-09-30", staleSince: null };
    expect(isComparable(live, AS_OF, 7)).toBe(true);
    expect(isComparable(live, AS_OF, 28)).toBe(false); // prev would start 2026-09-09
    expect(isComparable(live, "2026-11-24", 28)).toBe(true); // prev starts on the first data day
    expect(isComparable(live, "2026-11-23", 28)).toBe(false);
    expect(isComparable({ start: null, staleSince: null }, AS_OF, 7)).toBe(false);
    expect(isComparable({ start: "2026-01-01", staleSince: "2026-10-14" }, AS_OF, 7)).toBe(false);
  });
});

describe("periodCompare", () => {
  it("splits at the exact period boundaries", () => {
    const dates = ["2026-11-03", "2026-10-28", "2026-10-27", "2026-10-21", "2026-10-20"];
    expect(periodCompare(dates, AS_OF, 7, covered)).toEqual({ cur: 2, prev: 2, delta: 0 });
  });

  it("counts a PO dated ahead as the current period", () => {
    expect(periodCompare(["2026-11-06"], AS_OF, 7, covered).cur).toBe(1);
  });

  it("gives no delta on thin history instead of false growth", () => {
    const r = periodCompare(["2026-10-01", "2026-11-01"], AS_OF, 28, { start: "2026-09-30", staleSince: null });
    expect(r.delta).toBeNull();
    expect(r.cur).toBe(1);
  });

  it("gives no current figure when the dataset stopped before the period began", () => {
    const cov = { start: "2026-09-30", staleSince: "2026-10-14" };
    const rows = [{ date: "2026-10-10", qty: 5 }];
    expect(periodSum(rows, AS_OF, 7, cov)).toEqual({ cur: null, prev: 0, delta: null });
    expect(periodSum(rows, AS_OF, 28, cov).cur).toBe(5); // partly covered: real figure, no delta
    expect(periodSum(rows, AS_OF, 28, cov).delta).toBeNull();
  });

  it("does not drift on decimal kg", () => {
    const rows = [{ date: AS_OF, qty: 0.1 }, { date: AS_OF, qty: 0.2 }];
    expect(periodSum(rows, AS_OF, 7, covered).cur).toBe(0.3);
  });
});

describe("weeklySums", () => {
  it("buckets end at asOf and line up with the period", () => {
    const dates = [AS_OF, "2026-10-28", "2026-10-27"];
    expect(weeklyCounts(dates, AS_OF, 2, covered)).toEqual([1, 2]);
    expect(weekEnd(AS_OF, 1, 2)).toBe(AS_OF);
    expect(weekEnd(AS_OF, 0, 2)).toBe("2026-10-27");
  });

  it("leaves weeks before the data start null, never zero", () => {
    const r = weeklyCounts(["2026-10-01"], AS_OF, 8, { start: "2026-09-30", staleSince: null });
    expect(r.slice(0, 3)).toEqual([null, null, null]); // 09-09, 09-16, 09-23 starts
    expect(r[3]).toBe(1); // starts 09-30
  });

  it("leaves weeks after a stopped dataset null", () => {
    const r = weeklySums([{ date: "2026-10-10", qty: 3 }], AS_OF, 4, { start: "2026-09-30", staleSince: "2026-10-14" });
    expect(r).toEqual([3, 0, null, null]); // starts 10-07, 10-14, 10-21, 10-28
  });
});

describe("overdue", () => {
  // Mondays and Wednesdays for 3 weeks up to Wed 28 Oct.
  const mondayWed = ["2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26", "2026-10-28"].map((d) => order(d));
  const rhythm = (asOf: string) => weekdayPattern(mondayWed, asOf);

  it("counts days since the latest usual weekday that passed with no order", () => {
    expect(overdue(rhythm(AS_OF), "2026-10-28", AS_OF)).toBe(1); // Mon 2 Nov passed
    expect(overdue(rhythm("2026-11-06"), "2026-10-28", "2026-11-06")).toBe(2); // Wed 4 Nov
  });

  it("is not overdue when the order came, or on the usual day itself", () => {
    expect(overdue(rhythm(AS_OF), "2026-11-02", AS_OF)).toBeNull();
    expect(overdue(rhythm("2026-11-02"), "2026-10-28", "2026-11-02")).toBeNull(); // today is Monday; Wed 28 has an order
  });

  it("ignores buyers with too few order days and buyers with no rhythm", () => {
    const thin = [order("2026-10-26")];
    expect(overdue(weekdayPattern(thin, AS_OF), "2026-10-26", AS_OF)).toBeNull();
    expect(overdue(weekdayPattern([], AS_OF), null, AS_OF)).toBeNull();
    const scattered = ["2026-09-07", "2026-09-15", "2026-09-23", "2026-10-01", "2026-10-09"].map((d) => order(d));
    expect(overdue(weekdayPattern(scattered, AS_OF), "2026-10-09", AS_OF)).toBeNull();
  });
});

describe("basketBreadth / leadTime", () => {
  it("averages distinct SKUs per order for each period, skipping blank lines", () => {
    const orders = [
      order("2026-11-02", ["A", "B"]),
      order("2026-11-01", ["A"]),
      order("2026-10-25", ["A", "B", "C"]),
      { ...order("2026-10-24", ["A"]), orderLines: [{ skuCode: "A", packQty: 1 }, { skuCode: "A", packQty: 2 }, { skuCode: "B", packQty: 0 }] },
    ];
    expect(basketBreadth(orders, AS_OF, 7)).toEqual({ cur: 1.5, prev: 2 });
    expect(basketBreadth([], AS_OF, 7)).toEqual({ cur: null, prev: null });
  });

  it("gives no lead time when POs are entered on or after delivery", () => {
    const back = [
      order("2026-11-02", ["A"], { recordedAt: "2026-11-02T03:00:00Z" }),
      order("2026-11-01", ["A"], { recordedAt: "2026-11-03T03:00:00Z" }),
    ];
    expect(leadTime(back)).toBeNull();
    expect(leadTime([])).toBeNull();
  });

  it("averages only the POs entered ahead, once most are", () => {
    const ahead = [
      order("2026-11-05", ["A"], { recordedAt: "2026-11-03T03:00:00Z" }),
      order("2026-11-06", ["A"], { recordedAt: "2026-11-03T03:00:00Z" }),
      order("2026-11-03", ["A"], { recordedAt: "2026-11-03T03:00:00Z" }),
    ];
    expect(leadTime(ahead)).toBe(2.5);
  });
});

describe("reliability", () => {
  const orders = [
    order("2026-11-01", ["A"], { invoiceRef: " inv1 ", outflowIds: ["o1"] }),
    order("2026-10-30", ["A"], { invoiceRef: "INV2", outflowIds: ["o2"] }),
    order("2026-10-29", ["A"], { invoiceRef: "INV3", outflowIds: ["o3"] }),
    order("2026-08-01", ["A"], { invoiceRef: "OLD", outflowIds: ["o4"] }), // outside 8 weeks
  ];
  const deliveries = [
    { id: "d1", invoiceRefNorm: "INV1", status: "terkirim" as const },
    { id: "d2", invoiceRefNorm: "INV2", status: "ditolak" as const },
    { id: "d4", invoiceRefNorm: "OLD", status: "terkirim" as const },
  ];

  it("keeps unlogged fakturs apart from delivered ones", () => {
    const r = reliability(orders, AS_OF, deliveries, [], new Set());
    expect(r).toMatchObject({ orders: 3, logged: 2, delivered: 1, rejected: 1, withReturn: 0 });
  });

  it("reports no deliveries as not logged, not as a zero rate", () => {
    expect(reliability(orders, AS_OF, [], [], new Set())).toMatchObject({ orders: 3, logged: 0, delivered: 0 });
  });

  it("counts a return from either the warehouse rows or a delivery line, once per faktur", () => {
    const lines = [{ deliveryId: "d1", reason: "pecah" }, { deliveryId: "d1", reason: "pecah" }, { deliveryId: "d2", reason: "expired" }];
    const r = reliability(orders, AS_OF, deliveries, lines, new Set(["o1", "o3"]));
    expect(r.withReturn).toBe(3);
    expect(r.reasons).toEqual([{ reason: "pecah", count: 2 }, { reason: "expired", count: 1 }]);
  });
});

describe("returnSpike", () => {
  const outflowIds = (id: string) => ({ outflowIds: [id] });
  const orders = [
    order("2026-11-02", ["A"], outflowIds("a")),
    order("2026-11-01", ["A"], outflowIds("b")),
    order("2026-10-01", ["A"], outflowIds("c")),
    order("2026-09-20", ["A"], outflowIds("d")),
  ];
  const hit = new Set(["a", "b", "c", "d"]);
  it("fires when the period beats the usual rate", () => {
    expect(returnSpike(orders, AS_OF, 7, hit, covered)).toEqual({ cur: 2, usual: 0.25, spike: true });
  });
  it("needs at least two fakturs", () => {
    expect(returnSpike(orders.slice(1), AS_OF, 7, hit, covered).spike).toBe(false);
  });
  it("never fires on stopped or thin return data", () => {
    expect(returnSpike(orders, AS_OF, 7, hit, { start: "2026-09-30", staleSince: "2026-10-14" }).spike).toBe(false);
    expect(returnSpike(orders, AS_OF, 28, hit, { start: "2026-09-30", staleSince: null }).spike).toBe(false);
  });
});

describe("summarizeBuyer flags", () => {
  const weekly = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => order(addDays(AS_OF, -(from + i * 2))));

  it("flags Turun at a 20 % drop", () => {
    const orders = [...weekly(0, 3), ...weekly(7, 4)]; // 3 vs 4: down 25 %
    expect(summarizeBuyer("x", "po", "X", orders, AS_OF, 7, covered).down).toBe(true);
  });

  it("does not flag Turun on thin history, whatever the counts say", () => {
    const cov = { start: "2026-10-01", staleSince: null };
    const r = summarizeBuyer("x", "po", "X", [order("2026-10-05"), order("2026-10-06"), order(AS_OF)], AS_OF, 28, cov);
    expect(r.compare.delta).toBeNull();
    expect(r.down).toBe(false);
    expect(r.isNew).toBe(false);
  });

  it("marks a first order inside the period as new, and new buyers are not down", () => {
    const r = summarizeBuyer("x", "po", "X", [order("2026-11-01")], AS_OF, 7, covered);
    expect(r.isNew).toBe(true);
    expect(r.down).toBe(false);
  });

  it("does not call a brand-new dataset's customers new", () => {
    const r = summarizeBuyer("x", "cash", "X", [order("2026-11-01")], AS_OF, 7, { start: "2026-11-01", staleSince: null });
    expect(r.isNew).toBe(false);
  });
});

describe("concentration", () => {
  it("is computed on order counts and names the top three", () => {
    expect(concentration([{ name: "A", count: 5 }, { name: "B", count: 3 }, { name: "C", count: 1 }, { name: "D", count: 1 }])).toEqual({
      pct: 90,
      names: ["A", "B", "C"],
    });
  });
  it("is null with no orders", () => {
    expect(concentration([{ name: "A", count: 0 }])).toBeNull();
  });
});

describe("initials", () => {
  it("drops honorifics and company forms", () => {
    expect(initials("Bu Ani")).toBe("AN");
    expect(initials("Warung Sri Rejeki")).toBe("SR");
    expect(initials("PT Unggas Jaya")).toBe("UJ");
    expect(initials("Family Mart")).toBe("FM");
    expect(initials("Osave")).toBe("OS");
  });
});

describe("Kas Tunai", () => {
  const log = (over: Partial<ActivityLog> & { metadata?: ActivityLog["metadata"] }): ActivityLog =>
    ({
      id: crypto.randomUUID(),
      action_type: "outflow",
      category: "egg",
      product: "KAMPUNG BIASA",
      quantity_butir: 30,
      recorded_at: "2026-11-04T03:00:00Z",
      ...over,
    }) as ActivityLog;

  it("merges only case and spacing variants, keeping the most frequent spelling", () => {
    expect(normName("  Bu   Ani ")).toBe("bu ani");
    const sale = (customerName: string) => ({ saleId: customerName, customerName, tracked: true, outflowDate: "2026-11-01", orderLines: [], eggTotals: [] });
    const c = kasTunaiCustomers([sale("Bu Ani"), sale("bu ani"), sale("BU ANI"), sale("Bu  Ani"), sale("bu ani"), sale("Ani"), sale("Ibu Ani")]);
    expect(c.map((x) => x.key).sort()).toEqual(["ani", "bu ani", "ibu ani"]);
    const ani = c.find((x) => x.key === "bu ani");
    expect(ani.sales).toHaveLength(5);
    expect(ani.name).toBe("bu ani");
    expect(ani.variants).toEqual(["bu ani", "Bu Ani", "BU ANI", "Bu  Ani"]);
  });

  it("groups one sale's rows and keeps eggs per product in their own unit", () => {
    const meta = { orderType: "manual" as const, saleId: "s1", outflowDate: "2026-11-02", customerName: "Bu Ani" };
    const sales = kasSalesFromLogs([
      log({ metadata: meta }),
      log({ metadata: meta, product: "NEGERI BIASA", quantity_butir: 2.5 }),
    ]);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ outflowDate: "2026-11-02", customerName: "Bu Ani", tracked: true });
    expect(sales[0].eggTotals).toEqual([{ product: "KAMPUNG BIASA", quantity: 30 }, { product: "NEGERI BIASA", quantity: 2.5 }]);
  });

  it("leaves out POs, voided rows, materials, inflows and stock corrections", () => {
    const sales = kasSalesFromLogs([
      log({ metadata: { orderType: "quick_outflow", buyerName: "Osave" } }),
      log({ voided_at: "2026-11-04T04:00:00Z" }),
      log({ category: "packaging" }),
      log({ action_type: "inflow" }),
      log({ invoice_supplier: "CORRECTION" }),
      log({ invoice_supplier: "INV-TEST-1" }),
    ]);
    expect(sales).toHaveLength(1);
    expect(sales[0].tracked).toBe(false);
  });
});

describe("supplierName", () => {
  it("merges grade variants into one supplier", () => {
    for (const raw of ["SUMBER JAYA (CREAM)", "SUMBER JAYA(CREAM)", "SUMBER JAYA ( CREAM)", "SUMBER JAYA CREAM", "sumber jaya (jumbo)", " SUMBER  JAYA "]) {
      expect(supplierName(raw)).toBe("SUMBER JAYA");
    }
    expect(supplierName("MAKMUR (CR")).toBe("MAKMUR");
    expect(supplierName("KEBUN 2")).toBe("KEBUN 2");
    expect(supplierName("Ibu Sari")).toBe("IBU SARI");
  });
  it("gives null for what isn't a supplier", () => {
    for (const raw of ["STOCK FISIK AWAL", "STOCK SELISIH", "M", "", "  ", null, undefined]) {
      expect(supplierName(raw)).toBeNull();
    }
  });
});

describe("stock age", () => {
  const TODAY = "2026-11-05"; // Thursday
  const batch = (product: string, date: string, remaining: number) => ({ id: `${product}${date}`, product, date, remaining });

  it("splits by age at the band boundaries", () => {
    const b = [batch("P", "2026-11-03", 1), batch("P", "2026-11-02", 10), batch("P", "2026-11-01", 100), batch("P", "2026-10-31", 1000)];
    expect(ageBands(b, TODAY, 5)).toEqual({ fresh: 1, mid: 110, risk: 1000 });
  });

  it("uses the product's own freshness window", () => {
    const b = [batch("NEGERI BIASA", "2026-10-20", 7.5)];
    expect(ageBands(b, TODAY, 5).risk).toBe(7.5);
    expect(ageBands(b, TODAY, 30)).toEqual({ fresh: 0, mid: 7.5, risk: 0 });
  });

  it("lists batches crossing their window by Sunday, soonest first", () => {
    const list = atRiskThisWeek(
      [
        batch("A", "2026-10-31", 5), // crosses today
        batch("B", "2026-11-03", 5), // Sat 8 Nov... crosses 8 Nov
        batch("C", "2026-11-04", 5), // crosses Mon 9 Nov: too late
        batch("D", "2026-10-30", 5), // already crossed
        batch("E", "2026-10-31", 0), // gone
      ],
      TODAY,
      () => 5
    );
    expect(list.map((b) => [b.product, b.crossDate])).toEqual([["A", "2026-11-05"], ["B", "2026-11-08"]]);
  });

  it("orders the oldest remaining batches and skips empty ones", () => {
    const list = oldestBatches([batch("A", "2026-10-30", 5), batch("B", "2026-10-20", 0), batch("C", "2026-10-25", 1)], TODAY, 4);
    expect(list.map((b) => [b.product, b.age])).toEqual([["C", 11], ["A", 6]]);
  });
});

describe("turnoverDays", () => {
  const inflows = [{ id: "i1", date: "2026-10-20" }, { id: "i2", date: "2026-10-30" }];
  const outflows = [
    { id: "o1", date: "2026-11-01", product: "P" },
    { id: "o2", date: "2026-10-25", product: "P" }, // before i2: back-dated
    { id: "o3", date: "2026-11-02", product: "Q" },
    { id: "o4", date: "2026-08-01", product: "P" }, // out of period
  ];
  const ages = fifoAges(
    [
      { outflow_id: "o1", inflow_id: "i1", quantity_deducted: 10 }, // 12 days
      { outflow_id: "o1", inflow_id: "i2", quantity_deducted: 30 }, // 2 days
      { outflow_id: "o2", inflow_id: "i2", quantity_deducted: 99 }, // -5: unknown
      { outflow_id: "o3", inflow_id: "i1", quantity_deducted: 5 },
      { outflow_id: "voided", inflow_id: "i1", quantity_deducted: 500 },
    ],
    outflows,
    inflows
  );

  it("weights by quantity, per product, leaving out back-dated and voided rows", () => {
    expect(turnoverDays(ages, "P", AS_OF, 28)).toBe(4.5);
    expect(turnoverDays(ages, "Q", AS_OF, 28)).toBe(13);
  });

  it("is null when nothing went out", () => {
    expect(turnoverDays(ages, "R", AS_OF, 28)).toBeNull();
  });
});

describe("countVariance", () => {
  const row = (countDate: string, quantity: number, systemQty: number | null, product = "P") => ({ product, countDate, quantity, systemQty });
  it("keeps the latest n per product, oldest first, and flags past tolerance", () => {
    const rows = [row("2026-10-03", 11, 10), row("2026-10-01", 9, 10), row("2026-10-02", 10, 10), row("2026-10-03", 500, 1, "Q"), row("2026-10-04", 5, null)];
    expect(countVariance(rows, "P", 2, 2)).toEqual({ series: [0, 1], latest: 1, off: false });
    expect(countVariance(rows, "P", 2, 0.5).off).toBe(true);
    expect(countVariance([], "P", 6, 0)).toBeNull();
  });
});

describe("materialTone", () => {
  it("turns amber under 7 days and red under 3", () => {
    expect([materialTone(7), materialTone(6.9), materialTone(3), materialTone(2.9)]).toEqual(["ok", "amber", "amber", "red"]);
  });
});
