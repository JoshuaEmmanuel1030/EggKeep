import { supabase } from "@/integrations/supabase/client";
import { RecordReturnInput } from "@/types/returns";
import { classifyOutflowError } from "@/lib/outflowOutbox";

// Single source for the record_return RPC call, shared by the live submit
// (useRecordReturn) and the offline outbox replay (useReturnOutbox) so both
// classify failures identically. Mirrors src/lib/outflowRpc.ts.
export interface ReturnSubmitResult {
  ok: boolean;
  /** Set when ok is false. "network" = safe to queue; "server" = definitively rejected. */
  kind?: "network" | "server";
  message?: string;
}

export async function callRecordReturn(input: RecordReturnInput): Promise<ReturnSubmitResult> {
  try {
    // Cast: record_return isn't in the generated types until the migration types
    // are regenerated (same as the returns table). Remove after that.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("record_return", {
      p_return: {
        return_date: input.returnDate,
        buyer_name: input.buyerName ?? null,
        reason: input.reason ?? null,
        lines: input.lines.map((l) => ({
          id: l.id,
          outflow_id: l.outflowId,
          product: l.product,
          category: l.category,
          quantity: l.quantity,
          disposition: l.disposition,
          sku_code: l.skuCode ?? null,
        })),
      },
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    const online = typeof navigator === "undefined" || navigator.onLine;
    // record_return errors (RETURN_EXCEEDS_OUTFLOW, RESTOCK_EXCEEDS_DEDUCTED,
    // OUTFLOW_VOIDED, PARENT_TYPE_MISSING...) carry a Postgres code -> "server",
    // so they are never queued on first submit.
    const kind = classifyOutflowError(e, online);
    const message = (e as { message?: string })?.message ?? String(e);
    return { ok: false, kind, message };
  }
}
