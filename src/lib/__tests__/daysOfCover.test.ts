import { describe, it, expect } from "vitest";
import { averageDailyOutflow, daysOfCover } from "@/lib/inventory";
import { OutflowEntry } from "@/types/inventory";

function outflow(overrides: Partial<OutflowEntry>): OutflowEntry {
  return {
    id: crypto.randomUUID(),
    date: "2026-07-01",
    product: "KAMPUNG BIASA",
    quantityInButir: 100,
    createdAt: "2026-07-01T00:00:00Z",
    category: "egg",
    ...overrides,
  };
}

// Fixed "now" so the trailing-window math is deterministic.
const NOW = new Date("2026-07-15T12:00:00Z");
function daysBefore(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

describe("averageDailyOutflow", () => {
  it("averages recent outflow over the full window, not just active days", () => {
    // 700 butir sold across two days inside a 14-day window → 50/day.
    const outflows = [
      outflow({ date: daysBefore(2), quantityInButir: 300 }),
      outflow({ date: daysBefore(5), quantityInButir: 400 }),
    ];
    expect(averageDailyOutflow(outflows, "KAMPUNG BIASA", 14, NOW)).toBeCloseTo(50);
  });

  it("excludes outflows older than the window", () => {
    const outflows = [
      outflow({ date: daysBefore(3), quantityInButir: 140 }),
      outflow({ date: daysBefore(30), quantityInButir: 9999 }), // outside 14d
    ];
    expect(averageDailyOutflow(outflows, "KAMPUNG BIASA", 14, NOW)).toBeCloseTo(10);
  });

  it("excludes voided outflows", () => {
    const outflows = [
      outflow({ date: daysBefore(1), quantityInButir: 140 }),
      outflow({ date: daysBefore(1), quantityInButir: 700, voidedAt: "2026-07-14T00:00:00Z" }),
    ];
    expect(averageDailyOutflow(outflows, "KAMPUNG BIASA", 14, NOW)).toBeCloseTo(10);
  });

  it("ignores other products", () => {
    const outflows = [
      outflow({ date: daysBefore(1), product: "NEGERI BIASA", quantityInButir: 700 }),
    ];
    expect(averageDailyOutflow(outflows, "KAMPUNG BIASA", 14, NOW)).toBe(0);
  });
});

describe("daysOfCover", () => {
  it("divides stock by daily velocity", () => {
    expect(daysOfCover(300, 100)).toBeCloseTo(3);
  });

  it("returns null when there is no recent outflow (velocity unknown)", () => {
    expect(daysOfCover(300, 0)).toBeNull();
  });
});
