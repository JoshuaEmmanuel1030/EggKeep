import { describe, it, expect } from "vitest";
import { matchesType, presetRange, presetOf, todayStats, countEntries } from "../activityFilters";
import type { ActivityLog } from "@/types/activityLog";

// Local-time "now" so day boundaries don't depend on the test machine's TZ.
const now = new Date(2026, 9, 15, 14, 30);
const at = (day: number, h: number, m = 0, s = 0) => new Date(2026, 9, day, h, m, s).toISOString();

function log(over: Partial<ActivityLog>): ActivityLog {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: "u1",
    action_type: "outflow",
    product: "KAMPUNG BIASA",
    quantity_butir: 10,
    recorded_at: at(15, 9),
    created_at: at(15, 9),
    client_id: "c1",
    category: "egg",
    ...over,
  };
}

const order = (lines: unknown[], recorded_at: string, extra: Partial<ActivityLog> = {}) =>
  log({
    recorded_at,
    metadata: {
      orderType: "quick_outflow",
      buyerName: "OSAVE BKS",
      orderLines: lines as never,
      outflowDate: "2026-10-15",
    },
    ...extra,
  });

describe("date presets", () => {
  it("round-trips every fixed preset through presetOf", () => {
    for (const p of ["today", "last7", "last30"] as const) {
      expect(presetOf(presetRange(p, now), now)).toBe(p);
    }
  });

  it("last 7 days includes today", () => {
    const r = presetRange("last7", now);
    expect(r.from).toEqual(new Date(2026, 9, 9));
    expect(r.to).toEqual(new Date(2026, 9, 15));
  });

  it("no range is all time", () => {
    expect(presetOf(undefined, now)).toBe("allTime");
    expect(presetOf({ from: undefined, to: undefined }, now)).toBe("allTime");
  });

  it("anything else is custom", () => {
    expect(presetOf({ from: new Date(2026, 9, 10), to: new Date(2026, 9, 15) }, now)).toBe("custom");
    expect(presetOf({ from: new Date(2026, 9, 15), to: undefined }, now)).toBe("custom");
    // A preset computed on another day no longer matches today.
    expect(presetOf(presetRange("today", new Date(2026, 9, 14)), now)).toBe("custom");
  });
});

describe("todayStats", () => {
  const lines = [{ skuCode: "KP10B", packQty: 24 }];

  it("counts distinct quick orders, one per Kastun log, and inflows", () => {
    const logs = [
      // One order: two material rows in the same 30s bucket.
      order(lines, at(15, 9, 15, 1)),
      order(lines, at(15, 9, 15, 2), { product: "Mika 10" }),
      // A second order minutes later.
      order(lines, at(15, 10, 40)),
      // Kastun (no buyer) counts per log.
      log({ metadata: { orderType: "manual" } }),
      log({ metadata: { orderType: "quick_outflow" } }),
      log({ action_type: "inflow", invoice_supplier: "Farm A" }),
    ];
    expect(todayStats(logs, now)).toEqual({ orders: 4, inflows: 1 });
  });

  it("excludes voided logs and other days", () => {
    const logs = [
      order(lines, at(15, 9), { voided_at: at(15, 10) }),
      log({ action_type: "inflow", voided_at: at(15, 10) }),
      order(lines, at(14, 23, 59)),
      log({ action_type: "inflow", recorded_at: at(16, 0, 1) }),
    ];
    expect(todayStats(logs, now)).toEqual({ orders: 0, inflows: 0 });
  });
});

describe("matchesType", () => {
  it("applies the voided rules per type tab", () => {
    const kastun = log({});
    const voidedOrder = order([{ skuCode: "KP10B", packQty: 24 }], at(15, 9), { voided_at: at(15, 10) });
    expect(matchesType(voidedOrder, "all")).toBe(true);
    expect(matchesType(voidedOrder, "voided")).toBe(true);
    expect(matchesType(voidedOrder, "quick")).toBe(false);
    expect(matchesType(kastun, "voided")).toBe(false);
    expect(matchesType(kastun, "manual")).toBe(true);
    expect(matchesType(kastun, "quick")).toBe(false);
  });
});

describe("countEntries", () => {
  it("counts an order's material rows once and every other log once", () => {
    const lines = [{ skuCode: "KP10B", packQty: 24 }];
    const logs = [
      order(lines, at(15, 9, 15, 5), { product: "KAMPUNG BIASA" }),
      order(lines, at(15, 9, 15, 6), { product: "Mika 10", category: "packaging" }),
      order(lines, at(15, 11, 0, 0)), // same buyer/lines, different 30s bucket = new order
      log({ metadata: { orderType: "manual" } }),
      log({ action_type: "inflow" }),
    ];
    expect(countEntries(logs)).toBe(4);
    expect(countEntries([])).toBe(0);
  });
});
