import { describe, it, expect } from "vitest";
import {
  STOCK_LOCATIONS,
  defaultTolerance,
  resolveTolerance,
  computeVariance,
  totalOnHand,
  parseQtyInput,
  qtyInputText,
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

describe("parseQtyInput", () => {
  it.each(["kg", "butir", "pcs"] as const)("%s: blank is null, 0 is a number", (unit) => {
    expect(parseQtyInput("", unit)).toBeNull();
    expect(parseQtyInput("   ", unit)).toBeNull();
    expect(parseQtyInput("0", unit)).toBe(0);
    expect(parseQtyInput(" 300 ", unit)).toBe(300);
  });

  it.each(["butir", "pcs"] as const)("%s: whole numbers, a dot is thousands", (unit) => {
    expect(parseQtyInput("1.500", unit)).toBe(1500);
    expect(parseQtyInput("1.000.000", unit)).toBe(1000000);
    for (const bad of ["2,5", "1.5", "1.50", "1,500", "1.500,5", "12abc", "abc", "-5", "1 500", "1.5000"]) {
      expect(parseQtyInput(bad, unit)).toBeNull();
    }
  });

  // The owner's call (2026-11-09): kg reads as the screens print it.
  it("kg: a dot before three digits groups thousands, a comma after them is the decimal", () => {
    expect(parseQtyInput("1.500", "kg")).toBe(1500);
    expect(parseQtyInput(" 1.500 ", "kg")).toBe(1500);
    expect(parseQtyInput("12.345", "kg")).toBe(12345);
    expect(parseQtyInput("120.500", "kg")).toBe(120500);
    expect(parseQtyInput("1.500.000", "kg")).toBe(1500000);
    expect(parseQtyInput("12.345,67", "kg")).toBe(12345.67);
    expect(parseQtyInput("1.200,5", "kg")).toBe(1200.5);
  });

  it("kg: otherwise one decimal separator, comma or dot", () => {
    expect(parseQtyInput("1500", "kg")).toBe(1500);
    expect(parseQtyInput("52,89", "kg")).toBe(52.89);
    expect(parseQtyInput("52.89", "kg")).toBe(52.89);
    expect(parseQtyInput("1,500", "kg")).toBe(1.5); // a comma is always the decimal
    expect(parseQtyInput("0.500", "kg")).toBe(0.5); // a leading zero can't be thousands
    expect(parseQtyInput("1.5000", "kg")).toBe(1.5); // four digits: not a thousands group
  });

  it("kg: refuses anything else", () => {
    for (const bad of ["1,500.5", "12.34.567", "1.500,5,5", "1.2.3", "12abc", "abc", "-5", "1 500", "1."]) {
      expect(parseQtyInput(bad, "kg")).toBeNull();
    }
  });
});

describe("qtyInputText", () => {
  it("is empty for no quantity", () => {
    expect(qtyInputText(null)).toBe("");
    expect(qtyInputText(undefined)).toBe("");
  });
  it("reads back as the same number, whatever kg was stored", () => {
    for (const n of [0, 1500, 2.125, 12.345, 52.89, 1.5]) {
      expect(parseQtyInput(qtyInputText(n), "kg")).toBe(n);
    }
    // Why the comma: as plain text, a stored 2.125 kg would read back as 2125.
    expect(parseQtyInput(String(2.125), "kg")).toBe(2125);
  });
  it("a stored whole count reads back; a stored fraction doesn't pass as a count", () => {
    expect(parseQtyInput(qtyInputText(1500), "butir")).toBe(1500);
    expect(parseQtyInput(qtyInputText(1.5), "butir")).toBeNull();
  });
});
