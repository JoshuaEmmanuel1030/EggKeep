// Return-entry resolution shared by RecordReturnDialog (Activities) and the
// delivery Retur section (/deliveries): SKU -> egg, pieces -> native, the
// running per-egg remainder, and the RPC error codes. Pure (no React/Supabase).
// Spec: docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md §6.4
import type { PackSKU } from "@/types/catalog";
import type { InventoryCategory } from "@/types/inventory";
import type { ReturnDisposition, ReturnLineInput } from "@/types/returns";
import type { BoxCapacityMap } from "@/lib/outflowCalculator";
import type { ReturnSubmitResult } from "@/lib/returnRpc";
import { piecesToNative } from "@/lib/returnsCap";

export interface SkuEgg {
  eggProduct: string;
  piecesPerPak: number;
  // Base pack x box capacity; null when the SKU is not a box or its capacity is not configured.
  piecesPerBox: number | null;
  basePackCode: string | null;
  isBoxMode: boolean;
}

// A box SKU (OSVN10B) resolves through its base pack: the box row's own
// eggsPerPack / eggProduct are placeholders on the live Osave boxes (1, empty).
export function buildSkuEggMap(skus: PackSKU[], boxCapacityMap: BoxCapacityMap | undefined): Record<string, SkuEgg> {
  const byCode: Record<string, PackSKU> = {};
  for (const s of skus) byCode[s.code] = s;
  const m: Record<string, SkuEgg> = {};
  for (const s of skus) {
    const base = s.basePackCode ? byCode[s.basePackCode] : undefined;
    const piecesPerPak = base ? base.eggsPerPack : s.eggsPerPack;
    const capacity = s.boxMode && s.basePackCode ? boxCapacityMap?.[s.boxMode]?.[s.basePackCode] ?? 0 : 0;
    m[s.code] = {
      eggProduct: base?.eggProduct || s.eggProduct,
      piecesPerPak,
      piecesPerBox: base && capacity > 0 ? piecesPerPak * capacity : null,
      basePackCode: s.basePackCode ?? null,
      isBoxMode: !!s.boxMode,
    };
  }
  return m;
}

// Pieces in one unit of a delivery line. A non-box SKU counted "per box"
// (N30B, 150 eggs) uses its own pack size; a box-mode SKU without a configured
// capacity cannot be typed in box (null).
export function piecesPerUnit(egg: SkuEgg, unit: "pak" | "box"): number | null {
  if (unit === "pak") return egg.piecesPerPak;
  return egg.isBoxMode ? egg.piecesPerBox : egg.piecesPerPak;
}

export interface ReturnRowInput {
  key: string;
  skuCode?: string;
  eggProduct: string;
  // true: buckets are pieces (pack rows); false: already the egg's native unit.
  inPieces: boolean;
  buckets: Record<ReturnDisposition, number>;
}

export interface BuildReturnLinesInput {
  rows: ReturnRowInput[];
  outflowIdByProduct: Record<string, string | null | undefined>;
  remainingNativeByProduct: Record<string, number>;
  unitByProduct: Record<string, string | undefined>;
  categoryByProduct: Record<string, InventoryCategory>;
  expectedPriorByProduct?: Record<string, number>;
  ids: (rowKey: string, disposition: ReturnDisposition) => string;
}

// ok: lines set. Not ok: kind + product (+ exceedsBy in native units). One flat
// shape, not a union: the repo compiles with strict: false (no narrowing).
export interface BuildReturnLinesResult {
  ok: boolean;
  lines?: ReturnLineInput[];
  kind?: "unresolved" | "exceeds";
  product?: string;
  exceedsBy?: number;
}

const DISPOSITIONS: ReturnDisposition[] = ["restock", "retakan", "writeoff"];

