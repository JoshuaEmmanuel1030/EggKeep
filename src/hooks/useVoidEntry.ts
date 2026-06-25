import { useCallback } from "react";
import { differenceInHours, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useUserRole } from "./useUserRole";
import { toast } from "sonner";
import { ActivityLog } from "@/types/activityLog";

interface FifoDeduction {
  id: string;
  outflow_id: string;
  inflow_id: string;
  quantity_deducted: number;
  created_at: string;
}

export function useVoidEntry() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();

  // Check if entry can be edited
  // Admins can always edit, owners can edit within 48 hours
  const canEdit = useCallback((createdAt: string, entryUserId?: string): boolean => {
    // Admins can always edit
    if (isAdmin) return true;
    
    // If entryUserId is provided, check ownership + time window
    if (entryUserId && user?.id !== entryUserId) {
      return false;
    }
    
    // Check 48-hour window for owners
    const created = parseISO(createdAt);
    const now = new Date();
    return differenceInHours(now, created) <= 48;
  }, [isAdmin, user]);

  // Get remaining hours in edit window
  const getEditWindowHours = useCallback((createdAt: string): number => {
    const created = parseISO(createdAt);
    const now = new Date();
    const hoursElapsed = differenceInHours(now, created);
    return Math.max(0, 48 - hoursElapsed);
  }, []);

  // Check if user owns the entry
  const isOwner = useCallback((entryUserId: string): boolean => {
    return user?.id === entryUserId;
  }, [user]);

  // Void an outflow and restore inventory
  const voidOutflow = useCallback(async (
    outflowId: string,
    activityLogId: string,
    reason: string
  ): Promise<boolean> => {
    try {
      // 1. Fetch FIFO deductions for this outflow
      const { data: deductions, error: deductionsError } = await supabase
        .from('fifo_deductions')
        .select('*')
        .eq('outflow_id', outflowId);

      if (deductionsError) {
        console.error("Error fetching FIFO deductions:", deductionsError);
        throw deductionsError;
      }

      // 2. Restore each inflow batch's remaining_butir
      if (deductions && deductions.length > 0) {
        for (const deduction of deductions as FifoDeduction[]) {
          const { data: inflow, error: inflowError } = await supabase
            .from('inflows')
            .select('remaining_butir')
            .eq('id', deduction.inflow_id)
            .single();

          if (inflowError) {
            console.error("Error fetching inflow:", inflowError);
            continue;
          }

          const newRemaining = (inflow?.remaining_butir || 0) + deduction.quantity_deducted;

          const { error: restoreError } = await supabase
            .from('inflows')
            .update({ remaining_butir: newRemaining })
            .eq('id', deduction.inflow_id);

          if (restoreError) {
            // Don't silently swallow — a failed restore must not report success.
            console.error("Error restoring inflow stock:", restoreError);
            throw restoreError;
          }
        }
      }

      // 3. Mark outflow as voided
      const { error: outflowError } = await supabase
        .from('outflows')
        .update({ 
          voided_at: new Date().toISOString(), 
          void_reason: reason 
        })
        .eq('id', outflowId);

      if (outflowError) {
        console.error("Error voiding outflow:", outflowError);
        throw outflowError;
      }

      // 4. Mark activity log as voided
      const { error: activityError } = await supabase
        .from('activity_logs')
        .update({ 
          voided_at: new Date().toISOString(), 
          void_reason: reason 
        })
        .eq('id', activityLogId);

      if (activityError) {
        console.error("Error voiding activity log:", activityError);
        throw activityError;
      }

      toast.success("Entry voided successfully");
      return true;
    } catch (error) {
      console.error("Error voiding outflow:", error);
      toast.error("Failed to void entry");
      return false;
    }
  }, []);

  // Void an inflow
  const voidInflow = useCallback(async (
    inflowId: string,
    activityLogId: string,
    reason: string
  ): Promise<boolean> => {
    try {
      // Check if inflow has been partially consumed
      const { data: inflow, error: checkError } = await supabase
        .from('inflows')
        .select('quantity_butir, remaining_butir')
        .eq('id', inflowId)
        .single();

      if (checkError) {
        console.error("Error checking inflow:", checkError);
        throw checkError;
      }

      if (inflow && inflow.remaining_butir < inflow.quantity_butir) {
        toast.error("Cannot void: Some stock has already been used");
        return false;
      }

      // Mark inflow as voided
      const { error: inflowError } = await supabase
        .from('inflows')
        .update({ 
          voided_at: new Date().toISOString(), 
          void_reason: reason 
        })
        .eq('id', inflowId);

      if (inflowError) {
        console.error("Error voiding inflow:", inflowError);
        throw inflowError;
      }

      // Mark activity log as voided
      const { error: activityError } = await supabase
        .from('activity_logs')
        .update({ 
          voided_at: new Date().toISOString(), 
          void_reason: reason 
        })
        .eq('id', activityLogId);

      if (activityError) {
        console.error("Error voiding activity log:", activityError);
        throw activityError;
      }

      toast.success("Entry voided successfully");
      return true;
    } catch (error) {
      console.error("Error voiding inflow:", error);
      toast.error("Failed to void entry");
      return false;
    }
  }, []);

  // Find the corresponding outflow/inflow ID for an activity log.
  const findRelatedEntryId = useCallback(async (
    activityLog: ActivityLog
  ): Promise<string | null> => {
    const table = activityLog.action_type === 'inflow' ? 'inflows' : 'outflows';

    // 1. Direct lookup via the id stored on the log at creation (new entries).
    //    This is the reliable path — no timestamp/clock guessing.
    const relatedId = activityLog.metadata?.relatedEntryId;
    if (relatedId) {
      const { data, error } = await supabase
        .from(table)
        .select('id')
        .eq('id', relatedId)
        .is('voided_at', null)
        .maybeSingle();

      if (!error && data?.id) return data.id;
      // If the stored id is missing/already voided, fall through to the heuristic.
    }

    // 2. Fallback for legacy rows (no stored id): match by product + quantity +
    //    category among non-voided rows, then pick the one whose created_at is
    //    closest to the log's recorded_at. product+quantity is selective enough
    //    that we don't need a tight time window.
    const { data, error } = await supabase
      .from(table)
      .select('id, created_at')
      .eq('product', activityLog.product)
      .eq('quantity_butir', activityLog.quantity_butir)
      .eq('category', activityLog.category)
      .is('voided_at', null);

    if (error) {
      console.error("Error finding related entry:", error);
      return null;
    }
    if (!data || data.length === 0) return null;

    const target = new Date(activityLog.recorded_at).getTime();
    let best = { id: data[0].id, dist: Infinity };
    for (const row of data) {
      const dist = Math.abs(new Date(row.created_at).getTime() - target);
      if (dist < best.dist) best = { id: row.id, dist };
    }
    return best.id;
  }, []);

  return { 
    canEdit, 
    getEditWindowHours, 
    isOwner, 
    voidOutflow, 
    voidInflow,
    findRelatedEntryId,
    isAdmin
  };
}
