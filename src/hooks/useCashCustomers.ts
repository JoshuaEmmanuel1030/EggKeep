import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCustomerName, sortCustomers, type CashCustomer } from "@/lib/cashCustomers";

// One identity while loading, so memos keyed on the list don't rerun each render.
const NONE: CashCustomer[] = [];
const COLUMNS = "id, name, is_active";
const toCustomer = (r: { id: string; name: string; is_active: boolean }): CashCustomer => ({ id: r.id, name: r.name, isActive: r.is_active });

// Kas Tunai customers: the drawer's pick list. Anyone signed in can add one
// (it happens mid-sale); rename / deactivate is an admin UI gate in Catalog.
export function useCashCustomers() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cash_customers"] });

  const { data: customers = NONE, isLoading, error } = useQuery({
    queryKey: ["cash_customers"],
    queryFn: async (): Promise<CashCustomer[]> => {
      const { data, error } = await supabase.from("cash_customers").select(COLUMNS).order("name");
      if (error) throw error;
      return sortCustomers((data || []).map(toCustomer));
    },
  });

  const addCustomer = useMutation({
    mutationFn: async ({ name }: { name: string }): Promise<CashCustomer> => {
      const { data, error } = await supabase
        .from("cash_customers")
        .insert({ name: normalizeCustomerName(name) })
        .select(COLUMNS)
        .single();
      if (error) throw error;
      return toCustomer(data);
    },
    // Also on error: a duplicate means the list here was stale.
    onSettled: invalidate,
  });

  const updateCustomer = useMutation({
    mutationFn: async ({ id, name, isActive }: { id: string; name?: string; isActive?: boolean }) => {
      const patch: { name?: string; is_active?: boolean } = {};
      if (name !== undefined) patch.name = normalizeCustomerName(name);
      if (isActive !== undefined) patch.is_active = isActive;
      // .select().single() makes an RLS-blocked (0-row) update error instead of silently succeeding.
      const { error } = await supabase.from("cash_customers").update(patch).eq("id", id).select("id").single();
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { customers, isLoading, error, addCustomer, updateCustomer };
}
