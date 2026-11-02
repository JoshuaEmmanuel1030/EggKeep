// Delivery & Return Log flags and the PO ⟵ delivery left join.
// Pure (no React / Supabase) so the rules mirror the open_delivery_items view
// and stay unit-tested; used for the list, the Header badge's optimistic
// refresh and the Activities chip. Phase 2 adds the delivery-line flags
// (orange / red / Masih ditanyakan), classified here once, from tables.
// Spec: docs/superpowers/specs/2026-10-29-delivery-return-log-design.md §4.7, §8
//       docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md §6.6
import type {
  Delivery,
  DeliveryFlags,
  DeliveryLine,
  DeliveryLineView,
  DeliveryListItem,
  DeliveryPo,
  DeliveryStatus,
  LineReturnSummary,
  LineSummary,
} from "@/types/deliveries";
import type { ReturnRow } from "@/lib/returnsSummary";
import type { SkuEgg } from "@/lib/returnLines";
import { nativeToPieces } from "@/lib/returnsCap";

// Reasons with no physical return: no warehouse side, no orange flag. The
// partial unique index delivery_lines_physical_key repeats this list
// (deliveryLinesSync.test.ts), so adding a reason here needs a migration.
export const NO_PHYSICAL_RETURN: ReadonlySet<string> = new Set(["kurang", "lebih", "revisi_po", "cancel", "masih_ditanyakan"]);

export const lineHasPhysicalReturn = (line: Pick<DeliveryLine, "reason">): boolean => !NO_PHYSICAL_RETURN.has(line.reason);

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

export function deliveryFlags(
  invoiceRef: string | null | undefined,
  delivery: FlagSource | null | undefined
): Pick<DeliveryFlags, "notLogged" | "invoiceNotBack"> {
  return { notLogged: notLogged(invoiceRef, delivery), invoiceNotBack: invoiceNotBack(delivery) };
}

export const NO_FLAGS: DeliveryFlags = {
  notLogged: false,
  invoiceNotBack: false,
  awaitingWarehouse: false,
  needsClaimRef: false,
  unresolved: false,
};

export const EMPTY_LINE_SUMMARY: LineSummary = {
  lineCount: 0,
  awaitingCount: 0,
  needsRefCount: 0,
  pecahWithoutRef: 0,
  kurangPieces: 0,
  unresolvedCount: 0,
  claimRowCount: 0,
  claimPecah: 0,
  full: false,
};

// Non-voided returns on these outflow rows under this SKU. Pieces are
// converted per bucket and then summed, as ReturnBubble does.
export function summarizeLineReturns(
  rows: ReturnRow[],
  eggOutflowIds: string[],
  skuCode: string,
  unitByProduct: Record<string, string | undefined>
): LineReturnSummary | null {
  const ids = new Set(eggOutflowIds);
  const mine = rows.filter((r) => !r.voided_at && ids.has(r.outflow_id) && r.sku_code === skuCode);
  if (mine.length === 0) return null;
  const s: LineReturnSummary = {
    okPieces: 0,
    pecahPieces: 0,
    restockNative: 0,
    retakanNative: 0,
    writeoffNative: 0,
    firstReturnDate: null,
    lastUserEmail: null,
  };
  let last = "";
  for (const r of mine) {
    const q = Number(r.quantity);
    const pieces = nativeToPieces(q, unitByProduct[r.product]);
    if (r.disposition === "restock") {
      s.restockNative += q;
      s.okPieces += pieces;
    } else {
      if (r.disposition === "retakan") s.retakanNative += q;
      else s.writeoffNative += q;
      s.pecahPieces += pieces;
    }
    if (!s.firstReturnDate || r.return_date < s.firstReturnDate) s.firstReturnDate = r.return_date;
    if (r.created_at >= last) {
      last = r.created_at;
      s.lastUserEmail = r.user_email;
    }
  }
  return s;
}

// Pieces in one unit of what the PO sold under this SKU (boxes for a box SKU).
const poPiecesPerUnit = (egg: SkuEgg | undefined): number | null =>
  egg ? (egg.isBoxMode ? egg.piecesPerBox : egg.piecesPerPak) : null;

