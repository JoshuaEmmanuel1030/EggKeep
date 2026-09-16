import { describe, it, expect } from "vitest";
import { calculateLineMaterials, resolveBoxLine, PackSKU } from "@/lib/outflowCalculator";
import { OrderLine } from "@/types/quickOutflow";
import { ConversionMap } from "@/types/inventory";

// N10B: count-sold pack (butir), 10 eggs/pack, packaging OSAVE PACK.
// BOXOSV: box SKU wrapping N10B in box osave.
const skus: PackSKU[] = [
  { code: "N10B", displayName: "Negeri 10 Biasa", eggsPerPack: 10,
    eggProduct: "NEGERI BIASA", packagingItem: "OSAVE PACK", isActive: true },
  { code: "BOXOSV", displayName: "Box Osave N10B", eggsPerPack: 1,
    eggProduct: "", packagingItem: null, isActive: true,
    basePackCode: "N10B", boxMode: "box osave" },
];
const conversionMap: ConversionMap = { "NEGERI BIASA": { unit: "btr", eggs_per_unit: 1 } };
const boxCapacityMap = { "box osave": { N10B: 18 } };

const boxLine: OrderLine = { id: "1", lineType: "pack", skuCode: "BOXOSV", packQty: 5 };

describe("Box SKU desugaring", () => {
  it("resolveBoxLine expands a box line to base packs", () => {
    const eff = resolveBoxLine(boxLine, skus, boxCapacityMap);
    expect(eff).not.toBeNull();
    expect(eff!.skuCode).toBe("N10B");
    expect(eff!.packQty).toBe(90); // 5 boxes × 18
    expect(eff!.boxModeOverride).toBe("box osave");
  });

  it("resolveBoxLine passes normal pack lines through unchanged", () => {
    const packLine: OrderLine = { id: "2", lineType: "pack", skuCode: "N10B", packQty: 7 };
    expect(resolveBoxLine(packLine, skus, boxCapacityMap)).toEqual(packLine);
  });

  it("resolveBoxLine returns null when the box has no capacity for the pack", () => {
    const badBox: PackSKU = { ...skus[1], boxMode: "box kecil" };
    const eff = resolveBoxLine(boxLine, [skus[0], badBox], boxCapacityMap);
    expect(eff).toBeNull();
  });

  it("calculateLineMaterials deducts eggs, packaging and physical boxes for a box line", () => {
    const m = calculateLineMaterials(
      boxLine, "box osave", true, skus, conversionMap, boxCapacityMap, {}
    );
    expect(m).not.toBeNull();
    expect(m!.eggProduct).toBe("NEGERI BIASA");
    expect(m!.eggsButir).toBe(900);      // 90 packs × 10 eggs
    expect(m!.packagingPcs).toBe(90);    // 90 packs
    expect(m!.packagingItem).toBe("OSAVE PACK");
    expect(m!.boxesPcs).toBe(5);         // 90 / 18
    expect(m!.boxType).toBe("box osave");
  });

  it("calculateLineMaterials returns null for an unconfigured box×pack", () => {
    const badBox: PackSKU = { ...skus[1], boxMode: "box kecil" };
    const m = calculateLineMaterials(
      boxLine, "box osave", true, [skus[0], badBox], conversionMap, boxCapacityMap, {}
    );
    expect(m).toBeNull();
  });
});
