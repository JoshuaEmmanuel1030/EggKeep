import { BoxModeType, OrderLine, LineMaterials, AggregatedMaterials, StockShortage } from "@/types/quickOutflow";
import { StockSummary, ItemType } from "@/types/inventory";
import { CONVERSION_DICT, ConversionMap } from "@/types/inventory";

// Pack SKU interface - now uses dynamic data from database
export interface PackSKU {
  code: string;
  displayName: string;
  eggsPerPack: number;
  eggProduct: string;
  packagingItem: string | null;
  isActive?: boolean;
}

// Box capacities: boxType -> skuCode -> packs per box
export const BOX_CAPACITIES: Record<string, Record<string, number>> = {
  "box kecil": {
    "N15B": 8,
    "N15O": 8,
    "N10B": 12,
    "N10O": 12,
    "N6B": 20,
    "N6O": 20,
    "KP10B": 14,
    "KP10O": 14,
    "KP6B": 20,
    "KP6O": 20,
    "P25": 15,
    "BK4AMTG": 20,
  },
  "box osave": {
    "N10B": 18,
    "N10O": 18,
    "KP6B": 20,
    "KP6O": 20,
  },
  "box osave polos": {
    "N10B": 18,
    "N10O": 18,
  },
};

// Runtime box-capacity table: boxName -> skuCode -> packsPerBox. Same shape as BOX_CAPACITIES.
export type BoxCapacityMap = Record<string, Record<string, number>>;

/**
 * Build the authoritative box-capacity map from the catalog's box item types,
 * layered over the hardcoded BOX_CAPACITIES baseline. The baseline guarantees the
 * original boxes always resolve (offline / before the catalog loads); configured DB
 * box rows override or extend it. Mirror of buildConversionMap for eggs.
 */
export function buildBoxCapacityMap(boxItems: ItemType[]): BoxCapacityMap {
  // Deep-clone the baseline so per-box merges don't mutate the constant.
  const map: BoxCapacityMap = {};
  for (const [boxName, caps] of Object.entries(BOX_CAPACITIES)) {
    map[boxName] = { ...caps };
  }
  for (const t of boxItems) {
    if (t.category !== "box") continue;
    if (!t.boxCapacities) continue; // skip unconfigured boxes
    map[t.name] = { ...(map[t.name] || {}), ...t.boxCapacities };
  }
  return map;
}

// Buyer default box modes
export const BUYER_BOX_MODES: Record<string, BoxModeType> = {
  "Astro": "box kecil",
  "Family Mart": "box kecil",
  "K3Mart": "box kecil",
  "Osave": "box osave",
  "Segari": "keranjang",
  "CircleK": "keranjang",
  "Sayurbox": "tray",
};

// Logistics-only box modes (no inventory deduction)
export const LOGISTICS_ONLY_MODES: BoxModeType[] = ["keranjang", "tray", "plastic"];

// Get SKU by code - now accepts dynamic SKU list
export function getSKUByCode(code: string, skus: PackSKU[]): PackSKU | undefined {
  return skus.find(sku => sku.code === code);
}

// Check if box mode is logistics only (no DB write for boxes)
export function isLogisticsOnlyMode(boxMode: BoxModeType): boolean {
  return LOGISTICS_ONLY_MODES.includes(boxMode);
}

// Calculate boxes needed for a pack SKU
export function calculateBoxes(
  skuCode: string,
  packs: number,
  boxMode: BoxModeType,
  boxCapacityMap: BoxCapacityMap = BOX_CAPACITIES
): { boxes: number; remainder: number; capacity: number | null } {
  if (isLogisticsOnlyMode(boxMode)) {
    return { boxes: 0, remainder: 0, capacity: null };
  }

  const capacity = boxCapacityMap[boxMode]?.[skuCode];
  if (!capacity) {
    // capacity: null signals "not configured for this SKU×box" (vs a real 0 need),
    // so the UI can surface a warning instead of a silent "0 boxes".
    return { boxes: 0, remainder: packs, capacity: null };
  }

  const boxes = Math.ceil(packs / capacity);
  const remainder = packs % capacity;
  return { boxes, remainder, capacity };
}

