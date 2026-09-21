import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { callRecordReturn } from "@/lib/returnRpc";
import { loadReturnOutbox, replayReturnOutbox, QueuedReturn } from "@/lib/returnOutbox";

/**
 * Offline outbox replay for returns. Mirrors useOutflowOutbox but simpler:
 * returns write no activity logs and don't compete for stock, so a server-
 * rejected return is skipped rather than blocking the queue. Enqueue happens at
 * the submit site (RecordReturnDialog) via the pure enqueueReturn; this hook owns
 * replay on app start, reconnect, and window focus (PWA phones stay open all day).
 */
export function useReturnOutbox(options?: { onSynced?: () => void }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [orders, setOrders] = useState<QueuedReturn[]>(() => loadReturnOutbox());
  const replayingRef = useRef(false);
  const onSyncedRef = useRef(options?.onSynced);
  onSyncedRef.current = options?.onSynced;

  const refresh = useCallback(() => setOrders(loadReturnOutbox()), []);

  const replay = useCallback(async () => {
    if (!user || replayingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (loadReturnOutbox().length === 0) return;

    replayingRef.current = true;
    try {
      const result = await replayReturnOutbox({ submit: callRecordReturn });
      refresh();

      if (result.syncedCount > 0) {
        onSyncedRef.current?.();
        toast({
          title: t.outbox.returnSyncedTitle,
          description: `${result.syncedCount} ${t.outbox.returnSyncedDesc}`,
        });
      }
      // Only toast NEW failures (pre-existing failed items are skipped silently,
      // so a permanently-rejected return doesn't nag on every focus).
      if (result.newlyFailedCount > 0) {
        toast({
          title: t.outbox.returnSyncFailedTitle,
          description: t.outbox.returnSyncFailedDesc,
          variant: "destructive",
          duration: 1000000,
        });
      }
    } finally {
      replayingRef.current = false;
    }
  }, [user, refresh, t]);

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

  return { orders, pendingCount: orders.length, replay, refresh };
}
