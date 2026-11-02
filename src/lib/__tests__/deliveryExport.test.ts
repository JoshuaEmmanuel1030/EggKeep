import { describe, it, expect } from "vitest";
import {
  DELIVERY_LOG_HEADERS,
  DELIVERY_LOG_COLUMNS,
  DELIVERY_STATUS_LABEL_ID,
  CSV_SEPARATOR,
  formatDateId,
  formatNumberId,
  guardFormula,
  itemToLogRows,
  buildClaimCsv,
  claimCsvFilename,
  deliveryLogRowToCells,
  deliveryLogToCsv,
  buildDeliveryLogCsv,
  deliveryLogFilename,
} from "@/lib/deliveryExport";
import { buildDeliveryItems } from "@/lib/deliveryFlags";
import type { Delivery, DeliveryPo } from "@/types/deliveries";

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  id: "d1",
  invoiceRef: "2610383",
  invoiceRefNorm: "2610383",
  buyerName: "OSAVE",
  dcName: "Depok",
  deliveryDate: "2026-10-26",
  driverId: "drv1",
  driverName: "Hendi",
  status: "terkirim",
  invoiceReturnedAt: "2026-10-28",
  invoiceCheckedBy: "yani@js.id",
  pic: "dila@js.id",
  notes: null,
  createdAt: "2026-10-26T01:00:00.000Z",
  updatedAt: "2026-10-28T01:00:00.000Z",
  ...over,
});

const po = (over: Partial<DeliveryPo> = {}): DeliveryPo => ({
  invoiceRef: "2610383",
  buyerName: "OSAVE",
  dcName: "Depok",
  outflowDate: "2026-10-26",
  recordedAt: "2026-10-26T01:00:00.000Z",
  orderLines: [{ skuCode: "N10O", packQty: 20 }],
  eggTotals: [],
  ...over,
});

const itemsOf = (pos: DeliveryPo[], ds: Delivery[]) => buildDeliveryItems(pos, ds).items;

// Row 2 of the sheet's main tab, verbatim (Phase 2 spec §6.7.1).
const SHEET_HEADERS = [
  "PIC", "Tgl Kirim", "No. Faktur / PO", "Customer", "Supir", "Status Kirim", "Tgl Faktur Balik", "Paraf Admin",
  "Item", "Qty Diterima (pack)", "Qty Retur (pack)", "Full", "Alasan Retur", "Catatan Kondisi", "Tgl Barang Balik",
  "Tgl Expired", "Butir OK (ke stok)", "Butir Pecah", "Paraf Gudang", "No. Retur ARYO", "Status Tagihan",
];
const itemToLogRow = (item: Parameters<typeof itemToLogRows>[0]) => itemToLogRows(item)[0];

describe("delivery log columns", () => {
  it("match the sheet header row exactly, in order", () => {
    expect([...DELIVERY_LOG_HEADERS]).toEqual(SHEET_HEADERS);
    expect(DELIVERY_LOG_HEADERS.join(";")).toBe(SHEET_HEADERS.join(";"));
  });
  it("follow the delivery_log column order from the spec", () => {
    expect(DELIVERY_LOG_COLUMNS.map((c) => c.key)).toEqual([
      "pic", "deliveryDate", "invoiceRef", "customer", "driverName", "status", "invoiceReturnedAt", "invoiceCheckedBy",
      "skuCode", "qtyReceivedPack", "qtyReturnedPack", "full", "reason", "conditionNotes", "returnedToWarehouseAt",
      "expectedExpiry", "piecesOk", "piecesPecah", "warehouseCheckedBy", "claimRef", "claimStatus",
    ]);
  });
});

