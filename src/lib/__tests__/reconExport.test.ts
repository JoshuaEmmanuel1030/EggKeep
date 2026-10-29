import { describe, it, expect } from "vitest";
import {
  buildReconSheets,
  reconFileName,
  excelDate,
  type ReconData,
  type ReconDailyRow,
  type ReconLedgerRow,
  type ReconProductRow,
  type ReconSheet,
} from "@/lib/reconExport";
import { calculateStockSummary } from "@/lib/inventory";
import type { InflowEntry } from "@/types/inventory";

// Acceptance criteria of docs/spec-export-rekonsiliasi.md §11 that hold at the
// tab-builder layer (1, 2, 3, 5, 6). The SQL side of the same criteria was
// checked against prod when the views were written (see the PR).

type P = Pick<ReconLedgerRow, "nama_katalog" | "item" | "unit" | "urutan" | "is_retakan" | "tanpa_label" | "butir_per_unit">;
const NEGERI: P = { nama_katalog: "NEGERI BIASA", item: "Telur Negeri", unit: "kg", urutan: 1, is_retakan: false, tanpa_label: false, butir_per_unit: 15.5 };
const MERAH: P = { nama_katalog: "KAMPUNG MERAH", item: "Telur Kampung Merah", unit: "butir", urutan: 4, is_retakan: false, tanpa_label: false, butir_per_unit: 1 };
const MERAH_R: P = { nama_katalog: "KAMPUNG MERAH (RETAKAN)", item: "Telur Kampung Merah (RETAKAN)", unit: "butir", urutan: 104, is_retakan: true, tanpa_label: false, butir_per_unit: 1 };

let seq = 0;
function row(p: P, jenis: ReconLedgerRow["jenis"], tanggal: string, over: Partial<ReconLedgerRow> = {}): ReconLedgerRow {
  seq += 1;
  return {
    jenis, tanggal, no_faktur: null, ...p,
    masuk: null, keluar_po: null, keluar_tunai: null, retur: null, qty: null,
    pembeli_pemasok: null, flags: [], dibuat_wib: `${tanggal}T10:00:00`, voided: false,
    id: `row-${seq}`, outflow_id: null, return_id: null, disposisi: null, tanggal_faktur_asal: null,
    ...over,
  };
}

// Deliberately out of order: the builders must sort.
const ledger = (): ReconLedgerRow[] => [
  row(MERAH, "outflow_po", "2026-09-30", { keluar_po: 300, qty: 300, no_faktur: "2610002", pembeli_pemasok: "Segari", outflow_id: "o3", id: "o3" }),
  row(NEGERI, "outflow_po", "2026-09-30", { keluar_po: 30.25, qty: 30.25, no_faktur: "2610001", pembeli_pemasok: "Osave", outflow_id: "o1", id: "o1" }),
  row(NEGERI, "inflow", "2026-09-29", { masuk: 100.5, qty: 100.5, pembeli_pemasok: "AGEN A" }),
  row(NEGERI, "outflow_po", "2026-09-30", { keluar_po: 10, qty: 10, no_faktur: "2610001", pembeli_pemasok: "Osave", outflow_id: "o2", id: "o2" }),
  row(NEGERI, "outflow_tunai", "2026-09-30", { keluar_tunai: 5, qty: 5, pembeli_pemasok: "warung" }),
  row(NEGERI, "return_restock", "2026-09-30", { retur: 2.5, qty: 2.5, no_faktur: "2610001", outflow_id: "o1", return_id: "r1", disposisi: "restock", tanggal_faktur_asal: "2026-09-30" }),
  row(NEGERI, "outflow_po", "2026-09-30", { keluar_po: 7, qty: 7, no_faktur: "2610009", voided: true, flags: ["void"], outflow_id: "o9", id: "o9" }),
  row(MERAH, "inflow", "2026-09-29", { masuk: 1000, qty: 1000, flags: ["tgl-utc"], dibuat_wib: "2026-09-30T01:00:00", id: "in-utc" }),
  row(MERAH_R, "return_retakan", "2026-09-30", { masuk: 9, qty: 9, flags: ["retakan"], no_faktur: "2610002", outflow_id: "o3", return_id: "r2", disposisi: "retakan", tanggal_faktur_asal: "2026-09-30" }),
  row(MERAH, "return_writeoff", "2026-09-30", { qty: 4, no_faktur: "2610002", outflow_id: "o3", return_id: "r3", disposisi: "writeoff", tanggal_faktur_asal: "2026-09-30" }),
  row(MERAH, "stock_count", "2026-09-30", { qty: 690 }),
];

