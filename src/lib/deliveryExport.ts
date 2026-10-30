// Export v1 of the Delivery & Return Log: the delivery_log columns (Phase 2
// view) in the sheet's order, Indonesian headers, dd/mm/yyyy dates and decimal
// commas. Phase 1 emits one row per list item (every PO with a ref in the
// range, logged or not, plus deliveries with no live PO) with the per-line,
// warehouse and claim columns blank. Download goes through the existing
// downloadCSV helper (src/lib/inventory.ts).
// Spec: docs/superpowers/specs/2026-10-29-delivery-return-log-design.md §4.7, §5.5
import type { DeliveryListItem, DeliveryLogRow, DeliveryStatus } from "@/types/deliveries";
import { customerLabel } from "@/lib/deliveryFlags";

// Status Kirim as the sheet writes it. Fixed Indonesian, same in both locales.
export const DELIVERY_STATUS_LABEL_ID: Record<DeliveryStatus, string> = {
  belum_terkirim: "Belum Terkirim",
  terkirim: "Terkirim",
  ditolak: "Ditolak",
  batal: "Batal",
};

type ColumnKind = "text" | "date" | "number" | "status" | "bool";

// The sheet's header row, in order. Keys are delivery_log column names
// (camelCased); `kind` picks the Indonesian formatting.
export const DELIVERY_LOG_COLUMNS: ReadonlyArray<{ key: keyof DeliveryLogRow; header: string; kind: ColumnKind }> = [
  { key: "pic", header: "PIC", kind: "text" },
  { key: "deliveryDate", header: "Tgl Kirim", kind: "date" },
  { key: "invoiceRef", header: "No. Faktur", kind: "text" },
  { key: "customer", header: "Customer", kind: "text" },
  { key: "driverName", header: "Supir", kind: "text" },
  { key: "status", header: "Status Kirim", kind: "status" },
  { key: "invoiceReturnedAt", header: "Tgl Faktur Balik", kind: "date" },
  { key: "invoiceCheckedBy", header: "Paraf Admin", kind: "text" },
  { key: "skuCode", header: "SKU", kind: "text" },
  { key: "qtyReceivedPack", header: "Qty Diterima (Pak)", kind: "number" },
  { key: "qtyReturnedPack", header: "Qty Retur (Pak)", kind: "number" },
  { key: "full", header: "Full", kind: "bool" },
  { key: "reason", header: "Alasan", kind: "text" },
  { key: "conditionNotes", header: "Keterangan Kondisi", kind: "text" },
  { key: "returnedToWarehouseAt", header: "Tgl Kembali Gudang", kind: "date" },
  { key: "expectedExpiry", header: "Expired", kind: "date" },
  { key: "piecesOk", header: "Butir OK", kind: "number" },
  { key: "piecesRetak", header: "Butir Retak", kind: "number" },
  { key: "piecesPecah", header: "Butir Pecah", kind: "number" },
  { key: "warehouseCheckedBy", header: "Paraf Gudang", kind: "text" },
  { key: "claimRef", header: "No. Klaim", kind: "text" },
  { key: "claimStatus", header: "Status Klaim", kind: "text" },
];

export const DELIVERY_LOG_HEADERS: readonly string[] = DELIVERY_LOG_COLUMNS.map((c) => c.header);

// Decimal commas mean a comma can't also separate columns: Excel (id-ID) and
// Google Sheets both read ';'-separated CSV.
export const CSV_SEPARATOR = ";";

// yyyy-MM-dd (or an ISO timestamp) -> dd/mm/yyyy; blank for null.
export function formatDateId(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Decimal comma, no thousands separator (so the file re-imports cleanly);
// integers stay integers. Blank for null.
export function formatNumberId(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return String(n).replace(".", ",");
}

// A user-typed text cell that a spreadsheet would run as a formula gets a
// leading apostrophe. Numbers and dates are never prefixed.
export function guardFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

// One export row per list item. Live PO fields (buyer, DC, date) come from
// the item, which prefers the PO over the snapshot; an un-logged PO has blank
// PIC, driver and status.
export function itemToLogRow(item: DeliveryListItem): DeliveryLogRow {
  const d = item.delivery;
  return {
    pic: d?.pic ?? "",
    deliveryDate: item.deliveryDate,
    invoiceRef: item.invoiceRef,
    customer: customerLabel(item.buyerName, item.dcName),
    driverName: d?.driverName ?? "",
    status: d?.status ?? null,
    invoiceReturnedAt: d?.invoiceReturnedAt ?? null,
    invoiceCheckedBy: d?.invoiceCheckedBy ?? "",
    // Phase 2+ (delivery lines, warehouse receipt, claims): blank in v1.
    skuCode: "",
    qtyReceivedPack: null,
    qtyReturnedPack: null,
    full: null,
    reason: "",
    conditionNotes: "",
    returnedToWarehouseAt: null,
    expectedExpiry: null,
    piecesOk: null,
    piecesRetak: null,
    piecesPecah: null,
    warehouseCheckedBy: "",
    claimRef: "",
    claimStatus: "",
  };
}

function formatCell(kind: ColumnKind, value: DeliveryLogRow[keyof DeliveryLogRow]): string {
  if (value == null) return "";
  switch (kind) {
    case "date":
      return formatDateId(value as string);
    case "number":
      return formatNumberId(value as number);
    case "status":
      return DELIVERY_STATUS_LABEL_ID[value as DeliveryStatus] ?? String(value);
    case "bool":
      return value ? "Ya" : "Tidak";
    default:
      return guardFormula(String(value));
  }
}

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function deliveryLogRowToCells(row: DeliveryLogRow): string[] {
  return DELIVERY_LOG_COLUMNS.map((c) => formatCell(c.kind, row[c.key]));
}

// Header + one line per row, every cell quoted. The leading BOM makes Excel
// read the file as UTF-8.
export function deliveryLogToCsv(rows: DeliveryLogRow[]): string {
  const lines = [DELIVERY_LOG_HEADERS.map(quote).join(CSV_SEPARATOR)];
  for (const row of rows) lines.push(deliveryLogRowToCells(row).map(quote).join(CSV_SEPARATOR));
  return "﻿" + lines.join("\n");
}

// The list's rows for the range, in list order (newest delivery first), no
// matter which chips or search are set.
export function buildDeliveryLogCsv(items: DeliveryListItem[]): string {
  return deliveryLogToCsv(items.map(itemToLogRow));
}

export const deliveryLogFilename = (from: string, to: string) => `log-pengiriman-${from}_${to}.csv`;
