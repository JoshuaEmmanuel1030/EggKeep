// Pure logic for the physical stock-count page: locations, per-item tolerance,
// variance vs system stock, and per-product total on hand. No I/O, no React.

export const STOCK_LOCATIONS = ["js_warehouse", "tst_warehouse", "loaded"] as const;
export type StockLocation = (typeof STOCK_LOCATIONS)[number];

/** Default variance tolerance when an item has none configured:
 *  kg eggs tolerate 1 kg of weighing drift; everything else must match exactly. */
export function defaultTolerance(unit: "kg" | "butir" | "pcs"): number {
  return unit === "kg" ? 1 : 0;
}

/** Configured per-item tolerance wins (0 is a valid "exact" override); otherwise the unit default. */
export function resolveTolerance(
  configured: number | undefined,
  unit: "kg" | "butir" | "pcs"
): number {
  return configured != null && configured >= 0 ? configured : defaultTolerance(unit);
}

export type VarianceStatus = "match" | "within" | "off";

export interface Variance {
  delta: number; // physicalJs - systemQty, rounded to 2 dp
  status: VarianceStatus;
}

/** Compare a physical JS-warehouse count against system stock, given a tolerance. */
export function computeVariance(
  physicalJs: number,
  systemQty: number,
  tolerance: number
): Variance {
  const delta = Math.round((physicalJs - systemQty) * 100) / 100;
  const abs = Math.abs(delta);
  const status: VarianceStatus = abs === 0 ? "match" : abs <= tolerance ? "within" : "off";
  return { delta, status };
}

/** Sum of the three location counts (blanks treated as zero), in the product's native unit. */
export function totalOnHand(counts: Partial<Record<StockLocation, number | null>>): number {
  return STOCK_LOCATIONS.reduce((sum, loc) => sum + (counts[loc] ?? 0), 0);
}

/** Parse a raw count input. Accepts the Indonesian decimal comma. Blank, invalid,
 *  or negative -> null (meaning "not counted"). */
export function parseCountInput(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed.replace(",", "."));
  return isNaN(n) || n < 0 ? null : n;
}
