import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { OutflowEntry } from "@/types/inventory";
import { Json } from "@/integrations/supabase/types";
import { callRecordOrderOutflows } from "@/lib/outflowRpc";
import {
  QueuedOutflowOrder,
  OutboxLogPayload,
  loadOutbox,
  enqueueOutflowOrder,
  removeOutboxOrder,
  retryOutboxOrder,
  replayOutbox,
} from "@/lib/outflowOutbox";

const PENDING_LOGS_KEY = "pending_activity_logs";

function describeOrder(order: QueuedOutflowOrder): string {
  const ref =
    order.logs[0]?.metadata?.buyerName ||
    order.entries[0]?.invoiceSupplier ||
    "";
  const products = order.entries.map((e) => e.product).join(", ");
  return ref ? `${ref} — ${products}` : products;
}

/**
 * Offline outbox for outflow orders (same offline philosophy as useOfflineSync
 * for activity logs, but order-grained and replayed through the atomic
 * record_order_outflows RPC, which is idempotent per entry id).
 *
 * Replays strictly FIFO on: app start, `online` event, and window focus.
 * An order rejected by the server during replay (e.g. INSUFFICIENT_STOCK) is
 * flagged `failed` and blocks the queue until the user retries or discards it.
 */
export function useOutflowOutbox(options?: { onOrderSynced?: () => void }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [orders, setOrders] = useState<QueuedOutflowOrder[]>(() => loadOutbox());
  const [isReplaying, setIsReplaying] = useState(false);
  const replayingRef = useRef(false);
  const onOrderSyncedRef = useRef(options?.onOrderSynced);
  onOrderSyncedRef.current = options?.onOrderSynced;

  const refresh = useCallback(() => setOrders(loadOutbox()), []);

  // Write the activity logs for a replayed order. The RPC already committed,
  // so if the log insert itself fails we fall back to the same offline
  // activity-log queue that useOfflineSync drains — never resubmit the order.
  const writeOrderLogs = useCallback(
    async (order: QueuedOutflowOrder) => {
      if (!user) return;
      for (const log of order.logs) {
        const row = {
          id: crypto.randomUUID(),
          user_id: user.id,
          client_id: crypto.randomUUID(),
          action_type: log.action_type,
          product: log.product,
          quantity_butir: log.quantity_butir,
          recorded_at: log.recorded_at,
          category: log.category,
          invoice_supplier: log.invoice_supplier,
          user_email: log.user_email,
          metadata: log.metadata,
        };
        try {
          const { error } = await supabase
            .from("activity_logs")
            .insert({ ...row, metadata: row.metadata as unknown as Json });
          if (error) throw error;
        } catch (e) {
          console.error("Error writing replayed activity log, queueing offline:", e);
          try {
            const raw = localStorage.getItem(PENDING_LOGS_KEY);
            const pending = raw ? JSON.parse(raw) : [];
            pending.push(row);
            localStorage.setItem(PENDING_LOGS_KEY, JSON.stringify(pending));
          } catch (storageError) {
            console.error("Error queueing activity log offline:", storageError);
          }
        }
      }
    },
    [user]
  );

  const replay = useCallback(async () => {
    if (!user || replayingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (loadOutbox().length === 0) return;

    replayingRef.current = true;
    setIsReplaying(true);
    try {
      const result = await replayOutbox({
        submit: callRecordOrderOutflows,
        onOrderSynced: writeOrderLogs,
      });
      refresh();

      if (result.syncedCount > 0) {
        onOrderSyncedRef.current?.();
        toast({
          title: t.outbox.syncedTitle,
          description: `${result.syncedCount} ${t.outbox.syncedDesc}`,
        });
      }

      if (result.stopped === "failed-head" && result.failedOrder) {
        const failed = result.failedOrder;
        // Long-lived toast: the user must resolve this manually (void/adjust
        // stock, then Retry — or Discard the order from the outbox banner).
        toast({
          title: t.outbox.failedTitle,
          description: `${describeOrder(failed)}: ${failed.failReason || ""}. ${t.outbox.failedDesc}`,
          variant: "destructive",
          duration: 1000000,
        });
      }
    } finally {
      replayingRef.current = false;
      setIsReplaying(false);
    }
  }, [user, writeOrderLogs, refresh, t]);

  // Replay on app start, when connectivity returns, and on focus (PWA sessions
  // stay open all day on the warehouse phones — mirrors useInventorySync).
  useEffect(() => {
    if (!user) return;
    replay();
    const onOnline = () => replay();
    const onFocus = () => replay();
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, replay]);

  const enqueue = useCallback(
    (entries: OutflowEntry[], logs: OutboxLogPayload[]) => {
      const queued = enqueueOutflowOrder({ entries, logs });
      refresh();
      return queued;
    },
    [refresh]
  );

  const discard = useCallback(
    (id: string) => {
      removeOutboxOrder(id);
      refresh();
    },
    [refresh]
  );

  const retry = useCallback(
    (id: string) => {
      retryOutboxOrder(id);
      refresh();
      replay();
    },
    [refresh, replay]
  );

  return {
    orders,
    pendingCount: orders.length,
    isReplaying,
    enqueue,
    discard,
    retry,
    replay,
  };
}
