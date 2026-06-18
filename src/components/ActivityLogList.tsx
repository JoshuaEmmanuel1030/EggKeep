import { useState, useMemo } from "react";
import { Cloud, CloudOff, Filter, X, Search, Calendar, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ActivityLog } from "@/types/activityLog";
import { GroupedActivityLog } from "./GroupedActivityLog";
import { useLanguage } from "@/contexts/LanguageContext";
import { format, parseISO, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Clock, Layers, LayoutList, Wifi, WifiOff } from "lucide-react";

interface ActivityLogListProps {
  logs: ActivityLog[];
  loading: boolean;
  pendingCount: number;
  isOnline: boolean;
}

type ActionTypeFilter = "all" | "inflow" | "outflow" | "voided";

export function ActivityLogList({
  logs,
  loading,
  pendingCount,
  isOnline,
}: ActivityLogListProps) {
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<"grouped" | "chronological">("grouped");
  
  // Filter state
  const [actionTypeFilter, setActionTypeFilter] = useState<ActionTypeFilter>("all");
  const [buyerFilter, setBuyerFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [skuFilter, setSkuFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Get unique buyers from logs for the filter dropdown
  const buyersInLogs = useMemo(() => {
    const buyerNames = new Set<string>();
    logs.forEach(log => {
      if (log.metadata?.buyerName) {
        buyerNames.add(log.metadata.buyerName);
      }
    });
    return Array.from(buyerNames).sort();
  }, [logs]);

  // Get unique suppliers from logs for the filter dropdown
  const suppliersInLogs = useMemo(() => {
    const supplierNames = new Set<string>();
    logs.forEach(log => {
      if (log.invoice_supplier) {
        supplierNames.add(log.invoice_supplier);
      }
    });
    return Array.from(supplierNames).sort();
  }, [logs]);

  // Filter logs based on action type filter (including voided tab)
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Handle voided tab - show only voided entries
      if (actionTypeFilter === "voided") {
        return log.voided_at != null;
      }
      
      // For "all" tab, show everything including voided (they'll display with indicator)
      // For inflow/outflow tabs, exclude voided entries
      if (actionTypeFilter !== "all" && log.voided_at) return false;

      // Action type filter (inflow/outflow)
      if (actionTypeFilter === "inflow" || actionTypeFilter === "outflow") {
        if (log.action_type !== actionTypeFilter) return false;
      }

      // Buyer filter (only applies to outflows with buyer info)
      if (buyerFilter && buyerFilter !== "all") {
        if (log.metadata?.buyerName !== buyerFilter) return false;
      }

      // Supplier filter
      if (supplierFilter && supplierFilter !== "all") {
        if (log.invoice_supplier !== supplierFilter) return false;
      }

      // SKU/Product filter
      if (skuFilter.trim()) {
        const term = skuFilter.toLowerCase().trim();
        const matchesProduct = log.product.toLowerCase().includes(term);
        const matchesSku = log.metadata?.orderLines?.some(
          line => line.skuCode?.toLowerCase().includes(term)
        );
        const matchesBuyer = log.metadata?.buyerName?.toLowerCase().includes(term);
        if (!matchesProduct && !matchesSku && !matchesBuyer) return false;
      }

      // Date range filter
      if (dateRange?.from || dateRange?.to) {
        const logDate = parseISO(log.recorded_at);
        const from = dateRange.from ? startOfDay(dateRange.from) : new Date(0);
        const to = dateRange.to ? endOfDay(dateRange.to) : new Date(9999, 11, 31);
        
        if (!isWithinInterval(logDate, { start: from, end: to })) return false;
      }

      return true;
    });
  }, [logs, actionTypeFilter, buyerFilter, supplierFilter, skuFilter, dateRange]);

  const hasActiveFilters = actionTypeFilter !== "all" || buyerFilter !== "all" || 
    supplierFilter !== "all" || skuFilter.trim() !== "" || dateRange?.from || dateRange?.to;

  const activeFilterCount = [
    buyerFilter !== "all",
    supplierFilter !== "all",
    skuFilter.trim() !== "",
    dateRange?.from || dateRange?.to,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setActionTypeFilter("all");
    setBuyerFilter("all");
    setSupplierFilter("all");
    setSkuFilter("");
    setDateRange(undefined);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">
            Loading activity logs...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {isOnline ? (
            <Badge variant="outline" className="gap-1.5 bg-green-50 text-green-700 border-green-200">
              <Wifi className="h-3 w-3" />
              {t.activity.online}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 bg-orange-50 text-orange-700 border-orange-200">
              <WifiOff className="h-3 w-3" />
              {t.activity.offline}
            </Badge>
          )}
        </div>
        {pendingCount > 0 && (
          <Badge variant="secondary" className="gap-1.5">
            <CloudOff className="h-3 w-3" />
            {pendingCount} {t.activity.pending}
          </Badge>
        )}
      </div>

      {/* Main Card */}
      <Card>
        {/* Header */}
        <CardHeader className="pb-4 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Clock className="h-5 w-5" />
              {t.activity.title}
            </CardTitle>
            
            {/* View Toggle */}
            <ToggleGroup 
              type="single" 
              value={viewMode} 
              onValueChange={(value) => value && setViewMode(value as "grouped" | "chronological")}
              className="bg-muted rounded-lg p-1"
            >
              <ToggleGroupItem 
                value="grouped" 
                aria-label="Grouped view"
                className="text-xs px-3 py-1.5 rounded-md data-[state=on]:bg-background data-[state=on]:shadow-sm"
              >
                <Layers className="h-3.5 w-3.5 mr-1.5" />
                {t.activity.groupedView}
              </ToggleGroupItem>
              <ToggleGroupItem 
                value="chronological" 
                aria-label="Chronological view"
                className="text-xs px-3 py-1.5 rounded-md data-[state=on]:bg-background data-[state=on]:shadow-sm"
              >
                <LayoutList className="h-3.5 w-3.5 mr-1.5" />
                {t.activity.chronologicalView}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardHeader>

        {/* Filter Section */}
        <div className="px-6 py-4 bg-muted/20 border-b">
          {/* Primary Row: Action Type + Filter Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup
              type="single"
              value={actionTypeFilter}
              onValueChange={(value) => value && setActionTypeFilter(value as ActionTypeFilter)}
              className="bg-background border rounded-lg p-1"
            >
              <ToggleGroupItem 
                value="all" 
                size="sm" 
                className="text-sm px-4 py-1.5 rounded-md data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {t.activity.all}
              </ToggleGroupItem>
              <ToggleGroupItem 
                value="inflow" 
                size="sm" 
                className="text-sm px-4 py-1.5 rounded-md data-[state=on]:bg-green-600 data-[state=on]:text-white"
              >
                {t.activity.inflows}
              </ToggleGroupItem>
              <ToggleGroupItem 
                value="outflow" 
                size="sm" 
                className="text-sm px-4 py-1.5 rounded-md data-[state=on]:bg-orange-600 data-[state=on]:text-white"
              >
                {t.activity.outflows}
              </ToggleGroupItem>
              <ToggleGroupItem 
                value="voided" 
                size="sm" 
                className="text-sm px-4 py-1.5 rounded-md data-[state=on]:bg-red-600 data-[state=on]:text-white"
              >
                {t.activity.voided}
              </ToggleGroupItem>
            </ToggleGroup>

            <div className="flex items-center gap-2">
              <Button
                variant={filtersOpen ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltersOpen(!filtersOpen)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                {t.activity.filters}
                {activeFilterCount > 0 && (
                  <Badge 
                    variant="secondary" 
                    className={cn(
                      "h-5 min-w-5 px-1.5 text-xs",
                      filtersOpen && "bg-primary-foreground/20 text-primary-foreground"
                    )}
                  >
                    {activeFilterCount}
                  </Badge>
                )}
                <ChevronDown className={cn(
                  "h-4 w-4 transition-transform",
                  filtersOpen && "rotate-180"
                )} />
              </Button>

              {hasActiveFilters && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={clearFilters} 
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  {t.activity.clearFilters}
                </Button>
              )}
            </div>
          </div>

          {/* Expandable Filter Panel */}
          <div className={cn(
            "overflow-hidden transition-all duration-200 ease-in-out",
            filtersOpen ? "mt-4 pt-4 border-t border-border/50 max-h-[500px] opacity-100" : "max-h-0 opacity-0"
          )}>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
                {/* Buyer Filter */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t.activity.filterByBuyer}</Label>
                  <Select value={buyerFilter} onValueChange={setBuyerFilter}>
                    <SelectTrigger className="h-10 bg-background">
                      <SelectValue placeholder={t.activity.selectBuyer} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t.activity.allBuyers}</SelectItem>
                      {buyersInLogs.map(buyer => (
                        <SelectItem key={buyer} value={buyer}>
                          {buyer}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Date Range Filter */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t.activity.filterByDate}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full h-10 justify-start text-left font-normal bg-background overflow-hidden",
                          !dateRange?.from && "text-muted-foreground"
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4 flex-shrink-0" />
                        <span className="truncate">
                          {dateRange?.from ? (
                            dateRange.to ? (
                              <>
                                {format(dateRange.from, "MMM d")} - {format(dateRange.to, "MMM d")}
                              </>
                            ) : (
                              format(dateRange.from, "MMM d, yyyy")
                            )
                          ) : (
                            t.activity.selectDateRange || "Select date range"
                          )}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        initialFocus
                        mode="range"
                        defaultMonth={dateRange?.from}
                        selected={dateRange}
                        onSelect={setDateRange}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* SKU/Product Search */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t.activity.searchSkuProduct}</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      value={skuFilter}
                      onChange={(e) => setSkuFilter(e.target.value)}
                      className="h-10 pl-9 bg-background"
                    />
                  </div>
                </div>

                {/* Supplier Filter */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t.activity.filterBySupplier}</Label>
                  <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                    <SelectTrigger className="h-10 bg-background">
                      <SelectValue placeholder={t.activity.selectSupplier} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t.activity.allSuppliers}</SelectItem>
                      {suppliersInLogs.map(supplier => (
                        <SelectItem key={supplier} value={supplier}>
                          {supplier}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

          {/* Results Count */}
          {hasActiveFilters && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-medium text-foreground">{filteredLogs.length}</span> of {logs.length} entries
              </p>
            </div>
          )}
        </div>

        {/* Content */}
        <CardContent className="pt-4">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {hasActiveFilters ? t.activity.noResults : "No activity logs yet"}
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-420px)] min-h-[300px] max-h-[600px] pr-4">
              <GroupedActivityLog logs={filteredLogs} showVoided={actionTypeFilter === "voided"} viewMode={viewMode} />
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
