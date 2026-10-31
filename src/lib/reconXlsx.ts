// Export Rekonsiliasi, I/O half: read the v_recon_* views for a date range,
// build the sheets (reconExport.ts), render them with exceljs and hand the
// file to the browser. exceljs is loaded on demand: it is ~0.9 MB and only an
// admin running this export ever needs it (vite.config keeps it out of the PWA
// precache for the same reason).
import { supabase } from "@/integrations/supabase/client";
import { downloadBlob } from "@/lib/inventory";
import {
  buildReconSheets,
  reconFileName,
  type ReconBoxRow,
  type ReconDailyRow,
  type ReconData,
  type ReconLedgerRow,
  type ReconOptions,
  type ReconProductRow,
  type ReconSheet,
  type ReconSkuRow,
  type ReconTable,
} from "@/lib/reconExport";

/** Excel number format only; cell values are numeric either way (§4, §11.4). */
export type NumberFormat = "id" | "std";

// PostgREST caps one request at 1000 rows; a month of movements is about that.
const PAGE = 1000;
type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
async function fetchAll<T>(page: (from: number, to: number) => Page): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

export async function fetchReconData(opts: ReconOptions): Promise<ReconData> {
  const [ledger, daily, products, skus, boxes] = await Promise.all([
    fetchAll<ReconLedgerRow>((a, b) =>
      supabase.from("v_recon_ledger").select("*")
        .gte("tanggal", opts.from).lte("tanggal", opts.to)
        .order("tanggal").order("urutan").order("item").order("dibuat_wib").order("id")
        .range(a, b)),
    fetchAll<ReconDailyRow>((a, b) =>
      supabase.from("v_recon_daily").select("*")
        .gte("tanggal", opts.from).lte("tanggal", opts.to)
        .order("tanggal").order("urutan").order("item")
        .range(a, b)),
    fetchAll<ReconProductRow>((a, b) =>
      supabase.from("v_recon_products").select("*").order("urutan").order("item").range(a, b)),
    fetchAll<ReconSkuRow>((a, b) =>
      supabase.from("pack_skus").select("code, egg_product, eggs_per_pack")
        .is("deleted_at", null).order("code").range(a, b)),
    fetchAll<ReconBoxRow>((a, b) =>
      supabase.from("item_types").select("name, box_capacities")
        .eq("category", "box").is("deleted_at", null).order("name").range(a, b)),
  ]);
  return { ledger, daily, products, skus, boxes };
}

const NUM_FMT: Record<NumberFormat, { kg: string; butir: string; int: string }> = {
  id: { kg: "#,##0.00", butir: "#,##0", int: "#,##0" },
  std: { kg: "0.00", butir: "0", int: "0" },
};
const DATE_FMT = "dd/mm/yyyy";
const DATETIME_FMT = "dd/mm/yyyy hh:mm";

// exceljs' typings are a module with named exports; at runtime Vite serves the
// package's CJS browser bundle, whose exports sit on `default`.
type ExcelNS = typeof import("exceljs");
async function loadExcel(): Promise<ExcelNS> {
  const mod = (await import("exceljs")) as ExcelNS & { default?: ExcelNS };
  return mod.default ?? mod;
}

/** Writes one header + rows table at `startRow`; returns the next free row. */
function writeTable(ws: import("exceljs").Worksheet, startRow: number, table: ReconTable, fmt: typeof NUM_FMT[NumberFormat]): number {
  const header = ws.getRow(startRow);
  table.columns.forEach((c, i) => { header.getCell(i + 1).value = c.header; });
  header.font = { bold: true };
  let r = startRow + 1;
  for (const row of table.rows) {
    const xr = ws.getRow(r);
    row.cells.forEach((v, i) => {
      const cell = xr.getCell(i + 1);
      cell.value = v;
      const t = table.columns[i].type;
      if (t === "date") cell.numFmt = DATE_FMT;
      else if (t === "datetime") cell.numFmt = DATETIME_FMT;
      else if (t === "qty") cell.numFmt = row.unit === "kg" ? fmt.kg : fmt.butir;
      else if (t === "int") cell.numFmt = fmt.int;
    });
    // Thin line between date groups (Harian); no blank spacer rows (§5.2).
    if (row.groupStart && r > startRow + 1) {
      for (let i = 1; i <= table.columns.length; i++) xr.getCell(i).border = { top: { style: "thin" } };
    }
    r += 1;
  }
  return r;
}

export async function writeReconXlsx(sheets: ReconSheet[], numberFormat: NumberFormat): Promise<Blob> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "EggKeep";
  const fmt = NUM_FMT[numberFormat];
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    let row = 1;
    if (sheet.meta) {
      for (const [label, value] of sheet.meta) {
        const r = ws.getRow(row);
        r.getCell(1).value = label;
        r.getCell(1).font = { bold: true };
        r.getCell(2).value = value;
        row += 1;
      }
      row += 1;
    } else {
      // Data tabs: header frozen + autofilter (§9).
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    }
    row = writeTable(ws, row, sheet, fmt);
    if (sheet.extra) {
      row += 1;
      const title = ws.getRow(row);
      title.getCell(1).value = sheet.extra.title;
      title.font = { bold: true };
      writeTable(ws, row + 1, sheet.extra, fmt);
    }
    sheet.columns.forEach((c, i) => {
      const w = Math.max(c.width, sheet.extra?.columns[i]?.width ?? 0, sheet.meta ? 18 : 0);
      ws.getColumn(i + 1).width = w;
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Fetch → build → write → download. Resolves to the number of Transaksi rows in the file. */
export async function exportRekonsiliasi(opts: ReconOptions, numberFormat: NumberFormat, now: Date = new Date()): Promise<number> {
  const data = await fetchReconData(opts);
  const sheets = buildReconSheets(data, opts, now);
  const blob = await writeReconXlsx(sheets, numberFormat);
  downloadBlob(blob, reconFileName(opts.from, opts.to));
  return sheets.find((s) => s.name === "Transaksi")?.rows.length ?? 0;
}
