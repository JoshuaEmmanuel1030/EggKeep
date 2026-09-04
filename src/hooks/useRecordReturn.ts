import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RecordReturnInput } from "@/types/returns";

export interface RecordReturnResult {
  ok: boolean;
  message?: string;
}

/**
 * Records one or more returned order lines against their original outflow(s).
 *
 * Contract (backend spec — see docs/superpowers/specs/2026-09-03-returns-design.md):
 *   - Calls the atomic `record_return` Postgres RPC (all-or-nothing, row-locked FIFO,
 *     idempotent by client line id — same guarantees as record_order_outflows).
 *   - "restock" lines reverse the outflow's fifo_deductions oldest-batch-first, so
 *     returned eggs go back to their real batch at their real age.
 *   - "writeoff" lines insert a return row and touch NO stock.
 *   - The RPC rejects RETURN_EXCEEDS_OUTFLOW if cumulative returns exceed the outflow qty.
 *
 * NOTE: the `record_return` RPC + `returns`/`return_restocks` migration are not yet
 * applied. Until then this hook resolves the interface the CTA is built against; the
 * live call will start succeeding once the migration ships (deploy DB before frontend).
 */
export function useRecordReturn() {
  const [saving, setSaving] = useState(false);

  const recordReturn = useCallback(
    async (input: RecordReturnInput): Promise<RecordReturnResult> => {
      setSaving(true);
      try {
        // Cast: `record_return` isn't in the generated types until the migration is
        // applied and types are regenerated. Remove the cast after that.
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
            })),
          },
        });
        if (error) throw error;
        return { ok: true };
      } catch (e) {
        const message = (e as { message?: string })?.message ?? String(e);
        console.error("Error recording return:", e);
        return { ok: false, message };
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return { recordReturn, saving };
}
