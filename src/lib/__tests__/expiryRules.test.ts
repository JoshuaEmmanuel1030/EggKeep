import { describe, it, expect } from "vitest";
import { resolveShelfLife, expectedExpiry } from "@/lib/expiryRules";
import type { ExpiryRule } from "@/types/deliveries";

const rule = (buyerKeyword: string | null, skuCode: string | null, shelfDays: number | null, shelfMonths: number | null = null): ExpiryRule => ({
  id: `${buyerKeyword}-${skuCode}`,
  buyerKeyword,
  skuCode,
  shelfDays,
  shelfMonths,
  note: null,
});

// The migration's seed (20261103000000, §6.2.7).
const SEED: ExpiryRule[] = [
  rule("Astro", null, 22),
  rule("Astro", "N15B", 21), rule("Astro", "N15O", 21), rule("Astro", "N30B", 21), rule("Astro", "N30O", 21),
  rule("Astro", "BK4AMTG", 14),
  rule("Segari", null, null, 1),
  rule("Segari", "BK4AMTG", 14),
  rule("Sayurbox", null, 14),
  rule("Sayurbox", "P25", 21),
  rule("Sayurbox", "KP6B", null, 1), rule("Sayurbox", "KP6O", null, 1),
  rule("Sayurbox", "N4", null, 1),
  rule(null, null, null, 1),
];

describe("resolveShelfLife", () => {
  it("keyword + SKU beats keyword only, which beats the default", () => {
    expect(resolveShelfLife(SEED, "Astro CKD", "N15B")?.shelfDays).toBe(21);
    expect(resolveShelfLife(SEED, "Astro CKD", "P25")?.shelfDays).toBe(22);
    expect(resolveShelfLife(SEED, "Osave DPK", "N10B")?.shelfMonths).toBe(1);
  });
  it("matches the keyword as a case-insensitive substring", () => {
    expect(resolveShelfLife(SEED, "astro ckd", "N30O")?.shelfDays).toBe(21);
  });
  it("OSVKP6O on Sayurbox resolves through its base pack KP6O -> 1 month", () => {
    expect(resolveShelfLife(SEED, "Sayurbox", "KP6O")?.shelfMonths).toBe(1);
  });
  it("no rules -> null", () => {
    expect(resolveShelfLife([], "Osave", "N10B")).toBeNull();
  });
});

describe("expectedExpiry", () => {
  it("Osave 19 Oct + 1 month (default row) -> 19 Nov", () => {
    expect(expectedExpiry("2026-10-19", resolveShelfLife(SEED, "Osave DPK", "N10B"))).toBe("2026-11-19");
  });
  it("31 Oct + 1 month -> 30 Nov (day clamped to the month's end)", () => {
    expect(expectedExpiry("2026-10-31", rule(null, null, null, 1))).toBe("2026-11-30");
  });
  it("Sayurbox P25 21 Oct + 21 days -> 11 Nov; Astro P25 -> Astro default 22 days -> 12 Nov", () => {
    expect(expectedExpiry("2026-10-21", resolveShelfLife(SEED, "Sayurbox", "P25"))).toBe("2026-11-11");
    expect(expectedExpiry("2026-10-21", resolveShelfLife(SEED, "Astro", "P25"))).toBe("2026-11-12");
  });
  it("no rule -> null", () => {
    expect(expectedExpiry("2026-10-19", null)).toBeNull();
  });
  it("is local-date arithmetic (no UTC shift)", () => {
    expect(expectedExpiry("2026-10-19", rule(null, null, null, 1))).toBe("2026-11-19");
    expect(expectedExpiry("2026-12-31", rule(null, null, 1))).toBe("2027-01-01");
  });
});
