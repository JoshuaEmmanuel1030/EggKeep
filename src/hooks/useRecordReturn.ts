import { useState, useCallback } from "react";
import { RecordReturnInput } from "@/types/returns";
import { callRecordReturn, ReturnSubmitResult } from "@/lib/returnRpc";

/**
 * Records one or more returned order lines against their original outflow(s).
 *
 * Contract (see docs/superpowers/specs/2026-09-03-returns-design.md):
 *   - Calls the atomic `record_return` Postgres RPC (all-or-nothing, row-locked FIFO,
 *     idempotent by client line id — same guarantees as record_order_outflows).
 *   - "restock" lines reverse the outflow's fifo_deductions oldest-batch-first.
 *   - "retakan" lines add a fresh inflow to the parent's auto-created RETAKAN child.
 *   - "writeoff" lines insert a return row and touch NO stock.
 *   - Returns a classified result: kind="network" is safe for the caller to queue
 *     in the offline return outbox; kind="server" was definitively rejected.
 */
export function useRecordReturn() {
  const [saving, setSaving] = useState(false);

  const recordReturn = useCallback(
    async (input: RecordReturnInput): Promise<ReturnSubmitResult> => {
      setSaving(true);
      try {
        const result = await callRecordReturn(input);
        if (!result.ok) console.error("Error recording return:", result.message);
        return result;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  return { recordReturn, saving };
}
