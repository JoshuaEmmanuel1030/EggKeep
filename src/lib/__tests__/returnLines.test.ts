import { describe, it, expect } from "vitest";
import {
  buildReturnLines,
  buildSkuEggMap,
  piecesPerUnit,
  returnErrorCode,
  voidReturnErrorCode,
  insufficientStockProduct,
  type BuildReturnLinesInput,
} from "@/lib/returnLines";
import type { PackSKU } from "@/types/catalog";

const sku = (code: string, over: Partial<PackSKU> = {}): PackSKU => ({
  id: code,
  code,
  displayName: code,
  eggsPerPack: 10,
  eggProduct: "NEGERI BIASA",
  packagingItem: null,
  isActive: true,
  createdAt: "2026-01-01",
  ...over,
});

// Live pack_skus shapes (§4.4): the Osave box rows carry placeholders.
const SKUS: PackSKU[] = [
  sku("N10B"),
  sku("N10O", { eggProduct: "NEGERI OMEGA" }),
  sku("KP6O", { eggsPerPack: 6, eggProduct: "KAMPUNG MERAH" }),
  sku("OSVN10B", { eggsPerPack: 1, eggProduct: "", basePackCode: "N10B", boxMode: "box osave" }),
  sku("OSVKP6O", { eggsPerPack: 1, eggProduct: "", basePackCode: "KP6O", boxMode: "box osave" }),
  sku("N30B", { eggsPerPack: 150 }),
];
const CAPS = { "box osave": { N10B: 18, N10O: 18, KP6B: 20, KP6O: 20 } };

const input = (over: Partial<BuildReturnLinesInput> = {}): BuildReturnLinesInput => ({
  rows: [],
  outflowIdByProduct: { "NEGERI BIASA": "of-nb", "KAMPUNG MERAH": "of-km" },
  remainingNativeByProduct: { "NEGERI BIASA": 998.71, "KAMPUNG MERAH": 120 },
  unitByProduct: { "NEGERI BIASA": "kg", "KAMPUNG MERAH": "butir" },
  categoryByProduct: { "NEGERI BIASA": "egg", "KAMPUNG MERAH": "egg" },
  ids: (key, d) => `${key}:${d}`,
  ...over,
});
const row = (key: string, eggProduct: string, restock: number, retakan = 0, writeoff = 0, skuCode?: string) => ({
  key,
  skuCode,
  eggProduct,
  inPieces: true,
  buckets: { restock, retakan, writeoff },
});

describe("buildReturnLines", () => {
  it("CUJ 1: OSVN10B 7 boxes, Pecah 172 -> restock 70.19 kg + retakan 11.10 kg, expectedPrior 0", () => {
    const res = buildReturnLines(input({ rows: [row("OSVN10B", "NEGERI BIASA", 1088, 172, 0, "OSVN10B")], expectedPriorByProduct: { "NEGERI BIASA": 0 } }));
    expect(res.ok).toBe(true);
    expect(res.lines).toEqual([
      { id: "OSVN10B:restock", outflowId: "of-nb", skuCode: "OSVN10B", product: "NEGERI BIASA", category: "egg", quantity: 70.19, disposition: "restock", expectedPrior: 0 },
      { id: "OSVN10B:retakan", outflowId: "of-nb", skuCode: "OSVN10B", product: "NEGERI BIASA", category: "egg", quantity: 11.1, disposition: "retakan", expectedPrior: 0 },
    ]);
  });

  it("two rows on one kg egg overshooting by less than one piece -> clamped, ok", () => {
    // remainder 10 kg; 78 + 78 pieces -> 5.03 + 5.03 = 10.06 kg (0.06 over: within one piece)
    const res = buildReturnLines(input({ remainingNativeByProduct: { "NEGERI BIASA": 10 }, rows: [row("a", "NEGERI BIASA", 78), row("b", "NEGERI BIASA", 78)] }));
    expect(res.ok).toBe(true);
    expect(res.lines!.map((l) => l.quantity)).toEqual([5.03, 10 - 5.03]);
  });

  it("an overshoot of 0.5 kg is reported, not cut", () => {
    const res = buildReturnLines(input({ remainingNativeByProduct: { "NEGERI BIASA": 10 }, rows: [row("a", "NEGERI BIASA", 163)] })); // 10.52 kg
    expect(res).toMatchObject({ ok: false, kind: "exceeds", product: "NEGERI BIASA" });
    expect(res.exceedsBy).toBeCloseTo(0.52, 5);
  });

  it("a count egg overshooting by one piece -> exceeds", () => {
    const res = buildReturnLines(input({ rows: [row("a", "KAMPUNG MERAH", 121)] }));
    expect(res).toMatchObject({ ok: false, kind: "exceeds", product: "KAMPUNG MERAH", exceedsBy: 1 });
  });

  it("a Negeri return of the full sold quantity fits the cap", () => {
    const res = buildReturnLines(input({ rows: [row("a", "NEGERI BIASA", 15480)] }));
    expect(res.ok).toBe(true);
    expect(res.lines).toHaveLength(1);
    expect(res.lines![0].quantity).toBe(998.71);
  });

  it("a product with no outflow id -> unresolved", () => {
    const res = buildReturnLines(input({ outflowIdByProduct: {}, rows: [row("a", "NEGERI BIASA", 10)] }));
    expect(res).toMatchObject({ ok: false, kind: "unresolved", product: "NEGERI BIASA" });
  });

  it("native rows are not converted, and no expectedPrior without the map", () => {
    const res = buildReturnLines(input({ rows: [{ ...row("a", "NEGERI BIASA", 2.5), inPieces: false }] }));
    expect(res.lines![0]).toMatchObject({ quantity: 2.5 });
    expect(res.lines![0]).not.toHaveProperty("expectedPrior");
  });
});

