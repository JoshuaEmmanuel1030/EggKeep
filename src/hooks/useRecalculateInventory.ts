import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface RecalculationResult {
  product_name: string;
  outflows_processed: number;
  deductions_created: number;
  total_deducted: number;
}

export function useRecalculateInventory() {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<RecalculationResult[] | null>(null);
  const { toast } = useToast();

  const recalculate = async (): Promise<boolean> => {
    setIsLoading(true);
    setResults(null);

    try {
      // Use direct SQL RPC call since the function isn't in the types yet
      const { data, error } = await supabase.rpc(
        "recalculate_inventory_fifo" as any
      );

      if (error) {
        console.error("Recalculation error:", error);
        toast({
          title: "Recalculation Failed",
          description: error.message,
          variant: "destructive",
        });
        return false;
      }

      const resultData = data as RecalculationResult[] | null;
      setResults(resultData);
      toast({
        title: "Inventory Recalculated",
        description: `Successfully processed ${resultData?.length || 0} products`,
      });
      return true;
    } catch (err) {
      console.error("Recalculation error:", err);
      toast({
        title: "Recalculation Failed",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { recalculate, isLoading, results };
}
