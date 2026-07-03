import { describe, it, expect } from "vitest";
import { calculateStockSummary } from "@/lib/inventory";
import { InflowEntry, CONVERSION_DICT } from "@/types/inventory";

function inflow(overrides: Partial<InflowEntry>): InflowEntry {
  return {
    id: crypto.randomUUID(),
    date: "2026-01-01",
    product: "ASIN MATENG",
    quantity: 100,
    unit: "pcs",
    quantityInButir: 100,
    remainingButir: 100,
    createdAt: "2026-01-01T00:00:00Z",
    category: "egg",
    ...overrides,
  };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

describe("calculateStockSummary freshness windows", () => {
  it("flags eggs older than the 5-day default as at risk", () => {
    const summary = calculateStockSummary([inflow({ date: daysAgo(7) })]);
    const row = summary.find((s) => s.product === "ASIN MATENG")!;
    expect(row.isAtRisk).toBe(true);
    expect(row.atRiskQuantity).toBe(100);
  });

  it("respects a longer per-product freshness window from the catalog", () => {
    const summary = calculateStockSummary(
      [inflow({ date: daysAgo(7) })],
      CONVERSION_DICT,
      { "ASIN MATENG": 30 }
    );
    const row = summary.find((s) => s.product === "ASIN MATENG")!;
    expect(row.isAtRisk).toBe(false);
    expect(row.atRiskQuantity).toBe(0);
    expect(row.safeQuantity).toBe(100);
  });

  it("applies the override only to the named product", () => {
    const summary = calculateStockSummary(
      [
        inflow({ date: daysAgo(7) }),
        inflow({ product: "KAMPUNG BIASA", date: daysAgo(7) }),
      ],
      CONVERSION_DICT,
      { "ASIN MATENG": 30 }
    );
    expect(summary.find((s) => s.product === "ASIN MATENG")!.isAtRisk).toBe(false);
    expect(summary.find((s) => s.product === "KAMPUNG BIASA")!.isAtRisk).toBe(true);
  });

  it("only counts remaining stock of old batches as at risk (FIFO-aware)", () => {
    const summary = calculateStockSummary([
      inflow({ date: daysAgo(10), remainingButir: 40 }),
      inflow({ date: daysAgo(1), remainingButir: 100 }),
    ]);
    const row = summary.find((s) => s.product === "ASIN MATENG")!;
    expect(row.atRiskQuantity).toBe(40);
    expect(row.safeQuantity).toBe(100);
    expect(row.totalStock).toBe(140);
  });
});
