import { useState, useMemo, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { localToday, pinnedCodesFor, radialSkuCodes } from "@/lib/buyerProfile";
import { useRecentPurchaseOrders } from "@/hooks/usePurchaseOrders";
import { RadialAddButton, type RadialItem } from "./RadialAddButton";
import { FLASH_MS, RADIAL_FLASH_CLASS } from "@/lib/radial";
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
import { format } from "date-fns";
import { useDuplicateOrderCheck, DuplicateMatch } from "@/hooks/useDuplicateOrderCheck";

interface QuickOutflowBuilderProps {
  stockSummary: StockSummary[];
  inflows: InflowEntry[];
  onSubmit: (entries: OutflowEntry[], userEmail: string, metadata?: ActivityLogMetadata) => Promise<boolean>;
  // Tablet landscape (6a): order area + 300px right panel. Only the JSX
  // branches on it; all state stays here so rotating never loses an order.
  tablet?: boolean;
}

// Tablet (6a) field chrome: 48px controls, radius 11, amber focus ring.
const TB_LABEL = "text-[13.5px] font-semibold text-ek-nav";
const TB_CONTROL =
  "h-12 rounded-[11px] border-ek-border bg-card px-3.5 text-base text-ek-fg md:text-base placeholder:text-[#a89d90] focus:border-amber-600 focus:shadow-[0_0_0_3px_rgba(217,119,6,0.15)] focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0";
const TB_POPOVER = "rounded-[14px] border-ek-border shadow-[0_14px_36px_rgba(0,0,0,0.16)]";
const TB_BIG_BUTTON = "h-[54px] w-full gap-2 rounded-[13px] text-base font-semibold disabled:opacity-[.45] [&_svg]:size-[18px]";

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

export function QuickOutflowBuilder({ stockSummary, inflows, onSubmit, tablet }: QuickOutflowBuilderProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { buyers, isLoading: buyersLoading } = useBuyers();
  const { dcsForBuyer, isLoading: dcsLoading, error: dcsError } = useBuyerDcs();
  const { skus } = usePackSKUs();
  const { conversionMap, eggProductNames, boxCapacityMap, labelsPerPackMap, getTypesByCategory } = useItemTypes();
  const { check: checkDuplicates } = useDuplicateOrderCheck();
  const queryClient = useQueryClient();

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
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
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
  // Tablet: the one line whose Rincian bahan popover is open. Cleared on
  // rotate: the phone row drops the popover without telling us, and the id
  // would reopen it on its own when the tablet row mounts again.
  const [openMaterialsLineId, setOpenMaterialsLineId] = useState<string | null>(null);
  useEffect(() => setOpenMaterialsLineId(null), [tablet]);

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

  // Radial pick (tablet): a pack line with the SKU already chosen, as the SKU
  // picker would set it. The effect below brings it into view once rendered.
  const orderAreaRef = useRef<HTMLDivElement>(null);
  const pickedLineId = useRef<string | null>(null);
  const addPickedLine = (skuCode: string) => {
    const id = crypto.randomUUID();
    pickedLineId.current = id;
    setLines(prev => [...prev, { id, lineType: "pack", skuCode }]);
  };
  useEffect(() => {
    const id = pickedLineId.current;
    pickedLineId.current = null;
    const area = orderAreaRef.current;
    const row = id && area?.querySelector<HTMLElement>(`[data-line-id="${id}"]`);
    if (!row) return;
    area.scrollTop = area.scrollHeight;
    row.querySelector("input")?.focus(); // the row's only input: Jumlah
    row.classList.add(RADIAL_FLASH_CLASS);
    window.setTimeout(() => row.classList.remove(RADIAL_FLASH_CLASS), FLASH_MS);
  }, [lines]);

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

  const pleaseSelectBuyerToast = () =>
    toast({
      title: t.common.error,
      description: t.outflow.pleaseSelectBuyer,
      variant: "destructive",
    });

  // Add current order to queue
  const addToQueue = () => {
    if (!selectedBuyer) {
      pleaseSelectBuyerToast();
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
      description: t.outflow.orderQueued.replace("{buyer}", selectedBuyer.name),
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
      // New POs: refresh the radial ranking and buyer-profile stats (read-only).
      if (completedCount > 0) queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });

      if (failedOrders.length === 0) {
        toast({
          title: t.outflow.orderRecorded,
          description: t.outflow.ordersRecordedDesc
            .replace("{count}", String(completedCount))
            .replace("{orders}", completedCount > 1 ? t.common.orders : t.common.order)
            .replace("{items}", String(totalEntries)),
        });
      } else {
        toast({
          title: completedCount > 0
            ? t.outflow.partialSubmission
                .replace("{done}", String(completedCount))
                .replace("{total}", String(ordersToSubmit.length))
            : t.common.error,
          description: completedCount > 0
            ? t.outflow.partialSubmissionDesc
                .replace("{done}", String(completedCount))
                .replace("{orders}", completedCount > 1 ? t.common.orders : t.common.order)
                .replace("{failed}", String(failedOrders.length))
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
      // Lines are fine but no buyer: say so, not "add a valid line".
      if (hasValidLines) pleaseSelectBuyerToast();
      else invalidLineToast();
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
        invoiceRef: o.invoiceRef,
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

  // Order header fields, shared by both layouts (the tablet restyles them and
  // lays them out 2×2: Buyer, DC / Date, Invoice).
  const fieldWrap = tablet ? "flex min-w-0 flex-col gap-1.5" : "space-y-2";
  const fieldLabel = tablet ? TB_LABEL : undefined;

  const buyerField = (
    <div className={fieldWrap}>
      <Label className={fieldLabel}>{t.outflow.buyer}</Label>
      <Popover open={buyerOpen} onOpenChange={setBuyerOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={buyerOpen}
            className={tablet
              ? cn(TB_CONTROL, "w-full justify-between font-semibold hover:bg-card hover:text-ek-fg", !selectedBuyer && "font-normal text-[#a89d90]")
              : "w-full justify-between h-12"}
            disabled={buyersLoading}
          >
            {tablet
              ? <span className="truncate">{selectedBuyer?.name || t.outflow.selectBuyer}</span>
              : selectedBuyer?.name || t.outflow.selectBuyer}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className={tablet ? cn("z-50 w-[270px] p-0", TB_POPOVER) : "w-[250px] p-0 z-50"} align="start">
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
                    className={tablet ? "min-h-11 rounded-[9px] text-[15px]" : undefined}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedBuyer?.id === buyer.id ? "opacity-100" : "opacity-0",
                        tablet && "text-amber-700"
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
  );

  const dateField = (
    <div className={fieldWrap}>
      <Label htmlFor="order-date" className={fieldLabel}>{t.common.date}</Label>
      <Input
        id="order-date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className={tablet ? TB_CONTROL : "h-12"}
      />
    </div>
  );

  const invoiceField = (
    <div className={fieldWrap}>
      <Label htmlFor="invoice-ref" className={fieldLabel}>{t.outflow.invoiceRef}</Label>
      <Input
        id="invoice-ref"
        type="text"
        value={invoiceRef}
        onChange={(e) => setInvoiceRef(e.target.value)}
        placeholder={t.common.optional}
        className={tablet ? TB_CONTROL : "h-12"}
      />
    </div>
  );

  // DC (distribution center) of the selected buyer
  const dcField = (
    <div className={fieldWrap}>
      <Label htmlFor="order-dc" className={fieldLabel}>{t.outflow.dc}</Label>
      <Select
        value={selectedDc?.id ?? ""}
        onValueChange={setDcId}
        disabled={buyerDcs.length === 0}
      >
        <SelectTrigger
          id="order-dc"
          className={tablet
            ? cn(TB_CONTROL, "font-semibold data-[placeholder]:font-normal data-[placeholder]:text-[#a89d90] disabled:bg-ek-muted disabled:opacity-100")
            : "h-12"}
        >
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
        <p className={cn(
          tablet ? "text-[12.5px] leading-[1.35]" : "text-xs",
          dcsError ? "text-destructive" : tablet ? "text-ek-mfg" : "text-muted-foreground"
        )}>
          {dcsError ? t.outflow.dcsLoadFailed : t.outflow.noDcsForBuyer}
        </p>
      )}
    </div>
  );

  const lineItems = lines.map((line, index) => (
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
      tablet={tablet}
      shortages={shortages}
      materialsOpen={openMaterialsLineId === line.id}
      onMaterialsOpenChange={(open) => setOpenMaterialsLineId(open ? line.id : null)}
    />
  ));

  const summaryAggregates = orderQueue.length > 0 ? totalAggregates : aggregates;
  const canQueue = hasValidLines && !!selectedBuyer;
  const canSubmit = !submitting && (hasValidLines || orderQueue.length > 0);
  const submitLabel = submitting
    ? t.outflow.recording
    : orderQueue.length > 0
      ? `${t.outflow.submitAll || "Submit All"} (${orderQueue.length + (hasValidLines && selectedBuyer ? 1 : 0)})`
      : t.outflow.submitOrder;

  return (
    <>
      {tablet ? (
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* Order area */}
          <div ref={orderAreaRef} className="min-w-0 flex-1 overflow-y-auto px-6 pb-7 pt-[22px] text-ek-fg">
            <h1 className="mb-[18px] flex items-center gap-3 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em]">
              <ShoppingCart className="h-7 w-7 shrink-0 text-amber-600" />
              {t.outflow.quickBuilder}
            </h1>

            <div className="grid grid-cols-2 gap-x-3.5 gap-y-3">
              {buyerField}
              {dcField}
              {dateField}
              {invoiceField}
            </div>

            <div className="mb-2.5 mt-[22px] flex items-center gap-2.5">
              <h2 className="font-display text-[19px] font-semibold">{t.outflow.orderLines}</h2>
              <span className="text-sm text-ek-mfg">{t.outflow.linesCount.replace("{n}", String(lines.length))}</span>
            </div>

            {lines.length === 0 ? (
              <div className="rounded-[14px] border-2 border-dashed border-ek-border p-[26px] text-center text-[15px] leading-normal text-ek-mfg">
                <p className="font-semibold text-ek-fg">{t.outflow.noLines}</p>
                <p>{t.outflow.noLinesHint}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-ek-border bg-card">
                <div className="grid grid-cols-[44px_minmax(0,1fr)_120px_44px] items-center gap-2 border-b border-ek-border px-3.5 py-3 text-[12.5px] font-semibold text-ek-mfg">
                  <span>#</span>
                  <span>{t.outflow.packSku}</span>
                  <span>{t.common.quantity}</span>
                  <span />
                </div>
                {lineItems}
              </div>
            )}

            <PoRadialAdd
              buyerName={selectedBuyer?.name ?? null}
              skus={skus}
              pinnedSkuCodes={pinnedSkuCodes}
              onTap={addLine}
              onPick={(item) => addPickedLine(item.key)}
            />
          </div>

          {/* Right panel: queue, summary, pinned actions */}
          <aside className="flex min-h-0 w-[300px] shrink-0 flex-col border-l border-ek-border bg-card text-ek-fg">
            <div className="min-h-0 flex-1 overflow-y-auto p-[18px]">
              {orderQueue.length > 0 && (
                <div className="mb-4 rounded-[14px] border border-ek-border bg-[#faf8f4]">
                  <button
                    type="button"
                    aria-expanded={queueOpen}
                    onClick={() => setQueueOpen((o) => !o)}
                    className={cn(
                      "flex min-h-[50px] w-full items-center gap-2 px-3 py-1.5 text-left text-[14.5px] font-semibold",
                      queueOpen && "border-b border-ek-border"
                    )}
                  >
                    <Users className="h-[17px] w-[17px] shrink-0" />
                    <span className="min-w-0 leading-[1.2]">{t.outflow.queuedOrders}</span>
                    <span className="inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-amber-600 px-1.5 text-xs font-bold text-white">
                      {orderQueue.length}
                    </span>
                    <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 transition-transform", queueOpen && "rotate-180")} />
                  </button>
                  {queueOpen && (
                    <div className="flex flex-col gap-2 p-2">
                      {orderQueue.map((order) => (
                        <div key={order.id} className="flex items-center gap-0.5 rounded-[11px] border border-ek-border bg-card py-2 pl-3 pr-1">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[15px] font-bold">{order.buyer.name}</div>
                            <div className="mt-[3px] text-[12.5px] leading-[1.35] text-ek-mfg">
                              {order.dcName && (
                                <span className="mr-1 inline-block whitespace-nowrap rounded-md border border-ek-border px-1.5 py-px text-xs font-semibold text-ek-nav">
                                  {order.dcName}
                                </span>
                              )}
                              {t.outflow.linesCount.replace("{n}", String(order.lines.length))} •{" "}
                              {Array.from(order.aggregates.eggsByProduct).map(([p, q]) => `${q.toLocaleString()} ${p}`).join(", ")}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            aria-label={`${t.common.edit} ${order.buyer.name}`}
                            onClick={() => editFromQueue(order.id)}
                            className="h-11 w-11 shrink-0 rounded-[11px] p-0 text-ek-nav hover:bg-ek-muted hover:text-ek-nav [&_svg]:size-[17px]"
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={`${t.common.delete} ${order.buyer.name}`}
                            onClick={() => removeFromQueue(order.id)}
                            className="h-11 w-11 shrink-0 rounded-[11px] p-0 text-red-600 hover:bg-red-50 hover:text-red-600 [&_svg]:size-[17px]"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setPickListOpen(true)}
                    className="flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-b-[14px] border-t border-ek-border text-sm font-semibold text-ek-nav hover:bg-ek-muted hover:text-ek-fg"
                  >
                    <ClipboardList className="h-4 w-4" />
                    {t.pickList.button}
                  </button>
                </div>
              )}

              <OrderSummaryPanel
                variant="panel"
                aggregates={summaryAggregates}
                shortages={shortages}
                conversionMap={conversionMap}
              />
            </div>

            <div className="flex flex-col gap-2.5 border-t border-ek-border px-[18px] pb-4 pt-3.5">
              <Button
                type="button"
                variant="outline"
                onClick={addToQueue}
                disabled={!canQueue}
                className={cn(TB_BIG_BUTTON, "border-ek-border bg-card text-ek-fg hover:border-[#d9cfbf] hover:bg-card hover:text-ek-fg")}
              >
                <Plus />
                {t.outflow.addToQueue || "Add to Queue"}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(TB_BIG_BUTTON, "bg-amber-600 text-white hover:bg-amber-700")}
              >
                <ShoppingCart />
                {submitLabel}
              </Button>
            </div>
          </aside>
        </div>
      ) : (
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
                      <Button variant="ghost" className="min-w-0 flex-1 justify-between h-12 px-4">
                        {/* min-w-0 + truncate: on a phone the title would push Daftar Ambil off-screen */}
                        <div className="flex min-w-0 items-center gap-2">
                          <Users className="h-4 w-4" />
                          <span className="truncate font-medium">{t.outflow.queuedOrders || "Queued Orders"}</span>
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
                    >
                      <ClipboardList className="h-4 w-4" />
                      {t.pickList.button}
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
              {buyerField}
              {dateField}
              {invoiceField}
              {dcField}
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
                    {lineItems}
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
                  aggregates={summaryAggregates}
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
                disabled={!canQueue}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t.outflow.addToQueue || "Add to Queue"}
              </Button>

              {/* Submit button */}
              <Button
                onClick={handleSubmit}
                className="h-12 flex-1 text-base font-medium"
                disabled={!canSubmit}
              >
                <ShoppingCart className="h-4 w-4 mr-2" />
                {submitLabel}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialogs render once, outside the layout branch. */}
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
              {t.outflow.proceedAnyway}
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
                    •{" "}
                    {d.kind === "ref"
                      ? t.outflow.duplicateRef
                          .replace("{ref}", d.invoiceRef ?? "")
                          .replace("{buyer}", d.buyerName)
                          .replace("{date}", d.outflowDate)
                      : `${d.buyerName} (${d.outflowDate}) — ${t.outflow.duplicateLine.replace("{minutes}", String(d.minutesAgo))}`}
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
    </>
  );
}

interface PoRadialAddProps {
  buyerName: string | null;
  skus: { code: string; isActive?: boolean | null }[];
  pinnedSkuCodes: Set<string>;
  onTap: () => void;
  onPick: (item: RadialItem) => void;
}

// Tablet Tambah Baris: a tap adds a blank line; press-drag picks one of the
// buyer's most-ordered active SKUs (all buyers' when the buyer has none). Its
// own component so only the tablet fetches the recent POs.
function PoRadialAdd({ buyerName, skus, pinnedSkuCodes, onTap, onPick }: PoRadialAddProps) {
  const { t } = useLanguage();
  const { data: recent } = useRecentPurchaseOrders();
  const { codes, scope } = useMemo(() => {
    const active = new Set(skus.filter((s) => s.isActive !== false).map((s) => s.code));
    return radialSkuCodes(recent ?? [], buyerName, localToday(), (code) => active.has(code));
  }, [recent, buyerName, skus]);

  const head = !buyerName
    ? `${t.radial.frequent} · ${t.radial.allBuyers}`
    : scope === "buyer"
      ? `${t.radial.frequent} · ${buyerName}`
      : `${t.radial.noHistory.replace("{buyer}", buyerName)} · ${t.radial.allBuyers}`;

  return (
    <RadialAddButton
      caption={t.outflow.addLine}
      items={codes.map((code) => ({ key: code, label: code, pinned: pinnedSkuCodes.has(code) }))}
      banner={{ text: head, muted: t.radial.last8w }}
      centerVerb={t.radial.add}
      onTap={onTap}
      onPick={onPick}
    />
  );
}
