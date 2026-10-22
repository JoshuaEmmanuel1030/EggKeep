import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Buyer } from "@/types/quickOutflow";

export function useBuyers() {
  const queryClient = useQueryClient();

  const { data: buyers = [], isLoading, error, refetch } = useQuery({
    queryKey: ["buyers"],
    queryFn: async (): Promise<Buyer[]> => {
      const { data, error } = await supabase
        .from("buyers")
        .select("*")
        .is("deleted_at", null)
        .order("name");

      if (error) throw error;

      return (data || []).map((row) => ({ id: row.id, name: row.name, pinnedSkuIds: row.pinned_sku_ids ?? [] }));
    },
  });

  // default_box_mode is no longer set from the UI (boxes come from box SKUs);
  // the column keeps its DB default and existing values.
  const addBuyer = useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      const { data, error } = await supabase
        .from("buyers")
        .insert({ name })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
    },
  });

  const updateBuyer = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase
        .from("buyers")
        .update({ name })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
    },
  });

  // Admin-only in the UI. Replaces the buyer's pinned SKU list.
  const setPinnedSkus = useMutation({
    mutationFn: async ({ id, skuIds }: { id: string; skuIds: string[] }) => {
      // .select("id").single() makes an RLS-blocked (0-row) update error instead of silently succeeding.
      const { error } = await supabase.from("buyers").update({ pinned_sku_ids: skuIds }).eq("id", id).select("id").single();
      if (error) throw error;
    },
    // Returned so mutateAsync resolves only after ["buyers"] has refetched (no stale seed on reopen).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["buyers"] }),
  });

  // Soft delete - sets deleted_at timestamp
  const deleteBuyer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("buyers")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
    },
  });

  // Restore a soft-deleted buyer
  const restoreBuyer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("buyers")
        .update({ deleted_at: null })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
    },
  });

  return {
    buyers,
    isLoading,
    error,
    refetch,
    addBuyer,
    updateBuyer,
    setPinnedSkus,
    deleteBuyer,
    restoreBuyer,
  };
}
