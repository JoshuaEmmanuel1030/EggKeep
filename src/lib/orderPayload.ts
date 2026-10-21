// Turns a Purchase Order (buyer, DC, date, invoice, lines + their aggregated
// materials) into the stock entries sent to record_order_outflows and the
// activity-log rows written for it. Shared by the order builder and the
// "Edit order" correction, so an edit deducts exactly what a new order would.
import type { OutflowEntry } from "@/types/inventory";
import type { ActivityLogMetadata } from "@/types/activityLog";
import type { AggregatedMaterials, OrderLine } from "@/types/quickOutflow";

export interface OrderPayloadInput {
  buyerName: string;
  invoiceRef?: string;
  date: string; // business/delivery date, yyyy-MM-dd
  dcId?: string;
  dcName?: string;
  lines: OrderLine[];
  aggregates: AggregatedMaterials;
}

// One stock entry per egg product, packaging item, label item and box type.
export function buildOrderEntries(
  order: OrderPayloadInput,
  timestamp: string,
  newId: () => string = () => crypto.randomUUID()
): OutflowEntry[] {
  const invoiceSupplier = order.invoiceRef || `${order.buyerName} - Order`;
  const groups: [Map<string, number>, OutflowEntry["category"]][] = [
    [order.aggregates.eggsByProduct, "egg"],
    [order.aggregates.packagingByItem, "packaging"],
    [order.aggregates.labelsByItem, "label"],
    [order.aggregates.boxesByType, "box"],
  ];
  const entries: OutflowEntry[] = [];
  for (const [byProduct, category] of groups) {
    for (const [product, quantity] of byProduct) {
      entries.push({
        id: newId(),
        date: order.date,
        product,
        quantityInButir: quantity,
        createdAt: timestamp,
        category,
        invoiceSupplier,
      });
    }
  }
  return entries;
}

// Metadata stored on every activity-log row of the order.
export function buildOrderMetadata(order: OrderPayloadInput): ActivityLogMetadata {
  const relatedProducts: Array<{ product: string; quantity: number; type: string }> = [];
  for (const [product, qty] of order.aggregates.eggsByProduct) relatedProducts.push({ product, quantity: qty, type: "egg" });
  for (const [item, qty] of order.aggregates.packagingByItem) relatedProducts.push({ product: item, quantity: qty, type: "packaging" });
  for (const [item, qty] of order.aggregates.labelsByItem) relatedProducts.push({ product: item, quantity: qty, type: "label" });
  for (const [type, qty] of order.aggregates.boxesByType) relatedProducts.push({ product: type, quantity: qty, type: "box" });

  const packLine = order.lines.find((l) => l.lineType === "pack" && l.skuCode);

  // What the customer ordered. looseUnit / labelSelection are kept (only when
  // set) so an edit can rebuild exactly the same materials.
  const orderLines = order.lines
    .filter((l) => (l.lineType === "pack" && l.skuCode) || (l.lineType === "loose" && l.eggProduct))
    .map((l) => ({
      skuCode: l.skuCode,
      packQty: l.packQty,
      eggProduct: l.eggProduct,
      looseQty: l.looseQty,
      ...(l.lineType === "loose" && l.looseUnit ? { looseUnit: l.looseUnit } : {}),
      ...(l.labelSelection ? { labelSelection: l.labelSelection } : {}),
    }));

  return {
    orderType: "quick_outflow",
    buyerName: order.buyerName,
    invoiceRef: order.invoiceRef || undefined,
    skuCode: packLine?.skuCode,
    packQty: packLine?.packQty,
    dcId: order.dcId,
    dcName: order.dcName,
    outflowDate: order.date,
    orderLines,
    relatedProducts,
  };
}

// The activity-log rows for an order's entries (one per entry, linked by
// relatedEntryId). Same shape the Orders page writes after a successful RPC.
export function toOutflowLogPayloads(
  entries: OutflowEntry[],
  userEmail: string,
  metadata: ActivityLogMetadata | undefined,
  recordedAt: string
) {
  return entries.map((entry) => ({
    action_type: "outflow" as const,
    product: entry.product,
    quantity_butir: entry.quantityInButir,
    recorded_at: recordedAt,
    category: entry.category,
    invoice_supplier: entry.invoiceSupplier,
    user_email: userEmail,
    metadata: { ...metadata, relatedEntryId: entry.id },
  }));
}

// record_order_outflows' p_entries shape (quantity in each product's native unit).
export function toRpcEntries(entries: OutflowEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    date: entry.date,
    product: entry.product,
    quantity_butir: entry.quantityInButir,
    category: entry.category,
    invoice_supplier: entry.invoiceSupplier || null,
  }));
}
