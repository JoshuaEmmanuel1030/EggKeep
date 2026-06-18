import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PackSKU, PackSKUInput } from "@/types/catalog";

export function usePackSKUs() {
  const queryClient = useQueryClient();

  const { data: skus = [], isLoading, error, refetch } = useQuery({
    queryKey: ["pack_skus"],
    queryFn: async (): Promise<PackSKU[]> => {
      const { data, error } = await supabase
        .from("pack_skus")
        .select("*")
        .is("deleted_at", null)
        .order("code");

      if (error) throw error;

      return (data || []).map((row) => ({
        id: row.id,
        code: row.code,
        displayName: row.display_name,
        eggsPerPack: row.eggs_per_pack,
        eggProduct: row.egg_product,
        packagingItem: row.packaging_item,
        isActive: row.is_active,
        createdAt: row.created_at,
      }));
    },
  });

  const addSKU = useMutation({
    mutationFn: async (input: PackSKUInput) => {
      const { data, error } = await supabase
        .from("pack_skus")
        .insert({
          code: input.code,
          display_name: input.displayName,
          eggs_per_pack: input.eggsPerPack,
          egg_product: input.eggProduct,
          packaging_item: input.packagingItem || null,
          is_active: input.isActive ?? true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pack_skus"] });
    },
  });

  const updateSKU = useMutation({
    mutationFn: async ({ id, ...input }: PackSKUInput & { id: string }) => {
      const { data, error } = await supabase
        .from("pack_skus")
        .update({
          code: input.code,
          display_name: input.displayName,
          eggs_per_pack: input.eggsPerPack,
          egg_product: input.eggProduct,
          packaging_item: input.packagingItem || null,
          is_active: input.isActive ?? true,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pack_skus"] });
    },
  });

  // Soft delete - sets deleted_at timestamp
  const deleteSKU = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pack_skus")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pack_skus"] });
    },
  });

  // Restore a soft-deleted SKU
  const restoreSKU = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pack_skus")
        .update({ deleted_at: null })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pack_skus"] });
    },
  });

  return {
    skus,
    isLoading,
    error,
    refetch,
    addSKU,
    updateSKU,
    deleteSKU,
    restoreSKU,
  };
}
