import { describe, expect, it } from "vitest";
import {
  buildSheetLine,
  composeNote,
  customerMatchesBuyer,
  derivedQuantity,
  isNonPoCustomer,
  mapReason,
  mergeLines,
  piecesPerUnit,
  resolveSkuCode,
  resolveUnit,
  toIsoDate,
} from "../lib/sheetImportRules.mjs";

// Live pack_skus shape (§4.4): the Osave box rows carry placeholder eggs_per_pack = 1.
const skuRows = [
  { code: "OSVN10B", eggs_per_pack: 1, egg_product: null, base_pack_code: "N10B", box_mode: "box osave", unit_label: "box" },
  { code: "OSVN10O", eggs_per_pack: 1, egg_product: null, base_pack_code: "N10O", box_mode: "box osave", unit_label: "box" },
  { code: "OSVKP6O", eggs_per_pack: 1, egg_product: null, base_pack_code: "KP6O", box_mode: "box osave", unit_label: "box" },
  { code: "N10B", eggs_per_pack: 10, egg_product: "NEGERI BIASA", base_pack_code: null, box_mode: null, unit_label: "pak" },
  { code: "N10O", eggs_per_pack: 10, egg_product: "NEGERI OMEGA", base_pack_code: null, box_mode: null, unit_label: "pak" },
  { code: "KP6O", eggs_per_pack: 6, egg_product: "KAMPUNG MERAH", base_pack_code: null, box_mode: null, unit_label: "pak" },
  { code: "N30B", eggs_per_pack: 150, egg_product: "NEGERI BIASA", base_pack_code: null, box_mode: null, unit_label: "box" },
  { code: "N30O", eggs_per_pack: 30, egg_product: "NEGERI OMEGA", base_pack_code: null, box_mode: null, unit_label: "pak" },
];
const skusByCode = new Map(skuRows.map((s) => [s.code, s]));
const boxCaps = { "box osave": { N10B: 18, N10O: 18, KP6B: 20, KP6O: 20 } };

const row = (over: Record<string, unknown>) => ({
  sheetRow: 3,
  faktur: "X",
  item: null,
  qtyDiterima: null,
  qtyRetur: null,
  alasan: null,
  catatan: null,
  tglBalik: null,
  tglExpired: null,
  ok: null,
  pecah: null,
  noRetur: null,
  ...over,
});

describe("sheet code resolution", () => {
  it("two candidates, one on the PO → resolved", () => {
    expect(resolveSkuCode("N10", ["OSVN10B", "OSVN10O"])).toEqual({ code: "OSVN10B", reason: null });
    expect(resolveSkuCode("N 30", ["N30O"]).code).toBe("N30O");
  });
  it("none on the PO → unresolved with a reason", () => {
    const r = resolveSkuCode("NO10", ["OSVN10B"]);
    expect(r.code).toBeNull();
    expect(r.reason).toMatch(/none of/);
  });
  it("several on the PO, or an unknown code → unresolved", () => {
    expect(resolveSkuCode("N30", ["N30B", "N30O"]).code).toBeNull();
    expect(resolveSkuCode("ZZ9", ["N30B"]).reason).toMatch(/unknown sheet code/);
  });
});

describe("pieces per unit (base-pack rule)", () => {
  it("box-mode SKU: pak = base pack, box = base × capacity, never its own eggs_per_pack", () => {
    const sku = skusByCode.get("OSVKP6O");
    expect(piecesPerUnit(sku, "pak", skusByCode, boxCaps)).toBe(6);
    expect(piecesPerUnit(sku, "box", skusByCode, boxCaps)).toBe(120);
    expect(piecesPerUnit(sku, "box", skusByCode, {})).toBeNull();
  });
  it("non-box SKU uses its own eggs_per_pack (N30B is 150 per box)", () => {
    expect(piecesPerUnit(skusByCode.get("N30B"), "box", skusByCode, boxCaps)).toBe(150);
    expect(piecesPerUnit(skusByCode.get("N10B"), "pak", skusByCode, boxCaps)).toBe(10);
  });
});

