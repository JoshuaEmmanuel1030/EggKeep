import { describe, it, expect } from "vitest";
import {
  DELIVERY_LOG_HEADERS,
  DELIVERY_LOG_COLUMNS,
  DELIVERY_STATUS_LABEL_ID,
  CSV_SEPARATOR,
  formatDateId,
  formatNumberId,
  guardFormula,
  itemToLogRow,
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
  ...over,
});

const itemsOf = (pos: DeliveryPo[], ds: Delivery[]) => buildDeliveryItems(pos, ds).items;

// The sheet's header row, in its exact order (spec §4.7 column table).
const SHEET_HEADERS = [
  "PIC",
  "Tgl Kirim",
  "No. Faktur",
  "Customer",
  "Supir",
  "Status Kirim",
  "Tgl Faktur Balik",
  "Paraf Admin",
  "SKU",
  "Qty Diterima (Pak)",
  "Qty Retur (Pak)",
  "Full",
  "Alasan",
  "Keterangan Kondisi",
  "Tgl Kembali Gudang",
  "Expired",
  "Butir OK",
  "Butir Retak",
  "Butir Pecah",
  "Paraf Gudang",
  "No. Klaim",
  "Status Klaim",
];

describe("delivery log columns", () => {
  it("match the sheet header row exactly, in order", () => {
    expect([...DELIVERY_LOG_HEADERS]).toEqual(SHEET_HEADERS);
  });
  it("follow the delivery_log column order from the spec", () => {
    expect(DELIVERY_LOG_COLUMNS.map((c) => c.key)).toEqual([
      "pic", "deliveryDate", "invoiceRef", "customer", "driverName", "status", "invoiceReturnedAt", "invoiceCheckedBy",
      "skuCode", "qtyReceivedPack", "qtyReturnedPack", "full", "reason", "conditionNotes", "returnedToWarehouseAt",
      "expectedExpiry", "piecesOk", "piecesRetak", "piecesPecah", "warehouseCheckedBy", "claimRef", "claimStatus",
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
  it("fills columns 1-8 from the delivery and leaves 9-22 blank in Phase 1", () => {
    const [item] = itemsOf([po()], [delivery()]);
    const cells = deliveryLogRowToCells(itemToLogRow(item));
    expect(cells).toHaveLength(22);
    expect(cells.slice(0, 8)).toEqual([
      "dila@js.id", "26/10/2026", "2610383", "OSAVE Depok", "Hendi", "Terkirim", "28/10/2026", "yani@js.id",
    ]);
    expect(cells.slice(8)).toEqual(Array(14).fill(""));
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
    expect(row.split(";")).toHaveLength(22);
  });
  it("exports every list row in list order: newest first, un-logged and orphan rows included", () => {
    const items = itemsOf(
      [po({ invoiceRef: "A", outflowDate: "2026-10-20" }), po({ invoiceRef: "B", outflowDate: "2026-10-27" })],
      [delivery({ id: "x", invoiceRef: "X", invoiceRefNorm: "X", deliveryDate: "2026-10-25" })] // no PO
    );
    const lines = buildDeliveryLogCsv(items).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"B"');
    expect(lines[2]).toContain('"X"');
    expect(lines[3]).toContain('"A"');
  });
  it("names the file by the exported range", () => {
    expect(deliveryLogFilename("2026-10-15", "2026-10-29")).toBe("log-pengiriman-2026-10-15_2026-10-29.csv");
  });
});
