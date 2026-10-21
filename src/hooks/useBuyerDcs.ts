import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// A buyer's distribution center (e.g. OSAVE -> "BKS").
export interface BuyerDc {
  id: string;
  buyerId: string;
  name: string;
}

// All DCs (a small list), sorted by name. Callers filter by buyer with
// dcsForBuyer(). If the table isn't reachable the list is just empty, so the
// Purchase Order builder keeps working without a DC picker.
export function useBuyerDcs() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["buyer_dcs"] });

  const { data: dcs = [], isLoading, error } = useQuery({
    queryKey: ["buyer_dcs"],
    queryFn: async (): Promise<BuyerDc[]> => {
      const { data, error } = await supabase.from("buyer_dcs").select("id, buyer_id, name").order("name");
      if (error) throw error;
      return (data || []).map((r) => ({ id: r.id, buyerId: r.buyer_id, name: r.name }));
    },
  });

  const addDc = useMutation({
    mutationFn: async ({ buyerId, name }: { buyerId: string; name: string }) => {
      const { error } = await supabase.from("buyer_dcs").insert({ buyer_id: buyerId, name: name.trim() });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteDc = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("buyer_dcs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const dcsForBuyer = (buyerId: string | null | undefined) =>
    buyerId ? dcs.filter((d) => d.buyerId === buyerId) : [];

  return { dcs, isLoading, error, dcsForBuyer, addDc, deleteDc };
}

// Postgres unique_violation: the buyer already has a DC with this name.
export function isDuplicateDcError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}