// Test-local mirror of v_recon_daily: per product per day, non-void movements
// summed, running balance, js_warehouse count as Hitung Fisik.
function roll(rows: ReconLedgerRow[], days: string[]): ReconDailyRow[] {
  const live = rows.filter((r) => !r.voided && r.jenis !== "stock_count");
  const products = [...new Map(live.map((r) => [r.nama_katalog, r])).values()];
  const out: ReconDailyRow[] = [];
  for (const p of products) {
    let bal = 0;
    for (const d of days) {
      const today = live.filter((r) => r.nama_katalog === p.nama_katalog && r.tanggal === d);
      const sum = (k: "masuk" | "keluar_po" | "keluar_tunai" | "retur") => today.reduce((s, r) => s + (r[k] ?? 0), 0);
      const masuk = sum("masuk"), keluar_po = sum("keluar_po"), keluar_tunai = sum("keluar_tunai"), retur = sum("retur");
      const stok_awal = bal;
      bal = bal + masuk - keluar_po - keluar_tunai + retur;
      const count = rows.find((r) => r.jenis === "stock_count" && r.nama_katalog === p.nama_katalog && r.tanggal === d);
      out.push({
        tanggal: d, item: p.item, nama_katalog: p.nama_katalog!, unit: p.unit, urutan: p.urutan,
        is_retakan: p.is_retakan, tanpa_label: p.tanpa_label,
        stok_awal, masuk, keluar_po, keluar_tunai, retur, stok_akhir: bal,
        hitung_fisik: count?.qty ?? null, selisih_fisik: count ? count.qty! - bal : null, catatan: null,
      });
    }
  }
  return out;
}

const products: ReconProductRow[] = [
  { id: "p1", ...NEGERI, induk: null, deleted_at: null },
  { id: "p2", ...MERAH, induk: null, deleted_at: null },
  { id: "p3", ...MERAH_R, induk: "KAMPUNG MERAH", deleted_at: null },
  { id: "p4", nama_katalog: "RETAKAN", item: "RETAKAN", unit: "kg", urutan: 1000, is_retakan: false, tanpa_label: true, butir_per_unit: 15.5, induk: null, deleted_at: "2026-10-08T09:12:30Z" },
];

const DAYS = ["2026-09-29", "2026-09-30"];
function data(): ReconData {
  const l = ledger();
  return {
    ledger: l,
    daily: roll(l, DAYS),
    products,
    skus: [{ code: "N10O", egg_product: "NEGERI OMEGA", eggs_per_pack: 10 }, { code: "KP6", egg_product: "KAMPUNG MERAH", eggs_per_pack: 6 }],
    boxes: [{ name: "box osave", box_capacities: { N10O: 18 } }],
  };
}
const opts = { from: "2026-09-29", to: "2026-09-30", includeVoid: false, includeRetakan: true };
const NOW = new Date("2026-10-29T03:04:00Z"); // 10:04 WIB

type Rec = Record<string, string | number | Date | null>;
const table = (s: ReconSheet): Rec[] => s.rows.map((r) => Object.fromEntries(s.columns.map((c, i) => [c.header, r.cells[i]])));
const sheet = (sheets: ReconSheet[], name: string) => sheets.find((s) => s.name === name)!;
const sameDay = (a: Date | null, b: string) => a instanceof Date && a.getTime() === excelDate(b)!.getTime();

