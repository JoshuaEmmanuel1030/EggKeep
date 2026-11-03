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

// Aturan Expired: a day rule or a calendar-month rule (exactly one is set).
export interface ExpiryRule {
  id: string;
  buyerKeyword: string | null;
  skuCode: string | null; // base pack code (N10B, KP6O, ...)
  shelfDays: number | null;
  shelfMonths: number | null;
  note: string | null;
}

// Alasan Retur, stored as the code (delivery_lines.reason). Spec Phase 2 §4.3.
export const RETURN_REASONS = [
  "pecah",
  "rusak",
  "ditolak",
  "expired",
  "tukar_guling",
  "lainnya",
  "kurang",
  "lebih",
  "revisi_po",
  "cancel",
  "masih_ditanyakan",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

// One delivery_lines row: the store side of one (SKU, reason) on a faktur.
// Nothing stock-side is stored here; warehouse figures derive from `returns`.
export interface DeliveryLine {
  id: string;
  deliveryId: string;
  skuCode: string;
  unitLabel: "pak" | "box";
  piecesPerUnit: number;
  quantity: number;
  reason: string;
  note: string | null;
  claimRef: string | null;
  claimRefNorm: string | null;
  expectedExpiry: string | null; // yyyy-MM-dd
  source: "app" | "sheet_import";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// Non-voided returns for a physical-return line's SKU on the PO's egg outflow rows.
export interface LineReturnSummary {
  okPieces: number;
  pecahPieces: number; // retakan + writeoff
  restockNative: number;
  retakanNative: number;
  writeoffNative: number;
  firstReturnDate: string | null;
  lastUserEmail: string | null;
}

export interface DeliveryLineView extends DeliveryLine {
  piecesTotal: number; // quantity x piecesPerUnit
  physical: boolean;
  returns: LineReturnSummary | null; // physical-return line only
  mismatch: boolean; // returned pieces != piecesTotal
  poQty: number | null; // the PO's quantity of this SKU, in the line's unit
}

export interface LineSummary {
  lineCount: number;
  awaitingCount: number;
  needsRefCount: number;
  pecahWithoutRef: number;
  kurangPieces: number;
  unresolvedCount: number;
  claimRowCount: number;
  full: boolean;
}

// The Purchase Order side of a delivery, read from the purchase_orders view.
export interface DeliveryPo {
  invoiceRef: string;
  buyerName: string;
  dcName: string | null;
  outflowDate: string; // yyyy-MM-dd
  recordedAt: string;
  orderLines: PurchaseOrderLine[];
  // One per egg outflow row; outflowId null on legacy rows without relatedEntryId.
  eggTotals: { product: string; quantity: number; outflowId: string | null }[];
}

// Phase 1 flags (same logic as the open_delivery_items view) plus the Phase 2
// line flags (from tables, never in the badge).
export interface DeliveryFlags {
  notLogged: boolean;
  invoiceNotBack: boolean;
  awaitingWarehouse: boolean; // orange
  needsClaimRef: boolean; // red
  unresolved: boolean; // Masih ditanyakan
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
  lines: DeliveryLineView[];
  lineSummary: LineSummary;
  requiresClaimRef: boolean;
}

// One export row = one delivery line (or one row for a faktur with none), in
// the sheet's 21 columns.
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
  piecesPecah: number | null;
  warehouseCheckedBy: string;
  claimRef: string;
  claimStatus: string;
}

// One row of the claim CSV (the sheet's "Klaim Retur OSV" tab).
export interface ClaimCsvRow {
  deliveryDate: string;
  invoiceRef: string;
  customer: string;
  skuCode: string;
  qtyReturnedPack: number;
  reason: string;
  expectedExpiry: string | null;
  piecesPecah: number | null;
  claimRef: string;
  claimStatus: string;
}
