// A pack SKU's own eggs-per-kg overrides the product rate on outflow.
// Migration: supabase/migrations/20261117000000_pack_sku_eggs_per_kg.sql

import { describe, it, expect } from "vitest";
import { calculateLineMaterials } from "@/lib/outflowCalculator";
import type { PackSKU } from "@/lib/outflowCalculator";
import { ConversionMap } from "@/types/inventory";
import { OrderLine } from "@/types/quickOutflow";

const MAP: ConversionMap = {
  "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
  "ASIN MATENG": { unit: "btr", eggs_per_unit: 1 },
};

const BOXES = { "box osave": { N10B: 18 } };

const sku = (over: Partial<PackSKU>): PackSKU => ({
  code: "X",
  displayName: "X",
  eggsPerPack: 10,
  eggProduct: "NEGERI BIASA",
  packagingItem: null,
  isActive: true,
  ...over,
});

// 5 bundles of 150 eggs: at the product rate 750/15.5 = 48.39 kg,
// at this SKU's own 16.22 it is 750/16.22 = 46.24 kg.
const BUNDLE: PackSKU = sku({ code: "BUNDLE", eggsPerPack: 150 });
const line = (skuCode: string, packQty: number): OrderLine =>
  ({ id: "1", lineType: "pack", skuCode, packQty });

const eggsFor = (skus: PackSKU[], skuCode: string, qty = 5) =>
  calculateLineMaterials(line(skuCode, qty), null, false, skus, MAP, BOXES)!.eggsButir;

describe("per-SKU eggs per kg", () => {
  it("no rate on the SKU converts at the product rate", () => {
    expect(eggsFor([BUNDLE], "BUNDLE")).toBe(48.39);
  });

  it("a rate on the SKU converts at that rate instead", () => {
    expect(eggsFor([{ ...BUNDLE, eggsPerKg: 16.22 }], "BUNDLE")).toBe(46.24);
  });

  it("an explicit null is the same as no rate", () => {
    expect(eggsFor([{ ...BUNDLE, eggsPerKg: null }], "BUNDLE")).toBe(48.39);
  });

  // The dangerous failure: dividing by 0 or skipping the division would bank a
  // butir count (750) as kilograms. It must fall back to the product rate.
  it.each([0, -1])("a rate of %s falls back to the product rate", (bad) => {
    expect(eggsFor([{ ...BUNDLE, eggsPerKg: bad }], "BUNDLE")).toBe(48.39);
  });

  it("the rate is ignored on a count-sold product, which deducts eggs", () => {
    const counted = sku({ code: "ASIN4", eggsPerPack: 4, eggProduct: "ASIN MATENG", eggsPerKg: 16.22 });
    expect(eggsFor([counted], "ASIN4")).toBe(20);
  });

  // resolveBoxLine rewrites a box line to its base pack before the conversion,
  // so the box's own rate is unreachable and the base pack's rate governs.
  it("a box SKU's rate is ignored; its base pack's rate governs", () => {
    const base = sku({ code: "N10B", eggsPerPack: 10, eggsPerKg: 16.22 });
    const box = sku({ code: "OSVN10B", eggsPerPack: 1, eggsPerKg: 99, basePackCode: "N10B", boxMode: "box osave" });
    // 1 box = 18 packs x 10 eggs = 180 eggs; 180 / 16.22 = 11.1, not 180 / 99.
    expect(eggsFor([base, box], "OSVN10B", 1)).toBe(11.1);
  });
});