describe("buildReconSheets — structure (§5, §9)", () => {
  const sheets = buildReconSheets(data(), opts, NOW);

  it("has the six tabs in order with the fixed headers", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Ringkasan", "Harian", "Transaksi", "Faktur", "Retur", "Katalog"]);
    expect(sheet(sheets, "Harian").columns.map((c) => c.header)).toEqual([
      "TGL", "Item", "Unit", "Stok Awal", "Masuk", "Keluar PO", "Keluar Tunai", "Retur Restock", "Stok Akhir", "Hitung Fisik", "Selisih Fisik", "Catatan",
    ]);
    expect(sheet(sheets, "Transaksi").columns.map((c) => c.header)).toEqual([
      "Tanggal", "No. Faktur", "Item", "Unit", "Masuk", "Keluar PO", "Keluar Tunai", "Retur", "Pembeli / Pemasok", "Jenis", "Catatan", "Dibuat", "ID",
    ]);
    expect(sheet(sheets, "Faktur").columns.map((c) => c.header)).toEqual([
      "Tanggal", "No. Faktur", "Pembeli", "Item", "Unit", "Qty", "Qty Butir Setara", "Retur", "Netto", "Catatan", "Outflow ID",
    ]);
    expect(sheet(sheets, "Retur").columns.map((c) => c.header)).toEqual([
      "Tanggal Retur", "No. Faktur Asal", "Tanggal Faktur Asal", "Pembeli", "Item", "Unit", "Qty", "Disposisi", "Catatan", "Return ID", "Outflow ID",
    ]);
  });

  it("writes real dates and numeric cells, never strings", () => {
    const t = table(sheet(sheets, "Transaksi"));
    for (const r of t) {
      expect(r["Tanggal"]).toBeInstanceOf(Date);
      expect(r["Dibuat"]).toBeInstanceOf(Date);
      for (const k of ["Masuk", "Keluar PO", "Keluar Tunai", "Retur"]) {
        if (r[k] != null) expect(typeof r[k]).toBe("number");
      }
    }
    const utc = t.find((r) => r["ID"] === "in-utc")!;
    expect((utc["Dibuat"] as Date).getUTCHours()).toBe(1); // WIB wall clock, no tz shift
    expect(sameDay(utc["Tanggal"] as Date, "2026-09-29")).toBe(true);
  });

  it("Harian: one row per product per day, grouped by date in §7 order, no spacer rows", () => {
    const h = sheet(sheets, "Harian");
    expect(h.rows).toHaveLength(3 * DAYS.length);
    const t = table(h);
    expect(t.slice(0, 3).map((r) => r["Item"])).toEqual(["Telur Negeri", "Telur Kampung Merah", "Telur Kampung Merah (RETAKAN)"]);
    expect(t.slice(0, 3).every((r) => sameDay(r["TGL"] as Date, "2026-09-29"))).toBe(true);
    expect(h.rows.map((r) => !!r.groupStart)).toEqual([true, false, false, true, false, false]);
    // Stok Awal chains from the previous day's Stok Akhir.
    expect(t[3]["Stok Awal"]).toBe(t[0]["Stok Akhir"]);
    expect(t[4]["Hitung Fisik"]).toBe(690);
    expect(t[4]["Selisih Fisik"]).toBe(690 - 700);
  });

  it("names the file after the range", () => {
    expect(reconFileName("2026-09-01", "2026-09-30")).toBe("EggKeep_Rekonsiliasi_2026-09-01_2026-09-30.xlsx");
  });
});

