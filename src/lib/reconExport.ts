// Export Rekonsiliasi: pure tab builders over rows of the v_recon_* views
// (supabase/migrations/20261029000000_recon_views.sql). Spec:
// docs/spec-export-rekonsiliasi.md (§5 tabs, §7 order, §8 flags, §9 format).
//
// Every number here is a stored value in the product's native unit, taken from
// the views as-is. Nothing in this file converts units or consults the client
// conversion map; the only arithmetic is sums, `Netto = Qty - Retur` and the
// catalog-factor butir estimate the views hand us the factor for.

export type ReconJenis =
  | "inflow"
  | "outflow_po"
  | "outflow_tunai"
  | "return_restock"
  | "return_retakan"
  | "return_writeoff"
  | "stock_count";

export const RECON_JENIS: ReconJenis[] = [
  "inflow", "outflow_po", "outflow_tunai",
  "return_restock", "return_retakan", "return_writeoff", "stock_count",
];

// §8 flag tokens. The views set all but `faktur-ganda`, which depends on the
// exported range and is added here.
export const RECON_FLAGS = [
  "tgl-utc", "void", "retakan", "sku-yatim", "tanpa-faktur", "faktur-ganda",
  "qty-nol", "tgl-aneh", "tanpa-log",
] as const;
export const FLAG_FAKTUR_GANDA = "faktur-ganda";

export const RECON_SCHEMA_VERSION = 1;

/** One row of v_recon_ledger. */
export interface ReconLedgerRow {
  jenis: ReconJenis;
  tanggal: string | null; // yyyy-mm-dd (business date)
  no_faktur: string | null;
  item: string;
  nama_katalog: string | null;
  unit: "kg" | "butir";
  urutan: number;
  is_retakan: boolean;
  tanpa_label: boolean;
  butir_per_unit: number;
  masuk: number | null;
  keluar_po: number | null;
  keluar_tunai: number | null;
  retur: number | null;
  qty: number | null;
  pembeli_pemasok: string | null;
  flags: string[];
  dibuat_wib: string; // yyyy-mm-ddThh:mm:ss (WIB wall clock, no offset)
  voided: boolean;
  id: string;
  outflow_id: string | null;
  return_id: string | null;
  disposisi: string | null;
  tanggal_faktur_asal: string | null;
}

/** One row of v_recon_daily. */
export interface ReconDailyRow {
  tanggal: string;
  item: string;
  nama_katalog: string;
  unit: "kg" | "butir";
  urutan: number;
  is_retakan: boolean;
  tanpa_label: boolean;
  stok_awal: number;
  masuk: number;
  keluar_po: number;
  keluar_tunai: number;
  retur: number;
  stok_akhir: number;
  hitung_fisik: number | null;
  selisih_fisik: number | null;
  catatan: string | null;
}

/** One row of v_recon_products (the §7 label map, live + deleted items). */
export interface ReconProductRow {
  id: string;
  nama_katalog: string;
  item: string;
  unit: "kg" | "butir";
  butir_per_unit: number;
  is_retakan: boolean;
  induk: string | null;
  deleted_at: string | null;
  urutan: number;
  tanpa_label: boolean;
}

export interface ReconSkuRow { code: string; egg_product: string; eggs_per_pack: number }
export interface ReconBoxRow { name: string; box_capacities: unknown }

export interface ReconData {
  ledger: ReconLedgerRow[];
  daily: ReconDailyRow[];
  products: ReconProductRow[];
  skus: ReconSkuRow[];
  boxes: ReconBoxRow[];
}

export interface ReconOptions {
  from: string; // yyyy-mm-dd
  to: string;   // yyyy-mm-dd
  includeVoid: boolean;
  includeRetakan: boolean;
}

// ---------------------------------------------------------------------------
// Sheet model: what the xlsx writer renders. Header names are fixed by §5.
// ---------------------------------------------------------------------------

