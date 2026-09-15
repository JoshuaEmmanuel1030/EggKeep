import { describe, it, expect } from "vitest";
import { buildSkuBomRows, skuBomRowsToCSV } from "@/lib/outflowSkuExport";
import { ActivityLog } from "@/types/activityLog";
import { PackSKU, BoxCapacityMap, LabelsPerPackMap } from "@/lib/outflowCalculator";
import { ConversionMap } from "@/types/inventory";

const skus: PackSKU[] = [
  { code: "N10O", displayName: "Osave Negeri 10", eggsPerPack: 10, eggProduct: "NEGERI OMEGA", packagingItem: "NEGERI ISI 10" },
];
const conversionMap: ConversionMap = {
  "NEGERI OMEGA": { unit: "kg", eggs_per_unit: 15 },
};
const boxCapacityMap: BoxCapacityMap = { "box osave": { N10O: 18 } };
const labelsPerPackMap: LabelsPerPackMap = {};

// One order = the component rows record_order_outflows writes, all sharing the
// same orderLines/boxMode metadata and recorded_at.
function orderLogs(): ActivityLog[] {
  const meta = {
    orderType: "quick_outflow" as const,
    buyerName: "Osave",
    invoiceRef: "INV-1",
    boxMode: "box osave",
    outflowDate: "2026-09-12",
    orderLines: [{ skuCode: "N10O", packQty: 180 }],
  };
  const common = {
    user_id: "u", action_type: "outflow" as const, recorded_at: "2026-09-12T03:00:00.000Z",
    created_at: "2026-09-12T03:00:00.000Z", client_id: "c", metadata: meta,
  };
  return [
    { ...common, id: "1", product: "NEGERI OMEGA", quantity_butir: 120, category: "egg" },
    { ...common, id: "2", product: "NEGERI ISI 10", quantity_butir: 180, category: "packaging" },
    { ...common, id: "3", product: "box osave", quantity_butir: 10, category: "box" },
  ];
}

describe("buildSkuBomRows", () => {
  it("reconstructs the per-SKU BOM: 180 packs -> 120kg eggs, 180 packaging, 10 boxes", () => {
    const rows = buildSkuBomRows(orderLogs(), skus, conversionMap, boxCapacityMap, labelsPerPackMap);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.sku).toBe("N10O");
    expect(r.packQty).toBe(180);
    expect(r.eggProduct).toBe("NEGERI OMEGA");
    expect(r.eggQty).toBe(120); // 180*10 / 15
    expect(r.eggUnit).toBe("kg");
    expect(r.packagingQty).toBe(180);
    expect(r.boxType).toBe("box osave");
    expect(r.boxes).toBe(10); // ceil(180/18)
  });

  it("passes through legacy/manual outflows that have no orderLines", () => {
    const legacy: ActivityLog[] = [{
      id: "9", user_id: "u", action_type: "outflow", product: "KAMPUNG MERAH",
      quantity_butir: 500, category: "egg", recorded_at: "2026-09-10T01:00:00.000Z",
      created_at: "2026-09-10T01:00:00.000Z", client_id: "c",
      metadata: { buyerName: "Walk-in" },
    }];
    const rows = buildSkuBomRows(legacy, skus, conversionMap, boxCapacityMap, labelsPerPackMap);
    expect(rows).toHaveLength(1);
    expect(rows[0].lineType).toBe("legacy");
    expect(rows[0].eggProduct).toBe("KAMPUNG MERAH");
    expect(rows[0].eggQty).toBe(500);
    expect(rows[0].eggUnit).toBe("butir");
  });

  it("serializes to CSV with a header row", () => {
    const csv = skuBomRowsToCSV(buildSkuBomRows(orderLogs(), skus, conversionMap, boxCapacityMap, labelsPerPackMap));
    const lines = csv.split("\n");
    expect(lines[0]).toContain("SKU");
    expect(lines[0]).toContain("Boxes");
    expect(lines).toHaveLength(2);
  });
});
