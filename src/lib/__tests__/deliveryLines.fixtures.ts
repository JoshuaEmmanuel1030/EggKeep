// Shared Phase 2 fixtures for the delivery-line tests (sheet rows of October).
import type { Delivery, DeliveryLine, DeliveryPo } from "@/types/deliveries";
import type { ReturnRow } from "@/lib/returnsSummary";

export const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  id: "d1",
  invoiceRef: "2610319",
  invoiceRefNorm: "2610319",
  buyerName: "Osave",
  dcName: "DPK",
  deliveryDate: "2026-10-19",
  driverId: null,
  driverName: "Hendi",
  status: "terkirim",
  invoiceReturnedAt: "2026-10-20",
  invoiceCheckedBy: "yani@js.id",
  pic: "dila@js.id",
  notes: null,
  createdAt: "2026-10-19T01:00:00.000Z",
  updatedAt: "2026-10-19T01:00:00.000Z",
  ...over,
});

export const po = (over: Partial<DeliveryPo> = {}): DeliveryPo => ({
  invoiceRef: "2610319",
  buyerName: "Osave",
  dcName: "DPK",
  outflowDate: "2026-10-19",
  recordedAt: "2026-10-19T01:00:00.000Z",
  orderLines: [
    { skuCode: "OSVN10B", packQty: 86 },
    { skuCode: "OSVN10O", packQty: 33 },
  ],
  eggTotals: [
    { product: "NEGERI BIASA", quantity: 998.71, outflowId: "of-nb" },
    { product: "NEGERI OMEGA", quantity: 383.23, outflowId: "of-no" },
  ],
  ...over,
});

let n = 0;
export const line = (over: Partial<DeliveryLine> = {}): DeliveryLine => ({
  id: `l${++n}`,
  deliveryId: "d1",
  skuCode: "OSVN10B",
  unitLabel: "box",
  piecesPerUnit: 180,
  quantity: 7,
  reason: "pecah",
  note: null,
  claimRef: "OSV-2610037",
  claimRefNorm: "OSV-2610037",
  expectedExpiry: "2026-11-19",
  source: "app",
  createdBy: null,
  createdAt: "2026-10-20T01:00:00.000Z",
  updatedAt: "2026-10-20T01:00:00.000Z",
  ...over,
});

export const ret = (over: Partial<ReturnRow> = {}): ReturnRow => ({
  id: `r${++n}`,
  outflow_id: "of-nb",
  sku_code: "OSVN10B",
  product: "NEGERI BIASA",
  category: "egg",
  quantity: 70.19,
  disposition: "restock",
  reason: "pecah",
  return_date: "2026-10-20",
  created_at: "2026-10-20T02:00:00.000Z",
  user_id: "u-dila",
  user_email: "dila@js.id",
  voided_at: null,
  void_reason: null,
  voided_by: null,
  ...over,
});

export const KG = { "NEGERI BIASA": "kg", "NEGERI OMEGA": "kg" } as Record<string, string | undefined>;