export type CellValue = string | number | Date | null;
/** qty = native-unit quantity (2 dp for kg rows, 0 dp otherwise); int = plain integer. */
export type ColType = "text" | "date" | "datetime" | "qty" | "int";
export interface ReconColumn { header: string; type: ColType; width: number }
export interface ReconRow { cells: CellValue[]; unit?: "kg" | "butir"; groupStart?: boolean }
export interface ReconTable { columns: ReconColumn[]; rows: ReconRow[] }
export interface ReconSheet extends ReconTable {
  name: string;
  /** Label/value block above the table (Ringkasan only). */
  meta?: [string, CellValue][];
  /** Second table below the first (Katalog's pack_skus). */
  extra?: ReconTable & { title: string };
}

const col = (header: string, type: ColType, width: number): ReconColumn => ({ header, type, width });

/** A yyyy-mm-dd string as a timezone-free Excel date (UTC midnight). */
export function excelDate(ymd: string | null): Date | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** A WIB wall-clock timestamp (no offset) as a timezone-free Excel datetime. */
export function excelDateTime(wib: string | null): Date | null {
  if (!wib) return null;
  const [date, time = "00:00:00"] = wib.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss = "0"] = time.split(":");
  return new Date(Date.UTC(y, m - 1, d, Number(hh), Number(mm), Math.floor(Number(ss))));
}

