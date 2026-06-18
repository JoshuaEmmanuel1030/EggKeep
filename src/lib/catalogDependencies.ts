import { supabase } from "@/integrations/supabase/client";

export interface DependencyCheckResult {
  hasDependencies: boolean;
  dependencyCount: number;
  dependencyDetails: string[];
}

/**
 * Check if a SKU is used in outflows
 */
export async function checkSKUDependencies(skuCode: string): Promise<DependencyCheckResult> {
  const details: string[] = [];
  let totalCount = 0;

  // Check outflows metadata for SKU references
  const { count: outflowCount, error: outflowError } = await supabase
    .from("outflows")
    .select("*", { count: "exact", head: true })
    .or(`invoice_supplier.ilike.%${skuCode}%`);

  if (!outflowError && outflowCount && outflowCount > 0) {
    details.push(`outflows:${outflowCount}`);
    totalCount += outflowCount;
  }

  return {
    hasDependencies: totalCount > 0,
    dependencyCount: totalCount,
    dependencyDetails: details,
  };
}

/**
 * Check if an item type is used in inflows, outflows, or SKUs
 */
export async function checkItemTypeDependencies(
  itemName: string,
  category: "egg" | "box" | "label" | "packaging"
): Promise<DependencyCheckResult> {
  const details: string[] = [];
  let totalCount = 0;

  // Check inflows
  const { count: inflowCount, error: inflowError } = await supabase
    .from("inflows")
    .select("*", { count: "exact", head: true })
    .eq("product", itemName)
    .eq("category", category);

  if (!inflowError && inflowCount && inflowCount > 0) {
    details.push(`inflows:${inflowCount}`);
    totalCount += inflowCount;
  }

  // Check outflows
  const { count: outflowCount, error: outflowError } = await supabase
    .from("outflows")
    .select("*", { count: "exact", head: true })
    .eq("product", itemName)
    .eq("category", category);

  if (!outflowError && outflowCount && outflowCount > 0) {
    details.push(`outflows:${outflowCount}`);
    totalCount += outflowCount;
  }

  // For egg types, check if used in SKUs
  if (category === "egg") {
    const { count: skuEggCount, error: skuEggError } = await supabase
      .from("pack_skus")
      .select("*", { count: "exact", head: true })
      .eq("egg_product", itemName)
      .is("deleted_at", null);

    if (!skuEggError && skuEggCount && skuEggCount > 0) {
      details.push(`skus:${skuEggCount}`);
      totalCount += skuEggCount;
    }
  }

  // For packaging, check if used in SKUs
  if (category === "packaging") {
    const { count: skuPackCount, error: skuPackError } = await supabase
      .from("pack_skus")
      .select("*", { count: "exact", head: true })
      .eq("packaging_item", itemName)
      .is("deleted_at", null);

    if (!skuPackError && skuPackCount && skuPackCount > 0) {
      details.push(`skus:${skuPackCount}`);
      totalCount += skuPackCount;
    }
  }

  return {
    hasDependencies: totalCount > 0,
    dependencyCount: totalCount,
    dependencyDetails: details,
  };
}

/**
 * Check if a buyer is used in outflows
 */
export async function checkBuyerDependencies(buyerName: string): Promise<DependencyCheckResult> {
  const details: string[] = [];
  let totalCount = 0;

  // Check outflows for buyer references in invoice_supplier
  const { count: outflowCount, error: outflowError } = await supabase
    .from("outflows")
    .select("*", { count: "exact", head: true })
    .ilike("invoice_supplier", `%${buyerName}%`);

  if (!outflowError && outflowCount && outflowCount > 0) {
    details.push(`outflows:${outflowCount}`);
    totalCount += outflowCount;
  }

  return {
    hasDependencies: totalCount > 0,
    dependencyCount: totalCount,
    dependencyDetails: details,
  };
}