// The PO's egg outflow row ids (legacy rows without relatedEntryId drop out).
export const eggOutflowIdsOf = (po: DeliveryPo | null): string[] =>
  (po?.eggTotals ?? []).map((e) => e.outflowId).filter((id): id is string => !!id);

// Derived warehouse figures attach to the physical-return line only.
export function buildLineViews(
  lines: DeliveryLine[],
  po: DeliveryPo | null,
  returns: ReturnRow[],
  unitByProduct: Record<string, string | undefined>,
  skuEggMap: Record<string, SkuEgg> = {},
  eggOutflowIds: string[] = eggOutflowIdsOf(po)
): DeliveryLineView[] {
  return [...lines]
    .sort((a, b) => a.skuCode.localeCompare(b.skuCode) || a.reason.localeCompare(b.reason))
    .map((line) => {
      const physical = lineHasPhysicalReturn(line);
      const lineReturns = physical ? summarizeLineReturns(returns, eggOutflowIds, line.skuCode, unitByProduct) : null;
      const piecesTotal = line.quantity * line.piecesPerUnit;
      const poLines = (po?.orderLines ?? []).filter((l) => l.skuCode === line.skuCode);
      const packs = poLines.reduce((n, l) => n + (l.packQty ?? 0), 0);
      const perPoUnit = poPiecesPerUnit(skuEggMap[line.skuCode]);
      return {
        ...line,
        piecesTotal,
        physical,
        returns: lineReturns,
        mismatch: !!lineReturns && lineReturns.okPieces + lineReturns.pecahPieces !== piecesTotal,
        poQty: poLines.length === 0 ? null : perPoUnit ? (packs * perPoUnit) / line.piecesPerUnit : packs,
      };
    });
}

const lineNeedsRef = (line: DeliveryLineView, requiresRef: boolean) =>
  requiresRef && line.physical && !normalizeInvoiceRef(line.claimRef);

export function summarizeLines(lines: DeliveryLineView[], requiresRef: boolean, delivered: boolean): LineSummary {
  const s: LineSummary = { ...EMPTY_LINE_SUMMARY, lineCount: lines.length };
  for (const l of lines) {
    const pecah = l.returns?.pecahPieces ?? 0;
    if (l.physical && !l.returns) s.awaitingCount++;
    if (lineNeedsRef(l, requiresRef)) {
      s.needsRefCount++;
      s.pecahWithoutRef += pecah;
    }
    if (l.reason === "kurang") s.kurangPieces += l.piecesTotal;
    if (l.reason === "masih_ditanyakan") s.unresolvedCount++;
    if (requiresRef && l.physical) {
      s.claimRowCount++;
      s.claimPecah += pecah;
    }
  }
  s.full = delivered && !lines.some((l) => l.quantity > 0);
  return s;
}

const lineFlags = (summary: LineSummary): Pick<DeliveryFlags, "awaitingWarehouse" | "needsClaimRef" | "unresolved"> => ({
  awaitingWarehouse: summary.awaitingCount > 0,
  needsClaimRef: summary.needsRefCount > 0,
  unresolved: summary.unresolvedCount > 0,
});

export interface RowSummaryLabels {
  full: string; // "Diterima penuh"
  items: string; // "{n} item retur"
  awaiting: string; // "gudang belum"
  needsRef: string; // "{n} tanpa No. Retur"
  unresolved: string; // "Masih ditanyakan"
}

