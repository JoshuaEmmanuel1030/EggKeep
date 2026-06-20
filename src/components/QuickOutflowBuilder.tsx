import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { OrderLineItem } from "./OrderLineItem";
import { OrderSummaryPanel } from "./OrderSummaryPanel";
import { Buyer, BoxModeType, OrderLine, QuickOutflowOrder, AggregatedMaterials } from "@/types/quickOutflow";
import { StockSummary, InflowEntry, OutflowEntry } from "@/types/inventory";
import { ActivityLogMetadata } from "@/types/activityLog";
import { useBuyers } from "@/hooks/useBuyers";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { 
  PackSKU,
  aggregateOrderMaterials, 
  validateStockAgainstInventory,
  getAvailableBoxModes,
} from "@/lib/outflowCalculator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PickListDialog } from "./PickListDialog";
import { ShoppingCart, Plus, ChevronsUpDown, Check, Package, ChevronDown, Trash2, Users, Pencil, ClipboardList } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";

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
  boxMode: BoxModeType;
  boxesRequired: boolean;
  lines: OrderLine[];
  aggregates: AggregatedMaterials;
}

export function QuickOutflowBuilder({ stockSummary, inflows, onSubmit }: QuickOutflowBuilderProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { buyers, isLoading: buyersLoading } = useBuyers();
  const { skus, isLoading: skusLoading } = usePackSKUs();
  
  // Map SKUs to PackSKU interface for outflow calculator
  const packSKUs: PackSKU[] = skus.map(sku => ({
    code: sku.code,
    displayName: sku.displayName,
    eggsPerPack: sku.eggsPerPack,
    eggProduct: sku.eggProduct,
    packagingItem: sku.packagingItem,
    isActive: sku.isActive,
  }));
  
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [selectedBuyer, setSelectedBuyer] = useState<Buyer | null>(null);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [boxMode, setBoxMode] = useState<BoxModeType>("box kecil");
  const [boxesRequired, setBoxesRequired] = useState(true);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false); // Ref-based guard for immediate double-click prevention
  
  // Multi-buyer queue
  const [orderQueue, setOrderQueue] = useState<QueuedOrder[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [shortageDialogOpen, setShortageDialogOpen] = useState(false);
  const [pendingOrders, setPendingOrders] = useState<QueuedOrder[]>([]);
  const [pickListOpen, setPickListOpen] = useState(false);

  // Update box mode when buyer changes
  const handleBuyerSelect = (buyer: Buyer) => {
    setSelectedBuyer(buyer);
    setBoxMode(buyer.defaultBoxMode);
    setBuyerOpen(false);
  };

  // Get available box modes for selected buyer
  const availableBoxModes = useMemo(() => {
    if (!selectedBuyer) return ["box kecil"] as BoxModeType[];
    return getAvailableBoxModes(selectedBuyer.name);
  }, [selectedBuyer]);

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
    return aggregateOrderMaterials(lines, boxMode, boxesRequired, packSKUs);
  }, [lines, boxMode, boxesRequired, packSKUs]);

  // Calculate total aggregates including queue
  const totalAggregates = useMemo(() => {
    const combined: AggregatedMaterials = {
      eggsByProduct: new Map(),
      packagingByItem: new Map(),
      boxesByType: new Map(),
      logistics: { keranjang: false, traysUsed: 0 },
    };

    // Add current order
    for (const [product, qty] of aggregates.eggsByProduct) {
      combined.eggsByProduct.set(product, (combined.eggsByProduct.get(product) || 0) + qty);
    }
    for (const [item, qty] of aggregates.packagingByItem) {
      combined.packagingByItem.set(item, (combined.packagingByItem.get(item) || 0) + qty);
    }
    for (const [type, qty] of aggregates.boxesByType) {
      combined.boxesByType.set(type, (combined.boxesByType.get(type) || 0) + qty);
    }
    combined.logistics.keranjang = combined.logistics.keranjang || aggregates.logistics.keranjang;
    combined.logistics.traysUsed += aggregates.logistics.traysUsed;

    // Add queued orders
    for (const order of orderQueue) {
      for (const [product, qty] of order.aggregates.eggsByProduct) {
        combined.eggsByProduct.set(product, (combined.eggsByProduct.get(product) || 0) + qty);
      }
      for (const [item, qty] of order.aggregates.packagingByItem) {
        combined.packagingByItem.set(item, (combined.packagingByItem.get(item) || 0) + qty);
      }
      for (const [type, qty] of order.aggregates.boxesByType) {
        combined.boxesByType.set(type, (combined.boxesByType.get(type) || 0) + qty);
      }
      combined.logistics.keranjang = combined.logistics.keranjang || order.aggregates.logistics.keranjang;
      combined.logistics.traysUsed += order.aggregates.logistics.traysUsed;
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

    if (!hasValidLines) {
      toast({
        title: t.common.error,
        description: t.outflow.pleaseAddValidLine,
        variant: "destructive",
      });
      return;
    }

    const queuedOrder: QueuedOrder = {
      id: crypto.randomUUID(),
      buyer: selectedBuyer,
      date,
      invoiceRef,
      boxMode,
      boxesRequired,
      lines: [...lines],
      aggregates: aggregateOrderMaterials(lines, boxMode, boxesRequired, packSKUs),
    };

    setOrderQueue(prev => [...prev, queuedOrder]);

    // Reset form for next buyer
    setLines([]);
    setInvoiceRef("");
    setSelectedBuyer(null);
    setBoxMode("box kecil");

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
    setBoxMode(order.boxMode);
    setBoxesRequired(order.boxesRequired);
    setLines([...order.lines]);
    removeFromQueue(orderId);
  };

  // Build metadata for activity log
  const buildOrderMetadata = (order: QueuedOrder): ActivityLogMetadata => {
    const relatedProducts: Array<{ product: string; quantity: number; type: string }> = [];
    
    for (const [product, qty] of order.aggregates.eggsByProduct) {
      relatedProducts.push({ product, quantity: qty, type: 'egg' });
    }
    for (const [item, qty] of order.aggregates.packagingByItem) {
      relatedProducts.push({ product: item, quantity: qty, type: 'packaging' });
    }
    for (const [type, qty] of order.aggregates.boxesByType) {
      relatedProducts.push({ product: type, quantity: qty, type: 'box' });
    }

    // Get first SKU for reference
    const packLine = order.lines.find(l => l.lineType === 'pack' && l.skuCode);

    // Build order lines (what customer actually ordered)
    const orderLines = order.lines
      .filter(l => (l.lineType === 'pack' && l.skuCode) || (l.lineType === 'loose' && l.eggProduct))
      .map(l => ({
        skuCode: l.skuCode,
        packQty: l.packQty,
        eggProduct: l.eggProduct,
        looseQty: l.looseQty,
      }));
    
    return {
      orderType: 'quick_outflow',
      buyerName: order.buyer.name,
      invoiceRef: order.invoiceRef || undefined,
      skuCode: packLine?.skuCode,
      packQty: packLine?.packQty,
      boxMode: order.boxMode,
      outflowDate: order.date,
      orderLines,
      relatedProducts,
    };
  };

  const doSubmit = async (ordersToSubmit: QueuedOrder[]) => {
    setSubmitting(true);

    // Pre-flight: re-validate combined stock before any write to prevent partial commits
    const combined: AggregatedMaterials = {
      eggsByProduct: new Map(),
      packagingByItem: new Map(),
      boxesByType: new Map(),
      logistics: { keranjang: false, traysUsed: 0 },
    };
    for (const order of ordersToSubmit) {
      for (const [p, q] of order.aggregates.eggsByProduct) combined.eggsByProduct.set(p, (combined.eggsByProduct.get(p) || 0) + q);
      for (const [i, q] of order.aggregates.packagingByItem) combined.packagingByItem.set(i, (combined.packagingByItem.get(i) || 0) + q);
      for (const [b, q] of order.aggregates.boxesByType) combined.boxesByType.set(b, (combined.boxesByType.get(b) || 0) + q);
    }
    const preflightShortages = validateStockAgainstInventory(combined, stockSummary).filter(s => s.available === 0);
    if (preflightShortages.length > 0) {
      toast({
        title: "Stock changed",
        description: `No stock for: ${preflightShortages.map(s => s.item).join(', ')}. Refresh and try again.`,
        variant: "destructive",
      });
      setSubmitting(false);
      isSubmittingRef.current = false;
      return;
    }

    let completedCount = 0;
    try {
      const timestamp = new Date().toISOString();
      const userEmail = user?.email || "";
      let totalEntries = 0;

      for (const order of ordersToSubmit) {
        const entries: OutflowEntry[] = [];

        for (const [product, quantity] of order.aggregates.eggsByProduct) {
          entries.push({
            id: crypto.randomUUID(),
            date: order.date,
            product,
            quantityInButir: quantity,
            createdAt: timestamp,
            category: "egg",
            invoiceSupplier: order.invoiceRef || `${order.buyer.name} - Order`,
          });
        }

        for (const [item, quantity] of order.aggregates.packagingByItem) {
          entries.push({
            id: crypto.randomUUID(),
            date: order.date,
            product: item,
            quantityInButir: quantity,
            createdAt: timestamp,
            category: "packaging",
            invoiceSupplier: order.invoiceRef || `${order.buyer.name} - Order`,
          });
        }

        for (const [boxType, quantity] of order.aggregates.boxesByType) {
          entries.push({
            id: crypto.randomUUID(),
            date: order.date,
            product: boxType,
            quantityInButir: quantity,
            createdAt: timestamp,
            category: "box",
            invoiceSupplier: order.invoiceRef || `${order.buyer.name} - Order`,
          });
        }

        const metadata = buildOrderMetadata(order);
        const success = await onSubmit(entries, userEmail, metadata);
        if (!success) throw new Error(`Failed to submit order for ${order.buyer.name}`);
        completedCount++;
        totalEntries += entries.length;
      }

      toast({
        title: t.outflow.orderRecorded,
        description: `${ordersToSubmit.length} ${ordersToSubmit.length > 1 ? 'orders' : 'order'} recorded (${totalEntries} items)`,
      });

      setLines([]);
      setInvoiceRef("");
      setSelectedBuyer(null);
      setBoxMode("box kecil");
      setOrderQueue([]);
    } catch (error) {
      console.error("Error submitting orders:", error);
      const remaining = ordersToSubmit.length - completedCount;
      toast({
        title: completedCount > 0 ? `Partial submission (${completedCount}/${ordersToSubmit.length})` : t.common.error,
        description: completedCount > 0
          ? `${completedCount} order(s) recorded. ${remaining} failed — check activity log and re-submit the remainder.`
          : t.outflow.failedToRecordOrder,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const handleSubmit = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    let allOrders = [...orderQueue];
    if (hasValidLines && selectedBuyer) {
      allOrders.push({
        id: crypto.randomUUID(),
        buyer: selectedBuyer,
        date,
        invoiceRef,
        boxMode,
        boxesRequired,
        lines: [...lines],
        aggregates: aggregateOrderMaterials(lines, boxMode, boxesRequired, packSKUs),
      });
    }

    if (allOrders.length === 0) {
      toast({
        title: t.common.error,
        description: t.outflow.pleaseAddValidLine,
        variant: "destructive",
      });
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
                          <Badge variant="outline" className="text-xs">{order.boxMode}</Badge>
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

          {/* Boxing mode */}
          <div className="space-y-2">
            <Label>{t.outflow.boxingMode}</Label>
            <Select value={boxMode} onValueChange={(v) => setBoxMode(v as BoxModeType)}>
              <SelectTrigger className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableBoxModes.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Boxes required checkbox */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="boxes-required"
            checked={boxesRequired}
            onCheckedChange={(checked) => setBoxesRequired(checked as boolean)}
          />
          <label
            htmlFor="boxes-required"
            className="text-sm font-medium cursor-pointer flex items-center gap-2"
          >
            <Package className="h-4 w-4" />
            {t.outflow.boxesRequired}
          </label>
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
                    boxMode={boxMode}
                    boxesRequired={boxesRequired}
                    selectedBuyer={selectedBuyer}
                    skus={packSKUs}
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
              boxMode={boxMode}
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
                {shortages.map(s => (
                  <li key={s.item}>• {s.item}: {t.outflow.need} {s.required}, {t.outflow.have} {s.available}</li>
                ))}
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

      <PickListDialog
        open={pickListOpen}
        onOpenChange={setPickListOpen}
        orderQueue={orderQueue}
        stockSummary={stockSummary}
      />
    </Card>
  );
}
