import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PO_COLUMNS, rowToDelivery, rowToLine, rowToPo } from "@/hooks/useDeliveries";
import { priorReturnsKey } from "@/hooks/usePriorReturns";
import { eggOutflowIdsOf, normalizeInvoiceRef } from "@/lib/deliveryFlags";
import type { Delivery, DeliveryLine, DeliveryPo, DeliveryStatus } from "@/types/deliveries";

// "ok": a live PO carries this invoice_ref · "missing": no live PO does (the
// PO was re-keyed via correct_order, or the ref never matched) · "voided":
// the PO was voided after the delivery was logged (history stays, flags are
// suppressed).
export type DeliveryPoState = "ok" | "missing" | "voided";

export interface DeliveryDetailData {
  delivery: Delivery | null;
  po: DeliveryPo | null;
  poState: DeliveryPoState;
  duplicatePos: number; // extra POs reusing the same invoice_ref
  // Phase 2: the faktur's delivery lines, and the egg outflow rows its returns
  // key on (the live PO's; the voided PO's when poState = "voided", as history).
  lines: DeliveryLine[];
  eggOutflowIds: string[];
  duplicatePoLabels?: { buyerName: string; outflowDate: string }[]; // every PO sharing the ref
}

// LIKE pattern for an exact, case-insensitive match (ilike has no plain
// case-insensitive equality).
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// No live PO: look at the voided rows that carried the ref. correct_order
// links the rows it replaces (corrected_by_log_id), a plain void does not.
async function voidedPoState(pattern: string): Promise<{ state: DeliveryPoState; eggOutflowIds: string[] }> {
  const { data, error } = await supabase
    .from("activity_logs")
    .select("id, corrected_by_log_id, category, metadata")
    .eq("action_type", "outflow")
    .filter("metadata->>invoiceRef", "ilike", pattern)
    .not("voided_at", "is", null)
    .limit(50);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return { state: "missing", eggOutflowIds: [] };
  if (rows.some((r) => r.corrected_by_log_id)) return { state: "missing", eggOutflowIds: [] };
  const eggOutflowIds = rows
    .filter((r) => r.category === "egg")
    .map((r) => (r.metadata as { relatedEntryId?: string } | null)?.relatedEntryId)
    .filter((id): id is string => !!id);
  return { state: "voided", eggOutflowIds };
}

async function fetchDeliveryDetail(invoiceRef: string): Promise<DeliveryDetailData> {
  const norm = normalizeInvoiceRef(invoiceRef);
  const pattern = likeExact(invoiceRef.trim());
  const [dRes, pRes] = await Promise.all([
    supabase.from("deliveries").select("*, delivery_lines(*)").eq("invoice_ref_norm", norm).limit(1),
    supabase.from("purchase_orders").select(PO_COLUMNS).ilike("invoice_ref", pattern).order("recorded_at"),
  ]);
  if (dRes.error) throw dRes.error;
  if (pRes.error) throw pRes.error;
  const pos = (pRes.data ?? []).map(rowToPo);
  const voided = pos.length > 0 ? null : await voidedPoState(pattern);
  const row = dRes.data?.[0];
  return {
    delivery: row ? rowToDelivery(row) : null,
    po: pos[0] ?? null,
    poState: voided ? voided.state : "ok",
    duplicatePos: Math.max(0, pos.length - 1),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (((row as any)?.delivery_lines ?? []) as unknown[]).map(rowToLine),
    eggOutflowIds: voided ? voided.eggOutflowIds : eggOutflowIdsOf(pos[0] ?? null),
    duplicatePoLabels: pos.length > 1 ? pos.map((p) => ({ buyerName: p.buyerName, outflowDate: p.outflowDate })) : undefined,
  };
}

// Postgres unique_violation on delivery_lines, by constraint.
export type LineSaveError = "DUPLICATE_LINE" | "DUPLICATE_PHYSICAL_LINE";
export function lineSaveErrorCode(error: unknown): LineSaveError | null {
  const e = error as { code?: string; message?: string; details?: string } | null;
  if (e?.code !== "23505") return null;
  return `${e.message ?? ""} ${e.details ?? ""}`.includes("delivery_lines_physical_key") ? "DUPLICATE_PHYSICAL_LINE" : "DUPLICATE_LINE";
}

// The store-side fields the Retur section writes; id is client-generated.
export type DeliveryLineInput = Omit<DeliveryLine, "claimRefNorm" | "source" | "createdBy" | "createdAt" | "updatedAt">;

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

function patchToRow(patch: DeliveryPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.invoiceRef !== undefined) row.invoice_ref = patch.invoiceRef.trim();
  if (patch.driverId !== undefined) row.driver_id = patch.driverId;
  if (patch.driverName !== undefined) row.driver_name = patch.driverName;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.invoiceReturnedAt !== undefined) row.invoice_returned_at = patch.invoiceReturnedAt;
  if (patch.invoiceCheckedBy !== undefined) row.invoice_checked_by = patch.invoiceCheckedBy;
  if (patch.pic !== undefined) row.pic = patch.pic;
  if (patch.notes !== undefined) row.notes = patch.notes;
  return row;
}

