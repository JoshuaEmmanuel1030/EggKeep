// Pure logic for the physical stock-count page: locations, per-item tolerance,
// variance vs system stock, and per-product total on hand. Also the parser every
// typed stock quantity goes through (parseQtyInput). No I/O, no React.

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

/** Parse a typed quantity in its unit. The screens print id-ID ("1.500 butir") and
 *  staff type what they read, so a dot must never quietly mean 1,5.
 *  butir/pcs: whole numbers, a dot is thousands ("1.500" = 1500; "2,5" is invalid).
 *  kg (owner's call, 2026-11-09): read as the screens print it, so a dot before three
 *  digits groups thousands and a comma after them is the decimal ("1.500" = 1500,
 *  "12.345,67" = 12345,67). Otherwise one decimal separator, comma or dot ("52,89",
 *  "52.89", "1,500" = 1,5); a leading zero can't be thousands ("0.500" = 0,5).
 *  Blank or unreadable -> null; 0 is a number. */
export function parseQtyInput(raw: string, unit: "kg" | "butir" | "pcs"): number | null {
  const s = (raw ?? "").trim();
  if (unit !== "kg") {
    return /^\d+$/.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, "")) : null;
  }
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  return /^\d+([.,]\d+)?$/.test(s) ? Number(s.replace(",", ".")) : null;
}

/** A stored quantity as input text. The decimal comma makes a stored 2.125 kg read
 *  back as itself: "2.125" would read as 2125 kg above. */
export const qtyInputText = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
