import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { OrderLineItem } from "./OrderLineItem";
import { OrderSummaryPanel } from "./OrderSummaryPanel";
import { Buyer, OrderLine, AggregatedMaterials } from "@/types/quickOutflow";
import { StockSummary, InflowEntry, OutflowEntry } from "@/types/inventory";
import { ActivityLogMetadata } from "@/types/activityLog";
import { buildOrderEntries, buildOrderMetadata as buildPayloadMetadata, type OrderPayloadInput } from "@/lib/orderPayload";
import { useBuyers } from "@/hooks/useBuyers";
import { pinnedCodesFor } from "@/lib/buyerProfile";
import { useBuyerDcs } from "@/hooks/useBuyerDcs";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { useItemTypes } from "@/hooks/useItemTypes";
import {
  PackSKU,
  aggregateOrderMaterials,
  calculateLineMaterials,
  validateStockAgainstInventory,
} from "@/lib/outflowCalculator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PickListDialog } from "./PickListDialog";
import { ShoppingCart, Plus, ChevronsUpDown, Check, ChevronDown, Trash2, Users, Pencil, ClipboardList } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { useDuplicateOrderCheck, DuplicateMatch } from "@/hooks/useDuplicateOrderCheck";

interface QuickOutflowBuilderProps {
  stockSummary: StockSummary[];
  inflows: InflowEntry[];
  onSubmit: (entries: OutflowEntry[], userEmail: string, metadata?: ActivityLogMetadata) => Promise<boolean>;
}

interface QueuedOrder {
  id: string;
  buyer: Buyer;
  date: string;
  invoiceRef: string;
  dcId?: string;
  dcName?: string;  // name snapshot, like buyerName
  lines: OrderLine[];
  aggregates: AggregatedMaterials;
}

