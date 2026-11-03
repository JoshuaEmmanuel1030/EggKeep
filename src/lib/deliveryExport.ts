// Delivery & Return Log export: the sheet's 21 columns ("Pengiriman & Retur",
// row 2) with its header strings, one row per delivery line, Indonesian dates
// and decimal commas, plus the "selisih kurang" summary row; and the claim CSV
// in the "Klaim Retur OSV" tab's layout. Client-side over the list items.
// Download goes through the existing downloadCSV helper (src/lib/inventory.ts).
// Headers are row 2 of the sheet admin used until launch. This file is the
// month-end archive.
// Spec: docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md §6.7
import type { ClaimCsvRow, DeliveryLineView, DeliveryListItem, DeliveryLogRow, DeliveryStatus } from "@/types/deliveries";
import { customerLabel } from "@/lib/deliveryFlags";

// Status Kirim as the sheet writes it. Fixed Indonesian, same in both locales.
export const DELIVERY_STATUS_LABEL_ID: Record<DeliveryStatus, string> = {
  belum_terkirim: "Belum Terkirim",
  terkirim: "Terkirim",
  ditolak: "Ditolak",
  batal: "Batal",
};

// Alasan Retur as the sheet writes it, by reason code. Fixed Indonesian.
export const RETURN_REASON_LABEL_ID: Record<string, string> = {
  pecah: "Pecah",
  rusak: "Rusak",
  ditolak: "Ditolak",
  expired: "Expired",
  tukar_guling: "Tukar Guling",
  lainnya: "Lainnya",
  kurang: "Kurang",
  lebih: "Lebih",
  revisi_po: "Revisi PO",
  cancel: "Cancel",
  masih_ditanyakan: "Masih ditanyakan",
};

type ColumnKind = "text" | "date" | "number" | "status" | "bool";