// Calculate materials for a single order line - now accepts dynamic SKU list
export function calculateLineMaterials(
  line: OrderLine,
  boxMode: BoxModeType,
  boxesRequired: boolean,
  skus: PackSKU[] = [],
  conversionMap: ConversionMap = CONVERSION_DICT,
  boxCapacityMap: BoxCapacityMap = BOX_CAPACITIES
): LineMaterials | null {
  if (line.lineType === "pack") {
    if (!line.skuCode || !line.packQty || line.packQty <= 0) {
      return null;
    }

    const sku = getSKUByCode(line.skuCode, skus);
    if (!sku) return null;

    const effectiveBoxMode = line.boxModeOverride || boxMode;
    const eggsButir = line.packQty * sku.eggsPerPack;
    
    let boxesPcs = 0;
    let boxType: string | null = null;
    let lastBoxFill: string | undefined;
    const isLogisticsOnly = isLogisticsOnlyMode(effectiveBoxMode);

    if (boxesRequired && !isLogisticsOnly) {
      const { boxes, remainder, capacity } = calculateBoxes(line.skuCode, line.packQty, effectiveBoxMode, boxCapacityMap);
      boxesPcs = boxes;
      boxType = effectiveBoxMode;
      if (remainder > 0 && capacity) {
        lastBoxFill = `${remainder}/${capacity}`;
      }
    }

    return {
      eggsButir,
      eggProduct: sku.eggProduct,
      packagingPcs: line.packQty,
      packagingItem: sku.packagingItem,
      boxesPcs,
      boxType,
      isLogisticsOnly,
      lastBoxFill,
    };
  }

  if (line.lineType === "loose") {
    if (!line.eggProduct || !line.looseQty || line.looseQty <= 0) {
      return null;
    }

    // Convert to butir if needed
    let eggsButir = line.looseQty;
    if (line.looseUnit === "kg") {
      const config = conversionMap[line.eggProduct];
      if (config && config.unit === "kg") {
        eggsButir = Math.round(line.looseQty * config.eggs_per_unit);
      }
    }

    // Tray calculation for loose eggs (30 eggs per tray)
    const effectiveBoxMode = line.boxModeOverride || boxMode;
    const traysUsed = effectiveBoxMode === "tray" ? Math.ceil(eggsButir / 30) : 0;

    return {
      eggsButir,
      eggProduct: line.eggProduct,
      packagingPcs: 0,
      packagingItem: "",
      boxesPcs: 0,
      boxType: null,
      isLogisticsOnly: true,
      traysUsed,
    };
  }

  return null;
}

// Aggregate materials from multiple order lines - now accepts dynamic SKU list
export function aggregateOrderMaterials(
  lines: OrderLine[],
  boxMode: BoxModeType,
  boxesRequired: boolean,
  skus: PackSKU[] = [],
  conversionMap: ConversionMap = CONVERSION_DICT,
  boxCapacityMap: BoxCapacityMap = BOX_CAPACITIES
): AggregatedMaterials {
  const eggsByProduct = new Map<string, number>();
  const packagingByItem = new Map<string, number>();
  const boxesByType = new Map<string, number>();
  let hasKeranjang = false;
  let totalTrays = 0;

  for (const line of lines) {
    const materials = calculateLineMaterials(line, boxMode, boxesRequired, skus, conversionMap, boxCapacityMap);
    if (!materials) continue;

    // Aggregate eggs
    const currentEggs = eggsByProduct.get(materials.eggProduct) || 0;
    eggsByProduct.set(materials.eggProduct, currentEggs + materials.eggsButir);

    // Aggregate packaging (only for pack lines)
    if (materials.packagingItem && materials.packagingPcs > 0) {
      const currentPkg = packagingByItem.get(materials.packagingItem) || 0;
      packagingByItem.set(materials.packagingItem, currentPkg + materials.packagingPcs);
    }

    // Aggregate boxes (only for inventory box types)
    if (materials.boxType && materials.boxesPcs > 0 && !materials.isLogisticsOnly) {
      const currentBoxes = boxesByType.get(materials.boxType) || 0;
      boxesByType.set(materials.boxType, currentBoxes + materials.boxesPcs);
    }

    // Track logistics
    const effectiveBoxMode = line.boxModeOverride || boxMode;
    if (effectiveBoxMode === "keranjang") {
      hasKeranjang = true;
    }
    if (materials.traysUsed) {
      totalTrays += materials.traysUsed;
    }
  }

  return {
    eggsByProduct,
    packagingByItem,
    boxesByType,
    logistics: { keranjang: hasKeranjang, traysUsed: totalTrays },
  };
}

// Validate stock availability
export function validateStockAgainstInventory(
  aggregates: AggregatedMaterials,
  stockSummary: StockSummary[]
): StockShortage[] {
  const shortages: StockShortage[] = [];

  // Check eggs
  for (const [product, required] of aggregates.eggsByProduct) {
    const stock = stockSummary.find(s => s.product === product && s.category === "egg");
    const available = stock?.totalStock || 0;
    if (required > available) {
      shortages.push({
        category: "egg",
        item: product,
        required,
        available,
        shortage: required - available,
      });
    }
  }

  // Check packaging
  for (const [item, required] of aggregates.packagingByItem) {
    const stock = stockSummary.find(s => s.product === item && s.category === "packaging");
    const available = stock?.totalStock || 0;
    if (required > available) {
      shortages.push({
        category: "packaging",
        item,
        required,
        available,
        shortage: required - available,
      });
    }
  }

  // Check boxes
  for (const [boxType, required] of aggregates.boxesByType) {
    const stock = stockSummary.find(s => s.product === boxType && s.category === "box");
    const available = stock?.totalStock || 0;
    if (required > available) {
      shortages.push({
        category: "box",
        item: boxType,
        required,
        available,
        shortage: required - available,
      });
    }
  }

  return shortages;
}

// Get available box modes for a buyer
export function getAvailableBoxModes(buyerName: string): BoxModeType[] {
  const defaultMode = BUYER_BOX_MODES[buyerName] || "box kecil";
  
  // Osave can switch between box osave and box osave polos
  if (buyerName === "Osave") {
    return ["box osave", "box osave polos"];
  }
  
  // Return the default mode
  return [defaultMode];
}

// Check if a SKU is supported for a box mode
export function isSKUSupportedForBoxMode(
  skuCode: string,
  boxMode: BoxModeType,
  boxCapacityMap: BoxCapacityMap = BOX_CAPACITIES
): boolean {
  if (isLogisticsOnlyMode(boxMode)) return true;
  return !!boxCapacityMap[boxMode]?.[skuCode];
}
