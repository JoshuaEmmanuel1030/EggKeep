import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// One row per inflow whose stored remaining_butir disagrees with the ledger.
export interface ReconDiscrepancy {
  inflow_id: string;
  product: string;
  stored_remaining: number;
  expected_remaining: number;
  drift: number;
  kind: "negative" | "over_original" | "drift";
}

// Read-only wrapper over the reconcile_inventory() RPC. Returns discrepancies
// (empty array = stock is consistent). Never mutates — repairs go through
// Recalculate Inventory.
export function useReconciliation() {
  const [isLoading, setIsLoading] = useState(false);
  const [discrepancies, setDiscrepancies] = useState<ReconDiscrepancy[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reconcile = async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      // reconcile_inventory isn't in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc("reconcile_inventory" as any);
      if (error) throw error;
      setDiscrepancies((data as ReconDiscrepancy[]) ?? []);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconciliation failed");
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { reconcile, isLoading, discrepancies, error };
}