describe("buildReconSheets — §11 acceptance criteria", () => {
  const d = data();
  const sheets = buildReconSheets(d, opts, NOW);
  const harian = table(sheet(sheets, "Harian"));
  const transaksi = table(sheet(sheets, "Transaksi"));
  const faktur = table(sheet(sheets, "Faktur"));

  it("1. Ringkasan Stok Akhir = last day's Harian Stok Akhir = calculateStockSummary()", () => {
    const ringkasan = table(sheet(sheets, "Ringkasan"));
    for (const r of ringkasan) {
      const last = harian.filter((h) => h["Item"] === r["Item"]).at(-1)!;
      expect(r["Stok Akhir Periode"]).toBe(last["Stok Akhir"]);
    }
    // The same number the dashboard shows: remaining batch stock per product.
    const inflow = (product: string, remaining: number): InflowEntry => ({
      id: product, date: "2026-09-29", product, quantity: remaining, unit: "kg",
      quantityInButir: remaining, remainingButir: remaining, createdAt: "", category: "egg",
    });
    const summary = calculateStockSummary(
      [inflow("NEGERI BIASA", 100.5 - 30.25 - 10 - 5 + 2.5), inflow("KAMPUNG MERAH", 1000 - 300), inflow("KAMPUNG MERAH (RETAKAN)", 9)],
      { "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 }, "KAMPUNG MERAH": { unit: "btr", eggs_per_unit: 1 }, "KAMPUNG MERAH (RETAKAN)": { unit: "btr", eggs_per_unit: 1 } },
    );
    const byName = Object.fromEntries(ringkasan.map((r) => [r["Item"], r["Stok Akhir Periode"] as number]));
    expect(byName["Telur Negeri"]).toBeCloseTo(summary.find((s) => s.product === "NEGERI BIASA")!.totalStock, 2);
    expect(byName["Telur Kampung Merah"]).toBe(summary.find((s) => s.product === "KAMPUNG MERAH")!.totalStock);
    expect(byName["Telur Kampung Merah (RETAKAN)"]).toBe(summary.find((s) => s.product === "KAMPUNG MERAH (RETAKAN)")!.totalStock);
    expect(byName["Telur Negeri"]).toBe(57.75);
  });

  it("2. Σ Faktur.Qty per product and date = Harian.Keluar PO", () => {
    for (const h of harian) {
      const sum = faktur
        .filter((f) => f["Item"] === h["Item"] && (f["Tanggal"] as Date).getTime() === (h["TGL"] as Date).getTime())
        .reduce((s, f) => s + (f["Qty"] as number), 0);
      expect(sum).toBeCloseTo(h["Keluar PO"] as number, 6);
    }
    expect(faktur).toHaveLength(3); // o1, o2, o3 — the voided o9 is out
  });

  it("3. Σ Transaksi by day and type reproduces every Harian cell", () => {
    const cols: [string, string][] = [["Masuk", "Masuk"], ["Keluar PO", "Keluar PO"], ["Keluar Tunai", "Keluar Tunai"], ["Retur", "Retur Restock"]];
    for (const h of harian) {
      const rows = transaksi.filter((r) => r["Item"] === h["Item"] && (r["Tanggal"] as Date).getTime() === (h["TGL"] as Date).getTime());
      for (const [tCol, hCol] of cols) {
        const sum = rows.reduce((s, r) => s + ((r[tCol] as number) ?? 0), 0);
        expect(sum).toBeCloseTo(h[hCol] as number, 6);
      }
    }
  });

  it("5. a row flagged tgl-utc by the view carries the token in Catatan (row and day)", () => {
    expect(transaksi.find((r) => r["ID"] === "in-utc")!["Catatan"]).toBe("tgl-utc");
    const day = harian.find((h) => h["Item"] === "Telur Kampung Merah" && sameDay(h["TGL"] as Date, "2026-09-29"))!;
    expect(day["Catatan"]).toContain("tgl-utc");
  });

  it("6. a RETAKAN return is Masuk on the child product and leaves the parent untouched", () => {
    const retakan = transaksi.filter((r) => r["Jenis"] === "return_retakan");
    expect(retakan).toHaveLength(1);
    expect(retakan[0]["Item"]).toBe("Telur Kampung Merah (RETAKAN)");
    expect(retakan[0]["Masuk"]).toBe(9);
    expect(retakan[0]["Catatan"]).toBe("retakan");
    const parent = harian.find((h) => h["Item"] === "Telur Kampung Merah" && sameDay(h["TGL"] as Date, "2026-09-30"))!;
    expect(parent["Masuk"]).toBe(0);
    expect(parent["Stok Akhir"]).toBe(700);
    const child = harian.find((h) => h["Item"] === "Telur Kampung Merah (RETAKAN)" && sameDay(h["TGL"] as Date, "2026-09-30"))!;
    expect(child["Stok Akhir"]).toBe(9);

    // Opting out of RETAKAN drops the child everywhere and changes nothing on the parent.
    const without = buildReconSheets(d, { ...opts, includeRetakan: false }, NOW);
    for (const name of ["Harian", "Transaksi", "Katalog"]) {
      expect(table(sheet(without, name)).some((r) => String(r["Item"] ?? r["Item (sheet)"]).includes("RETAKAN"))).toBe(false);
    }
    const parent2 = table(sheet(without, "Harian")).find((h) => h["Item"] === "Telur Kampung Merah" && sameDay(h["TGL"] as Date, "2026-09-30"))!;
    expect(parent2["Stok Akhir"]).toBe(700);
  });
});

describe("buildReconSheets — flags, voids, Faktur, Retur, Katalog", () => {
  const d = data();
  const sheets = buildReconSheets(d, opts, NOW);
  const faktur = table(sheet(sheets, "Faktur"));

  it("flags faktur-ganda on both outflows sharing No. Faktur + Item, and nothing else", () => {
    const by = Object.fromEntries(faktur.map((f) => [f["Outflow ID"], f["Catatan"]]));
    expect(by["o1"]).toBe("faktur-ganda");
    expect(by["o2"]).toBe("faktur-ganda");
    expect(by["o3"]).toBe("");
  });

  it("Faktur: Retur sums restock returns on that outflow, Netto = Qty - Retur, butir estimate only for kg items", () => {
    const o1 = faktur.find((f) => f["Outflow ID"] === "o1")!;
    expect(o1["Qty"]).toBe(30.25);
    expect(o1["Retur"]).toBe(2.5);
    expect(o1["Netto"]).toBe(27.75);
    expect(o1["Qty Butir Setara"]).toBe(Math.round(30.25 * 15.5));
    expect(o1["Pembeli"]).toBe("Osave");
    const o3 = faktur.find((f) => f["Outflow ID"] === "o3")!;
    expect(o3["Qty Butir Setara"]).toBeNull();
    expect(o3["Retur"]).toBe(0);
    expect(faktur.map((f) => f["No. Faktur"])).toEqual(["2610001", "2610001", "2610002"]);
  });

  it("void rows are out by default and in, flagged, when asked for", () => {
    const ids = (s: ReconSheet[]) => table(sheet(s, "Transaksi")).map((r) => r["ID"]);
    expect(ids(sheets)).not.toContain("o9");
    expect(table(sheet(sheets, "Ringkasan")).length).toBe(3);
    expect(sheet(sheets, "Ringkasan").meta!.find(([k]) => k === "Jumlah transaksi")![1]).toBe(9);

    const withVoid = buildReconSheets(d, { ...opts, includeVoid: true }, NOW);
    expect(ids(withVoid)).toContain("o9");
    expect(table(sheet(withVoid, "Faktur")).find((f) => f["Outflow ID"] === "o9")!["Catatan"]).toBe("void");
    expect(sheet(withVoid, "Ringkasan").meta!.find(([k]) => k === "Jumlah transaksi")![1]).toBe(10);
    expect(sheet(withVoid, "Ringkasan").meta!.find(([k]) => k === "Catatan")![1]).toBe("faktur-ganda: 2, retakan: 1, tgl-utc: 1, void: 1");
  });

  it("Retur lists every disposition with its original invoice", () => {
    // Same sort as Transaksi: date, then §7 product order (the RETAKAN child sorts last).
    const retur = table(sheet(sheets, "Retur"));
    expect(retur.map((r) => r["Disposisi"])).toEqual(["restock", "writeoff", "retakan"]);
    expect(retur.map((r) => r["Qty"])).toEqual([2.5, 4, 9]);
    expect(retur.every((r) => sameDay(r["Tanggal Faktur Asal"] as Date, "2026-09-30"))).toBe(true);
    expect(retur[2]["Return ID"]).toBe("r2");
    expect(retur[2]["Outflow ID"]).toBe("o3");
  });

  it("Ringkasan metadata", () => {
    const meta = Object.fromEntries(sheet(sheets, "Ringkasan").meta!);
    expect(meta["Periode"]).toBe("29/09/2026 – 30/09/2026");
    expect(meta["Dibuat"]).toBe("29/10/2026 10:04 WIB");
    expect(meta["Versi skema"]).toBe(1);
    expect(meta["Produk tanpa label"]).toBe(0);
  });

  it("Katalog snapshots live products in §7 order, boxes with capacities, and pack SKUs", () => {
    const k = sheet(sheets, "Katalog");
    const t = table(k);
    expect(t.map((r) => r["Item (sheet)"])).toEqual(["Telur Negeri", "Telur Kampung Merah", "Telur Kampung Merah (RETAKAN)", "box osave"]);
    expect(t[0]["Butir per Unit"]).toBe(15.5);
    expect(t[2]["Induk (parent)"]).toBe("KAMPUNG MERAH");
    expect(t[2]["Is RETAKAN"]).toBe("YA");
    expect(t[3]["Box capacities (JSON)"]).toBe('{"N10O":18}');
    expect(k.extra!.rows.map((r) => r.cells)).toEqual([["KP6", "KAMPUNG MERAH", 6], ["N10O", "NEGERI OMEGA", 10]]);
  });
});
