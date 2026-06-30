import { useState, useEffect, useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ItemType, InventoryCategory, ConversionMap, buildConversionMap } from "@/types/inventory";
import { BoxCapacityMap, buildBoxCapacityMap } from "@/lib/outflowCalculator";

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
        // New conversion columns (egg-only). Older rows may not have them yet.
        unit: (row as { unit?: string | null }).unit as "kg" | "btr" | undefined,
        eggsPerUnit: (row as { eggs_per_unit?: number | null }).eggs_per_unit ?? undefined,
        // Box-only packs-per-box map (JSONB). Null/absent for non-box or unconfigured rows.
        boxCapacities:
          ((row as { box_capacities?: Record<string, number> | null }).box_capacities as
            | Record<string, number>
            | null) ?? undefined,
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

  // Authoritative egg conversion table: configured DB egg rows over the baseline.
  const conversionMap: ConversionMap = useMemo(
    () => buildConversionMap(itemTypes.filter((t) => t.category === "egg")),
    [itemTypes]
  );

  // Egg product names for dropdowns: catalog egg types plus any baseline names
  // that aren't (yet) in the catalog, so nothing silently disappears.
  const eggProductNames: string[] = useMemo(
    () => Object.keys(conversionMap).sort(),
    [conversionMap]
  );

  // Authoritative box-capacity table: configured DB box rows over the baseline.
  const boxCapacityMap: BoxCapacityMap = useMemo(
    () => buildBoxCapacityMap(itemTypes.filter((t) => t.category === "box")),
    [itemTypes]
  );

  const addItemType = useMutation({
    mutationFn: async ({
      name,
      category,
      unit,
      eggsPerUnit,
      boxCapacities,
    }: {
      name: string;
      category: InventoryCategory;
      unit?: "kg" | "btr";
      eggsPerUnit?: number;
      boxCapacities?: Record<string, number>;
    }) => {
      const { data, error } = await supabase
        .from("item_types")
        .insert({
          name,
          category,
          unit: unit ?? null,
          eggs_per_unit: eggsPerUnit ?? null,
          box_capacities: boxCapacities ?? null,
        })
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
    mutationFn: async ({
      id,
      name,
      unit,
      eggsPerUnit,
      boxCapacities,
    }: {
      id: string;
      name: string;
      unit?: "kg" | "btr";
      eggsPerUnit?: number;
      boxCapacities?: Record<string, number>;
    }) => {
      const { data, error } = await supabase
        .from("item_types")
        .update({
          name,
          unit: unit ?? null,
          eggs_per_unit: eggsPerUnit ?? null,
          box_capacities: boxCapacities ?? null,
        })
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
    conversionMap,
    eggProductNames,
    boxCapacityMap,
    refetch: fetchItemTypes,
    addItemType,
    updateItemType,
    deleteItemType,
    restoreItemType,
  };
}
