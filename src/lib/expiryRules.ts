// Aturan Expired: the default Tgl Expired of a delivery line. Pure.
// Spec: docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md §6.8
import { addDays, addMonths, format } from "date-fns";
import type { ExpiryRule } from "@/types/deliveries";

// Keyword + base pack code, else keyword only, else the (null, null) default row.
// Keyword = case-insensitive substring of customerLabel ("Astro" matches "Astro CKD").
// No match -> null: the default is data, not a hardcoded fallback.
export function resolveShelfLife(rules: ExpiryRule[], customer: string, baseSkuCode: string): ExpiryRule | null {
  const c = customer.toLowerCase();
  const sku = baseSkuCode.trim().toUpperCase();
  const keyed = rules.filter((r) => r.buyerKeyword && c.includes(r.buyerKeyword.toLowerCase()));
  return (
    keyed.find((r) => r.skuCode && r.skuCode.trim().toUpperCase() === sku) ??
    keyed.find((r) => !r.skuCode) ??
    rules.find((r) => !r.buyerKeyword && !r.skuCode) ??
    null
  );
}

// yyyy-MM-dd + the rule, by local date. Months are calendar months with the day
// clamped to the month's end (31 Oct + 1 month = 30 Nov), as the sheet does.
export function expectedExpiry(deliveryDate: string, rule: ExpiryRule | null): string | null {
  if (!rule) return null;
  const [y, m, d] = deliveryDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const start = new Date(y, m - 1, d);
  if (rule.shelfMonths) return format(addMonths(start, rule.shelfMonths), "yyyy-MM-dd");
  if (rule.shelfDays) return format(addDays(start, rule.shelfDays), "yyyy-MM-dd");
  return null;
}
