import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PendingActivityLog } from "@/types/activityLog";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Json } from "@/integrations/supabase/types";

const PENDING_LOGS_KEY = "pending_activity_logs";

export function useOfflineSync() {
  const { user } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingLogs, setPendingLogs] = useState<PendingActivityLog[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Load pending logs from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_LOGS_KEY);
    if (stored) {
      try {
        setPendingLogs(JSON.parse(stored));
      } catch (e) {
        console.error("Error loading pending logs:", e);
      }
    }
  }, []);

  // Save pending logs to localStorage
  const savePendingLogs = useCallback((logs: PendingActivityLog[]) => {
    localStorage.setItem(PENDING_LOGS_KEY, JSON.stringify(logs));
    setPendingLogs(logs);
  }, []);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast({
        title: "Back online",
        description: "Syncing pending entries...",
      });
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast({
        title: "Offline mode",
        description: "Entries will be saved and synced when online",
        variant: "destructive",
      });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Sync pending logs when online
  const syncPendingLogs = useCallback(async () => {
    if (!user || !isOnline || pendingLogs.length === 0 || isSyncing) return;

    setIsSyncing(true);
    const successfulSyncs: string[] = [];

    try {
      for (const log of pendingLogs) {
        const { error } = await supabase.from("activity_logs").insert({
          id: log.id,
          user_id: log.user_id,
          action_type: log.action_type,
          product: log.product,
          quantity_butir: log.quantity_butir,
          quantity_original: log.quantity_original,
          recorded_at: log.recorded_at,
          client_id: log.client_id,
          category: log.category,
          invoice_supplier: log.invoice_supplier,
          user_email: log.user_email,
          metadata: log.metadata as unknown as Json,
        });

        if (!error) {
          successfulSyncs.push(log.id);
        } else {
          console.error("Error syncing log:", error);
        }
      }

      if (successfulSyncs.length > 0) {
        const remaining = pendingLogs.filter(
          (log) => !successfulSyncs.includes(log.id)
        );
        savePendingLogs(remaining);

        toast({
          title: "Synced successfully",
          description: `${successfulSyncs.length} entries uploaded`,
        });
      }
    } catch (error) {
      console.error("Error during sync:", error);
    } finally {
      setIsSyncing(false);
    }
  }, [user, isOnline, pendingLogs, isSyncing, savePendingLogs]);

  // Auto-sync when online and there are pending logs
  useEffect(() => {
    if (isOnline && pendingLogs.length > 0 && user) {
      syncPendingLogs();
    }
  }, [isOnline, pendingLogs.length, user, syncPendingLogs]);

  // Add a new activity log (handles offline mode)
  const addActivityLog = useCallback(
    async (log: Omit<PendingActivityLog, "id" | "user_id" | "client_id">) => {
      if (!user) return false;

      const newLog: PendingActivityLog = {
        ...log,
        id: crypto.randomUUID(),
        user_id: user.id,
        client_id: crypto.randomUUID(),
      };

      if (isOnline) {
        try {
          const { error } = await supabase.from("activity_logs").insert({
            id: newLog.id,
            user_id: newLog.user_id,
            action_type: newLog.action_type,
            product: newLog.product,
            quantity_butir: newLog.quantity_butir,
            quantity_original: newLog.quantity_original,
            recorded_at: newLog.recorded_at,
            client_id: newLog.client_id,
            category: newLog.category,
            invoice_supplier: newLog.invoice_supplier,
            user_email: newLog.user_email,
            metadata: newLog.metadata as unknown as Json,
          });

          if (error) throw error;
          return true;
        } catch (error) {
          console.error("Error adding log, saving offline:", error);
          savePendingLogs([...pendingLogs, newLog]);
          toast({
            title: "Saved offline",
            description: "Entry will sync when connected",
          });
          return true;
        }
      } else {
        savePendingLogs([...pendingLogs, newLog]);
        toast({
          title: "Saved offline",
          description: "Entry will sync when connected",
        });
        return true;
      }
    },
    [user, isOnline, pendingLogs, savePendingLogs]
  );

  return {
    isOnline,
    pendingCount: pendingLogs.length,
    pendingLogs,
    isSyncing,
    addActivityLog,
    syncPendingLogs,
  };
}