// "2 item retur · gudang belum · 1 tanpa No. Retur", "Diterima penuh", ...
export function rowSummaryText(summary: LineSummary, labels: RowSummaryLabels): string {
  if (summary.full) return labels.full;
  const parts: string[] = [];
  const items = summary.lineCount - summary.unresolvedCount;
  if (items > 0) parts.push(labels.items.replace("{n}", String(items)));
  if (summary.awaitingCount > 0) parts.push(labels.awaiting);
  if (summary.needsRefCount > 0) parts.push(labels.needsRef.replace("{n}", String(summary.needsRefCount)));
  if (summary.unresolvedCount > 0) parts.push(labels.unresolved);
  return parts.join(" · ");
}

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
export function buildDeliveryItems(
  pos: DeliveryPo[],
  deliveries: Delivery[],
  lines: DeliveryLine[] = [],
  returns: ReturnRow[] = [],
  requiresRefByBuyer: Record<string, boolean> = {},
  unitByProduct: Record<string, string | undefined> = {},
  skuEggMap: Record<string, SkuEgg> = {}
): DeliveryItemsResult {
  const linesByDelivery = new Map<string, DeliveryLine[]>();
  for (const l of lines) linesByDelivery.set(l.deliveryId, [...(linesByDelivery.get(l.deliveryId) ?? []), l]);
  // requires_claim_ref matched to the buyer name case-insensitively (never by prefix).
  const requiresRef = (buyer: string) => !!requiresRefByBuyer[buyer.trim().toLowerCase()];
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
    const views = delivery ? buildLineViews(linesByDelivery.get(delivery.id) ?? [], po, returns, unitByProduct, skuEggMap) : [];
    const needsRef = requiresRef(po.buyerName);
    const lineSummary = summarizeLines(views, needsRef, delivery?.status === "terkirim");
    items.push({
      key: duplicate ? `${norm}#${po.recordedAt}` : norm,
      invoiceRef: po.invoiceRef,
      invoiceRefNorm: norm,
      buyerName: po.buyerName,
      dcName: po.dcName,
      deliveryDate: po.outflowDate,
      po,
      delivery,
      flags: duplicate ? NO_FLAGS : { ...deliveryFlags(po.invoiceRef, delivery), ...lineFlags(lineSummary) },
      poMissing: false,
      duplicateInvoice: duplicate,
      lines: views,
      lineSummary,
      requiresClaimRef: needsRef,
    });
  }

  for (const d of deliveries) {
    const norm = d.invoiceRefNorm || normalizeInvoiceRef(d.invoiceRef);
    if (seen.has(norm)) continue;
    seen.add(norm);
    // No live PO: lines render as history; no outflow ids, so no warehouse figures.
    const views = buildLineViews(linesByDelivery.get(d.id) ?? [], null, [], unitByProduct, skuEggMap);
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
      lines: views,
      lineSummary: summarizeLines(views, requiresRef(d.buyerName), d.status === "terkirim"),
      requiresClaimRef: requiresRef(d.buyerName),
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
  awaitingWarehouse?: boolean; // Gudang belum (orange)
  needsClaimRef?: boolean; // Tanpa No. Retur (red)
  unresolved?: boolean; // Masih ditanyakan
  kurang?: boolean; // has a Kurang line
  claim?: boolean; // Klaim: physical lines of requires_claim_ref buyers
}

// Search matches invoice_ref or customer (case-insensitive). The chips are
// multi-select and OR together: an item shows when it matches any chosen chip.
export function filterDeliveryItems(items: DeliveryListItem[], filters: DeliveryListFilters): DeliveryListItem[] {
  const q = (filters.search ?? "").trim().toLowerCase();
  const anyChip = !!(
    filters.notLogged ||
    filters.notDelivered ||
    filters.invoiceNotBack ||
    filters.awaitingWarehouse ||
    filters.needsClaimRef ||
    filters.unresolved ||
    filters.kurang ||
    filters.claim
  );
  return items.filter((it) => {
    if (q) {
      const hay = `${it.invoiceRef} ${customerLabel(it.buyerName, it.dcName)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (!anyChip) return true;
    return (
      (!!filters.notLogged && it.flags.notLogged) ||
      (!!filters.notDelivered && it.delivery?.status === "belum_terkirim") ||
      (!!filters.invoiceNotBack && it.flags.invoiceNotBack) ||
      (!!filters.awaitingWarehouse && it.flags.awaitingWarehouse) ||
      (!!filters.needsClaimRef && it.flags.needsClaimRef) ||
      (!!filters.unresolved && it.flags.unresolved) ||
      (!!filters.kurang && !it.poMissing && it.lineSummary.kurangPieces > 0) ||
      (!!filters.claim && !it.poMissing && it.lineSummary.claimRowCount > 0)
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