describe("unit resolution", () => {
  it("OK + Pecah == qty × base → pak; == qty × box → box; else box + doubt", () => {
    expect(resolveUnit({ qtyRetur: 55, ok: 409, pecah: 141, basePieces: 10, boxPieces: 180 })).toEqual({ unit: "pak", unitDoubt: false });
    expect(resolveUnit({ qtyRetur: 7, ok: 1088, pecah: 172, basePieces: 10, boxPieces: 180 })).toEqual({ unit: "box", unitDoubt: false });
    expect(resolveUnit({ qtyRetur: 7, ok: 1000, pecah: 1, basePieces: 10, boxPieces: 180 })).toEqual({ unit: "box", unitDoubt: true });
    expect(resolveUnit({ qtyRetur: 7, ok: null, pecah: null, basePieces: 10, boxPieces: 180 })).toEqual({ unit: "box", unitDoubt: false });
  });
  it("2610448 NO10 \"55\" with OK 409 + Pecah 141 → pak, 10 pieces/unit", () => {
    const r = buildSheetLine({
      row: row({ faktur: "2610448", item: "NO10", qtyRetur: 55, alasan: "Pecah", ok: 409, pecah: 141 }),
      poLines: [{ skuCode: "OSVN10O", packQty: 40 }, { skuCode: "N30B", packQty: 10 }],
      skusByCode,
      boxCaps,
    });
    expect(r.line).toMatchObject({ skuCode: "OSVN10O", unitLabel: "pak", piecesPerUnit: 10, quantity: 55, reason: "pecah" });
    expect(r.flags.unitDoubt).toBe(false);
  });
});

describe("reasons", () => {
  it("maps the sheet strings case-insensitively", () => {
    expect(mapReason("Pecah")).toEqual({ reason: "pecah", unknown: false });
    expect(mapReason("  TUKAR   guling ")).toEqual({ reason: "tukar_guling", unknown: false });
    expect(mapReason("Revisi PO").reason).toBe("revisi_po");
    expect(mapReason("masih ditanyakan").reason).toBe("masih_ditanyakan");
  });
  it("\"Pecah 19,kurang 2\" → lainnya with the text kept in the note", () => {
    expect(mapReason("Pecah 19,kurang 2")).toEqual({ reason: "lainnya", unknown: true });
    const r = buildSheetLine({
      row: row({ item: "N10", qtyRetur: 1, alasan: "Pecah 19,kurang 2" }),
      poLines: [{ skuCode: "OSVN10B", packQty: 10 }],
      skusByCode,
      boxCaps,
    });
    expect(r.line.reason).toBe("lainnya");
    expect(r.line.note).toContain("Pecah 19,kurang 2");
    expect(r.flags.unknownReason).toBe(true);
  });
});

describe("derived quantity", () => {
  it("blank Qty Retur on a non-physical reason → PO packQty − Qty Diterima", () => {
    expect(derivedQuantity({ qtyRetur: null, qtyDiterima: 168, poPackQty: 200, reason: "kurang" })).toEqual({ quantity: 32, derived: true });
    expect(derivedQuantity({ qtyRetur: null, qtyDiterima: 168, poPackQty: 200, reason: "pecah" })).toEqual({ quantity: 0, derived: false });
    expect(derivedQuantity({ qtyRetur: null, qtyDiterima: null, poPackQty: 200, reason: "kurang" })).toEqual({ quantity: 0, derived: false });
    expect(derivedQuantity({ qtyRetur: 5, qtyDiterima: 168, poPackQty: 200, reason: "kurang" })).toEqual({ quantity: 5, derived: false });
  });
  it("2610598 KpO6 revisi_po, blank Qty Retur → PO packQty − Qty Diterima", () => {
    const r = buildSheetLine({
      row: row({ faktur: "2610598", item: "KpO6", qtyDiterima: 22, alasan: "Revisi PO" }),
      poLines: [{ skuCode: "OSVKP6O", packQty: 30 }],
      skusByCode,
      boxCaps,
    });
    expect(r.line).toMatchObject({ skuCode: "OSVKP6O", reason: "revisi_po", quantity: 8, unitLabel: "box", piecesPerUnit: 120 });
    expect(r.flags.derived).toBe(true);
  });
});

