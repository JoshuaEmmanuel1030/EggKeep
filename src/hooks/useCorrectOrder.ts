import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useLanguage } from "@/contexts/LanguageContext";
import { toRpcEntries, toOutflowLogPayloads } from "@/lib/orderPayload";
import { correctionErrorCode } from "@/lib/orderCorrection";
import type { OutflowEntry } from "@/types/inventory";

// One corrected activity-log row: what toOutflowLogPayloads makes, plus the ids
// the correct_order RPC inserts it under.
export type CorrectedLogPayload = ReturnType<typeof toOutflowLogPayloads>[number] & {
  id: string;
  client_id: string;
};

export interface CorrectOrderInput {
  oldLogIds: string[]; // live activity-log rows of the order being replaced
  entries: OutflowEntry[]; // corrected stock entries (fresh UUIDs)
  logs: CorrectedLogPayload[]; // one per entry
  reason: string; // void reason stored on the replaced rows
}

// Saves an "Edit order" through the atomic correct_order RPC (voids the
// original outflows, records the corrected ones, swaps the activity logs —
// all or nothing). Toasts the outcome; resolves true on success.
export function useCorrectOrder() {
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false); // ref, not state: blocks a double tap before re-render

  const correctOrder = useCallback(
    async ({ oldLogIds, entries, logs, reason }: CorrectOrderInput): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setSaving(true);
      try {
        const { error } = await supabase.rpc("correct_order", {
          p_old_log_ids: oldLogIds,
          p_entries: toRpcEntries(entries),
          p_logs: logs as unknown as Json,
          p_reason: reason,
        });
        if (error) throw error;
        toast.success(t.activity.orderEdited);
        return true;
      } catch (error) {
        // Supabase errors are plain objects: read .message, not instanceof Error.
        const message = (error as { message?: string })?.message ?? String(error);
        console.error("Error editing order:", message);
        const descriptions = {
          INSUFFICIENT_STOCK: t.activity.editErrInsufficient,
          EDIT_WINDOW_CLOSED: t.activity.editErrWindow,
          HAS_RETURNS: t.activity.editErrReturns,
          ALREADY_CHANGED: t.activity.editErrChanged,
          NOT_ALLOWED: t.activity.editErrNotAllowed,
          ORDER_INCOMPLETE: t.activity.editErrIncomplete,
          NETWORK: t.activity.editNeedsOnline,
          OTHER: message,
        };
        toast.error(t.activity.editFailed, {
          description: descriptions[correctionErrorCode(message, navigator.onLine)],
        });
        return false;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [t]
  );

  return { correctOrder, saving };
}