// One return entry per non-zero bucket per row. The native remainder per egg is
// shared across rows, so two rows on one kg egg never exceed the server cap by
// rounding: an overshoot within one piece is rounding and is clamped; anything
// larger is reported, never silently cut.
export function buildReturnLines(input: BuildReturnLinesInput): BuildReturnLinesResult {
  const remaining: Record<string, number> = {};
  const lines: ReturnLineInput[] = [];
  for (const row of input.rows) {
    const product = row.eggProduct;
    const outflowId = input.outflowIdByProduct[product];
    if (!outflowId) return { ok: false, kind: "unresolved", product };
    if (!(product in remaining)) remaining[product] = input.remainingNativeByProduct[product] ?? 0;
    const unit = input.unitByProduct[product];
    const tolerance = (unit === "kg" ? piecesToNative(1, "kg") : 0) + 1e-9;
    for (const disposition of DISPOSITIONS) {
      const entered = row.buckets[disposition] ?? 0;
      if (entered <= 0) continue;
      const want = row.inPieces ? piecesToNative(entered, unit) : entered;
      if (want > remaining[product] + tolerance) {
        return { ok: false, kind: "exceeds", product, exceedsBy: want - remaining[product] };
      }
      const quantity = Math.min(want, remaining[product]);
      if (quantity <= 0) continue;
      const expectedPrior = input.expectedPriorByProduct?.[product];
      lines.push({
        id: input.ids(row.key, disposition),
        outflowId,
        skuCode: row.skuCode,
        product,
        category: input.categoryByProduct[product] ?? "egg",
        quantity,
        disposition,
        ...(expectedPrior !== undefined ? { expectedPrior } : {}),
      });
      remaining[product] -= quantity;
    }
  }
  return { ok: true, lines };
}

const RETURN_CODES = [
  "RETURN_EXCEEDS_OUTFLOW",
  "RESTOCK_EXCEEDS_DEDUCTED",
  "RESTOCK_UNALLOCATED",
  "OUTFLOW_VOIDED",
  "PARENT_TYPE_MISSING",
  "PRIOR_MISMATCH",
  "INVALID_ENTRY",
  "AUTH_REQUIRED",
  "NO_ENTRIES",
] as const;
export type ReturnErrorCode = (typeof RETURN_CODES)[number] | "DEADLOCK" | "NETWORK" | "OTHER";

const VOID_CODES = [
  "INSUFFICIENT_STOCK",
  "RETURN_NOT_FOUND",
  "NOT_ALLOWED",
  "VOID_WINDOW_CLOSED",
  "REASON_REQUIRED",
  "VOID_BLOCKED",
  "AUTH_REQUIRED",
] as const;
export type VoidReturnErrorCode = (typeof VOID_CODES)[number] | "DEADLOCK" | "NETWORK" | "OTHER";

// SQLSTATE 40P01 reaches the client as Postgres' "deadlock detected" message.
const DEADLOCK_RE = /deadlock detected|40P01/i;

function matchCode<T extends string>(result: ReturnSubmitResult, codes: readonly T[]): T | "DEADLOCK" | "NETWORK" | "OTHER" {
  if (result.kind === "network") return "NETWORK";
  const m = result.message ?? "";
  for (const code of codes) if (m.includes(code)) return code;
  if (DEADLOCK_RE.test(m)) return "DEADLOCK";
  return "OTHER";
}

export const returnErrorCode = (result: ReturnSubmitResult): ReturnErrorCode => matchCode(result, RETURN_CODES);
export const voidReturnErrorCode = (result: ReturnSubmitResult): VoidReturnErrorCode => matchCode(result, VOID_CODES);

// The product named by "INSUFFICIENT_STOCK: <product> (<category>) is short <n> ...".
// Anchored on the category so "NEGERI BIASA (RETAKAN)" keeps its suffix.
export function insufficientStockProduct(message: string | undefined): string | null {
  return /INSUFFICIENT_STOCK: (.+) \((?:egg|box|label|packaging)\) is short/.exec(message ?? "")?.[1] ?? null;
}
