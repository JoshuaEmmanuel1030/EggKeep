import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { InflowEntry, OutflowEntry, InventoryCategory } from "@/types/inventory";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

export function useInventorySync() {
  const { user } = useAuth();
  const [inflows, setInflows] = useState<InflowEntry[]>([]);
  const [outflows, setOutflows] = useState<OutflowEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch all data from the database
  const fetchData = useCallback(async () => {
    try {
      // Exclude voided rows so a voided inflow drops out of stock immediately and
      // is never used as a FIFO source for new outflows.
      const [inflowResult, outflowResult] = await Promise.all([
        supabase.from("inflows").select("*").is("voided_at", null).order("created_at", { ascending: true }),
        supabase.from("outflows").select("*").is("voided_at", null).order("created_at", { ascending: true }),
      ]);

      if (inflowResult.error) throw inflowResult.error;
      if (outflowResult.error) throw outflowResult.error;

      const mappedInflows: InflowEntry[] = (inflowResult.data || []).map((row) => ({
        id: row.id,
        date: row.date,
        product: row.product,
        quantity: Number(row.quantity_original),
        unit: row.product === "NEGERI BIASA" || row.product === "NEGERI OMEGA" ? "kg" : "pcs",
        quantityInButir: Number(row.quantity_butir),
        remainingButir: Number(row.remaining_butir),
        createdAt: row.created_at,
        category: (row.category as InventoryCategory) || 'egg',
        invoiceSupplier: row.invoice_supplier || undefined,
      }));

      const mappedOutflows: OutflowEntry[] = (outflowResult.data || []).map((row) => ({
        id: row.id,
        date: row.date,
        product: row.product,
        quantityInButir: Number(row.quantity_butir),
        createdAt: row.created_at,
        category: (row.category as InventoryCategory) || 'egg',
        invoiceSupplier: row.invoice_supplier || undefined,
      }));

      setInflows(mappedInflows);
      setOutflows(mappedOutflows);
    } catch (error) {
      console.error("Error fetching inventory:", error);
      toast({
        title: "Error",
        description: "Failed to load inventory data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [fetchData, user]);

  // Add inflow to database
  const addInflow = useCallback(
    async (entry: InflowEntry) => {
      if (!user) return false;

      try {
        const { error } = await supabase.from("inflows").insert({
          id: entry.id,
          date: entry.date,
          product: entry.product,
          quantity_original: entry.quantity,
          quantity_butir: entry.quantityInButir,
          remaining_butir: entry.remainingButir,
          user_id: user.id,
          category: entry.category,
          invoice_supplier: entry.invoiceSupplier || null,
        });

        if (error) throw error;

        setInflows((prev) => [...prev, entry]);
        return true;
      } catch (error) {
        console.error("Error adding inflow:", error);
        toast({
          title: "Error",
          description: "Failed to save inflow",
          variant: "destructive",
        });
        return false;
      }
    },
    [user]
  );

  // Add multiple inflows at once
  const addMultipleInflows = useCallback(
    async (entries: InflowEntry[]) => {
      if (!user || entries.length === 0) return false;

      try {
        const insertData = entries.map((entry) => ({
          id: entry.id,
          date: entry.date,
          product: entry.product,
          quantity_original: entry.quantity,
          quantity_butir: entry.quantityInButir,
          remaining_butir: entry.remainingButir,
          user_id: user.id,
          category: entry.category,
          invoice_supplier: entry.invoiceSupplier || null,
        }));

        const { error } = await supabase.from("inflows").insert(insertData);

        if (error) throw error;

        setInflows((prev) => [...prev, ...entries]);
        return true;
      } catch (error) {
        console.error("Error adding multiple inflows:", error);
        toast({
          title: "Error",
          description: "Failed to save inflows",
          variant: "destructive",
        });
        return false;
      }
    },
    [user]
  );

  // Add outflow and update inflows (FIFO) - only for eggs
  const addOutflow = useCallback(
    async (entry: OutflowEntry, quantityToRemove: number) => {
      if (!user) return false;
      
      try {
        // Get inflows for this product with stock remaining
        // Sort by business date (physical arrival) for FIFO, createdAt as tiebreaker
        const productInflows = inflows
          .filter((i) => i.product === entry.product && i.remainingButir > 0 && i.category === entry.category)
          .sort((a, b) => {
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) return dateCompare;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          });

        // Check available stock before proceeding
        const availableStock = productInflows.reduce((sum, i) => sum + i.remainingButir, 0);
        if (quantityToRemove > availableStock) {
          toast({
            title: "Insufficient Stock",
            description: `Only ${availableStock.toLocaleString()} available for ${entry.product}. Requested: ${quantityToRemove.toLocaleString()}`,
            variant: "destructive",
          });
          return false;
        }

        // Calculate FIFO deductions
        let remaining = quantityToRemove;
        const updates: { id: string; remaining_butir: number; deducted: number }[] = [];

        for (const inflow of productInflows) {
          if (remaining <= 0) break;
          const toDeduct = Math.min(inflow.remainingButir, remaining);
          updates.push({
            id: inflow.id,
            remaining_butir: inflow.remainingButir - toDeduct,
            deducted: toDeduct,
          });
          remaining -= toDeduct;
        }

        // Update inflows with FIFO deductions
        for (const update of updates) {
          const { error: updateError } = await supabase
            .from("inflows")
            .update({ remaining_butir: update.remaining_butir })
            .eq("id", update.id);

          if (updateError) throw updateError;
        }

        // Insert outflow record
        const { error: outflowError } = await supabase.from("outflows").insert({
          id: entry.id,
          date: entry.date,
          product: entry.product,
          quantity_butir: entry.quantityInButir,
          user_id: user.id,
          category: entry.category,
          invoice_supplier: entry.invoiceSupplier || null,
        });

        if (outflowError) throw outflowError;

        // Record FIFO deductions for audit trail
        const fifoRecords = updates
          .filter((u) => u.deducted > 0)
          .map((u) => ({
            outflow_id: entry.id,
            inflow_id: u.id,
            quantity_deducted: u.deducted,
          }));

        if (fifoRecords.length > 0) {
          const { error: fifoError } = await supabase
            .from("fifo_deductions")
            .insert(fifoRecords);

          if (fifoError) {
            console.error("Error recording FIFO deductions:", fifoError);
            // Don't throw - outflow was successful, this is just audit logging
          }
        }

        // Update local state
        setInflows((prev) =>
          prev.map((i) => {
            const update = updates.find((u) => u.id === i.id);
            return update ? { ...i, remainingButir: update.remaining_butir } : i;
          })
        );

        setOutflows((prev) => [...prev, entry]);

        return true;
      } catch (error) {
        console.error("Error adding outflow:", error);
        toast({
          title: "Error",
          description: "Failed to save outflow",
          variant: "destructive",
        });
        return false;
      }
    },
    [inflows, user]
  );

  // Add multiple outflows at once
  const addMultipleOutflows = useCallback(
    async (entries: OutflowEntry[]) => {
      if (!user || entries.length === 0) return false;

      try {
        for (const entry of entries) {
          const success = await addOutflow(entry, entry.quantityInButir);
          if (!success) return false;
        }
        return true;
      } catch (error) {
        console.error("Error adding multiple outflows:", error);
        return false;
      }
    },
    [user, addOutflow]
  );

  return {
    inflows,
    outflows,
    loading,
    addInflow,
    addMultipleInflows,
    addOutflow,
    addMultipleOutflows,
    refetch: fetchData,
  };
}
