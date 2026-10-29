import { describe, it, expect, vi } from "vitest";
import { Workbook } from "exceljs";
import { writeReconXlsx } from "@/lib/reconXlsx";
import type { ReconSheet } from "@/lib/reconExport";

// The writer never touches the network; keep the browser-only client out of Node.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

// Round-trips a small sheet model through the real exceljs writer and reads it
// back: tab names, bold/frozen/filtered header, real dates, numeric cells with
// the kg/butir number formats (§9, §11.4). The browser only adds the download.
const sheets: ReconSheet[] = [
  {
    name: "Ringkasan",
    meta: [["Periode", "01/09/2026 – 30/09/2026"], ["Versi skema", 1]],
    columns: [{ header: "Item", type: "text", width: 20 }, { header: "Stok Akhir Periode", type: "qty", width: 16 }],
    rows: [{ unit: "kg", cells: ["Telur Negeri", 1234.5] }],
  },
  {
    name: "Harian",
    columns: [
      { header: "TGL", type: "date", width: 12 }, { header: "Item", type: "text", width: 20 },
      { header: "Masuk", type: "qty", width: 12 }, { header: "Dibuat", type: "datetime", width: 16 },
      { header: "Qty Butir Setara", type: "int", width: 14 },
    ],
    rows: [
      { unit: "kg", groupStart: true, cells: [new Date(Date.UTC(2026, 8, 30)), "Telur Negeri", 1234.5, new Date(Date.UTC(2026, 8, 30, 8, 15)), 19135] },
      { unit: "butir", groupStart: true, cells: [new Date(Date.UTC(2026, 9, 1)), "Telur Puyuh", 300, null, null] },
    ],
    extra: {
      title: "pack_skus",
      columns: [{ header: "SKU", type: "text", width: 10 }, { header: "Butir per Pack", type: "int", width: 12 }],
      rows: [{ cells: ["N10O", 10] }],
    },
  },
];

async function load(numberFormat: "id" | "std") {
  const blob = await writeReconXlsx(sheets, numberFormat);
  expect(blob.type).toContain("spreadsheetml");
  const wb = new Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}

describe("writeReconXlsx", () => {
  it("writes every tab by name, with a bold, frozen, filtered header on data tabs", async () => {
    const wb = await load("id");
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Ringkasan", "Harian"]);
    const h = wb.getWorksheet("Harian")!;
    expect(h.getCell("A1").value).toBe("TGL");
    expect(h.getCell("A1").font?.bold).toBe(true);
    expect(h.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(h.autoFilter).toBeTruthy();
    expect(h.getColumn(2).width).toBe(20);
    // Ringkasan: metadata block, then the table two rows below it; no freeze.
    const r = wb.getWorksheet("Ringkasan")!;
    expect(r.getCell("A1").value).toBe("Periode");
    expect(r.getCell("B2").value).toBe(1);
    expect(r.getCell("A4").value).toBe("Item");
    expect(r.getCell("B5").value).toBe(1234.5);
    expect(r.views ?? []).toHaveLength(0);
  });

  it("keeps dates as dates and quantities numeric, formatted per unit (Indonesian separators)", async () => {
    const h = (await load("id")).getWorksheet("Harian")!;
    expect(h.getCell("A2").value).toBeInstanceOf(Date);
    expect((h.getCell("A2").value as Date).getUTCDate()).toBe(30);
    expect(h.getCell("A2").numFmt).toBe("dd/mm/yyyy");
    expect(h.getCell("D2").numFmt).toBe("dd/mm/yyyy hh:mm");
    expect((h.getCell("D2").value as Date).getUTCHours()).toBe(8);
    expect(h.getCell("C2").value).toBe(1234.5);
    expect(h.getCell("C2").numFmt).toBe("#,##0.00"); // kg row
    expect(h.getCell("C3").numFmt).toBe("#,##0");    // butir row
    expect(h.getCell("E2").numFmt).toBe("#,##0");    // int column
    expect(h.getCell("C3").value).toBe(300);
    expect(h.getCell("D3").value).toBeNull();
    // Second table (pack_skus) sits under a bold title, one blank row below the first.
    expect(h.getCell("A5").value).toBe("pack_skus");
    expect(h.getCell("A6").value).toBe("SKU");
    expect(h.getCell("B7").value).toBe(10);
    // Date groups are separated by a thin top border, not a blank row.
    expect(h.getCell("A3").border?.top?.style).toBe("thin");
    expect(h.getCell("A2").border?.top).toBeUndefined();
  });

  it("'Standar' drops the thousands separator but keeps values numeric", async () => {
    const h = (await load("std")).getWorksheet("Harian")!;
    expect(h.getCell("C2").numFmt).toBe("0.00");
    expect(h.getCell("C3").numFmt).toBe("0");
    expect(h.getCell("C2").value).toBe(1234.5);
  });
});