describe("Indonesian formatting", () => {
  it("dates are dd/mm/yyyy, blank for null", () => {
    expect(formatDateId("2026-10-26")).toBe("26/10/2026");
    expect(formatDateId("2026-01-05T03:00:00.000Z")).toBe("05/01/2026");
    expect(formatDateId(null)).toBe("");
  });
  it("numbers use a decimal comma and no thousands separator", () => {
    expect(formatNumberId(12.5)).toBe("12,5");
    expect(formatNumberId(1500)).toBe("1500");
    expect(formatNumberId(null)).toBe("");
  });
  it("statuses are the warehouse vocabulary", () => {
    expect(DELIVERY_STATUS_LABEL_ID).toEqual({
      belum_terkirim: "Belum Terkirim",
      terkirim: "Terkirim",
      ditolak: "Ditolak",
      batal: "Batal",
    });
  });
  it("text that a spreadsheet would run as a formula gets a leading apostrophe", () => {
    expect(guardFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(guardFormula("+62 812")).toBe("'+62 812");
    expect(guardFormula("-1")).toBe("'-1");
    expect(guardFormula("@user")).toBe("'@user");
    expect(guardFormula("\tx")).toBe("'\tx");
    expect(guardFormula("2610383")).toBe("2610383");
    expect(guardFormula("OSAVE Depok")).toBe("OSAVE Depok");
  });
});

describe("itemToLogRow / cells", () => {
  it("a faktur with no lines: columns 1-8 from the delivery, Full filled, the rest blank", () => {
    const [item] = itemsOf([po()], [delivery()]);
    const cells = deliveryLogRowToCells(itemToLogRow(item));
    expect(cells).toHaveLength(21);
    expect(cells.slice(0, 8)).toEqual([
      "dila@js.id", "26/10/2026", "2610383", "OSAVE Depok", "Hendi", "Terkirim", "28/10/2026", "yani@js.id",
    ]);
    expect(cells[11]).toBe("Ya");
    expect([...cells.slice(8, 11), ...cells.slice(12)]).toEqual(Array(12).fill(""));
  });
  it("an un-logged PO exports with blank PIC, driver, status and faktur balik", () => {
    const [item] = itemsOf([po({ dcName: null })], []);
    const cells = deliveryLogRowToCells(itemToLogRow(item));
    expect(cells.slice(0, 8)).toEqual(["", "26/10/2026", "2610383", "OSAVE", "", "", "", ""]);
  });
  it("live PO fields win over the delivery's snapshot while the PO exists", () => {
    const [item] = itemsOf(
      [po({ buyerName: "OSAVE", dcName: "Bekasi", outflowDate: "2026-10-27" })],
      [delivery({ buyerName: "OLD NAME", dcName: "Depok", deliveryDate: "2026-10-26" })]
    );
    const cells = deliveryLogRowToCells(itemToLogRow(item));
    expect(cells[1]).toBe("27/10/2026");
    expect(cells[3]).toBe("OSAVE Bekasi");
  });
  it("a delivery with no live PO falls back to its snapshot", () => {
    const [item] = itemsOf([], [delivery({ buyerName: "OLD NAME", dcName: null })]);
    const cells = deliveryLogRowToCells(itemToLogRow(item));
    expect(cells[3]).toBe("OLD NAME");
    expect(cells[5]).toBe("Terkirim");
  });
  it("user-typed text is formula-guarded, dates and numbers are not", () => {
    const [item] = itemsOf([po()], [delivery({ pic: "=cmd", driverName: "-Hendi" })]);
    const cells = deliveryLogRowToCells(itemToLogRow(item));
    expect(cells[0]).toBe("'=cmd");
    expect(cells[4]).toBe("'-Hendi");
    expect(cells[1]).toBe("26/10/2026");
  });
});

describe("CSV", () => {
  it("uses ';' between columns (decimal commas), quotes every cell and starts with a BOM", () => {
    const csv = deliveryLogToCsv([itemToLogRow(itemsOf([po({ buyerName: 'Toko "A"' })], [delivery()])[0])]);
    expect(CSV_SEPARATOR).toBe(";");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = csv.slice(1).split("\n");
    expect(header).toBe(SHEET_HEADERS.map((h) => `"${h}"`).join(";"));
    expect(row.startsWith('"dila@js.id";"26/10/2026";"2610383";"Toko ""A"" Depok";"Hendi";"Terkirim";"28/10/2026";"yani@js.id";')).toBe(true);
    expect(row.split(";")).toHaveLength(21);
  });
  it("exports every list row in list order: newest first, un-logged and orphan rows included", () => {
    const items = itemsOf(
      [po({ invoiceRef: "A", outflowDate: "2026-10-20" }), po({ invoiceRef: "B", outflowDate: "2026-10-27" })],
      [delivery({ id: "x", invoiceRef: "X", invoiceRefNorm: "X", deliveryDate: "2026-10-25" })] // no PO
    );
    const lines = buildDeliveryLogCsv(items, "2026-10-15", "2026-10-29").split("\n");
    expect(lines).toHaveLength(6); // header, 3 rows, blank, summary
    expect(lines[1]).toContain('"B"');
    expect(lines[2]).toContain('"X"');
    expect(lines[3]).toContain('"A"');
  });
  it("names the file by the exported range", () => {
    expect(deliveryLogFilename("2026-10-15", "2026-10-29")).toBe("log-pengiriman-2026-10-15_2026-10-29.csv");
  });
});