// The sheet's header row 2, verbatim, in order. `kind` picks the formatting.
export const DELIVERY_LOG_COLUMNS: ReadonlyArray<{ key: keyof DeliveryLogRow; header: string; kind: ColumnKind }> = [
  { key: "pic", header: "PIC", kind: "text" },
  { key: "deliveryDate", header: "Tgl Kirim", kind: "date" },
  { key: "invoiceRef", header: "No. Faktur / PO", kind: "text" },
  { key: "customer", header: "Customer", kind: "text" },
  { key: "driverName", header: "Supir", kind: "text" },
  { key: "status", header: "Status Kirim", kind: "status" },
  { key: "invoiceReturnedAt", header: "Tgl Faktur Balik", kind: "date" },
  { key: "invoiceCheckedBy", header: "Paraf Admin", kind: "text" },
  { key: "skuCode", header: "Item", kind: "text" },
  { key: "qtyReceivedPack", header: "Qty Diterima (pack)", kind: "number" },
  { key: "qtyReturnedPack", header: "Qty Retur (pack)", kind: "number" },
  { key: "full", header: "Full", kind: "bool" },
  { key: "reason", header: "Alasan Retur", kind: "text" },
  { key: "conditionNotes", header: "Catatan Kondisi", kind: "text" },
  { key: "returnedToWarehouseAt", header: "Tgl Barang Balik", kind: "date" },
  { key: "expectedExpiry", header: "Tgl Expired", kind: "date" },
  { key: "piecesOk", header: "Butir OK (ke stok)", kind: "number" },
  { key: "piecesPecah", header: "Butir Pecah", kind: "number" },
  { key: "warehouseCheckedBy", header: "Paraf Gudang", kind: "text" },
  { key: "claimRef", header: "No. Retur ARYO", kind: "text" },
  { key: "claimStatus", header: "Status Tagihan", kind: "text" },
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

// Qty Diterima in the line's unit: what the store kept, read off the faktur.
function qtyReceived(line: DeliveryLineView): number | null {
  if (line.poQty == null) return null;
  if (line.reason === "kurang") return line.poQty - line.quantity;
  if (line.reason === "lebih") return line.poQty + line.quantity;
  return line.poQty;
}

// One export row per delivery line, or one row for a faktur with none. Live PO
// fields (buyer, DC, date) come from the item, which prefers the PO over the
// snapshot; an un-logged PO has blank PIC, driver and status. Warehouse columns
// come from the physical-return line's non-voided returns only.
export function itemToLogRows(item: DeliveryListItem): DeliveryLogRow[] {
  const d = item.delivery;
  const base: DeliveryLogRow = {
    pic: d?.pic ?? "",
    deliveryDate: item.deliveryDate,
    invoiceRef: item.invoiceRef,
    customer: customerLabel(item.buyerName, item.dcName),
    driverName: d?.driverName ?? "",
    status: d?.status ?? null,
    invoiceReturnedAt: d?.invoiceReturnedAt ?? null,
    invoiceCheckedBy: d?.invoiceCheckedBy ?? "",
    skuCode: "",
    qtyReceivedPack: null,
    qtyReturnedPack: null,
    full: item.lineSummary.full,
    reason: "",
    conditionNotes: "",
    returnedToWarehouseAt: null,
    expectedExpiry: null,
    piecesOk: null,
    piecesPecah: null,
    warehouseCheckedBy: "",
    claimRef: "",
    claimStatus: "", // Status Tagihan: Phase 3
  };
  if (item.lines.length === 0) return [base];
  return item.lines.map((line) => ({
    ...base,
    skuCode: line.skuCode,
    qtyReceivedPack: qtyReceived(line),
    qtyReturnedPack: line.quantity,
    reason: RETURN_REASON_LABEL_ID[line.reason] ?? line.reason,
    conditionNotes: line.note ?? "",
    returnedToWarehouseAt: line.returns?.firstReturnDate ?? null,
    expectedExpiry: line.expectedExpiry,
    piecesOk: line.returns ? line.returns.okPieces : null,
    piecesPecah: line.returns ? line.returns.pecahPieces : null,
    warehouseCheckedBy: line.returns?.lastUserEmail ?? "",
    claimRef: line.claimRef ?? "",
  }));
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
const csvLine = (cells: string[]) => cells.map(quote).join(CSV_SEPARATOR);
const BOM = "﻿";

export function deliveryLogRowToCells(row: DeliveryLogRow): string[] {
  return DELIVERY_LOG_COLUMNS.map((c) => formatCell(c.kind, row[c.key]));
}

// Header + one line per row, every cell quoted, then (when given) one blank row
// and the summary row. The leading BOM makes Excel read the file as UTF-8.
export function deliveryLogToCsv(rows: DeliveryLogRow[], summary?: string[]): string {
  const lines = [csvLine([...DELIVERY_LOG_HEADERS])];
  for (const row of rows) lines.push(csvLine(deliveryLogRowToCells(row)));
  if (summary) lines.push(csvLine(Array(DELIVERY_LOG_COLUMNS.length).fill("")), csvLine(summary));
  return BOM + lines.join("\n");
}

// Σ quantity × pieces_per_unit over the Kurang lines (the Kurang chip's number).
export const kurangPiecesOf = (items: DeliveryListItem[]): number =>
  items.reduce((n, it) => n + it.lineSummary.kurangPieces, 0);

// "Total selisih kurang (butir)" | range | ... | column 11 = the sum. A sum
// only: it changes no stock and reads no returns.
export function kurangSummaryCells(items: DeliveryListItem[], from: string, to: string): string[] {
  const cells: string[] = Array(DELIVERY_LOG_COLUMNS.length).fill("");
  cells[0] = "Total selisih kurang (butir)";
  cells[1] = `${formatDateId(from)}–${formatDateId(to)}`;
  cells[10] = formatNumberId(kurangPiecesOf(items));
  return cells;
}

// The list's rows for the range, in list order (newest delivery first), no
// matter which chips or search are set, then the selisih kurang summary row.
export function buildDeliveryLogCsv(items: DeliveryListItem[], from: string, to: string): string {
  return deliveryLogToCsv(items.flatMap(itemToLogRows), kurangSummaryCells(items, from, to));
}

export const deliveryLogFilename = (from: string, to: string) => `log-pengiriman-${from}_${to}.csv`;

// The Klaim tab's ten headers, verbatim, in order.
export const CLAIM_CSV_HEADERS = [
  "Tgl Kirim",
  "No. Faktur / PO (EggKeep)",
  "Customer",
  "Item",
  "Qty Retur (pack)",
  "Alasan Retur",
  "Tgl Expired",
  "Butir Pecah",
  "No. Retur OSV",
  "Status Tagihan",
] as const;

// Claim rows: the physical-return lines of buyers with requires_claim_ref,
// newest first. Which rows are billed is Phase 3.
export function claimRows(items: DeliveryListItem[]): ClaimCsvRow[] {
  return items
    .filter((it) => it.requiresClaimRef && !it.poMissing)
    .flatMap((it) =>
      it.lines
        .filter((l) => l.physical)
        .map((l) => ({
          deliveryDate: it.deliveryDate,
          invoiceRef: it.invoiceRef,
          customer: customerLabel(it.buyerName, it.dcName),
          skuCode: l.skuCode,
          qtyReturnedPack: l.quantity,
          reason: RETURN_REASON_LABEL_ID[l.reason] ?? l.reason,
          expectedExpiry: l.expectedExpiry,
          piecesPecah: l.returns ? l.returns.pecahPieces : null,
          claimRef: l.claimRef ?? "",
          claimStatus: "",
        }))
    )
    .sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
}

export function buildClaimCsv(items: DeliveryListItem[]): string {
  const lines = [csvLine([...CLAIM_CSV_HEADERS])];
  for (const r of claimRows(items)) {
    lines.push(
      csvLine([
        formatDateId(r.deliveryDate),
        guardFormula(r.invoiceRef),
        guardFormula(r.customer),
        guardFormula(r.skuCode),
        formatNumberId(r.qtyReturnedPack),
        r.reason,
        formatDateId(r.expectedExpiry),
        formatNumberId(r.piecesPecah),
        guardFormula(r.claimRef),
        r.claimStatus,
      ])
    );
  }
  return BOM + lines.join("\n");
}

export const claimCsvFilename = (from: string, to: string) => `klaim-retur-${from}_${to}.csv`;
