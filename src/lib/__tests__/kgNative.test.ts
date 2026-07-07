import { describe, it, expect } from "vitest";
import { calculateLineMaterials, buildLabelsPerPackMap } from "@/lib/outflowCalculator";
import type { PackSKU } from "@/lib/outflowCalculator";
import type { ItemType } from "@/types/inventory";
import { toStockUnits, getStockUnit, butirEquivalent } from "@/lib/inventory";
import { ConversionMap } from "@/types/inventory";
import { OrderLine } from "@/types/quickOutflow";

const MAP: ConversionMap = {
  "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
  "ASIN MATENG": { unit: "btr", eggs_per_unit: 1 },
};

const SKUS: PackSKU[] = [
  {
    code: "N15B",
    displayName: "Negeri isi 15",
    eggsPerPack: 15,
    eggProduct: "NEGERI BIASA",
    packagingItem: "negeri isi 15",
    isActive: true,
  },
  {
    code: "BK4AMTG",
    displayName: "Asin mateng isi 4",
    eggsPerPack: 4,
    eggProduct: "ASIN MATENG",
    packagingItem: "bebek kecil",
    isActive: true,
  },
];

describe("kg-native stock units", () => {
  it("getStockUnit: kg for weight-sold eggs, butir otherwise, pcs for non-eggs", () => {
    expect(getStockUnit("NEGERI BIASA", "egg", MAP)).toBe("kg");
    expect(getStockUnit("ASIN MATENG", "egg", MAP)).toBe("butir");
    expect(getStockUnit("box kecil", "box", MAP)).toBe("pcs");
  });

  it("toStockUnits: kg entry on kg product passes through exactly", () => {
    expect(toStockUnits("NEGERI BIASA", 100, "kg", MAP)).toBe(100);
  });

  it("toStockUnits: butir entry on kg product converts to estimated kg", () => {
    // 155 eggs / 15.5 per kg = 10 kg
    expect(toStockUnits("NEGERI BIASA", 155, "butir", MAP)).toBe(10);
  });

  it("butirEquivalent estimates eggs from kg stock", () => {
    expect(butirEquivalent("NEGERI BIASA", 10, MAP)).toBe(155);
    expect(butirEquivalent("ASIN MATENG", 200, MAP)).toBe(200);
  });
});

describe("calculateLineMaterials under kg-native", () => {
  it("pack line of a kg egg deducts estimated kg, not eggs", () => {
    const line: OrderLine = { id: "1", lineType: "pack", skuCode: "N15B", packQty: 31 };
    const m = calculateLineMaterials(line, "keranjang", false, SKUS, MAP)!;
    // 31 packs × 15 eggs = 465 eggs; 465 / 15.5 = 30 kg
    expect(m.eggsButir).toBe(30);
    expect(m.eggProduct).toBe("NEGERI BIASA");
    expect(m.packagingPcs).toBe(31);
  });

  it("pack line of a count egg still deducts eggs", () => {
    const line: OrderLine = { id: "1", lineType: "pack", skuCode: "BK4AMTG", packQty: 10 };
    const m = calculateLineMaterials(line, "keranjang", false, SKUS, MAP)!;
    expect(m.eggsButir).toBe(40);
  });

  it("loose kg sale of a kg egg deducts the kg exactly", () => {
    const line: OrderLine = {
      id: "1",
      lineType: "loose",
      eggProduct: "NEGERI BIASA",
      looseQty: 12.5,
      looseUnit: "kg",
    };
    const m = calculateLineMaterials(line, "keranjang", false, SKUS, MAP)!;
    expect(m.eggsButir).toBe(12.5);
  });

  it("loose butir sale of a kg egg deducts estimated kg", () => {
    const line: OrderLine = {
      id: "1",
      lineType: "loose",
      eggProduct: "NEGERI BIASA",
      looseQty: 155,
      looseUnit: "butir",
    };
    const m = calculateLineMaterials(line, "keranjang", false, SKUS, MAP)!;
    expect(m.eggsButir).toBe(10);
  });

  it("tray logistics count uses eggs, not kg", () => {
    const line: OrderLine = {
      id: "1",
      lineType: "loose",
      eggProduct: "NEGERI BIASA",
      looseQty: 10, // kg -> 155 eggs -> 6 trays of 30
      looseUnit: "kg",
    };
    const m = calculateLineMaterials(line, "tray", false, SKUS, MAP)!;
    expect(m.traysUsed).toBe(6);
    expect(m.eggsButir).toBe(10);
  });
});

describe("catalog-configurable labels per pack", () => {
  const packLine = (packQty: number, labelSelection?: string): OrderLine => ({
    id: "1",
    lineType: "pack",
    skuCode: "N15B",
    packQty,
    labelSelection,
  });

  it("defaults to 1 label per pack when no rate is configured", () => {
    const m = calculateLineMaterials(packLine(12, "label astro"), "keranjang", false, SKUS, MAP)!;
    expect(m.labelPcs).toBe(12);
    expect(m.labelItem).toBe("label astro");
  });

  it("uses the catalog-configured rate when present", () => {
    const m = calculateLineMaterials(packLine(12, "label astro"), "keranjang", false, SKUS, MAP, undefined, {
      "label astro": 2,
    })!;
    expect(m.labelPcs).toBe(24);
  });

  it("a rate configured for a different label does not apply", () => {
    const m = calculateLineMaterials(packLine(5, "label astro"), "keranjang", false, SKUS, MAP, undefined, {
      "label osave": 3,
    })!;
    expect(m.labelPcs).toBe(5); // falls back to the default of 1
  });

  it("fractional rates round up — you can't consume part of a label", () => {
    const m = calculateLineMaterials(packLine(5, "label astro"), "keranjang", false, SKUS, MAP, undefined, {
      "label astro": 1.5,
    })!;
    expect(m.labelPcs).toBe(8); // 5 × 1.5 = 7.5 -> 8
  });

  it("no label selected means no label deduction regardless of rates", () => {
    const m = calculateLineMaterials(packLine(5), "keranjang", false, SKUS, MAP, undefined, {
      "label astro": 2,
    })!;
    expect(m.labelPcs).toBe(0);
    expect(m.labelItem).toBeNull();
  });

  it("buildLabelsPerPackMap keeps configured label rates, drops unset/invalid/non-label rows", () => {
    const items: ItemType[] = [
      { id: "1", category: "label", name: "label astro", labelsPerPack: 2 },
      { id: "2", category: "label", name: "label osave" }, // unset -> default 1 (omitted)
      { id: "3", category: "label", name: "label zero", labelsPerPack: 0 }, // invalid -> omitted
      { id: "4", category: "packaging", name: "not a label", labelsPerPack: 5 }, // wrong category
    ];
    expect(buildLabelsPerPackMap(items)).toEqual({ "label astro": 2 });
  });
});