export function QuickOutflowBuilder({ stockSummary, inflows, onSubmit }: QuickOutflowBuilderProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { buyers, isLoading: buyersLoading } = useBuyers();
  const { dcsForBuyer, isLoading: dcsLoading, error: dcsError } = useBuyerDcs();
  const { skus } = usePackSKUs();
  const { conversionMap, eggProductNames, boxCapacityMap, labelsPerPackMap, getTypesByCategory } = useItemTypes();
  const { check: checkDuplicates } = useDuplicateOrderCheck();

  // Label catalog names for the per-line label dropdown.
  const labelNames = useMemo(
    () => getTypesByCategory("label").map((lt) => lt.name),
    [getTypesByCategory]
  );
  
  // Map SKUs to PackSKU interface for outflow calculator.
  // basePackCode/boxMode MUST be carried through — the box-line desugar
  // (resolveBoxLine) reads them; dropping them makes Box SKUs behave as plain packs.
  const packSKUs: PackSKU[] = skus.map(sku => ({
    code: sku.code,
    displayName: sku.displayName,
    eggsPerPack: sku.eggsPerPack,
    eggProduct: sku.eggProduct,
    packagingItem: sku.packagingItem,
    isActive: sku.isActive,
    basePackCode: sku.basePackCode,
    boxMode: sku.boxMode,
  }));
  
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [selectedBuyer, setSelectedBuyer] = useState<Buyer | null>(null);
  // Pins of the selected buyer, read from the live buyers list so an admin's
  // edit shows without re-picking the buyer. Catalog skus carry ids; packSKUs don't.
  const pinnedSkuCodes = useMemo(
    () => pinnedCodesFor(skus, buyers.find((b) => b.id === selectedBuyer?.id)?.pinnedSkuIds),
    [skus, buyers, selectedBuyer?.id]
  );
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [dcId, setDcId] = useState<string | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false); // Ref-based guard for immediate double-click prevention
  
  // Multi-buyer queue
  const [orderQueue, setOrderQueue] = useState<QueuedOrder[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [shortageDialogOpen, setShortageDialogOpen] = useState(false);
  const [pendingOrders, setPendingOrders] = useState<QueuedOrder[]>([]);
  const [dupDialogOpen, setDupDialogOpen] = useState(false);
  const [dupMatches, setDupMatches] = useState<DuplicateMatch[]>([]);
  const [pickListOpen, setPickListOpen] = useState(false);

  // DCs of the selected buyer. A buyer with exactly one DC gets it preselected
  // (derived, so it also works when the DC list loads after the buyer is picked),
  // but only when nothing was chosen: a chosen DC that was since deleted must be
  // re-picked, never silently swapped for the remaining one.
  // When the buyer has DCs, one is required; a buyer with none orders without.
  // While the list is still loading the DC can't be known yet, so hold the order.
  // If it failed to load (e.g. table not migrated) orders go through without a DC.
  const buyerDcs = dcsForBuyer(selectedBuyer?.id);
  const selectedDc = dcId
    ? buyerDcs.find((d) => d.id === dcId)
    : buyerDcs.length === 1 ? buyerDcs[0] : undefined;
  const dcMissing = !!selectedBuyer && (dcsLoading || (buyerDcs.length > 0 && !selectedDc));

  // Changing the buyer clears the DC
  const handleBuyerSelect = (buyer: Buyer) => {
    setSelectedBuyer(buyer);
    setDcId(null);
    setBuyerOpen(false);
  };

  const dcRequiredToast = () =>
    toast({
      title: t.common.error,
      description: t.outflow.dcRequired,
      variant: "destructive",
    });

  // Snapshot of the order currently in the form. No order-level box mode:
  // boxes come only from Box SKU lines (boxesRequired is always on for those).
  const buildCurrentOrder = (buyer: Buyer): QueuedOrder => ({
    id: crypto.randomUUID(),
    buyer,
    date,
    invoiceRef,
    dcId: selectedDc?.id,
    dcName: selectedDc?.name,
    lines: [...lines],
    aggregates: aggregateOrderMaterials(lines, null, true, packSKUs, conversionMap, boxCapacityMap, labelsPerPackMap),
  });

  // Create new order line
  const addLine = () => {
    setLines(prev => [...prev, {
      id: crypto.randomUUID(),
      lineType: "pack",
    }]);
  };

  // Remove order line
  const removeLine = (lineId: string) => {
    setLines(prev => prev.filter(l => l.id !== lineId));
  };

  // Update order line
  const updateLine = (lineId: string, updates: Partial<OrderLine>) => {
    setLines(prev => prev.map(l => 
      l.id === lineId ? { ...l, ...updates } : l
    ));
  };

  // Calculate aggregated materials
  const aggregates = useMemo(() => {
    return aggregateOrderMaterials(lines, null, true, packSKUs, conversionMap, boxCapacityMap, labelsPerPackMap);
  }, [lines, packSKUs, conversionMap, boxCapacityMap, labelsPerPackMap]);

  // Calculate total aggregates including queue
  const totalAggregates = useMemo(() => {
    const combined: AggregatedMaterials = {
      eggsByProduct: new Map(),
      packagingByItem: new Map(),
      labelsByItem: new Map(),
      boxesByType: new Map(),
    };

    // Add current order
    for (const [product, qty] of aggregates.eggsByProduct) {
      combined.eggsByProduct.set(product, (combined.eggsByProduct.get(product) || 0) + qty);
    }
    for (const [item, qty] of aggregates.packagingByItem) {
      combined.packagingByItem.set(item, (combined.packagingByItem.get(item) || 0) + qty);
    }
    for (const [item, qty] of aggregates.labelsByItem) {
      combined.labelsByItem.set(item, (combined.labelsByItem.get(item) || 0) + qty);
    }
    for (const [type, qty] of aggregates.boxesByType) {
      combined.boxesByType.set(type, (combined.boxesByType.get(type) || 0) + qty);
    }

    // Add queued orders
    for (const order of orderQueue) {
      for (const [product, qty] of order.aggregates.eggsByProduct) {
        combined.eggsByProduct.set(product, (combined.eggsByProduct.get(product) || 0) + qty);
      }
      for (const [item, qty] of order.aggregates.packagingByItem) {
        combined.packagingByItem.set(item, (combined.packagingByItem.get(item) || 0) + qty);
      }
      for (const [item, qty] of order.aggregates.labelsByItem) {
        combined.labelsByItem.set(item, (combined.labelsByItem.get(item) || 0) + qty);
      }
      for (const [type, qty] of order.aggregates.boxesByType) {
        combined.boxesByType.set(type, (combined.boxesByType.get(type) || 0) + qty);
      }
    }

    return combined;
  }, [aggregates, orderQueue]);

  // Validate stock against total
  const shortages = useMemo(() => {
    return validateStockAgainstInventory(totalAggregates, stockSummary);
  }, [totalAggregates, stockSummary]);

  // Check if form is valid
  const hasValidLines = useMemo(() => {
    return lines.some(line => {
      if (line.lineType === "pack") {
        return line.skuCode && line.packQty && line.packQty > 0;
      }
      if (line.lineType === "loose") {
        return line.eggProduct && line.looseQty && line.looseQty > 0;
      }
      return false;
    });
  }, [lines]);

  // A filled pack line that resolves to no materials (a Box SKU whose box×pack
  // capacity isn't configured, or a retired SKU) would be logged as sold while
  // deducting nothing. Hold the order instead.
  const hasUnresolvedLine = lines.some(
    (l) => l.lineType === "pack" && l.skuCode && l.packQty > 0 &&
      !calculateLineMaterials(l, null, true, packSKUs, conversionMap, boxCapacityMap, labelsPerPackMap)
  );

  const invalidLineToast = () =>
    toast({
      title: t.common.error,
      description: t.outflow.pleaseAddValidLine,
      variant: "destructive",
    });
  const boxSkuToast = () =>
    toast({
      title: t.common.error,
      description: t.outflow.boxSkuNoCapacity,
      variant: "destructive",
    });

  // Add current order to queue
  const addToQueue = () => {
    if (!selectedBuyer) {
      toast({
        title: t.common.error,
        description: t.outflow.pleaseSelectBuyer,
        variant: "destructive",
      });
      return;
    }

    if (dcMissing) {
      dcRequiredToast();
      return;
    }

    if (!hasValidLines) {
      invalidLineToast();
      return;
    }
    if (hasUnresolvedLine) {
      boxSkuToast();
      return;
    }

    const queuedOrder = buildCurrentOrder(selectedBuyer);

    setOrderQueue(prev => [...prev, queuedOrder]);

    // Reset form for next buyer
    setLines([]);
    setInvoiceRef("");
    setSelectedBuyer(null);
    setDcId(null);

    toast({
      title: t.outflow.addedToQueue || "Added to Queue",
      description: `${selectedBuyer.name} order queued`,
    });
  };

  // Remove order from queue
  const removeFromQueue = (orderId: string) => {
    setOrderQueue(prev => prev.filter(o => o.id !== orderId));
  };

  // Load a queued order back into the form for editing
  const editFromQueue = (orderId: string) => {
    const order = orderQueue.find(o => o.id === orderId);
    if (!order) return;
    setSelectedBuyer(order.buyer);
    setDate(order.date);
    setInvoiceRef(order.invoiceRef);
    setDcId(order.dcId ?? null);
    setLines([...order.lines]);
    removeFromQueue(orderId);
  };

  // Order -> shared payload input (entries + metadata come from lib/orderPayload,
  // which the "Edit order" correction uses too).
  const toPayloadInput = (order: QueuedOrder): OrderPayloadInput => ({
    buyerName: order.buyer.name,
    invoiceRef: order.invoiceRef,
    date: order.date,
    dcId: order.dcId,
    dcName: order.dcName,
    lines: order.lines,
    aggregates: order.aggregates,
  });
  const buildOrderMetadata = (order: QueuedOrder): ActivityLogMetadata => buildPayloadMetadata(toPayloadInput(order));

  const doSubmit = async (ordersToSubmit: QueuedOrder[]) => {
    setSubmitting(true);

    // No client-side stock gate here: the shortage dialog already warned the user
    // (all shortages, with an explicit "Continue Anyway"), and the record_order_outflows
    // RPC is the real authority — atomic per order, rolls back on INSUFFICIENT_STOCK.
    // Each order is its OWN atomic RPC. One order failing must NOT drop the
    // orders after it (the old `throw` did exactly that — the tail of a bulk
    // queue silently vanished). Instead: submit every order, keep only the
    // FAILED ones in the queue, and clear succeeded ones so a re-submit can't
    // re-record them (fresh entry UUIDs would dodge the RPC's idempotency guard
    // and double-deduct stock).
    const failedOrders: QueuedOrder[] = [];
    let completedCount = 0;
    try {
      const timestamp = new Date().toISOString();
      const userEmail = user?.email || "";
      let totalEntries = 0;

      for (const order of ordersToSubmit) {
        const entries: OutflowEntry[] = buildOrderEntries(toPayloadInput(order), timestamp);

        const metadata = buildOrderMetadata(order);
        let success = false;
        try {
          success = await onSubmit(entries, userEmail, metadata);
        } catch (error) {
          console.error(`Error submitting order for ${order.buyer.name}:`, error);
          success = false;
        }
        if (success) {
          completedCount++;
          totalEntries += entries.length;
        } else {
          failedOrders.push(order);
        }
      }

      // Only the failed orders survive in the queue; succeeded ones are gone so
      // they can never be re-recorded. Always clear the form — a failed
      // current-form order is now captured as a queued order above.
      setOrderQueue(failedOrders);
      setLines([]);
      setInvoiceRef("");
      setSelectedBuyer(null);
      setDcId(null);

      if (failedOrders.length === 0) {
        toast({
          title: t.outflow.orderRecorded,
          description: `${completedCount} ${completedCount > 1 ? 'orders' : 'order'} recorded (${totalEntries} items)`,
        });
      } else {
        toast({
          title: completedCount > 0
            ? `Partial submission (${completedCount}/${ordersToSubmit.length})`
            : t.common.error,
          description: completedCount > 0
            ? `${completedCount} order(s) recorded. ${failedOrders.length} still queued — fix stock and re-submit.`
            : t.outflow.failedToRecordOrder,
          variant: "destructive",
        });
      }
    } finally {
      setSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const handleSubmit = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    const allOrders = [...orderQueue];
    if (hasValidLines && selectedBuyer) {
      if (dcMissing) {
        dcRequiredToast();
        isSubmittingRef.current = false;
        return;
      }
      if (hasUnresolvedLine) {
        boxSkuToast();
        isSubmittingRef.current = false;
        return;
      }
      allOrders.push(buildCurrentOrder(selectedBuyer));
    }

    if (allOrders.length === 0) {
      invalidLineToast();
      isSubmittingRef.current = false;
      return;
    }

    // Near-duplicate guard: warn (don't block) if a matching order was recorded
    // recently. Uses the same orderLines shape that gets stored, for signature parity.
    const dups = await checkDuplicates(
      allOrders.map((o) => ({
        buyerName: o.buyer.name,
        outflowDate: o.date,
        orderLines: buildOrderMetadata(o).orderLines ?? [],
        dcId: o.dcId,
      }))
    );
    if (dups.length > 0) {
      setDupMatches(dups);
      setPendingOrders(allOrders);
      setDupDialogOpen(true);
      isSubmittingRef.current = false;
      return;
    }

    if (shortages.length > 0) {
      setPendingOrders(allOrders);
      setShortageDialogOpen(true);
      isSubmittingRef.current = false;
      return;
    }

    await doSubmit(allOrders);
  };

  // "Record anyway" from the duplicate warning: fall through to the shortage gate
  // (if any) then submit the same pending orders.
  const proceedPastDuplicate = () => {
    setDupDialogOpen(false);
    if (shortages.length > 0) {
      setShortageDialogOpen(true);
      return;
    }
    isSubmittingRef.current = true;
    doSubmit(pendingOrders);
  };

  return (
    <Card className="shadow-soft animate-fade-in">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShoppingCart className="h-5 w-5 text-primary" />
          {t.outflow.quickBuilder}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Queued Orders Section */}
        {orderQueue.length > 0 && (
          <Collapsible open={queueOpen} onOpenChange={setQueueOpen}>
            <div className="border rounded-lg bg-muted/30">
              <div className="flex items-center">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="flex-1 justify-between h-12 px-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      <span className="font-medium">{t.outflow.queuedOrders || "Queued Orders"}</span>
                      <Badge variant="secondary">{orderQueue.length}</Badge>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", queueOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-12 px-3 gap-1.5 text-xs text-muted-foreground hover:text-foreground border-l rounded-none rounded-tr-lg"
                  onClick={() => setPickListOpen(true)}
                  aria-label="View pick list"
                >
                  <ClipboardList className="h-4 w-4" />
                  Pick List
                </Button>
              </div>
              <CollapsibleContent>
                <div className="p-4 pt-0 space-y-2">
                  {orderQueue.map((order) => (
                    <div key={order.id} className="flex items-center justify-between p-3 bg-card rounded border">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{order.buyer.name}</span>
                          {order.dcName && (
                            <Badge variant="outline" className="text-xs">{order.dcName}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {order.lines.length} line(s) • 
                          {Array.from(order.aggregates.eggsByProduct.entries()).map(([p, q]) => 
                            ` ${q.toLocaleString()} ${p}`
                          ).join(', ')}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Edit queued order"
                          onClick={() => editFromQueue(order.id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Remove queued order"
                          onClick={() => removeFromQueue(order.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        {/* Header inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Buyer selector */}
          <div className="space-y-2">
            <Label>{t.outflow.buyer}</Label>
            <Popover open={buyerOpen} onOpenChange={setBuyerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={buyerOpen}
                  className="w-full justify-between h-12"
                  disabled={buyersLoading}
                >
                  {selectedBuyer?.name || t.outflow.selectBuyer}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[250px] p-0 z-50" align="start">
                <Command>
                  <CommandInput placeholder={t.outflow.searchBuyer} />
                  <CommandList>
                    <CommandEmpty>{t.outflow.noBuyerFound}</CommandEmpty>
                    <CommandGroup>
                      {buyers.map((buyer) => (
                        <CommandItem
                          key={buyer.id}
                          value={buyer.name}
                          onSelect={() => handleBuyerSelect(buyer)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedBuyer?.id === buyer.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {buyer.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="order-date">{t.common.date}</Label>
            <Input
              id="order-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-12"
            />
          </div>

          {/* Invoice/Reference */}
          <div className="space-y-2">
            <Label htmlFor="invoice-ref">{t.outflow.invoiceRef}</Label>
            <Input
              id="invoice-ref"
              type="text"
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
              placeholder={t.common.optional}
              className="h-12"
            />
          </div>

          {/* DC (distribution center) of the selected buyer */}
          <div className="space-y-2">
            <Label htmlFor="order-dc">{t.outflow.dc}</Label>
            <Select
              value={selectedDc?.id ?? ""}
              onValueChange={setDcId}
              disabled={buyerDcs.length === 0}
            >
              <SelectTrigger id="order-dc" className="h-12">
                <SelectValue placeholder={selectedBuyer ? t.outflow.selectDc : t.outflow.selectBuyerFirst} />
              </SelectTrigger>
              <SelectContent>
                {buyerDcs.map((dc) => (
                  <SelectItem key={dc.id} value={dc.id}>
                    {dc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBuyer && !dcsLoading && buyerDcs.length === 0 && (
              <p className={cn("text-xs", dcsError ? "text-destructive" : "text-muted-foreground")}>
                {dcsError ? t.outflow.dcsLoadFailed : t.outflow.noDcsForBuyer}
              </p>
            )}
          </div>
        </div>

        <Separator />

        {/* Order lines and summary */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Order lines section */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{t.outflow.orderLines}</h3>
            </div>

            {lines.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                <p>{t.outflow.noLines}</p>
                <p className="text-sm">{t.outflow.noLinesHint}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {lines.map((line, index) => (
                  <OrderLineItem
                    key={line.id}
                    line={line}
                    index={index}
                    selectedBuyer={selectedBuyer}
                    skus={packSKUs}
                    pinnedSkuCodes={pinnedSkuCodes}
                    conversionMap={conversionMap}
                    boxCapacityMap={boxCapacityMap}
                    labelsPerPackMap={labelsPerPackMap}
                    eggProductNames={eggProductNames}
                    labelNames={labelNames}
                    onUpdate={(updates) => updateLine(line.id, updates)}
                    onRemove={() => removeLine(line.id)}
                  />
                ))}
              </div>
            )}

            {/* Add Line button at bottom */}
            <Button 
              type="button" 
              variant="outline" 
              className="w-full h-12" 
              onClick={addLine}
            >
              <Plus className="h-4 w-4 mr-2" /> {t.outflow.addLine}
            </Button>
          </div>

          {/* Summary panel */}
          <div className="lg:col-span-1">
            <OrderSummaryPanel
              aggregates={orderQueue.length > 0 ? totalAggregates : aggregates}
              shortages={shortages}
              conversionMap={conversionMap}
            />
          </div>
        </div>

        <Separator />

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Add to Queue button */}
          <Button
            type="button"
            variant="outline"
            onClick={addToQueue}
            className="h-12 flex-1"
            disabled={!hasValidLines || !selectedBuyer}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t.outflow.addToQueue || "Add to Queue"}
          </Button>

          {/* Submit button */}
          <Button
            onClick={handleSubmit}
            className="h-12 flex-1 text-base font-medium"
            disabled={submitting || (!hasValidLines && orderQueue.length === 0)}
          >
            <ShoppingCart className="h-4 w-4 mr-2" />
            {submitting 
              ? t.outflow.recording 
              : orderQueue.length > 0 
                ? `${t.outflow.submitAll || "Submit All"} (${orderQueue.length + (hasValidLines && selectedBuyer ? 1 : 0)})`
                : t.outflow.submitOrder
            }
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={shortageDialogOpen} onOpenChange={setShortageDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.outflow.warningShortages}</AlertDialogTitle>
            <AlertDialogDescription>
              <ul className="mt-2 space-y-1 text-sm">
                {shortages.map(s => {
                  const unit = s.category === "egg" && conversionMap[s.item]?.unit === "kg" ? " kg" : "";
                  return (
                    <li key={s.item}>• {s.item}: {t.outflow.need} {s.required.toLocaleString()}{unit}, {t.outflow.have} {s.available.toLocaleString()}{unit}</li>
                  );
                })}
              </ul>
              <span className="block mt-3 text-sm">{t.outflow.continueAnyway}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel || "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShortageDialogOpen(false);
                isSubmittingRef.current = true;
                doSubmit(pendingOrders);
              }}
            >
              {t.outflow.continueAnyway || "Continue Anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dupDialogOpen} onOpenChange={setDupDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.outflow.duplicateTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">{t.outflow.duplicateBody}</span>
              <ul className="mt-2 space-y-1 text-sm">
                {dupMatches.map((d, i) => (
                  <li key={`${d.buyerName}-${d.outflowDate}-${i}`}>
                    • {d.buyerName} ({d.outflowDate}) — {t.outflow.duplicateLine.replace("{minutes}", String(d.minutesAgo))}
                  </li>
                ))}
              </ul>
              <span className="block mt-3 text-sm">{t.outflow.duplicateHint}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={proceedPastDuplicate}>
              {t.outflow.recordAnyway}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PickListDialog
        open={pickListOpen}
        onOpenChange={setPickListOpen}
        orderQueue={orderQueue}
        stockSummary={stockSummary}
      />
    </Card>
  );
}
