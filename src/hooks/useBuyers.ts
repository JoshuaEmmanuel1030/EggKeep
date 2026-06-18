import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Buyer, BoxModeType } from "@/types/quickOutflow";

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

      return (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        defaultBoxMode: row.default_box_mode as BoxModeType,
      }));
    },
  });

  const addBuyer = useMutation({
    mutationFn: async ({ name, defaultBoxMode }: { name: string; defaultBoxMode: string }) => {
      const { data, error } = await supabase
        .from("buyers")
        .insert({ name, default_box_mode: defaultBoxMode })
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
    mutationFn: async ({ id, name, defaultBoxMode }: { id: string; name: string; defaultBoxMode: string }) => {
      const { data, error } = await supabase
        .from("buyers")
        .update({ name, default_box_mode: defaultBoxMode })
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
    deleteBuyer,
    restoreBuyer,
  };
}
