import { useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Printer, Share2, AlertTriangle, Package, CheckCircle2 } from "lucide-react";
import { StockSummary, CONVERSION_DICT } from "@/types/inventory";
import { AggregatedMaterials, BoxModeType } from "@/types/quickOutflow";

interface QueuedOrder {
  id: string;
  buyer: { id: string; name: string; defaultBoxMode: BoxModeType };
  date: string;
  invoiceRef: string;
  boxMode: BoxModeType;
  boxesRequired: boolean;
  lines: unknown[];
  aggregates: AggregatedMaterials;
}

interface BatchAllocation {
  batchId: string;
  date: string;
  invoiceSupplier: string | null;
  daysInWarehouse: number;
  isAtRisk: boolean;
  allocatedButir: number;
}

interface ProductPickRow {
  product: string;
  totalButir: number;
  allocations: BatchAllocation[];
  shortfall: number;
}

function getDisplayUnit(product: string): string {
  return CONVERSION_DICT[product]?.unit === "kg" ? "kg" : "butir";
}

function butirToDisplay(product: string, butir: number): string {
  const cfg = CONVERSION_DICT[product];
  if (cfg?.unit === "kg") {
    return `${(butir / cfg.eggs_per_unit).toFixed(1)} kg`;
  }
  return `${butir.toLocaleString()} butir`;
}

function simulateFIFO(batches: StockSummary["batches"], needed: number): BatchAllocation[] {
  const sorted = [...batches].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  let remaining = needed;
  const result: BatchAllocation[] = [];
  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    if (take <= 0) continue;
    result.push({
      batchId: batch.id,
      date: batch.date,
      invoiceSupplier: batch.invoiceSupplier,
      daysInWarehouse: batch.daysInWarehouse,
      isAtRisk: batch.isAtRisk,
      allocatedButir: take,
    });
    remaining -= take;
  }
  return result;
}

interface PickListDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderQueue: QueuedOrder[];
  stockSummary: StockSummary[];
}