describe("merge", () => {
  it("2610421 \"N 30\" + \"N30\" tukar guling 6 + 30 → one line of 36 with both notes", () => {
    const poLines = [{ skuCode: "N30B", packQty: 50 }];
    const a = buildSheetLine({ row: row({ sheetRow: 10, faktur: "2610421", item: "N 30", qtyRetur: 6, alasan: "tukar guling", catatan: "retak" }), poLines, skusByCode, boxCaps });
    const b = buildSheetLine({ row: row({ sheetRow: 11, faktur: "2610421", item: "N30", qtyRetur: 30, alasan: "Tukar Guling", catatan: "kotor" }), poLines, skusByCode, boxCaps });
    const { lines, merges } = mergeLines([a.line, b.line]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ skuCode: "N30B", reason: "tukar_guling", quantity: 36, unitLabel: "box", piecesPerUnit: 150, sheetRows: [10, 11] });
    expect(lines[0].note).toContain("retak");
    expect(lines[0].note).toContain("kotor");
    expect(merges).toHaveLength(1);
  });
  it("keeps one physical line per SKU but lets a non-physical line sit next to it", () => {
    const base = { faktur: "F", skuCode: "N10B", unitLabel: "pak", piecesPerUnit: 10, quantity: 1, note: null, sheetRows: [1] };
    const { lines, dropped } = mergeLines([
      { ...base, reason: "pecah" },
      { ...base, reason: "kurang", sheetRows: [2] },
      { ...base, reason: "rusak", sheetRows: [3] },
    ]);
    expect(lines.map((l) => l.reason)).toEqual(["pecah", "kurang"]);
    expect(dropped).toHaveLength(1);
  });
});

describe("note composition", () => {
  it("adds the sheet's warehouse figures when any is filled", () => {
    expect(composeNote({ catatan: "", ok: 1088, pecah: 172, balik: "2026-10-20" })).toBe("Sheet: OK 1088 · Pecah 172 · balik 20/10/2026");
    expect(composeNote({ catatan: "dus basah", ok: null, pecah: 3, balik: null })).toBe("dus basah | Sheet: Pecah 3");
    expect(composeNote({ catatan: " ", ok: null, pecah: null, balik: null })).toBeNull();
  });
});

describe("customers", () => {
  it("first word maps to the buyer", () => {
    expect(customerMatchesBuyer("OSV Depok", "Osave")).toBe(true);
    expect(customerMatchesBuyer("FamilyMart Cikarang", "Family Mart")).toBe(true);
    expect(customerMatchesBuyer("Sushitoku", "SUSHI TOKU")).toBe(true);
    expect(customerMatchesBuyer("Circle K", "CircleK")).toBe(true);
    expect(customerMatchesBuyer("astro CKD", "Astro")).toBe(true);
    expect(customerMatchesBuyer("OSV Depok", "Astro")).toBe(false);
  });
  it("detects non-PO customers", () => {
    for (const c of ["TST", "TST Sayurbox", "bu linda", "Bu  Linda", "Cash", "Tunai"]) expect(isNonPoCustomer(c)).toBe(true);
    expect(isNonPoCustomer("Sayurbox")).toBe(false);
    expect(isNonPoCustomer("TSTX")).toBe(false);
  });
});

describe("dates", () => {
  it("Date cells and dd/mm/yyyy text → ISO", () => {
    expect(toIsoDate(new Date(Date.UTC(2026, 10, 19)))).toBe("2026-11-19");
    expect(toIsoDate("9/10/2026")).toBe("2026-10-09");
    expect(toIsoDate("")).toBeNull();
  });
});
