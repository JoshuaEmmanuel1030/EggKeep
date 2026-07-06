import { supabase } from "@/integrations/supabase/client";
import { OutflowEntry } from "@/types/inventory";
import { classifyOutflowError, OutflowSubmitResult } from "@/lib/outflowOutbox";

/**
 * Call the atomic record_order_outflows RPC and classify any failure as
 * network (queueable) vs server (rejected). Shared by the live submit path
 * (useInventorySync) and the offline-outbox replay (useOutflowOutbox) so both
 * go through exactly the same RPC and error classification.
 *
 * quantity_butir carries each product's NATIVE stock unit (kg for weight-sold
 * eggs, butir for count eggs, pcs otherwise) — no conversions here by design.
 */
export async function callRecordOrderOutflows(
  entries: OutflowEntry[]
): Promise<OutflowSubmitResult> {
  try {
    const { error } = await supabase.rpc("record_order_outflows", {
      p_entries: entries.map((entry) => ({
        id: entry.id,
        date: entry.date,
        product: entry.product,
        quantity_butir: entry.quantityInButir,
        category: entry.category,
        invoice_supplier: entry.invoiceSupplier || null,
      })),
    });

    if (error) throw error;
    return { ok: true };
  } catch (error) {
    console.error("Error recording order outflows:", error);
    // Supabase PostgrestError is a plain object in some versions — read
    // .message directly rather than relying on instanceof Error.
    const message = (error as { message?: string })?.message ?? String(error);
    return {
      ok: false,
      kind: classifyOutflowError(error, navigator.onLine),
      message,
    };
  }
}