describe("buildSkuEggMap / piecesPerUnit", () => {
  it("resolves Osave boxes through the base pack, ignoring the box row's placeholders", () => {
    const m = buildSkuEggMap(SKUS, CAPS);
    expect(m.OSVN10B).toEqual({ eggProduct: "NEGERI BIASA", piecesPerPak: 10, piecesPerBox: 180, basePackCode: "N10B", isBoxMode: true });
    expect(m.OSVKP6O.piecesPerBox).toBe(120);
  });
  it("no capacity -> piecesPerBox null, eggProduct kept", () => {
    const m = buildSkuEggMap(SKUS, {});
    expect(m.OSVN10B.piecesPerBox).toBeNull();
    expect(m.OSVN10B.eggProduct).toBe("NEGERI BIASA");
  });
  it("N30B box -> 150; OSVN10B pak -> 10; box without capacity -> null", () => {
    expect(piecesPerUnit(buildSkuEggMap(SKUS, CAPS).N30B, "box")).toBe(150);
    expect(piecesPerUnit(buildSkuEggMap(SKUS, CAPS).OSVN10B, "pak")).toBe(10);
    expect(piecesPerUnit(buildSkuEggMap(SKUS, {}).OSVN10B, "box")).toBeNull();
  });
});

describe("error codes", () => {
  const server = (message: string) => ({ ok: false, kind: "server" as const, message });
  it("maps each record_return prefix", () => {
    for (const code of ["RETURN_EXCEEDS_OUTFLOW", "RESTOCK_EXCEEDS_DEDUCTED", "RESTOCK_UNALLOCATED", "OUTFLOW_VOIDED", "PARENT_TYPE_MISSING", "PRIOR_MISMATCH", "INVALID_ENTRY", "AUTH_REQUIRED", "NO_ENTRIES"]) {
      expect(returnErrorCode(server(`${code}: details`))).toBe(code);
    }
    expect(returnErrorCode({ ok: false, kind: "network", message: "Failed to fetch" })).toBe("NETWORK");
    expect(returnErrorCode(server("something else"))).toBe("OTHER");
  });
  it("maps void_return codes, VOID_BLOCKED and deadlocks", () => {
    for (const code of ["INSUFFICIENT_STOCK", "RETURN_NOT_FOUND", "NOT_ALLOWED", "VOID_WINDOW_CLOSED", "REASON_REQUIRED", "VOID_BLOCKED"]) {
      expect(voidReturnErrorCode(server(`${code}: x`))).toBe(code);
    }
    expect(voidReturnErrorCode(server("deadlock detected"))).toBe("DEADLOCK");
    expect(returnErrorCode(server("deadlock detected"))).toBe("DEADLOCK");
  });
  it("parses the product out of INSUFFICIENT_STOCK", () => {
    expect(insufficientStockProduct("INSUFFICIENT_STOCK: NEGERI BIASA (RETAKAN) (egg) is short 3 butir/pcs")).toBe("NEGERI BIASA (RETAKAN)");
  });
});
