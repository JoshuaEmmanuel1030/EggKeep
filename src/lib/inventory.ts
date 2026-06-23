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
  conversionMap: ConversionMap = CONVERSION_DICT
): StockSummary[] {
  const today = new Date();
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
      const isAtRisk = inflow.category === 'egg' && daysInWarehouse > EGG_FRESHNESS_DAYS;
      
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
    const isAtRisk = data.category === 'egg' && maxDays > EGG_FRESHNESS_DAYS;
    
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
  const headers = ["ID", "Date", "Category", "Product", "Quantity", "Unit", "Quantity (Butir)", "Remaining (Butir)", "Invoice/Supplier", "Created At"];
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
