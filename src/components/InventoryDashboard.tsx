import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StockSummary, InventoryCategory, CATEGORY_LABELS } from "@/types/inventory";
import { AlertTriangle, Clock, Filter, ChevronDown, ChevronRight, FileText, Settings, AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useItemTypes } from "@/hooks/useItemTypes";

interface InventoryDashboardProps {
  stockSummary: StockSummary[];
  loading?: boolean;
}

const LOW_STOCK_KEY = 'eggkeep_low_stock_threshold';

export function InventoryDashboard({ stockSummary, loading = false }: InventoryDashboardProps) {
  const [selectedCategory, setSelectedCategory] = useState<InventoryCategory | "all">("all");
  const [sortBy, setSortBy] = useState<"stock" | "name" | "days">("stock");
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState<number>(() => {
    const stored = localStorage.getItem(LOW_STOCK_KEY);
    return stored ? parseInt(stored, 10) : 0;
  });
  const [thresholdInput, setThresholdInput] = useState<string>(() =>
    localStorage.getItem(LOW_STOCK_KEY) || "0"
  );
  const [thresholdOpen, setThresholdOpen] = useState(false);
  
  // Fetch all item types to show zero-stock items
  const { itemTypes } = useItemTypes();

  // Helper to check if product uses kg display
  const isKgProduct = (product: string) => {
    return product === "NEGERI BIASA" || product === "NEGERI OMEGA";
  };

  // Convert butir to kg (15.5 eggs per kg for Negeri)
  const butirToKg = (butir: number) => {
    return (butir / 15.5).toFixed(2);
  };

  // Format stock display based on product type
  const formatStock = (product: string, category: InventoryCategory, quantity: number) => {
    if (category === 'egg' && isKgProduct(product)) {
      return `${butirToKg(quantity)} kg (${quantity.toLocaleString()} butir)`;
    }
    return `${quantity.toLocaleString()} ${category === 'egg' ? 'butir' : 'pcs'}`;
  };

  // Merge stock summary with all item types to include zero-stock items
  const mergedSummary = useMemo(() => {
    const stockMap = new Map<string, StockSummary>();
    
    // Add all existing stock items
    stockSummary.forEach((item) => {
      stockMap.set(`${item.category}-${item.product}`, item);
    });
    
    // Add any item types that don't have stock (zero stock items)
    itemTypes.forEach((itemType) => {
      const key = `${itemType.category}-${itemType.name}`;
      if (!stockMap.has(key)) {
        stockMap.set(key, {
          product: itemType.name,
          totalStock: 0,
          oldestDate: null,
          maxDaysInWarehouse: 0,
          isAtRisk: false,
          category: itemType.category,
          atRiskQuantity: 0,
          safeQuantity: 0,
          batches: [],
        });
      }
    });
    
    return Array.from(stockMap.values());
  }, [stockSummary, itemTypes]);

  const filteredSummary = useMemo(() =>
    mergedSummary
      .filter((s) => selectedCategory === "all" || s.category === selectedCategory)
      .sort((a, b) => {
        if (sortBy === "stock") return b.totalStock - a.totalStock;
        if (sortBy === "name") return a.product.localeCompare(b.product);
        if (sortBy === "days") return b.maxDaysInWarehouse - a.maxDaysInWarehouse;
        return 0;
      }),
    [mergedSummary, selectedCategory, sortBy]
  );

  const totalAtRiskQuantity = useMemo(() =>
    stockSummary
      .filter((s) => s.category === 'egg')
      .reduce((sum, s) => sum + s.atRiskQuantity, 0),
    [stockSummary]
  );

  const productsWithAtRisk = useMemo(() =>
    stockSummary.filter((s) => s.atRiskQuantity > 0).length,
    [stockSummary]
  );

  const allAtRiskBatches = useMemo(() =>
    stockSummary
      .filter((s) => s.category === 'egg' && s.atRiskQuantity > 0)
      .flatMap((s) =>
        s.batches
          .filter((b) => b.isAtRisk)
          .map((b) => ({ ...b, product: s.product }))
      )
      .sort((a, b) => b.daysInWarehouse - a.daysInWarehouse),
    [stockSummary]
  );

  const categoryTotals = useMemo(() =>
    mergedSummary.reduce((acc, s) => {
      if (!acc[s.category]) acc[s.category] = 0;
      acc[s.category] += s.totalStock;
      return acc;
    }, {} as Record<InventoryCategory, number>),
    [mergedSummary]
  );

  const totalEggStock = useMemo(() =>
    stockSummary.filter(s => s.category === 'egg').reduce((sum, s) => sum + s.totalStock, 0),
    [stockSummary]
  );

  const isLowStock = threshold > 0 && totalEggStock < threshold;

  const saveThreshold = () => {
    const val = parseInt(thresholdInput, 10);
    if (!isNaN(val) && val >= 0) {
      setThreshold(val);
      localStorage.setItem(LOW_STOCK_KEY, String(val));
    }
    setThresholdOpen(false);
  };

  const toggleExpanded = (product: string) => {
    const newExpanded = new Set(expandedProducts);
    if (newExpanded.has(product)) {
      newExpanded.delete(product);
    } else {
      newExpanded.add(product);
    }
    setExpandedProducts(newExpanded);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="shadow-soft">
              <CardContent className="p-3 sm:pt-4 sm:pb-4 sm:px-6">
                <Skeleton className="h-6 w-20 mb-2" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-3 w-12 mt-1" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Low-stock alert + settings */}
      <div className="flex items-center justify-between gap-3">
        {isLowStock && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-amber-700 dark:text-amber-400 flex-1">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">
              Low stock: {totalEggStock.toLocaleString()} butir remaining (threshold: {threshold.toLocaleString()})
            </span>
          </div>
        )}
        <Popover open={thresholdOpen} onOpenChange={setThresholdOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Stock alert settings" className="ml-auto shrink-0">
              <Settings className="h-4 w-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <div className="space-y-3">
              <p className="text-sm font-medium">Low-Stock Alert</p>
              <p className="text-xs text-muted-foreground">Show a warning when total egg stock drops below this level. Set to 0 to disable.</p>
              <div className="space-y-1">
                <Label htmlFor="threshold-input" className="text-xs">Threshold (butir)</Label>
                <Input
                  id="threshold-input"
                  type="number"
                  min={0}
                  value={thresholdInput}
                  onChange={e => setThresholdInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveThreshold()}
                  className="h-9"
                />
              </div>
              <Button size="sm" className="w-full" onClick={saveThreshold}>Save</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Category Summary Cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4">
        {(["egg", "box", "label", "packaging"] as InventoryCategory[]).map((cat) => {
          const categoryColors: Record<InventoryCategory, string> = {
            egg: "bg-amber-500 text-white",
            box: "bg-blue-500 text-white",
            label: "bg-purple-500 text-white",
            packaging: "bg-emerald-500 text-white",
          };
          return (
            <Card 
              key={cat} 
              className={`shadow-soft cursor-pointer transition-all active:scale-95 sm:hover:scale-105 ${selectedCategory === cat ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setSelectedCategory(selectedCategory === cat ? "all" : cat)}
            >
              <CardContent className="p-3 sm:pt-4 sm:pb-4 sm:px-6">
                <Badge className={`${categoryColors[cat]} font-extrabold text-xs sm:text-base px-2 sm:px-3 py-0.5 sm:py-1 mb-1 sm:mb-2 shadow-sm uppercase tracking-wide`}>
                  {CATEGORY_LABELS[cat]}
                </Badge>
                <p className="text-xl sm:text-2xl font-display font-bold">
                  {(categoryTotals[cat] || 0).toLocaleString()}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground">{cat === 'egg' ? 'butir' : 'pcs'}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Stats Row - Now showing Total Eggs At Risk with Dialog */}
      <div className="grid grid-cols-1 gap-4">
        <Dialog>
          <DialogTrigger asChild>
            <Card className={`shadow-soft cursor-pointer transition-all hover:scale-[1.01] ${totalAtRiskQuantity > 0 ? "ring-2 ring-destructive/50" : ""}`}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Eggs At Risk</p>
                    <p className={`text-3xl font-display font-bold ${totalAtRiskQuantity > 0 ? "text-destructive" : "text-success"}`}>
                      {totalAtRiskQuantity.toLocaleString()} butir
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {productsWithAtRisk > 0 
                        ? `across ${productsWithAtRisk} product${productsWithAtRisk > 1 ? 's' : ''} • >5 days old • Click for details`
                        : 'All eggs are fresh'}
                    </p>
                  </div>
                  <div className={`h-12 w-12 rounded-full flex items-center justify-center ${totalAtRiskQuantity > 0 ? "bg-destructive/10" : "bg-success/10"}`}>
                    <AlertTriangle className={`h-6 w-6 ${totalAtRiskQuantity > 0 ? "text-destructive animate-pulse-soft" : "text-success"}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                All At-Risk Eggs ({totalAtRiskQuantity.toLocaleString()} butir)
              </DialogTitle>
            </DialogHeader>
            {allAtRiskBatches.length > 0 ? (
              <div className="mt-4">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 text-sm font-medium text-muted-foreground">Product</th>
                      <th className="text-left py-2 px-2 text-sm font-medium text-muted-foreground">Date</th>
                      <th className="text-left py-2 px-2 text-sm font-medium text-muted-foreground">Invoice/Supplier</th>
                      <th className="text-right py-2 px-2 text-sm font-medium text-muted-foreground">Quantity</th>
                      <th className="text-right py-2 px-2 text-sm font-medium text-muted-foreground">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allAtRiskBatches.map((batch) => (
                      <tr key={batch.id} className="border-b bg-destructive/5">
                        <td className="py-2 px-2 font-medium">{batch.product}</td>
                        <td className="py-2 px-2 text-muted-foreground">
                          {format(parseISO(batch.date), "dd/MM/yy")}
                        </td>
                        <td className="py-2 px-2 text-muted-foreground">
                          {batch.invoiceSupplier || "—"}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium">
                          {batch.quantity.toLocaleString()} butir
                        </td>
                        <td className="py-2 px-2 text-right text-destructive font-medium">
                          {batch.daysInWarehouse} days
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No at-risk eggs! 🎉</p>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Stock Table with Expandable Rows */}
      <Card className="shadow-soft">
        <CardHeader className="pb-3 sm:pb-4 px-3 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="text-base sm:text-lg">Stock Details</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={selectedCategory} onValueChange={(v) => setSelectedCategory(v as any)}>
                <SelectTrigger className="w-full sm:w-[130px] h-9 text-xs sm:text-sm">
                  <Filter className="h-3 w-3 mr-1 shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="egg">Eggs</SelectItem>
                  <SelectItem value="box">Boxes</SelectItem>
                  <SelectItem value="label">Labels</SelectItem>
                  <SelectItem value="packaging">Packaging</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                <SelectTrigger className="w-[90px] sm:w-[100px] h-9 text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">By Stock</SelectItem>
                  <SelectItem value="name">By Name</SelectItem>
                  <SelectItem value="days">By Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <div className="overflow-x-auto -mx-2 sm:mx-0">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="w-6 sm:w-8 py-2 sm:py-3 px-1 sm:px-2"></th>
                  <th className="text-left py-2 sm:py-3 px-1 sm:px-2 text-xs sm:text-sm font-medium text-muted-foreground">Product</th>
                  <th className="text-left py-2 sm:py-3 px-1 sm:px-2 text-xs sm:text-sm font-medium text-muted-foreground w-16 sm:w-24 hidden xs:table-cell">Category</th>
                  <th className="text-right py-2 sm:py-3 px-1 sm:px-2 text-xs sm:text-sm font-medium text-muted-foreground w-20 sm:w-28">Stock</th>
                  <th className="text-right py-2 sm:py-3 px-1 sm:px-2 text-xs sm:text-sm font-medium text-muted-foreground w-24 hidden md:table-cell">At Risk</th>
                  <th className="text-right py-2 sm:py-3 px-1 sm:px-2 text-xs sm:text-sm font-medium text-muted-foreground w-16 hidden md:table-cell">Days</th>
                  <th className="text-center py-2 sm:py-3 px-1 sm:px-2 text-xs sm:text-sm font-medium text-muted-foreground w-14 sm:w-20">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredSummary.map((item) => {
                  const isExpanded = expandedProducts.has(item.product);
                  const hasBatches = item.batches.length > 0;
                  
                  return (
                    <>
                      <tr
                        key={`${item.category}-${item.product}`}
                        onClick={() => hasBatches && toggleExpanded(item.product)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && hasBatches && toggleExpanded(item.product)}
                        tabIndex={hasBatches ? 0 : undefined}
                        role={hasBatches ? "button" : undefined}
                        aria-expanded={hasBatches ? expandedProducts.has(item.product) : undefined}
                        className={`border-b transition-colors hover:bg-muted/50 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                          item.isAtRisk && item.totalStock > 0
                            ? "bg-destructive/5 border-l-2 border-l-destructive"
                            : ""
                        } ${hasBatches ? "cursor-pointer" : ""}`}
                      >
                        <td className="py-2 sm:py-3 px-1 sm:px-2">
                          {hasBatches && (
                            isExpanded ? <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
                          )}
                        </td>
                        <td className="py-2 sm:py-3 px-1 sm:px-2">
                          <span className="font-medium text-xs sm:text-sm line-clamp-2">{item.product}</span>
                        </td>
                        <td className="py-2 sm:py-3 px-1 sm:px-2 hidden xs:table-cell">
                          <Badge variant="outline" className="text-[10px] sm:text-xs">
                            {CATEGORY_LABELS[item.category]}
                          </Badge>
                        </td>
                        <td className="py-2 sm:py-3 px-1 sm:px-2 text-right tabular-nums">
                          {item.category === 'egg' && isKgProduct(item.product) ? (
                            <div className="flex flex-col items-end">
                              <span className={`text-xs sm:text-sm ${item.totalStock === 0 ? "text-muted-foreground" : "font-semibold"}`}>
                                {butirToKg(item.totalStock)} kg
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                ({item.totalStock.toLocaleString()} butir)
                              </span>
                            </div>
                          ) : (
                            <>
                              <span className={`text-xs sm:text-sm ${item.totalStock === 0 ? "text-muted-foreground" : "font-semibold"}`}>
                                {item.totalStock.toLocaleString()}
                              </span>
                              <span className="text-[10px] sm:text-xs text-muted-foreground ml-0.5 sm:ml-1">
                                {item.category === 'egg' ? 'butir' : 'pcs'}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="py-2 sm:py-3 px-1 sm:px-2 text-right tabular-nums hidden md:table-cell">
                          {item.category === 'egg' && item.atRiskQuantity > 0 ? (
                            <span className="text-destructive font-medium text-sm">
                              {item.atRiskQuantity.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 sm:py-3 px-1 sm:px-2 text-right hidden md:table-cell">
                          {item.totalStock > 0 ? (
                            <span className="flex items-center justify-end gap-1">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className={`text-sm ${item.isAtRisk ? "text-destructive font-medium" : ""}`}>
                                {item.maxDaysInWarehouse}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 sm:py-3 px-1 sm:px-2 text-center">
                          {item.totalStock === 0 ? (
                            <Badge variant="secondary" className="text-[10px] sm:text-xs px-1.5 sm:px-2.5">Empty</Badge>
                          ) : item.isAtRisk ? (
                            <Badge variant="destructive" className="text-[10px] sm:text-xs gap-0.5 sm:gap-1 px-1.5 sm:px-2.5">
                              <AlertTriangle className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                              Risk
                            </Badge>
                          ) : (
                            <Badge className="text-[10px] sm:text-xs bg-success hover:bg-success/90 px-1.5 sm:px-2.5">OK</Badge>
                          )}
                        </td>
                      </tr>
                      {isExpanded && item.batches.map((batch) => (
                        <tr
                          key={batch.id}
                          className={`border-b text-xs sm:text-sm ${
                            batch.isAtRisk ? "bg-destructive/10" : "bg-muted/30"
                          }`}
                        >
                          <td className="py-1.5 sm:py-2 px-1 sm:px-2"></td>
                          <td className="py-1.5 sm:py-2 px-1 sm:px-2 pl-4 sm:pl-6" colSpan={2}>
                            <div className="flex flex-col xs:flex-row xs:items-center gap-0.5 xs:gap-2">
                              <span className="text-muted-foreground text-xs">
                                {format(parseISO(batch.date), "dd/MM/yy")}
                              </span>
                              {batch.invoiceSupplier && (
                                <span className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground truncate max-w-[100px] sm:max-w-none">
                                  <FileText className="h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0" />
                                  {batch.invoiceSupplier}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right tabular-nums">
                            {item.category === 'egg' && isKgProduct(item.product) ? (
                              <div className="flex flex-col items-end">
                                <span className="font-medium text-xs sm:text-sm">
                                  {butirToKg(batch.quantity)} kg
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  ({batch.quantity.toLocaleString()} butir)
                                </span>
                              </div>
                            ) : (
                              <>
                                <span className="font-medium text-xs sm:text-sm">{batch.quantity.toLocaleString()}</span>
                                <span className="text-[10px] sm:text-xs text-muted-foreground ml-0.5 sm:ml-1">
                                  {item.category === 'egg' ? 'butir' : 'pcs'}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right hidden md:table-cell">
                            <span className={`text-xs ${batch.isAtRisk ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                              {batch.daysInWarehouse} days
                            </span>
                          </td>
                          <td className="py-1.5 sm:py-2 px-1 sm:px-2 hidden md:table-cell"></td>
                          <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-center">
                            {batch.isAtRisk ? (
                              <Badge variant="destructive" className="text-[10px] sm:text-xs px-1 sm:px-2">Risk</Badge>
                            ) : (
                              <Badge className="text-[10px] sm:text-xs bg-success/80 hover:bg-success/70 px-1 sm:px-2">OK</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </>
                  );
                })}
                {filteredSummary.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No items found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}