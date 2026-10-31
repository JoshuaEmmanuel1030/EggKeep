import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeDriverName, sortDrivers } from "@/lib/drivers";
import type { Driver } from "@/types/deliveries";

export { isDuplicateDriverError } from "@/lib/drivers";

// Drivers (Supir) for the delivery log: a small catalog list, active first.
// Admin-only editing is a UI gate (Catalog → Supir), like buyers.
export function useDrivers() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["drivers"] });

  const { data: drivers = [], isLoading, error } = useQuery({
    queryKey: ["drivers"],
    queryFn: async (): Promise<Driver[]> => {
      const { data, error } = await supabase.from("drivers").select("id, name, is_active, created_at").order("name");
      if (error) throw error;
      return sortDrivers(
        (data || []).map((r) => ({ id: r.id, name: r.name, isActive: r.is_active, createdAt: r.created_at }))
      );
    },
  });

  const addDriver = useMutation({
    mutationFn: async ({ name }: { name: string }): Promise<Driver> => {
      const { data, error } = await supabase
        .from("drivers")
        .insert({ name: normalizeDriverName(name) })
        .select("id, name, is_active, created_at")
        .single();
      if (error) throw error;
      return { id: data.id, name: data.name, isActive: data.is_active, createdAt: data.created_at };
    },
    // Returned so mutateAsync resolves only after ["drivers"] has refetched.
    onSuccess: invalidate,
  });

  const updateDriver = useMutation({
    mutationFn: async ({ id, name, isActive }: { id: string; name?: string; isActive?: boolean }) => {
      const patch: { name?: string; is_active?: boolean } = {};
      if (name !== undefined) patch.name = normalizeDriverName(name);
      if (isActive !== undefined) patch.is_active = isActive;
      // .select().single() makes an RLS-blocked (0-row) update error instead of silently succeeding.
      const { error } = await supabase.from("drivers").update(patch).eq("id", id).select("id").single();
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const activeDrivers = drivers.filter((d) => d.isActive);

  return { drivers, activeDrivers, isLoading, error, addDriver, updateDriver };
}
