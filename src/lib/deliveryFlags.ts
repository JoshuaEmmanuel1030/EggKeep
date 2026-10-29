// Delivery & Return Log, Phase 1 flags and the PO ⟵ delivery left join.
// Pure (no React / Supabase) so the rules mirror the open_delivery_items view
// and stay unit-tested; used for the list, the Header badge's optimistic
// refresh and the Activities chip.
// Spec: docs/superpowers/specs/2026-10-29-delivery-return-log-design.md §4.7, §8
import type {
  Delivery,
  DeliveryFlags,
  DeliveryListItem,
  DeliveryPo,
  DeliveryStatus,
} from "@/types/deliveries";

// Same normalisation as deliveries.invoice_ref_norm: upper(trim(invoice_ref)).
export const normalizeInvoiceRef = (ref: string | null | undefined): string => (ref ?? "").trim().toUpperCase();

export const hasInvoiceRef = (ref: string | null | undefined): boolean => normalizeInvoiceRef(ref) !== "";

// Sheet "Customer": "<buyer> <dc>" (just the buyer when the PO has no DC).
export const customerLabel = (buyerName: string | null | undefined, dcName: string | null | undefined): string =>
  [buyerName, dcName].filter((s) => s && s.trim()).join(" ");

type FlagSource = Pick<Delivery, "status" | "invoiceReturnedAt">;

// invoice_not_back: delivered, but the signed faktur has not come back.
export function invoiceNotBack(delivery: FlagSource | null | undefined): boolean {
  return !!delivery && delivery.status === "terkirim" && !delivery.invoiceReturnedAt;
}

// not_logged: the PO carries an invoice_ref but has no deliveries row yet.
// A PO without an invoice_ref cannot be logged at all, so it is never "open".
export function notLogged(invoiceRef: string | null | undefined, delivery: unknown | null | undefined): boolean {
  return hasInvoiceRef(invoiceRef) && !delivery;
}

export function deliveryFlags(invoiceRef: string | null | undefined, delivery: FlagSource | null | undefined): DeliveryFlags {
  return { notLogged: notLogged(invoiceRef, delivery), invoiceNotBack: invoiceNotBack(delivery) };
}

export const NO_FLAGS: DeliveryFlags = { notLogged: false, invoiceNotBack: false };

export const isOpen = (flags: DeliveryFlags): boolean => flags.notLogged || flags.invoiceNotBack;

export interface DeliveryItemsResult {
  items: DeliveryListItem[];
  // POs in the range with no invoice_ref: they can't be keyed, so they are
  // hidden from the list (the page shows this count so nothing is silently lost).
  hiddenNoInvoice: number;
}

// purchase_orders LEFT JOIN deliveries ON invoice_ref_norm, plus the edge
// cases of §8: a delivery whose PO is gone (poMissing) and a second PO reusing
// an invoice_ref (duplicateInvoice; its flags are suppressed, nothing merges).
// Newest delivery date first, then invoice_ref.
export function buildDeliveryItems(pos: DeliveryPo[], deliveries: Delivery[]): DeliveryItemsResult {
  const byNorm = new Map<string, Delivery>();
  for (const d of deliveries) byNorm.set(d.invoiceRefNorm || normalizeInvoiceRef(d.invoiceRef), d);

  const items: DeliveryListItem[] = [];
  const seen = new Set<string>();
  let hiddenNoInvoice = 0;

  // Stable order so "the second PO" is the later-recorded one.
  const ordered = [...pos].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  for (const po of ordered) {
    const norm = normalizeInvoiceRef(po.invoiceRef);
    if (!norm) {
      hiddenNoInvoice++;
      continue;
    }
    const duplicate = seen.has(norm);
    seen.add(norm);
    const delivery = duplicate ? null : byNorm.get(norm) ?? null;
    items.push({
      key: duplicate ? `${norm}#${po.recordedAt}` : norm,
      invoiceRef: po.invoiceRef,
      invoiceRefNorm: norm,
      buyerName: po.buyerName,
      dcName: po.dcName,
      deliveryDate: po.outflowDate,
      po,
      delivery,
      flags: duplicate ? NO_FLAGS : deliveryFlags(po.invoiceRef, delivery),
      poMissing: false,
      duplicateInvoice: duplicate,
    });
  }

  for (const d of deliveries) {
    const norm = d.invoiceRefNorm || normalizeInvoiceRef(d.invoiceRef);
    if (seen.has(norm)) continue;
    seen.add(norm);
    items.push({
      key: norm,
      invoiceRef: d.invoiceRef,
      invoiceRefNorm: norm,
      buyerName: d.buyerName,
      dcName: d.dcName,
      deliveryDate: d.deliveryDate,
      po: null,
      delivery: d,
      flags: NO_FLAGS, // PO voided / re-keyed: history stays, flags suppressed
      poMissing: true,
      duplicateInvoice: false,
    });
  }

  items.sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate) || a.invoiceRef.localeCompare(b.invoiceRef));
  return { items, hiddenNoInvoice };
}

export interface DeliveryListFilters {
  search?: string;
  notLogged?: boolean; // Belum dicatat
  notDelivered?: boolean; // Belum terkirim
  invoiceNotBack?: boolean; // Faktur belum balik
}

// Search matches invoice_ref or customer (case-insensitive). The chips are
// multi-select and OR together: an item shows when it matches any chosen chip.
export function filterDeliveryItems(items: DeliveryListItem[], filters: DeliveryListFilters): DeliveryListItem[] {
  const q = (filters.search ?? "").trim().toLowerCase();
  const anyChip = !!(filters.notLogged || filters.notDelivered || filters.invoiceNotBack);
  return items.filter((it) => {
    if (q) {
      const hay = `${it.invoiceRef} ${customerLabel(it.buyerName, it.dcName)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (!anyChip) return true;
    return (
      (!!filters.notLogged && it.flags.notLogged) ||
      (!!filters.notDelivered && it.delivery?.status === "belum_terkirim") ||
      (!!filters.invoiceNotBack && it.flags.invoiceNotBack)
    );
  });
}

// Header badge count (Phase 1: invoice_not_back only), distinct per faktur.
export function countInvoiceNotBack(items: Pick<DeliveryListItem, "invoiceRefNorm" | "flags">[]): number {
  const norms = new Set<string>();
  for (const it of items) if (it.flags.invoiceNotBack) norms.add(it.invoiceRefNorm);
  return norms.size;
}

// Statuses that ask for a note when chosen (why it was rejected / cancelled).
export const STATUS_NEEDS_NOTE: ReadonlySet<DeliveryStatus> = new Set<DeliveryStatus>(["ditolak", "batal"]);
