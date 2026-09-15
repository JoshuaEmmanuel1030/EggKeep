// Per-SKU bill-of-materials reconstruction for the Activities outflow export.
//
// The activity log stores one row PER COMPONENT PRODUCT, with the raw-material
// consumption aggregated at the ORDER level (metadata.relatedProducts) plus the
// SKU list the customer ordered (metadata.orderLines). That means the per-SKU
// breakdown is NOT recoverable from the stored rows alone — two SKUs sharing an
// egg or packaging item collapse into one combined figure.
//
// So we RECONSTRUCT it: group logs back into orders, then re-run the same recipe
// expansion the outflow builder uses (`calculateLineMaterials`) on each ordered
// SKU line. One export row per SKU line, columns = eggs + packaging + boxes +
// labels consumed.
//
// ponytail: recompute uses the CURRENT catalog recipe. If an eggs_per_unit / pack
// recipe changed after an order, the recomputed egg qty is a faithful estimate,
// not the exact historical deduction (the stored relatedProducts is the truth).
// Snapshot the recipe per order at save time if penny-exact history is needed.
import { ActivityLog } from "@/types/activityLog";
import { ConversionMap } from "@/types/inventory";
import { OrderLine, BoxModeType } from "@/types/quickOutflow";
import { orderBucketKey } from "@/lib/activityGrouping";
import {
  calculateLineMaterials,
  PackSKU,
  BoxCapacityMap,
  LabelsPerPackMap,
} from "@/lib/outflowCalculator";

export interface SkuBomRow {
  date: string;
  buyer: string;
  invoice: string;
  boxMode: string;
  lineType: "pack" | "loose" | "legacy";
  sku: string;
  skuName: string;
  packQty: number | "";
  eggProduct: string;
  eggQty: number | "";
  eggUnit: string;
  packagingItem: string;
  packagingQty: number | "";
  boxType: string;
  boxes: number | "";
  labelItem: string;
  labels: number | "";
  voided: boolean;
}

const HEADERS = [
  "Date", "Buyer", "Invoice", "Box Mode", "Line Type",
  "SKU", "SKU Name", "Pack Qty",
  "Egg Product", "Egg Qty", "Egg Unit",
  "Packaging Item", "Packaging Qty",
  "Box Type", "Boxes",
  "Label Item", "Labels",
  "Voided",
];

/** Reconstruct per-SKU BOM rows from outflow activity logs. */
export function buildSkuBomRows(
  logs: ActivityLog[],
  skus: PackSKU[],
  conversionMap: ConversionMap,
  boxCapacityMap: BoxCapacityMap,
  labelsPerPackMap: LabelsPerPackMap,
): SkuBomRow[] {
  const unitOf = (product: string) =>
    conversionMap[product]?.unit === "kg" ? "kg" : "butir";

  // Group component rows back into their originating orders.
  const groups = new Map<string, ActivityLog[]>();
  for (const log of logs) {
    if (log.action_type !== "outflow") continue;
    const key = orderBucketKey({
      buyerName: log.metadata?.buyerName,
      orderLines: log.metadata?.orderLines,
      outflowDate: log.metadata?.outflowDate ?? null,
      recordedAt: log.recorded_at,
    });
    const bucket = groups.get(key);
    if (bucket) bucket.push(log);
    else groups.set(key, [log]);
  }

  const rows: SkuBomRow[] = [];
  for (const group of groups.values()) {
    const rep = group[0];
    const md = rep.metadata ?? {};
    const boxMode = (md.boxMode as BoxModeType) || "plastic";
    // Boxes were physically deducted only when the order produced a box row
    // (logistics modes — keranjang/tray/plastic — never do). Mirror that.
    const boxesRequired = group.some((l) => l.category === "box");
    const base = {
      date: (md.outflowDate || rep.recorded_at).slice(0, 10),
      buyer: md.buyerName || rep.invoice_supplier || "",
      invoice: md.invoiceRef || rep.invoice_supplier || "",
      boxMode,
      voided: group.every((l) => l.voided_at != null),
    };
    const blank = {
      sku: "", skuName: "", packQty: "" as const,
      eggProduct: "", eggQty: "" as const, eggUnit: "",
      packagingItem: "", packagingQty: "" as const,
      boxType: "", boxes: "" as const, labelItem: "", labels: "" as const,
    };

    const lines = md.orderLines ?? [];
    if (lines.length > 0) {
      for (const line of lines) {
        if (line.skuCode) {
          const sku = skus.find((s) => s.code === line.skuCode);
          const ol: OrderLine = {
            id: "",
            lineType: "pack",
            skuCode: line.skuCode,
            packQty: line.packQty,
          };
          const m = calculateLineMaterials(
            ol, boxMode, boxesRequired, skus, conversionMap, boxCapacityMap, labelsPerPackMap,
          );
          if (m) {
            rows.push({
              ...base, lineType: "pack",
              sku: line.skuCode, skuName: sku?.displayName ?? "",
              packQty: line.packQty ?? "",
              eggProduct: m.eggProduct, eggQty: m.eggsButir, eggUnit: unitOf(m.eggProduct),
              packagingItem: m.packagingItem, packagingQty: m.packagingPcs,
              boxType: m.boxType ?? "", boxes: m.boxesPcs,
              labelItem: m.labelItem ?? "", labels: m.labelPcs,
            });
          } else {
            // Unknown/retired SKU — surface the line rather than dropping it.
            rows.push({
              ...base, ...blank, lineType: "pack",
              sku: line.skuCode, skuName: sku?.displayName ?? "",
              packQty: line.packQty ?? "",
            });
          }
        } else if (line.eggProduct) {
          // Loose egg line: no packaging/box. looseUnit isn't stored, so eggQty
          // is the recorded looseQty and Egg Unit shows the product's native unit.
          rows.push({
            ...base, ...blank, lineType: "loose",
            eggProduct: line.eggProduct, eggQty: line.looseQty ?? "",
            eggUnit: unitOf(line.eggProduct),
          });
        }
      }
    } else {
      // Legacy/manual outflow with no orderLines: pass through the egg rows as-is.
      for (const l of group) {
        if (l.category !== "egg") continue;
        rows.push({
          ...base, ...blank, lineType: "legacy",
          eggProduct: l.product, eggQty: l.quantity_butir, eggUnit: unitOf(l.product),
        });
      }
    }
  }

  return rows;
}

const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;

export function skuBomRowsToCSV(rows: SkuBomRow[]): string {
  const body = rows.map((r) =>
    [
      r.date, r.buyer, r.invoice, r.boxMode, r.lineType,
      r.sku, r.skuName, r.packQty,
      r.eggProduct, r.eggQty, r.eggUnit,
      r.packagingItem, r.packagingQty,
      r.boxType, r.boxes,
      r.labelItem, r.labels,
      r.voided ? "YES" : "NO",
    ].map(esc).join(","),
  );
  return [HEADERS.map(esc).join(","), ...body].join("\n");
}
