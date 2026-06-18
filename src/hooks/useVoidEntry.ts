import { useCallback } from "react";
import { differenceInHours, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useUserRole } from "./useUserRole";
import { toast } from "sonner";

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
          
          await supabase
            .from('inflows')
            .update({ remaining_butir: newRemaining })
            .eq('id', deduction.inflow_id);
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

  // Find the corresponding outflow/inflow ID for an activity log
  const findRelatedEntryId = useCallback(async (
    activityLog: { action_type: string; product: string; recorded_at: string; quantity_butir: number }
  ): Promise<string | null> => {
    const table = activityLog.action_type === 'inflow' ? 'inflows' : 'outflows';
    
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .eq('product', activityLog.product)
      .gte('created_at', new Date(new Date(activityLog.recorded_at).getTime() - 5000).toISOString())
      .lte('created_at', new Date(new Date(activityLog.recorded_at).getTime() + 5000).toISOString())
      .is('voided_at', null)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error finding related entry:", error);
      return null;
    }

    return data?.id || null;
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
