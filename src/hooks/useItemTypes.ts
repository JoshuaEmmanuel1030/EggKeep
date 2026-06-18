import { useState, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ItemType, InventoryCategory } from "@/types/inventory";

export function useItemTypes() {
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const fetchItemTypes = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("item_types")
        .select("*")
        .is("deleted_at", null)
        .order("name");

      if (error) throw error;

      const mapped: ItemType[] = (data || []).map((row) => ({
        id: row.id,
        category: row.category as InventoryCategory,
        name: row.name,
      }));

      setItemTypes(mapped);
    } catch (error) {
      console.error("Error fetching item types:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItemTypes();
  }, [fetchItemTypes]);

  const getTypesByCategory = useCallback(
    (category: InventoryCategory): ItemType[] => {
      return itemTypes.filter((t) => t.category === category);
    },
    [itemTypes]
  );

  const addItemType = useMutation({
    mutationFn: async ({ name, category }: { name: string; category: InventoryCategory }) => {
      const { data, error } = await supabase
        .from("item_types")
        .insert({ name, category })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      fetchItemTypes();
    },
  });

  const updateItemType = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase
        .from("item_types")
        .update({ name })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      fetchItemTypes();
    },
  });

  // Soft delete - sets deleted_at timestamp
  const deleteItemType = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("item_types")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      fetchItemTypes();
    },
  });

  // Restore a soft-deleted item type
  const restoreItemType = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("item_types")
        .update({ deleted_at: null })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      fetchItemTypes();
    },
  });

  return {
    itemTypes,
    loading,
    getTypesByCategory,
    refetch: fetchItemTypes,
    addItemType,
    updateItemType,
    deleteItemType,
    restoreItemType,
  };
}
