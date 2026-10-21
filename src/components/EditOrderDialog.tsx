// "Edit order" in Activities: fix a recorded Purchase Order (invoice, DC, date,
// line quantities, drop a line) or Cash entry (quantity, invoice, date) within
// 1 hour of entry. Saves through useCorrectOrder -> public.correct_order, which
// swaps the old outflows for the corrected ones atomically (stock follows).
import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useItemTypes } from "@/hooks/useItemTypes";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { useBuyers } from "@/hooks/useBuyers";
import { useBuyerDcs } from "@/hooks/useBuyerDcs";
import { useCorrectOrder, type CorrectedLogPayload } from "@/hooks/useCorrectOrder";
import { aggregateOrderMaterials, calculateLineMaterials } from "@/lib/outflowCalculator";
import { buildOrderEntries, buildOrderMetadata, toOutflowLogPayloads, type OrderPayloadInput } from "@/lib/orderPayload";
import { editMinutesLeft } from "@/lib/orderCorrection";
import { parseCountInput } from "@/lib/stockCount";
import { useStockUnitLabel, type BuyerOrder } from "@/components/GroupedActivityLog";
import type { ActivityLog } from "@/types/activityLog";
import type { OutflowEntry } from "@/types/inventory";
import type { AggregatedMaterials, OrderLine } from "@/types/quickOutflow";

export type EditTarget =
  | { kind: "quick"; order: BuyerOrder } // a Purchase Order (all its rows)
  | { kind: "manual"; log: ActivityLog }; // a Cash entry (one row)

export interface EditOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: EditTarget | null;
  onSaved: () => void; // refetch logs + stock
}

// Saved order lines keep looseUnit / labelSelection (buildOrderMetadata);
// orders saved before that lack them.
type SavedLine = BuyerOrder["orderLines"][number] & {
  looseUnit?: "butir" | "kg";
  labelSelection?: string | null;
};

interface EditRow {
  key: string;
  line: OrderLine; // as recorded (original quantity)
  qty: string; // raw input
}

interface Form {
  invoice: string;
  date: string;
  dcId: string;
  rows: EditRow[]; // Purchase Order lines
  qty: string; // Cash entry quantity
}

const dayOf = (iso: string) => format(parseISO(iso), "yyyy-MM-dd");
const origQty = (line: OrderLine) => (line.lineType === "pack" ? line.packQty : line.looseQty);
// Empty, zero or negative is never valid; fractions only where the unit allows (kg).
const badQty = (raw: string, decimal: boolean) => {
  const n = parseCountInput(raw);
  return n === null || n <= 0 || (!decimal && !Number.isInteger(n));
};
const withIds = <T,>(p: T) => ({ ...p, id: crypto.randomUUID(), client_id: crypto.randomUUID() });

// What the order actually deducted: its live rows, as calculator aggregates.
function recordedAggregates(rows: ActivityLog[]): AggregatedMaterials {
  const agg: AggregatedMaterials = {
    eggsByProduct: new Map(),
    packagingByItem: new Map(),
    labelsByItem: new Map(),
    boxesByType: new Map(),
  };
  const byCategory = { egg: agg.eggsByProduct, packaging: agg.packagingByItem, label: agg.labelsByItem, box: agg.boxesByType };
  for (const r of rows) {
    const m = byCategory[r.category];
    m.set(r.product, (m.get(r.product) ?? 0) + r.quantity_butir);
  }
  return agg;
}
const AGG_KEYS = ["eggsByProduct", "packagingByItem", "labelsByItem", "boxesByType"] as const;
const sameAggregates = (a: AggregatedMaterials, b: AggregatedMaterials) =>
  AGG_KEYS.every((k) => a[k].size === b[k].size && [...a[k]].every(([p, q]) => Math.abs((b[k].get(p) ?? NaN) - q) < 1e-6));