/** `now` as a WIB wall-clock string, dd/mm/yyyy HH:mm. */
export function wibStamp(now: Date): string {
  const t = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

const ddmmyyyy = (ymd: string) => ymd.slice(8, 10) + "/" + ymd.slice(5, 7) + "/" + ymd.slice(0, 4);

export function reconFileName(from: string, to: string): string {
  return `EggKeep_Rekonsiliasi_${from}_${to}.xlsx`;
}

const byProduct = (a: { urutan: number; item: string }, b: { urutan: number; item: string }) =>
  a.urutan - b.urutan || a.item.localeCompare(b.item);
const cmp = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");

// ---------------------------------------------------------------------------

export function buildReconSheets(data: ReconData, opts: ReconOptions, now: Date = new Date()): ReconSheet[] {
  const keep = (r: { voided?: boolean; is_retakan: boolean }) =>
    (opts.includeVoid || !r.voided) && (opts.includeRetakan || !r.is_retakan);

  const ledger = data.ledger
    .filter(keep)
    .sort((a, b) => cmp(a.tanggal, b.tanggal) || byProduct(a, b) || cmp(a.dibuat_wib, b.dibuat_wib) || cmp(a.id, b.id));
  const daily = data.daily
    .filter(keep)
    .sort((a, b) => cmp(a.tanggal, b.tanggal) || byProduct(a, b));

  // §8 faktur-ganda: the same No. Faktur + Item on more than one live outflow in the range.
  const fakturCount = new Map<string, number>();
  for (const r of ledger) {
    if (r.jenis !== "outflow_po" || !r.no_faktur || r.voided) continue;
    const k = `${r.no_faktur}\u0000${r.item}`;
    fakturCount.set(k, (fakturCount.get(k) ?? 0) + 1);
  }
  const flagsOf = (r: ReconLedgerRow): string[] => {
    const ganda = r.jenis === "outflow_po" && !!r.no_faktur && !r.voided &&
      (fakturCount.get(`${r.no_faktur}\u0000${r.item}`) ?? 0) > 1;
    return ganda ? [...r.flags, FLAG_FAKTUR_GANDA] : r.flags;
  };
  const catatan = (flags: Iterable<string>) => [...new Set(flags)].sort().join(", ");

  // Restock returns per original outflow (Faktur.Retur).
  const restockByOutflow = new Map<string, number>();
  for (const r of ledger) {
    if (r.jenis !== "return_restock" || !r.outflow_id) continue;
    restockByOutflow.set(r.outflow_id, (restockByOutflow.get(r.outflow_id) ?? 0) + (r.retur ?? 0));
  }

  // --- Harian -------------------------------------------------------------
  const dayFlags = new Map<string, Set<string>>();
  for (const r of ledger) {
    if (r.jenis === "stock_count" || !r.tanggal) continue;
    const k = `${r.tanggal}\u0000${r.nama_katalog}`;
    const set = dayFlags.get(k) ?? new Set<string>();
    for (const f of flagsOf(r)) set.add(f);
    dayFlags.set(k, set);
  }
  const harian: ReconSheet = {
    name: "Harian",
    columns: [
      col("TGL", "date", 12), col("Item", "text", 28), col("Unit", "text", 7),
      col("Stok Awal", "qty", 13), col("Masuk", "qty", 12), col("Keluar PO", "qty", 12),
      col("Keluar Tunai", "qty", 13), col("Retur Restock", "qty", 14), col("Stok Akhir", "qty", 13),
      col("Hitung Fisik", "qty", 13), col("Selisih Fisik", "qty", 13), col("Catatan", "text", 24),
    ],
    rows: daily.map((d, i) => ({
      unit: d.unit,
      groupStart: i === 0 || daily[i - 1].tanggal !== d.tanggal,
      cells: [
        excelDate(d.tanggal), d.item, d.unit,
        d.stok_awal, d.masuk, d.keluar_po, d.keluar_tunai, d.retur, d.stok_akhir,
        d.hitung_fisik, d.selisih_fisik,
        catatan(dayFlags.get(`${d.tanggal}\u0000${d.nama_katalog}`) ?? []),
      ],
    })),
  };

  // --- Transaksi ----------------------------------------------------------
  const transaksi: ReconSheet = {
    name: "Transaksi",
    columns: [
      col("Tanggal", "date", 12), col("No. Faktur", "text", 14), col("Item", "text", 28), col("Unit", "text", 7),
      col("Masuk", "qty", 12), col("Keluar PO", "qty", 12), col("Keluar Tunai", "qty", 13), col("Retur", "qty", 12),
      col("Pembeli / Pemasok", "text", 22), col("Jenis", "text", 16), col("Catatan", "text", 24),
      col("Dibuat", "datetime", 17), col("ID", "text", 38),
    ],
    rows: ledger.map((r) => ({
      unit: r.unit,
      cells: [
        excelDate(r.tanggal), r.no_faktur, r.item, r.unit,
        r.masuk, r.keluar_po, r.keluar_tunai, r.retur,
        r.pembeli_pemasok, r.jenis, catatan(flagsOf(r)),
        excelDateTime(r.dibuat_wib), r.id,
      ],
    })),
  };

  // --- Faktur -------------------------------------------------------------
  const fakturRows = ledger
    .filter((r) => r.jenis === "outflow_po")
    .sort((a, b) => cmp(a.tanggal, b.tanggal) || cmp(a.no_faktur, b.no_faktur) || byProduct(a, b) || cmp(a.id, b.id));
  const faktur: ReconSheet = {
    name: "Faktur",
    columns: [
      col("Tanggal", "date", 12), col("No. Faktur", "text", 14), col("Pembeli", "text", 18), col("Item", "text", 28),
      col("Unit", "text", 7), col("Qty", "qty", 12), col("Qty Butir Setara", "int", 16), col("Retur", "qty", 12),
      col("Netto", "qty", 12), col("Catatan", "text", 24), col("Outflow ID", "text", 38),
    ],
    rows: fakturRows.map((r) => {
      const qty = r.qty ?? 0;
      const retur = r.outflow_id ? restockByOutflow.get(r.outflow_id) ?? 0 : 0;
      return {
        unit: r.unit,
        cells: [
          excelDate(r.tanggal), r.no_faktur, r.pembeli_pemasok, r.item, r.unit,
          qty,
          r.unit === "kg" ? Math.round(qty * r.butir_per_unit) : null,
          retur,
          qty - retur,
          catatan(flagsOf(r)), r.outflow_id,
        ],
      };
    }),
  };

  // --- Retur --------------------------------------------------------------
  const retur: ReconSheet = {
    name: "Retur",
    columns: [
      col("Tanggal Retur", "date", 13), col("No. Faktur Asal", "text", 15), col("Tanggal Faktur Asal", "date", 18),
      col("Pembeli", "text", 18), col("Item", "text", 28), col("Unit", "text", 7), col("Qty", "qty", 12),
      col("Disposisi", "text", 11), col("Catatan", "text", 24), col("Return ID", "text", 38), col("Outflow ID", "text", 38),
    ],
    rows: ledger
      .filter((r) => r.jenis.startsWith("return_"))
      .map((r) => ({
        unit: r.unit,
        cells: [
          excelDate(r.tanggal), r.no_faktur, excelDate(r.tanggal_faktur_asal),
          r.pembeli_pemasok, r.item, r.unit, r.qty,
          r.disposisi, catatan(flagsOf(r)), r.return_id, r.outflow_id,
        ],
      })),
  };

  // --- Ringkasan ----------------------------------------------------------
  const perProduct = new Map<string, { first: ReconDailyRow; last: ReconDailyRow; masuk: number; po: number; tunai: number; retur: number }>();
  for (const d of daily) {
    const cur = perProduct.get(d.nama_katalog);
    if (!cur) perProduct.set(d.nama_katalog, { first: d, last: d, masuk: d.masuk, po: d.keluar_po, tunai: d.keluar_tunai, retur: d.retur });
    else {
      cur.last = d;
      cur.masuk += d.masuk; cur.po += d.keluar_po; cur.tunai += d.keluar_tunai; cur.retur += d.retur;
    }
  }
  const flagCounts = new Map<string, number>();
  let transactions = 0;
  for (const r of ledger) {
    if (r.jenis === "stock_count") continue;
    transactions += 1;
    for (const f of flagsOf(r)) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  }
  const unlabeled = new Set(daily.filter((d) => d.tanpa_label).map((d) => d.nama_katalog));
  const ringkasan: ReconSheet = {
    name: "Ringkasan",
    meta: [
      ["Periode", `${ddmmyyyy(opts.from)} – ${ddmmyyyy(opts.to)}`],
      ["Dibuat", `${wibStamp(now)} WIB`],
      ["Versi skema", RECON_SCHEMA_VERSION],
      ["Jumlah transaksi", transactions],
      ["Catatan", [...flagCounts].sort().map(([f, n]) => `${f}: ${n}`).join(", ") || "-"],
      ["Produk tanpa label", unlabeled.size],
    ],
    columns: [
      col("Item", "text", 28), col("Unit", "text", 7), col("Stok Awal Periode", "qty", 17),
      col("Total Masuk", "qty", 13), col("Total Keluar PO", "qty", 15), col("Total Keluar Tunai", "qty", 17),
      col("Total Retur Restock", "qty", 18), col("Stok Akhir Periode", "qty", 17),
    ],
    rows: [...perProduct.values()]
      .sort((a, b) => byProduct(a.first, b.first))
      .map((p) => ({
        unit: p.first.unit,
        cells: [p.first.item, p.first.unit, p.first.stok_awal, p.masuk, p.po, p.tunai, p.retur, p.last.stok_akhir],
      })),
  };

  // --- Katalog ------------------------------------------------------------
  const liveProducts = data.products
    .filter((p) => !p.deleted_at && (opts.includeRetakan || !p.is_retakan))
    .sort(byProduct);
  const katalog: ReconSheet = {
    name: "Katalog",
    columns: [
      col("Item (sheet)", "text", 28), col("Nama Katalog", "text", 26), col("Unit", "text", 7),
      col("Butir per Unit", "qty", 14), col("Induk (parent)", "text", 20), col("Is RETAKAN", "text", 11),
      col("Box capacities (JSON)", "text", 40),
    ],
    rows: [
      ...liveProducts.map((p) => ({
        unit: "kg" as const, // factors keep their decimals (15.5)
        cells: [p.item, p.nama_katalog, p.unit, p.butir_per_unit, p.induk, p.is_retakan ? "YA" : "TIDAK", null],
      })),
      ...data.boxes
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({
          cells: [b.name, b.name, "pcs", null, null, "TIDAK", b.box_capacities == null ? null : JSON.stringify(b.box_capacities)],
        })),
    ],
    extra: {
      title: "pack_skus",
      columns: [col("SKU", "text", 12), col("Produk", "text", 26), col("Butir per Pack", "int", 14)],
      rows: data.skus
        .slice()
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((s) => ({ cells: [s.code, s.egg_product, s.eggs_per_pack] })),
    },
  };

  return [ringkasan, harian, transaksi, faktur, retur, katalog];
}
