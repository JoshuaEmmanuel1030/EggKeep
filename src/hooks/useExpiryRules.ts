import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ExpiryRule } from "@/types/deliveries";

// Aturan Expired (table + seed; no editor). First reader of the table.
export function useExpiryRules() {
  return useQuery<ExpiryRule[]>({
    queryKey: ["expiry-rules"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("expiry_rules").select("*");
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r.id as string,
        buyerKeyword: (r.buyer_keyword as string | null) ?? null,
        skuCode: (r.sku_code as string | null) ?? null,
        shelfDays: (r.shelf_days as number | null) ?? null,
        shelfMonths: (r.shelf_months as number | null) ?? null,
        note: (r.note as string | null) ?? null,
      }));
    },
    staleTime: 60 * 60 * 1000,
  });
}