export interface SaveDeliveryInput {
  existing: Delivery | null; // the row to update, or null to create it
  po: DeliveryPo | null; // live PO: its buyer/DC/date refresh the snapshot
  patch: DeliveryPatch;
  savedBy: string | null; // becomes `pic` when the row is created
}

// One delivery (by invoice_ref) with its PO. Opening writes nothing: the
// first `save` creates the row (§4.2), later saves update it. While the PO is
// live, every save copies its buyer, DC and date into the row's snapshot so
// the snapshot only matters once the PO is gone.
export function useDelivery(invoiceRef: string | null | undefined, placeholder?: DeliveryDetailData) {
  const queryClient = useQueryClient();
  const norm = normalizeInvoiceRef(invoiceRef);

  const query = useQuery<DeliveryDetailData>({
    queryKey: ["delivery", norm],
    queryFn: () => fetchDeliveryDetail(invoiceRef as string),
    enabled: !!norm,
    placeholderData: placeholder,
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["delivery", norm] }),
      queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
      queryClient.invalidateQueries({ queryKey: ["open_delivery_items"] }),
      queryClient.invalidateQueries({ queryKey: priorReturnsKey(query.data?.eggOutflowIds ?? []) }),
    ]);

  const save = useMutation({
    mutationFn: async ({ existing, po, patch, savedBy }: SaveDeliveryInput) => {
      const row = patchToRow(patch);
      row.updated_at = new Date().toISOString();
      if (po) {
        row.buyer_name = po.buyerName;
        row.dc_name = po.dcName;
        row.delivery_date = po.outflowDate;
      }
      if (existing) {
        // .select().single() makes an RLS-blocked (0-row) update error instead of silently succeeding.
        const { error } = await supabase.from("deliveries").update(row).eq("id", existing.id).select("id").single();
        if (error) throw error;
        return;
      }
      if (!po) throw new Error("Cannot create a delivery without a live PO");
      // Create on first save. ON CONFLICT DO UPDATE on invoice_ref_norm: if
      // someone created the row a moment ago, this save still lands.
      const { error } = await supabase
        .from("deliveries")
        .upsert(
          {
            invoice_ref: po.invoiceRef.trim(),
            buyer_name: po.buyerName,
            dc_name: po.dcName,
            delivery_date: po.outflowDate,
            pic: patch.pic !== undefined ? patch.pic : savedBy,
            ...row,
          },
          { onConflict: "invoice_ref_norm" }
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // §6.5.5 step 1: the faktur's deliveries row, created with an empty patch when
  // there is none. ignoreDuplicates keeps the pic of a row created a moment ago.
  const ensureDelivery = async (po: DeliveryPo, savedBy: string | null): Promise<string> => {
    const existing = query.data?.delivery;
    if (existing) return existing.id;
    const { error } = await supabase.from("deliveries").upsert(
      {
        invoice_ref: po.invoiceRef.trim(),
        buyer_name: po.buyerName,
        dc_name: po.dcName,
        delivery_date: po.outflowDate,
        pic: savedBy,
      },
      { onConflict: "invoice_ref_norm", ignoreDuplicates: true }
    );
    if (error) throw error;
    const { data, error: readError } = await supabase
      .from("deliveries")
      .select("id")
      .eq("invoice_ref_norm", normalizeInvoiceRef(po.invoiceRef))
      .single();
    if (readError) throw readError;
    return data.id;
  };

  const upsertLine = useMutation({
    mutationFn: async (line: DeliveryLineInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from as any)("delivery_lines").upsert(
        {
          id: line.id,
          delivery_id: line.deliveryId,
          sku_code: line.skuCode,
          unit_label: line.unitLabel,
          pieces_per_unit: line.piecesPerUnit,
          quantity: line.quantity,
          reason: line.reason,
          note: line.note,
          claim_ref: line.claimRef,
          expected_expiry: line.expectedExpiry,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteLine = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from as any)("delivery_lines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // "Terapkan ke semua baris": fills every line of the faktur with no claim_ref.
  const setClaimRefForDelivery = useMutation({
    mutationFn: async ({ deliveryId, claimRef }: { deliveryId: string; claimRef: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from as any)("delivery_lines")
        .update({ claim_ref: claimRef, updated_at: new Date().toISOString() })
        .eq("delivery_id", deliveryId)
        .is("claim_ref", null);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { ...query, save, invalidate, ensureDelivery, upsertLine, deleteLine, setClaimRefForDelivery };
}

// Postgres unique_violation: another delivery already uses this invoice_ref.
export function isDuplicateInvoiceError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}