function initialForm(order: BuyerOrder | null, cashLog: ActivityLog | null, cashDate?: string | null): Form {
  if (order) {
    const rows = (order.orderLines as SavedLine[])
      .filter((l) => l.skuCode || l.eggProduct)
      .map((l, i): EditRow => {
        const key = String(i);
        const line: OrderLine = l.skuCode
          ? { id: key, lineType: "pack", skuCode: l.skuCode, packQty: l.packQty, labelSelection: l.labelSelection }
          : { id: key, lineType: "loose", eggProduct: l.eggProduct, looseQty: l.looseQty, looseUnit: l.looseUnit };
        return { key, line, qty: String(origQty(line) ?? "") };
      });
    return {
      invoice: order.invoiceRef ?? "",
      date: order.outflowDate ?? dayOf(order.timestamp),
      dcId: order.logs[0]?.metadata?.dcId ?? "",
      rows,
      qty: "",
    };
  }
  return {
    invoice: cashLog.invoice_supplier ?? "",
    date: cashLog.metadata?.outflowDate ?? cashDate ?? dayOf(cashLog.recorded_at),
    dcId: "",
    rows: [],
    qty: String(cashLog.quantity_butir),
  };
}

// No target -> nothing mounted, so the feed doesn't run the catalog/buyer
// queries (or need a QueryClient) until someone actually edits.
export function EditOrderDialog(props: EditOrderDialogProps) {
  return props.target ? <EditOrderForm {...props} /> : null;
}

