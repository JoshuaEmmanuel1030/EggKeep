export type InventoryCategory = "egg" | "box" | "label" | "packaging";

export interface ProductConfig {
  unit: "kg" | "btr";
  eggs_per_unit: number;
}

export interface ItemType {
  id: string;
  category: InventoryCategory;
  name: string;
}

export interface InflowEntry {
  id: string;
  date: string;
  product: string;
  quantity: number;
  unit: string;
  quantityInButir: number;
  remainingButir: number;
  createdAt: string;
  category: InventoryCategory;
  invoiceSupplier?: string;
  voidedAt?: string;
  voidReason?: string;
}

export interface OutflowEntry {
  id: string;
  date: string;
  product: string;
  quantityInButir: number;
  createdAt: string;
  category: InventoryCategory;
  invoiceSupplier?: string;
  voidedAt?: string;
  voidReason?: string;
}

export interface BatchDetail {
  id: string;
  date: string;
  invoiceSupplier: string | null;
  quantity: number;        // remaining butir
  originalQuantity: number; // original butir when inflowed
  daysInWarehouse: number;
  isAtRisk: boolean;
}

export interface StockSummary {
  product: string;
  totalStock: number;
  oldestDate: string | null;
  maxDaysInWarehouse: number;
  isAtRisk: boolean;
  category: InventoryCategory;
  atRiskQuantity: number;
  safeQuantity: number;
  batches: BatchDetail[];
}

export interface InflowItem {
  id: string;
  product: string;
  quantity: number;
  invoiceSupplier: string;
}

export interface CategoryInflowData {
  category: InventoryCategory;
  items: InflowItem[];
}

export interface OutflowItem {
  id: string;
  product: string;
  quantity: number;
  invoiceSupplier: string;
}

export interface CategoryOutflowData {
  category: InventoryCategory;
  items: OutflowItem[];
}

export const CONVERSION_DICT: Record<string, ProductConfig> = {
  "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
  "NEGERI OMEGA": { unit: "kg", eggs_per_unit: 15.5 },
  "KAMPUNG BIASA": { unit: "btr", eggs_per_unit: 1 },
  "KAMPUNG MERAH": { unit: "btr", eggs_per_unit: 1 },
  "BEBEK TAWAR": { unit: "btr", eggs_per_unit: 1 },
  "ASIN MATENG": { unit: "btr", eggs_per_unit: 1 },
  "ASIN MENTAH": { unit: "btr", eggs_per_unit: 1 },
  "PUYUH": { unit: "btr", eggs_per_unit: 1 },
  "KUNING MANIK": { unit: "btr", eggs_per_unit: 1 },
};

export const PRODUCT_NAMES = Object.keys(CONVERSION_DICT);

export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  egg: "Eggs",
  box: "Boxes",
  label: "Labels",
  packaging: "Packaging",
};
