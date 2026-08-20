import { describe, it, expect } from "vitest";
import {
  STOCK_LOCATIONS,
  defaultTolerance,
  resolveTolerance,
  computeVariance,
  totalOnHand,
  parseCountInput,
} from "@/lib/stockCount";

describe("stockCount locations", () => {
  it("has exactly the three agreed locations in order", () => {
    expect([...STOCK_LOCATIONS]).toEqual(["js_warehouse", "tst_warehouse", "loaded"]);
  });
});

describe("defaultTolerance", () => {
  it("allows 1 kg drift for kg products", () => {
    expect(defaultTolerance("kg")).toBe(1);
  });
  it("requires exact match for butir and pcs", () => {
    expect(defaultTolerance("butir")).toBe(0);
    expect(defaultTolerance("pcs")).toBe(0);
  });
});

describe("resolveTolerance", () => {
  it("uses the configured value when present (including 0)", () => {
    expect(resolveTolerance(2, "kg")).toBe(2);
    expect(resolveTolerance(0, "kg")).toBe(0); // explicit exact override
  });
  it("falls back to the unit default when unset or negative", () => {
    expect(resolveTolerance(undefined, "kg")).toBe(1);
    expect(resolveTolerance(-5, "butir")).toBe(0);
  });
});

describe("computeVariance", () => {
  it("reports a match when physical equals system", () => {
    expect(computeVariance(300, 300, 0)).toEqual({ delta: 0, status: "match" });
  });
  it("reports within-tolerance for kg drift under the tolerance", () => {
    expect(computeVariance(120.4, 120, 1)).toEqual({ delta: 0.4, status: "within" });
  });
  it("reports off when the gap exceeds tolerance, with a signed delta", () => {
    expect(computeVariance(1760, 1800, 0)).toEqual({ delta: -40, status: "off" });
  });
});

describe("totalOnHand", () => {
  it("sums the three locations treating blanks as zero", () => {
    expect(totalOnHand({ js_warehouse: 120, tst_warehouse: 80, loaded: 45 })).toBe(245);
    expect(totalOnHand({ js_warehouse: 0, tst_warehouse: 300 })).toBe(300);
  });
});

describe("parseCountInput", () => {
  it("parses plain integers and treats blanks as not-counted (null)", () => {
    expect(parseCountInput("300")).toBe(300);
    expect(parseCountInput("")).toBeNull();
    expect(parseCountInput("   ")).toBeNull();
  });
  it("accepts the Indonesian decimal comma for kg", () => {
    expect(parseCountInput("120,5")).toBe(120.5);
  });
  it("rejects negatives and non-numbers", () => {
    expect(parseCountInput("-5")).toBeNull();
    expect(parseCountInput("abc")).toBeNull();
  });
});
