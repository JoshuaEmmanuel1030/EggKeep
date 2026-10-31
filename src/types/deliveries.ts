// Delivery & Return Log (Log Pengiriman & Retur), Phase 1 client types.
// Spec: docs/superpowers/specs/2026-10-29-delivery-return-log-design.md
import type { PurchaseOrderLine } from "@/lib/buyerProfile";

// Status Kirim — warehouse vocabulary, stored as-is in deliveries.status.
export const DELIVERY_STATUSES = ["belum_terkirim", "terkirim", "ditolak", "batal"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// Supir (Catalog → Supir).
export interface Driver {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

// One row per faktur / Purchase Order (deliveries table).
export interface Delivery {
  id: string;
  invoiceRef: string; // as typed on the PO
  invoiceRefNorm: string; // upper(trim(invoice_ref)), the join key
  buyerName: string; // snapshot
  dcName: string | null; // snapshot
  deliveryDate: string; // yyyy-MM-dd (Tgl Kirim = PO outflow_date)
  driverId: string | null;
  driverName: string | null; // snapshot for display/export
  status: DeliveryStatus;
  invoiceReturnedAt: string | null; // yyyy-MM-dd (Tgl Faktur Balik)
  invoiceCheckedBy: string | null; // Paraf Admin (user email)
  pic: string | null; // who logged it (user email)
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Aturan Expired (table + seed only in Phase 1).
export interface ExpiryRule {
  id: string;
  buyerKeyword: string | null;
  skuCode: string | null;
  shelfDays: number;
  note: string | null;
}

// The Purchase Order side of a delivery, read from the purchase_orders view.
export interface DeliveryPo {
  invoiceRef: string;
  buyerName: string;
  dcName: string | null;
  outflowDate: string; // yyyy-MM-dd
  recordedAt: string;
  orderLines: PurchaseOrderLine[];
}

// Phase 1 flags (same logic as the open_delivery_items view).
export interface DeliveryFlags {
  notLogged: boolean;
  invoiceNotBack: boolean;
}

// One list row on /deliveries: a PO left-joined to its delivery.
export interface DeliveryListItem {
  key: string;
  invoiceRef: string;
  invoiceRefNorm: string;
  buyerName: string;
  dcName: string | null;
  deliveryDate: string;
  po: DeliveryPo | null;
  delivery: Delivery | null;
  flags: DeliveryFlags;
  // Delivery row whose invoice_ref no longer matches any PO (edited via
  // correct_order, or the PO was voided) — "tidak cocok dengan PO".
  poMissing: boolean;
  // A second PO carrying an invoice_ref another PO already uses —
  // "No. Faktur sudah dipakai". Never auto-merged.
  duplicateInvoice: boolean;
}

// One export row = one line of the delivery_log view (Phase 2). Export v1 fills
// the first eight columns from `deliveries`; the rest stay blank until the
// delivery lines, warehouse receipt and claims land.
export interface DeliveryLogRow {
  pic: string;
  deliveryDate: string; // yyyy-MM-dd
  invoiceRef: string;
  customer: string; // "<buyer> <dc>"
  driverName: string;
  status: DeliveryStatus | null;
  invoiceReturnedAt: string | null; // yyyy-MM-dd
  invoiceCheckedBy: string;
  skuCode: string;
  qtyReceivedPack: number | null;
  qtyReturnedPack: number | null;
  full: boolean | null;
  reason: string;
  conditionNotes: string;
  returnedToWarehouseAt: string | null;
  expectedExpiry: string | null;
  piecesOk: number | null;
  piecesRetak: number | null;
  piecesPecah: number | null;
  warehouseCheckedBy: string;
  claimRef: string;
  claimStatus: string;
}