function EditOrderForm({ open, onOpenChange, target, onSaved }: EditOrderDialogProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { conversionMap, boxCapacityMap, labelsPerPackMap } = useItemTypes();
  const { skus } = usePackSKUs(); // superset of the calculator's PackSKU (keeps basePackCode/boxMode)
  const { buyers } = useBuyers();
  const { dcsForBuyer } = useBuyerDcs();
  const { correctOrder, saving } = useCorrectOrder();
  const unitLabel = useStockUnitLabel();

  // Explicit casts: the repo's strict:false build doesn't narrow on `kind`.
  const order = target?.kind === "quick" ? (target as { order: BuyerOrder }).order : null;
  const cashLog = target?.kind === "manual" ? (target as { log: ActivityLog }).log : null;

  // Cash logs don't carry their business date (OutflowForm never stored
  // metadata.outflowDate): read it off the outflow, so an invoice-only edit
  // can't move a back-dated sale to the day it was recorded. Save waits for it.
  const cashOutflowId = cashLog && !cashLog.metadata?.outflowDate ? cashLog.metadata?.relatedEntryId : undefined;
  const [fetchedDate, setFetchedDate] = useState<{ id: string; date: string | null } | null>(null);
  useEffect(() => {
    if (!open || !cashOutflowId) return;
    let live = true;
    supabase
      .from("outflows")
      .select("date")
      .eq("id", cashOutflowId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (live && !error) setFetchedDate({ id: cashOutflowId, date: data?.date ?? null });
      });
    return () => {
      live = false;
    };
  }, [open, cashOutflowId]);
  const cashDate = cashOutflowId && fetchedDate?.id === cashOutflowId ? fetchedDate.date : undefined; // undefined = loading/none
  const dateLoading = !!cashOutflowId && cashDate === undefined;

  const [form, setForm] = useState<Form>(() => initialForm(order, cashLog, cashDate));
  const [error, setError] = useState<string | null>(null);
  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  // Fresh form whenever the dialog opens or targets another order.
  useEffect(() => {
    if (!open) return;
    setForm(initialForm(order, cashLog, cashDate));
    setError(null);
    // order/cashLog derive from target; cashDate lands via the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);
  useEffect(() => {
    if (cashDate) setForm((f) => ({ ...f, date: cashDate }));
  }, [cashDate]);

  const init = initialForm(order, cashLog, cashDate);
  const liveLogs = order ? order.logs.filter((l) => !l.voided_at) : [cashLog];
  const firstCreatedAt = liveLogs.map((l) => l.created_at).sort()[0];
  const minutesLeft = editMinutesLeft(firstCreatedAt);

  // Loose unit as entered. Orders saved before looseUnit was kept: a kg egg
  // whose logged kg equals the typed qty was entered in kg, else in butir.
  const looseUnitOf = (line: OrderLine): "kg" | "butir" => {
    if (line.looseUnit) return line.looseUnit;
    const logged = order?.materials.find((m) => m.type === "egg" && m.product === line.eggProduct)?.quantity;
    return conversionMap[line.eggProduct]?.unit === "kg" && logged === line.looseQty ? "kg" : "butir";
  };
  const decimalRow = (line: OrderLine) => line.lineType === "loose" && looseUnitOf(line) === "kg";

  // Purchase Order: the lines with their new quantities, and what they deduct.
  const toLines = (rows: EditRow[]): OrderLine[] =>
    rows.map(({ line, qty }) => {
      const n = parseCountInput(qty) ?? undefined;
      return line.lineType === "pack"
        ? { ...line, packQty: n }
        : { ...line, looseQty: n, looseUnit: looseUnitOf(line) };
    });
  const editedLines = toLines(form.rows);
  const calc = (lines: OrderLine[]) =>
    aggregateOrderMaterials(lines, null, true, skus, conversionMap, boxCapacityMap, labelsPerPackMap);
  const linesChanged =
    form.rows.length !== init.rows.length || form.rows.some(({ line, qty }) => parseCountInput(qty) !== origQty(line));
  // Unchanged lines resend exactly what the order deducted (its rows). Lines
  // are only re-derived when today's rules reproduce those rows: not for orders
  // from the old order-level box mode, labels a line didn't keep, or a catalog
  // change since entry. Otherwise quantities are locked (invoice/DC/date only).
  const recorded = order ? recordedAggregates(liveLogs) : null;
  const linesEditable = !!order && sameAggregates(calc(toLines(init.rows)), recorded);

  const buyer = order ? buyers.find((b) => b.name === order.buyerName) : undefined;
  const buyerDcs = dcsForBuyer(buyer?.id);
  const origDcId = order?.logs[0]?.metadata?.dcId ?? "";
  // The order's own DC stays pickable (by its snapshot name) if it was deleted since.
  const dcOptions =
    origDcId && order?.dcName && !buyerDcs.some((d) => d.id === origDcId)
      ? [...buyerDcs, { id: origDcId, buyerId: buyer?.id ?? "", name: order.dcName }]
      : buyerDcs;

  const payloadInput: OrderPayloadInput | null = order && {
    buyerName: order.buyerName,
    invoiceRef: form.invoice.trim() || undefined,
    date: form.date,
    dcId: form.dcId || undefined,
    dcName: dcOptions.find((d) => d.id === form.dcId)?.name ?? (form.dcId === origDcId ? order.dcName : undefined),
    lines: editedLines,
    aggregates: linesChanged ? calc(editedLines) : recorded,
  };
  // Summary only: same entries the save sends, minus the ids.
  const materials = payloadInput ? buildOrderEntries(payloadInput, "", () => "") : [];

  const validationError = (): string | null => {
    const sameQty = (a: string, b: string) => parseCountInput(a) === parseCountInput(b);
    if (order) {
      if (form.rows.some(({ line, qty }) => badQty(qty, decimalRow(line)))) return t.activity.editErrQty;
      // Quantities typed before the catalog changed under us: never re-derive.
      if (linesChanged && !linesEditable) return t.activity.editQtyLocked;
      const unresolved =
        linesChanged &&
        editedLines.some((l) => !calculateLineMaterials(l, null, true, skus, conversionMap, boxCapacityMap, labelsPerPackMap));
      if (unresolved) return t.outflow.boxSkuNoCapacity;
      if (buyerDcs.length > 0 && !form.dcId) return t.outflow.dcRequired;
    } else if (badQty(form.qty, true)) {
      return t.activity.editErrQty;
    }
    const changed =
      form.invoice.trim() !== init.invoice.trim() ||
      form.date !== init.date ||
      form.dcId !== init.dcId ||
      !sameQty(form.qty, init.qty) ||
      linesChanged;
    if (!changed) return t.activity.noChanges;
    if (minutesLeft === 0) return t.activity.editErrWindow;
    if (!navigator.onLine) return t.activity.editNeedsOnline;
    return null;
  };

  const handleSave = async () => {
    const problem = validationError();
    setError(problem);
    if (problem) return;

    const now = new Date().toISOString();
    const email = user?.email ?? "";
    let entries: OutflowEntry[];
    let logs: CorrectedLogPayload[];
    if (order) {
      entries = buildOrderEntries(payloadInput, now);
      // Original recorded_at so the order keeps its place in the feed.
      logs = toOutflowLogPayloads(entries, email, buildOrderMetadata(payloadInput), order.timestamp).map(withIds);
    } else {
      entries = [
        {
          id: crypto.randomUUID(),
          date: form.date,
          product: cashLog.product,
          quantityInButir: parseCountInput(form.qty),
          category: cashLog.category,
          invoiceSupplier: form.invoice.trim() || undefined,
          createdAt: now,
        },
      ];
      logs = toOutflowLogPayloads(entries, email, { ...cashLog.metadata, outflowDate: form.date }, cashLog.recorded_at).map(withIds);
    }

    const ok = await correctOrder({
      oldLogIds: liveLogs.map((l) => l.id),
      entries,
      logs,
      reason: t.activity.edited,
    });
    if (ok) {
      onSaved();
      onOpenChange(false);
    }
  };

  const qtyInput = (id: string, label: string, value: string, decimal: boolean, onChange: (v: string) => void, disabled = false) => (
    <Input
      id={id}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      aria-label={label}
      aria-invalid={badQty(value, decimal)}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-24 shrink-0 text-base tabular-nums text-center aria-[invalid=true]:border-destructive"
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            {order ? t.activity.editOrder : t.activity.editCash}
          </DialogTitle>
          <DialogDescription>{order ? order.buyerName : cashLog.product}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t.activity.editHint}{" "}
          <span className="font-medium text-foreground">
            {t.activity.editMinutesLeft.replace("{minutes}", String(minutesLeft))}
          </span>
        </p>

        <div className="space-y-4 py-2">
          {cashLog && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-qty">{t.activity.quantity}</Label>
              <div className="flex items-center gap-2">
                {qtyInput("edit-qty", t.activity.quantity, form.qty, true, (qty) => patch({ qty }))}
                <span className="text-sm text-muted-foreground">{unitLabel(cashLog.product, cashLog.category)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-invoice">{t.outflow.invoiceRef}</Label>
            <Input
              id="edit-invoice"
              value={form.invoice}
              onChange={(e) => patch({ invoice: e.target.value })}
              className="h-11"
            />
          </div>

          {order && dcOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-dc">{t.outflow.dc}</Label>
              <Select value={form.dcId} onValueChange={(dcId) => patch({ dcId })}>
                <SelectTrigger id="edit-dc" className="h-11">
                  <SelectValue placeholder={t.outflow.selectDc} />
                </SelectTrigger>
                <SelectContent>
                  {dcOptions.map((dc) => (
                    <SelectItem key={dc.id} value={dc.id}>
                      {dc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-date">{t.activity.dateLabel}</Label>
            {/* Clearing the native picker yields "": keep the last date instead. */}
            <Input
              id="edit-date"
              type="date"
              value={form.date}
              onChange={(e) => e.target.value && patch({ date: e.target.value })}
              className="h-11"
            />
          </div>

          {order && (
            <div className="space-y-2">
              {!linesEditable && <p className="text-xs text-muted-foreground">{t.activity.editQtyLocked}</p>}
              {form.rows.map(({ key, line, qty }) => {
                const label = line.lineType === "pack" ? line.skuCode : line.eggProduct;
                return (
                  <div key={key} className="flex items-center gap-2 rounded-lg border bg-card p-2">
                    <div className="min-w-0 flex-1">
                      {line.lineType === "pack" ? (
                        <Badge variant="outline" className="font-mono">{line.skuCode}</Badge>
                      ) : (
                        <span className="block truncate text-sm font-medium">{line.eggProduct}</span>
                      )}
                    </div>
                    {qtyInput(
                      `edit-line-${key}`,
                      `${t.activity.quantity} ${label}`,
                      qty,
                      decimalRow(line),
                      (v) => patch({ rows: form.rows.map((r) => (r.key === key ? { ...r, qty: v } : r)) }),
                      !linesEditable
                    )}
                    <span className="w-10 shrink-0 text-sm text-muted-foreground">
                      {line.lineType === "pack" ? t.activity.packs : looseUnitOf(line)}
                    </span>
                    {linesEditable && form.rows.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={t.activity.removeLine}
                        onClick={() => patch({ rows: form.rows.filter((r) => r.key !== key) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}

              {materials.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                  <p className="text-sm font-medium">{t.activity.materialsUsed}</p>
                  {materials.map((m) => (
                    <div key={`${m.category}-${m.product}`} className="flex justify-between gap-2 text-sm">
                      <span className="truncate text-muted-foreground">{m.product}</span>
                      <span className="shrink-0 tabular-nums">
                        {m.quantityInButir.toLocaleString()} {unitLabel(m.product, m.category)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-0">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button className="h-11" onClick={handleSave} disabled={saving || dateLoading}>
            {saving ? t.common.saving : t.activity.saveChanges}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
