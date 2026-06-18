import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ActivityLog } from "@/types/activityLog";
import { InventoryCategory } from "@/types/inventory";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useOfflineSync } from "./useOfflineSync";

export function useActivityLogs() {
  const { user } = useAuth();
  const { pendingLogs, pendingCount, isOnline } = useOfflineSync();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch all activity logs from database
  const fetchLogs = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .order("recorded_at", { ascending: false });

      if (error) throw error;

      const mappedLogs: ActivityLog[] = (data || []).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        action_type: row.action_type as 'inflow' | 'outflow',
        product: row.product,
        quantity_butir: Number(row.quantity_butir),
        quantity_original: row.quantity_original ? Number(row.quantity_original) : undefined,
        recorded_at: row.recorded_at,
        synced_at: row.synced_at,
        created_at: row.created_at,
        client_id: row.client_id,
        category: (row.category as InventoryCategory) || 'egg',
        invoice_supplier: row.invoice_supplier || undefined,
        user_email: row.user_email || undefined,
        metadata: row.metadata as ActivityLog['metadata'],
        voided_at: (row as any).voided_at || undefined,
        void_reason: (row as any).void_reason || undefined,
        original_log_id: (row as any).original_log_id || undefined,
        corrected_by_log_id: (row as any).corrected_by_log_id || undefined,
        isSynced: true,
      }));

      setLogs(mappedLogs);
    } catch (error) {
      console.error("Error fetching activity logs:", error);
      toast({
        title: "Error",
        description: "Failed to load activity logs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Initial fetch
  useEffect(() => {
    if (user) {
      fetchLogs();
    } else {
      setLoading(false);
    }
  }, [user, fetchLogs]);

  // Set up realtime subscription
  useEffect(() => {
    if (!user) return;

    const mapLogFromPayload = (row: any): ActivityLog => ({
      id: row.id,
      user_id: row.user_id,
      action_type: row.action_type,
      product: row.product,
      quantity_butir: Number(row.quantity_butir),
      quantity_original: row.quantity_original
        ? Number(row.quantity_original)
        : undefined,
      recorded_at: row.recorded_at,
      synced_at: row.synced_at,
      created_at: row.created_at,
      client_id: row.client_id,
      category: (row.category as InventoryCategory) || 'egg',
      invoice_supplier: row.invoice_supplier || undefined,
      user_email: row.user_email || undefined,
      metadata: row.metadata as ActivityLog['metadata'],
      voided_at: row.voided_at || undefined,
      void_reason: row.void_reason || undefined,
      original_log_id: row.original_log_id || undefined,
      corrected_by_log_id: row.corrected_by_log_id || undefined,
      isSynced: true,
    });

    const channel = supabase
      .channel("activity-logs-changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_logs",
        },
        (payload) => {
          const newLog = mapLogFromPayload(payload.new);
          setLogs((prev) => {
            // Avoid duplicates
            if (prev.some((l) => l.id === newLog.id)) return prev;
            return [newLog, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "activity_logs",
        },
        (payload) => {
          const updatedLog = mapLogFromPayload(payload.new);
          setLogs((prev) =>
            prev.map((log) => (log.id === updatedLog.id ? updatedLog : log))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Combine synced logs with pending logs for display
  const allLogs: ActivityLog[] = [
    // Pending logs first (unsynced)
    ...pendingLogs.map((log) => ({
      ...log,
      synced_at: undefined,
      created_at: log.recorded_at,
      isSynced: false,
    })),
    // Then synced logs
    ...logs,
  ].sort(
    (a, b) =>
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
  );

  return {
    logs: allLogs,
    loading,
    pendingCount,
    isOnline,
    refetch: fetchLogs,
  };
}
