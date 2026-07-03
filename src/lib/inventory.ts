import { parseISO } from "date-fns";
import { InflowEntry, OutflowEntry, StockSummary, CONVERSION_DICT, ConversionMap, InventoryCategory, BatchDetail } from "@/types/inventory";

export const EGG_FRESHNESS_DAYS = 5;

const INFLOW_KEY = "js_online_inflow";
const OUTFLOW_KEY = "js_online_outflow";

export function loadInflows(): InflowEntry[] {
  const data = localStorage.getItem(INFLOW_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveInflows(entries: InflowEntry[]): void {
  localStorage.setItem(INFLOW_KEY, JSON.stringify(entries));
}

export function loadOutflows(): OutflowEntry[] {
  const data = localStorage.getItem(OUTFLOW_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveOutflows(entries: OutflowEntry[]): void {
  localStorage.setItem(OUTFLOW_KEY, JSON.stringify(entries));
}

// ============================================================================
// STOCK UNITS (kg-native design)
// The quantity_butir / remaining_butir columns hold each product's NATIVE stock
// unit: kg for weight-sold eggs, butir for count-sold eggs, pcs for everything
// else. (Non-egg categories always worked this way; kg eggs joined them in the
// 2026-07 kg-native cutover.) The conversion factor is only used at the edges:
// pack sales of kg eggs (eggs -> estimated kg) and butir-equivalent estimates
// on aggregate displays.
// ============================================================================

/** The unit a product's stock is stored and deducted in. */
export function getStockUnit(
  product: string,
  category: InventoryCategory,
  conversionMap: ConversionMap = CONVERSION_DICT
): "kg" | "butir" | "pcs" {
  if (category !== "egg") return "pcs";
  return conversionMap[product]?.unit === "kg" ? "kg" : "butir";
}

/** Convert an entered quantity to the product's native stock units. */
export function toStockUnits(
  product: string,
  quantity: number,
  enteredUnit: "kg" | "butir",
  conversionMap: ConversionMap = CONVERSION_DICT
): number {
  const config = conversionMap[product];
  const isKgProduct = config?.unit === "kg" && config.eggs_per_unit > 0;
  if (isKgProduct && enteredUnit === "butir") {
    // Estimated weight of a counted quantity.
    return Math.round((quantity / config.eggs_per_unit) * 100) / 100;
  }
  if (!isKgProduct && enteredUnit === "kg" && config && config.eggs_per_unit > 0) {
    return Math.round(quantity * config.eggs_per_unit);
  }
  return quantity; // already native
}

/** Butir-equivalent estimate for aggregate displays (kg stock × eggs/kg). */
export function butirEquivalent(
  product: string,
  stockQuantity: number,
  conversionMap: ConversionMap = CONVERSION_DICT
): number {
  const config = conversionMap[product];
  if (config?.unit === "kg" && config.eggs_per_unit > 0) {
    return Math.round(stockQuantity * config.eggs_per_unit);
  }
  return stockQuantity;
}

export function convertToButir(
  product: string,
  quantity: number,
  conversionMap: ConversionMap = CONVERSION_DICT
): number {
  const config = conversionMap[product];
  if (!config) return quantity; // For non-egg items, quantity = butir
  return Math.round(quantity * config.eggs_per_unit);
}

export function getProductUnit(
  product: string,
  conversionMap: ConversionMap = CONVERSION_DICT
): string {
  const config = conversionMap[product];
  return config?.unit === "kg" ? "kg" : "pcs";
}

export function isEggProduct(
  product: string,
  conversionMap: ConversionMap = CONVERSION_DICT
): boolean {
  return product in conversionMap;
}


export function processOutflowFIFO(
  inflows: InflowEntry[],
  product: string,
  quantityToRemove: number
): InflowEntry[] {
  const updatedInflows = [...inflows];
  let remaining = quantityToRemove;

  // Sort by date (oldest first) for FIFO
  const productInflows = updatedInflows
    .filter((i) => i.product === product && i.remainingButir > 0)
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

  for (const inflow of productInflows) {
    if (remaining <= 0) break;

    const index = updatedInflows.findIndex((i) => i.id === inflow.id);
    if (index === -1) continue;

    const available = updatedInflows[index].remainingButir;
    const toDeduct = Math.min(available, remaining);

    updatedInflows[index] = {
      ...updatedInflows[index],
      remainingButir: available - toDeduct,
    };

    remaining -= toDeduct;
  }

  return updatedInflows;
}

export function calculateStockSummary(
  inflows: InflowEntry[],
  conversionMap: ConversionMap = CONVERSION_DICT,
  // Per-product freshness windows (days) from the catalog; anything not listed
  // falls back to EGG_FRESHNESS_DAYS. Lets long-lived eggs (e.g. salted) stop
  // showing as "at risk" after the generic 5 days.
  freshnessDaysByProduct: Record<string, number> = {}
): StockSummary[] {
  const today = new Date();
  const freshnessLimit = (product: string) =>
    freshnessDaysByProduct[product] ?? EGG_FRESHNESS_DAYS;
  const productMap = new Map<string, { 
    total: number; 
    oldestDate: string | null; 
    category: InventoryCategory;
    atRiskQuantity: number;
    safeQuantity: number;
    batches: BatchDetail[];
  }>();

  // Initialize egg products
  Object.keys(conversionMap).forEach((product) => {
    productMap.set(product, { 
      total: 0, 
      oldestDate: null, 
      category: 'egg',
      atRiskQuantity: 0,
      safeQuantity: 0,
      batches: []
    });
  });

  // Calculate totals, oldest dates, and batch details for all products
  inflows
    .filter((i) => i.remainingButir > 0)
    .forEach((inflow) => {
      const current = productMap.get(inflow.product) || { 
        total: 0, 
        oldestDate: null, 
        category: inflow.category,
        atRiskQuantity: 0,
        safeQuantity: 0,
        batches: []
      };
      
      const inflowDate = parseISO(inflow.date);
      const daysInWarehouse = Math.floor((today.getTime() - inflowDate.getTime()) / (1000 * 60 * 60 * 24));
      const isAtRisk = inflow.category === 'egg' && daysInWarehouse > freshnessLimit(inflow.product);
      
      const batch: BatchDetail = {
        id: inflow.id,
        date: inflow.date,
        invoiceSupplier: inflow.invoiceSupplier || null,
        quantity: inflow.remainingButir,
        originalQuantity: inflow.quantityInButir,
        daysInWarehouse,
        isAtRisk
      };
      
      const newTotal = current.total + inflow.remainingButir;
      const newOldest =
        !current.oldestDate || parseISO(inflow.date) < parseISO(current.oldestDate)
          ? inflow.date
          : current.oldestDate;

      productMap.set(inflow.product, { 
        total: newTotal, 
        oldestDate: newOldest, 
        category: inflow.category,
        atRiskQuantity: current.atRiskQuantity + (isAtRisk ? inflow.remainingButir : 0),
        safeQuantity: current.safeQuantity + (isAtRisk ? 0 : inflow.remainingButir),
        batches: [...current.batches, batch]
      });
    });

  const summaries: StockSummary[] = [];

  productMap.forEach((data, product) => {
    let maxDays = 0;
    if (data.oldestDate) {
      const oldest = parseISO(data.oldestDate);
      maxDays = Math.floor((today.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Only eggs can be "at risk"
    const isAtRisk = data.category === 'egg' && maxDays > freshnessLimit(product);
    
    // Sort batches by date (oldest first - FIFO)
    const sortedBatches = data.batches.sort((a, b) => 
      parseISO(a.date).getTime() - parseISO(b.date).getTime()
    );

    summaries.push({
      product,
      totalStock: data.total,
      oldestDate: data.oldestDate,
      maxDaysInWarehouse: maxDays,
      isAtRisk,
      category: data.category,
      atRiskQuantity: data.atRiskQuantity,
      safeQuantity: data.safeQuantity,
      batches: sortedBatches,
    });
  });

  return summaries.sort((a, b) => b.totalStock - a.totalStock);
}

export function getTotalAvailableStock(inflows: InflowEntry[], product: string): number {
  return inflows
    .filter((i) => i.product === product && i.remainingButir > 0)
    .reduce((sum, i) => sum + i.remainingButir, 0);
}

export function exportInflowsToCSV(inflows: InflowEntry[]): string {
  const headers = ["ID", "Date", "Category", "Product", "Quantity", "Unit", "Stock Qty", "Remaining", "Invoice/Supplier", "Created At"];
  const rows = inflows.map((i) => [
    i.id,
    i.date,
    i.category,
    i.product,
    i.quantity.toString(),
    i.unit,
    i.quantityInButir.toString(),
    i.remainingButir.toString(),
    i.invoiceSupplier || "",
    i.createdAt,
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
