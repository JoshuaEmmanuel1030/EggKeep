import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PO_COLUMNS, rowToDelivery, rowToPo } from "@/hooks/useDeliveries";
import { normalizeInvoiceRef } from "@/lib/deliveryFlags";
import type { Delivery, DeliveryPo, DeliveryStatus } from "@/types/deliveries";

// "ok": the PO exists · "missing": no PO carries this invoice_ref any more
// (re-keyed via correct_order) · "voided": the PO was voided after the
// delivery was logged (history stays, flags are suppressed).
export type DeliveryPoState = "ok" | "missing" | "voided";

export interface DeliveryDetailData {
  delivery: Delivery | null;
  po: DeliveryPo | null;
  poState: DeliveryPoState;
  duplicatePos: number; // extra POs reusing the same invoice_ref
}

// LIKE pattern for an exact, case-insensitive match (ilike has no plain
// case-insensitive equality).
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function fetchDeliveryDetail(invoiceRef: string): Promise<DeliveryDetailData> {
  const norm = normalizeInvoiceRef(invoiceRef);
  const pattern = likeExact(invoiceRef.trim());
  const [dRes, pRes] = await Promise.all([
    supabase.from("deliveries").select("*").eq("invoice_ref_norm", norm).limit(1),
    supabase.from("purchase_orders").select(PO_COLUMNS).ilike("invoice_ref", pattern).order("recorded_at"),
  ]);
  if (dRes.error) throw dRes.error;
  if (pRes.error) throw pRes.error;
  const pos = (pRes.data ?? []).map(rowToPo);
  let poState: DeliveryPoState = pos.length > 0 ? "ok" : "missing";
  if (pos.length === 0) {
    // Only voided rows carry this invoice_ref -> the PO was cancelled.
    const { data } = await supabase
      .from("activity_logs")
      .select("id")
      .eq("action_type", "outflow")
      .filter("metadata->>invoiceRef", "ilike", pattern)
      .not("voided_at", "is", null)
      .limit(1);
    if ((data ?? []).length > 0) poState = "voided";
  }
  return {
    delivery: dRes.data?.[0] ? rowToDelivery(dRes.data[0]) : null,
    po: pos[0] ?? null,
    poState,
    duplicatePos: Math.max(0, pos.length - 1),
  };
}

// Fields the detail page edits. Only keys that are set are written.
export interface DeliveryPatch {
  invoiceRef?: string;
  driverId?: string | null;
  driverName?: string | null;
  status?: DeliveryStatus;
  invoiceReturnedAt?: string | null;
  invoiceCheckedBy?: string | null;
  pic?: string | null;
  notes?: string | null;
}

// One delivery (by invoice_ref) with its PO. `ensure` creates the row lazily
// the first time the PO is opened here; `update` writes field edits.
export function useDelivery(invoiceRef: string | null | undefined, placeholder?: DeliveryDetailData) {
  const queryClient = useQueryClient();
  const norm = normalizeInvoiceRef(invoiceRef);
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["delivery", norm] }),
      queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
      queryClient.invalidateQueries({ queryKey: ["open_delivery_items"] }),
    ]);

  const query = useQuery<DeliveryDetailData>({
    queryKey: ["delivery", norm],
    queryFn: () => fetchDeliveryDetail(invoiceRef as string),
    enabled: !!norm,
    placeholderData: placeholder,
  });

  // Insert-if-missing on invoice_ref_norm (ON CONFLICT DO NOTHING), so two
  // admins opening the same PO at once never clobber each other.
  const ensure = useMutation({
    mutationFn: async ({ po, pic }: { po: DeliveryPo; pic: string | null }) => {
      const { error } = await supabase.from("deliveries").upsert(
        {
          invoice_ref: po.invoiceRef.trim(),
          buyer_name: po.buyerName,
          dc_name: po.dcName,
          delivery_date: po.outflowDate,
          pic,
        },
        { onConflict: "invoice_ref_norm", ignoreDuplicates: true }
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: DeliveryPatch }) => {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.invoiceRef !== undefined) row.invoice_ref = patch.invoiceRef.trim();
      if (patch.driverId !== undefined) row.driver_id = patch.driverId;
      if (patch.driverName !== undefined) row.driver_name = patch.driverName;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.invoiceReturnedAt !== undefined) row.invoice_returned_at = patch.invoiceReturnedAt;
      if (patch.invoiceCheckedBy !== undefined) row.invoice_checked_by = patch.invoiceCheckedBy;
      if (patch.pic !== undefined) row.pic = patch.pic;
      if (patch.notes !== undefined) row.notes = patch.notes;
      // .select().single() makes an RLS-blocked (0-row) update error instead of silently succeeding.
      const { error } = await supabase.from("deliveries").update(row).eq("id", id).select("id").single();
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { ...query, ensure, update, invalidate };
}

// Postgres unique_violation: another delivery already uses this invoice_ref.
export function isDuplicateInvoiceError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}