export function PickListDialog({ open, onOpenChange, orderQueue, stockSummary }: PickListDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const pickData = useMemo(() => {
    // Aggregate total needs across all queued orders
    const eggNeeds = new Map<string, number>();
    const packagingNeeds = new Map<string, number>();
    const boxNeeds = new Map<string, number>();

    for (const order of orderQueue) {
      for (const [product, qty] of order.aggregates.eggsByProduct) {
        eggNeeds.set(product, (eggNeeds.get(product) || 0) + qty);
      }
      for (const [item, qty] of order.aggregates.packagingByItem) {
        packagingNeeds.set(item, (packagingNeeds.get(item) || 0) + qty);
      }
      for (const [type, qty] of order.aggregates.boxesByType) {
        boxNeeds.set(type, (boxNeeds.get(type) || 0) + qty);
      }
    }

    // Build pick rows with FIFO simulation
    const eggRows: ProductPickRow[] = [];
    for (const [product, totalButir] of eggNeeds) {
      const summary = stockSummary.find(s => s.product === product);
      const batches = summary?.batches ?? [];
      const allocations = simulateFIFO(batches, totalButir);
      const allocated = allocations.reduce((s, a) => s + a.allocatedButir, 0);
      eggRows.push({
        product,
        totalButir,
        allocations,
        shortfall: Math.max(0, totalButir - allocated),
      });
    }
    // sort by most butir first
    eggRows.sort((a, b) => b.totalButir - a.totalButir);

    return { eggRows, packagingNeeds, boxNeeds };
  }, [orderQueue, stockSummary]);

  const hasAtRisk = pickData.eggRows.some(r => r.allocations.some(a => a.isAtRisk));
  const hasShortfall = pickData.eggRows.some(r => r.shortfall > 0);

  const handlePrint = () => {
    window.print();
  };

  const handleWhatsApp = () => {
    const date = orderQueue[0]?.date ?? new Date().toISOString().slice(0, 10);
    const lines: string[] = [];
    lines.push(`*PICK LIST ${date}*`);
    lines.push(`${orderQueue.length} order(s)\n`);

    lines.push(`*TELUR:*`);
    for (const row of pickData.eggRows) {
      lines.push(`• ${row.product}: ${butirToDisplay(row.product, row.totalButir)}`);
      for (const a of row.allocations) {
        const risk = a.isAtRisk ? " ⚠" : "";
        lines.push(`  - ${a.invoiceSupplier || "No supplier"} (${a.date})${risk}: ${butirToDisplay(row.product, a.allocatedButir)}`);
      }
    }

    if (pickData.packagingNeeds.size > 0) {
      lines.push(`\n*PACKAGING:*`);
      for (const [item, qty] of pickData.packagingNeeds) {
        lines.push(`• ${item}: ${qty} pcs`);
      }
    }

    if (pickData.boxNeeds.size > 0) {
      lines.push(`\n*BOXES:*`);
      for (const [type, qty] of pickData.boxNeeds) {
        lines.push(`• ${type}: ${qty} pcs`);
      }
    }

    lines.push(`\n*ORDERS:*`);
    for (const order of orderQueue) {
      const eggs = Array.from(order.aggregates.eggsByProduct.entries())
        .map(([p, q]) => butirToDisplay(p, q))
        .join(", ");
      lines.push(`• ${order.buyer.name}${order.invoiceRef ? ` (${order.invoiceRef})` : ""}: ${eggs}`);
    }

    const text = encodeURIComponent(lines.join("\n"));
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const date = orderQueue[0]?.date ?? new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto print:shadow-none">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Dispatch Pick List
          </DialogTitle>
        </DialogHeader>

        {/* Print / Share actions */}
        <div className="flex gap-2 justify-end print:hidden">
          <Button variant="outline" size="sm" onClick={handleWhatsApp} className="gap-1.5">
            <Share2 className="h-4 w-4" />
            WhatsApp
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>

        <div ref={printRef} className="space-y-4 print:text-black">
          {/* Header */}
          <div className="print:border-b print:pb-2">
            <p className="font-semibold text-lg print:text-xl">PICK LIST — {date}</p>
            <p className="text-sm text-muted-foreground print:text-black">
              {orderQueue.length} order{orderQueue.length !== 1 ? "s" : ""} •{" "}
              {[...new Set(orderQueue.map(o => o.buyer.name))].join(", ")}
            </p>
          </div>

          {(hasAtRisk || hasShortfall) && (
            <div className="space-y-1.5 print:hidden">
              {hasShortfall && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Insufficient stock for some products — shortfall shown below.
                </div>
              )}
              {hasAtRisk && (
                <div className="flex items-center gap-2 rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-amber-700 dark:text-amber-400 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Some batches are at risk — dispatch these first.
                </div>
              )}
            </div>
          )}

          {/* Eggs section */}
          <div className="space-y-3">
            <p className="font-semibold text-sm uppercase tracking-wide text-muted-foreground print:text-black">
              Eggs to Pick
            </p>
            {pickData.eggRows.length === 0 && (
              <p className="text-sm text-muted-foreground">No eggs required.</p>
            )}
            {pickData.eggRows.map(row => (
              <div key={row.product} className="border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40">
                  <span className="font-medium">{row.product}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">
                      {butirToDisplay(row.product, row.totalButir)}
                    </span>
                    {row.shortfall > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        Short {butirToDisplay(row.product, row.shortfall)}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="divide-y">
                  {row.allocations.map((a, i) => (
                    <div key={i} className={`flex items-center justify-between px-4 py-2 text-sm ${a.isAtRisk ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {a.isAtRisk
                          ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          : <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        }
                        <span className="truncate text-muted-foreground print:text-black">
                          {a.invoiceSupplier || "—"}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">{a.date}</span>
                        <span className="text-xs text-muted-foreground shrink-0">({a.daysInWarehouse}d)</span>
                      </div>
                      <span className={`tabular-nums font-medium shrink-0 ml-4 ${a.isAtRisk ? "text-amber-600 dark:text-amber-400" : ""}`}>
                        {butirToDisplay(row.product, a.allocatedButir)}
                      </span>
                    </div>
                  ))}
                  {row.shortfall > 0 && (
                    <div className="flex items-center justify-between px-4 py-2 text-sm bg-destructive/5 text-destructive">
                      <span>⚠ Insufficient stock</span>
                      <span className="tabular-nums font-medium">
                        –{butirToDisplay(row.product, row.shortfall)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Packaging + Boxes */}
          {(pickData.packagingNeeds.size > 0 || pickData.boxNeeds.size > 0) && (
            <>
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {pickData.packagingNeeds.size > 0 && (
                  <div className="space-y-2">
                    <p className="font-semibold text-sm uppercase tracking-wide text-muted-foreground print:text-black">
                      Packaging
                    </p>
                    <div className="border rounded-lg divide-y">
                      {Array.from(pickData.packagingNeeds.entries()).map(([item, qty]) => (
                        <div key={item} className="flex items-center justify-between px-4 py-2 text-sm">
                          <span>{item}</span>
                          <span className="font-medium tabular-nums">{qty.toLocaleString()} pcs</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {pickData.boxNeeds.size > 0 && (
                  <div className="space-y-2">
                    <p className="font-semibold text-sm uppercase tracking-wide text-muted-foreground print:text-black">
                      Boxes
                    </p>
                    <div className="border rounded-lg divide-y">
                      {Array.from(pickData.boxNeeds.entries()).map(([type, qty]) => (
                        <div key={type} className="flex items-center justify-between px-4 py-2 text-sm">
                          <span>{type}</span>
                          <span className="font-medium tabular-nums">{qty.toLocaleString()} pcs</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Order summary */}
          <Separator />
          <div className="space-y-2">
            <p className="font-semibold text-sm uppercase tracking-wide text-muted-foreground print:text-black">
              Order Summary
            </p>
            <div className="border rounded-lg divide-y">
              {orderQueue.map(order => {
                const eggLine = Array.from(order.aggregates.eggsByProduct.entries())
                  .map(([p, q]) => butirToDisplay(p, q))
                  .join(" · ");
                return (
                  <div key={order.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">{order.buyer.name}</div>
                      {order.invoiceRef && (
                        <span className="text-xs text-muted-foreground shrink-0">{order.invoiceRef}</span>
                      )}
                    </div>
                    <p className="text-muted-foreground print:text-black text-xs mt-0.5">
                      {eggLine || "No eggs"} • {order.boxMode}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
