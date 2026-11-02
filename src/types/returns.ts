import { InventoryCategory } from "./inventory";

// A return is always linked to the original outflow row it came from.
// disposition drives whether stock moves:
//   - "restock"  -> good eggs go back into the outflow's original FIFO batches
//   - "writeoff" -> broken/scrapped; logged only, no stock change
export type ReturnDisposition = "restock" | "writeoff" | "retakan";

// One returned line the user is entering, tied to a specific outflow row.
export interface ReturnLineInput {
  // Client-generated UUID -> idempotent RPC replay (mirrors record_order_outflows).
  id: string;
  outflowId: string;
  product: string;
  category: InventoryCategory;
  // Returned amount in the product's NATIVE unit (kg / butir / pcs) — no conversions.
  quantity: number;
  disposition: ReturnDisposition;
  // The pack SKU this return was entered under (null for loose/manual returns),
  // so the feed can attribute a pooled-egg return to its order line.
  skuCode?: string;
  // The non-voided sum of returns on this outflow row (native, all SKUs) the
  // client displayed; record_return refuses with PRIOR_MISMATCH when it moved.
  expectedPrior?: number;
}

export interface RecordReturnInput {
  returnDate: string; // YYYY-MM-DD, when it physically came back
  buyerName?: string; // denormalized snapshot for retur-per-customer reporting
  reason?: string;
  lines: ReturnLineInput[];
}
