import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { InflowEntry, OutflowEntry, InventoryCategory } from "@/types/inventory";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { captureError } from "@/lib/monitoring";
import { OutflowSubmitResult } from "@/lib/outflowOutbox";
import { callRecordOrderOutflows } from "@/lib/outflowRpc";

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

  // Refetch when the tab regains focus so two devices don't show two different
  // stock levels (PWA sessions stay open all day on the warehouse phones).
  useEffect(() => {
    if (!user) return;
    const onFocus = () => fetchData();
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, fetchData]);

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
        captureError(error, { operation: "inflow_insert", product: entry.product });
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
        captureError(error, { operation: "inflow_insert_batch", count: entries.length });
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

  // Record ALL entries of one order (eggs + packaging + labels + boxes) atomically
  // via the record_order_outflows RPC. The database does the FIFO deduction inside
  // one transaction with row locks, so either the whole order goes through or none
  // of it does — and concurrent submits from two devices can't overwrite each
  // other's deductions (the old client-side FIFO wrote stale absolute values).
  const submitOrderOutflows = useCallback(
    async (entries: OutflowEntry[]): Promise<OutflowSubmitResult> => {
      if (!user || entries.length === 0) {
        return { ok: false, kind: "server", message: "NO_ENTRIES" };
      }

      const result = await callRecordOrderOutflows(entries);

      if (result.ok) {
        // Refetch instead of patching local state: the DB computed the deductions,
        // so its remaining_butir values are the only correct ones.
        await fetchData();
        return result;
      }

      // Network failures are NOT toasted here: the caller queues the order in
      // the offline outbox and shows its own "saved offline" toast instead.
      if (result.kind === "server") {
        const message = result.message ?? "";
        const shortStock = message.includes("INSUFFICIENT_STOCK");
        captureError(new Error(message || "record_order_outflows failed"), {
          operation: "rpc_record_order_outflows",
          entryCount: entries.length,
          insufficientStock: shortStock,
        });
        toast({
          title: shortStock ? "Insufficient Stock" : "Error",
          description: shortStock
            ? `${message.replace(/^.*INSUFFICIENT_STOCK:\s*/, "")} — nothing was deducted.`
            : "Failed to save outflow — nothing was deducted.",
          variant: "destructive",
        });
      }
      return result;
    },
    [user, fetchData]
  );

  return {
    inflows,
    outflows,
    loading,
    addInflow,
    addMultipleInflows,
    submitOrderOutflows,
    refetch: fetchData,
  };
}
