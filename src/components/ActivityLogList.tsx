import { useState, useMemo } from "react";
import { Cloud, CloudOff, Filter, X, Search, Calendar, ChevronDown, Download } from "lucide-react";
import { ActivityLog } from "@/types/activityLog";

function exportLogsToCSV(logs: ActivityLog[]): string {
  const headers = ["Date", "Time", "Type", "Product", "Qty (stock units)", "Buyer / Supplier", "Invoice", "User", "Voided"];
  const rows = logs.map(log => {
    const dt = new Date(log.recorded_at);
    return [
      dt.toISOString().slice(0, 10),
      dt.toTimeString().slice(0, 5),
      log.action_type,
      log.product,
      log.quantity_butir.toString(),
      log.metadata?.buyerName || log.invoice_supplier || "",
      log.metadata?.invoiceRef || log.invoice_supplier || "",
      log.user_email || "",
      log.voided_at ? "YES" : "NO",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GroupedActivityLog } from "./GroupedActivityLog";
import { ActivitySplitView } from "./ActivitySplitView";
import { matchesType, presetOf, presetRange, todayStats, type DatePreset, countEntries } from "@/lib/activityFilters";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { useItemTypes } from "@/hooks/useItemTypes";
import { buildSkuBomRows, skuBomRowsToCSV } from "@/lib/outflowSkuExport";
import { format, parseISO, startOfDay, endOfDay, isWithinInterval, isSameDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Clock, Layers, LayoutList, List, Wifi, WifiOff } from "lucide-react";

interface ActivityLogListProps {
  logs: ActivityLog[];
  loading: boolean;
  pendingCount: number;
  isOnline: boolean;
  onVoided?: () => void;
  // Tablet landscape (>=1024px): full-height header + split feed/detail.
  tablet?: boolean;
}

// "quick" = Orders (quick outflows with a buyer), "manual" = Kastun.
export type TypeFilter = "all" | "quick" | "manual" | "inflow" | "voided";

// Tablet chrome classes (docs/handoff/activities, direction 1a).
const SEG_GROUP = "gap-0.5 rounded-xl bg-ek-muted p-[3px]";
const SEG_ITEM =
  "h-[38px] rounded-[9px] px-3 text-ek-mfg hover:bg-transparent hover:text-ek-fg data-[state=on]:bg-card data-[state=on]:text-ek-fg data-[state=on]:shadow-[0_1px_3px_rgba(0,0,0,.1)]";
const TOOL_BTN =
  "h-11 gap-2 rounded-[11px] border-ek-border bg-card px-3.5 text-[15px] font-semibold text-ek-fg hover:bg-ek-muted hover:text-ek-fg [&_svg]:size-[18px]";
const MENU_ITEM =
  "flex-col items-start gap-0.5 rounded-[9px] px-3 py-2.5 text-[15px] font-semibold text-ek-fg focus:bg-ek-muted focus:text-ek-fg";
const SECTION_LABEL = "text-xs font-bold uppercase tracking-[0.07em] text-ek-mfg";
const SELECT_TRIGGER = "h-12 rounded-[11px] border-ek-border bg-card px-3.5 text-[15.5px]";
const PRESET_CHIP =
  "h-10 whitespace-nowrap rounded-full border border-ek-border px-3.5 text-sm font-semibold text-ek-nav";
const PRESET_CHIP_ON = "border-amber-600 bg-ek-accent text-amber-700";

export function ActivityLogList({
  logs,
  loading,
  pendingCount,
  isOnline,
  onVoided,
  tablet = false,
}: ActivityLogListProps) {
  const { t } = useLanguage();
  const { skus } = usePackSKUs();
  const { conversionMap, boxCapacityMap, labelsPerPackMap } = useItemTypes();
  const [viewMode, setViewMode] = useState<"grouped" | "chronological">("grouped");
  
  // Filter state
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [buyerFilter, setBuyerFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [skuFilter, setSkuFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [customDateOpen, setCustomDateOpen] = useState(false);

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

  // Get unique suppliers from logs for the filter dropdown.
  // Only inflows carry real supplier names; on outflows the same
  // invoice_supplier column holds the invoice/PO number, so exclude them.
  const suppliersInLogs = useMemo(() => {
    const supplierNames = new Set<string>();
    logs.forEach(log => {
      if (log.action_type === "inflow" && log.invoice_supplier) {
        supplierNames.add(log.invoice_supplier);
      }
    });
    return Array.from(supplierNames).sort();
  }, [logs]);

  // Filter logs based on action type filter (including voided tab)
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Type tab (voided rules included); the filters below apply on every tab.
      if (!matchesType(log, typeFilter)) return false;

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
  }, [logs, typeFilter, buyerFilter, supplierFilter, skuFilter, dateRange]);
  // Feed rows shown (an order's material rows count once), for the tablet strip.
  const shownEntries = useMemo(() => countEntries(filteredLogs), [filteredLogs]);
  const totalEntries = useMemo(() => countEntries(logs), [logs]);

  const hasActiveFilters = typeFilter !== "all" || buyerFilter !== "all" ||
    supplierFilter !== "all" || skuFilter.trim() !== "" || dateRange?.from || dateRange?.to;

  // Filters that live behind the Filters button (Date, Buyer, Supplier). The
  // search box sits outside it on tablet, so it isn't counted here.
  const activeFilterCount = [
    buyerFilter !== "all",
    supplierFilter !== "all",
    dateRange?.from || dateRange?.to,
  ].filter(Boolean).length;
  // Mobile keeps the search inside its filter panel, so its badge counts it too.
  const mobileFilterCount = activeFilterCount + (skuFilter.trim() !== "" ? 1 : 0);

  const clearFilters = () => {
    setTypeFilter("all");
    setBuyerFilter("all");
    setSupplierFilter("all");
    setSkuFilter("");
    setDateRange(undefined);
  };

  // Today's header stats are over every log, not the filtered list.
  const stats = useMemo(() => todayStats(logs), [logs]);

  const hasOutflows = filteredLogs.some((l) => l.action_type === "outflow");
  const exportActivityLog = () => {
    const csv = exportLogsToCSV(filteredLogs);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `activity-logs-${date}.csv`);
  };
  const exportSkuBom = () => {
    const rows = buildSkuBomRows(filteredLogs, skus, conversionMap, boxCapacityMap, labelsPerPackMap);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(skuBomRowsToCSV(rows), `outflow-sku-bom-${date}.csv`);
  };

  if (tablet) {
    const datePreset = presetOf(dateRange);
    const presetLabel: Record<DatePreset, string> = {
      today: t.activity.today,
      last7: t.activity.last7,
      last30: t.activity.last30,
      allTime: t.activity.allTime,
      custom: t.activity.custom,
    };
    const typeTabs: { value: TypeFilter; label: string; on?: string }[] = [
      { value: "all", label: t.activity.all },
      { value: "quick", label: t.activity.orders },
      { value: "manual", label: t.activity.kastun },
      { value: "inflow", label: t.activity.inflows, on: "data-[state=on]:bg-emerald-600 data-[state=on]:text-white" },
      { value: "voided", label: t.activity.voided, on: "data-[state=on]:bg-red-600 data-[state=on]:text-white" },
    ];
    const viewTabs = [
      { value: "grouped", Icon: Layers, label: t.activity.groupedView },
      { value: "chronological", Icon: List, label: t.activity.chronologicalView },
    ] as const;

    const customDateLabel = () => {
      const from = dateRange?.from ?? dateRange?.to;
      const to = dateRange?.to;
      if (!from) return "";
      return to && !isSameDay(from, to)
        ? `${format(from, "d MMM")} – ${format(to, "d MMM")}`
        : format(from, "d MMM");
    };

    // One chip per active filter, each clearing just itself.
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (typeFilter !== "all") {
      const label = typeTabs.find((tab) => tab.value === typeFilter)?.label ?? typeFilter;
      chips.push({ key: "type", label, clear: () => setTypeFilter("all") });
    }
    if (datePreset !== "allTime") {
      const label = datePreset === "custom" ? customDateLabel() : presetLabel[datePreset];
      chips.push({ key: "date", label, clear: () => setDateRange(undefined) });
    }
    if (buyerFilter !== "all") {
      chips.push({ key: "buyer", label: `${t.activity.buyerLabel}: ${buyerFilter}`, clear: () => setBuyerFilter("all") });
    }
    if (supplierFilter !== "all") {
      chips.push({ key: "supplier", label: `${t.activity.supplierLabel}: ${supplierFilter}`, clear: () => setSupplierFilter("all") });
    }
    if (skuFilter.trim()) {
      chips.push({ key: "search", label: `“${skuFilter.trim()}”`, clear: () => setSkuFilter("") });
    }

    const [showingBefore, showingAfter] = t.activity.showingOf
      .replace("{total}", String(totalEntries))
      .split("{n}");

    const statPill = (n: number, label: string, numClass: string, pillClass?: string) => (
      <span
        className={cn(
          "flex min-w-0 items-baseline gap-1.5 whitespace-nowrap rounded-full bg-ek-muted px-3 py-1.5 text-sm font-medium leading-tight text-ek-mfg",
          pillClass
        )}
      >
        <b className={cn("font-display text-lg font-semibold leading-tight tabular-nums", numClass)}>{n}</b>
        <span className="truncate">{label}</span>
      </span>
    );

    return (
      <div className="flex h-full min-h-0 flex-col bg-ek-bg text-ek-fg">
        {/* Header bar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-ek-border bg-card px-6 pb-3.5 pt-[18px]">
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em]">
            {t.nav.activities}
          </h1>
          {/* The stats give way (labels truncate) so the toggle and Export stay visible at 1024px. */}
          <div className="ml-2 flex min-w-0 gap-2 overflow-hidden">
            {statPill(stats.orders, t.activity.statOrdersToday, "text-amber-700")}
            {statPill(
              stats.inflows,
              stats.inflows === 1 ? t.activity.statInflow : t.activity.statInflows,
              "text-emerald-700"
            )}
            {pendingCount > 0 && statPill(pendingCount, t.activity.statPending, "text-amber-700", "bg-amber-100")}
          </div>
          <div className="flex-1" />

          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(value) => value && setViewMode(value as typeof viewMode)}
            className={SEG_GROUP}
          >
            {viewTabs.map(({ value, Icon, label }) => (
              <Tooltip key={value}>
                {/* Span wrapper: the trigger's own data-state would otherwise
                    override the item's data-state="on". */}
                <TooltipTrigger asChild>
                  <span className="flex">
                    <ToggleGroupItem value={value} aria-label={label} className={SEG_ITEM}>
                      <Icon className="h-4 w-4" />
                    </ToggleGroupItem>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className={TOOL_BTN}>
                <Download />
                {t.activity.export}
                <ChevronDown className="!size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-[260px] rounded-[14px] border-ek-border p-1.5 shadow-[0_12px_40px_rgba(0,0,0,.16)]"
            >
              <DropdownMenuItem
                className={MENU_ITEM}
                disabled={filteredLogs.length === 0}
                onSelect={exportActivityLog}
              >
                {t.activity.exportActivityLog}
                <span className="text-[13px] font-normal text-ek-mfg">{t.activity.exportActivityLogHint}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className={MENU_ITEM} disabled={!hasOutflows} onSelect={exportSkuBom}>
                {t.activity.exportSkuBom}
                <span className="text-[13px] font-normal text-ek-mfg">{t.activity.exportSkuBomHint}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Tools row */}
        <div className="relative z-10 flex shrink-0 items-center gap-2.5 border-b border-ek-border bg-card px-6 py-3">
          <div className="relative flex min-w-[200px] flex-1 items-center">
            <Search className="pointer-events-none absolute left-3.5 h-[18px] w-[18px] text-ek-mfg" />
            <Input
              value={skuFilter}
              onChange={(e) => setSkuFilter(e.target.value)}
              placeholder={t.activity.searchActivity}
              aria-label={t.activity.searchActivity}
              className="h-11 rounded-[11px] border-0 bg-ek-muted pl-10 pr-3.5 text-[15px] text-ek-fg placeholder:text-ek-mfg md:text-[15px]"
            />
          </div>

          <ToggleGroup
            type="single"
            value={typeFilter}
            onValueChange={(value) => value && setTypeFilter(value as TypeFilter)}
            className={cn(SEG_GROUP, "shrink-0")}
          >
            {typeTabs.map((tab) => (
              <ToggleGroupItem
                key={tab.value}
                value={tab.value}
                className={cn(SEG_ITEM, "text-sm font-semibold", tab.on)}
              >
                {tab.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  TOOL_BTN,
                  "shrink-0",
                  filtersOpen && "border-ek-fg bg-ek-fg text-white hover:bg-ek-fg hover:text-white"
                )}
              >
                <Filter />
                {t.activity.filters}
                {activeFilterCount > 0 && (
                  <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-amber-600 px-1.5 text-xs text-white">
                    {activeFilterCount}
                  </span>
                )}
                <ChevronDown className={cn("!size-4 transition-transform", filtersOpen && "rotate-180")} />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="flex w-[400px] flex-col gap-4 rounded-2xl border-ek-border bg-card px-[18px] pb-3.5 pt-[18px] text-ek-fg shadow-[0_12px_40px_rgba(0,0,0,.16)]"
            >
              {/* Date */}
              <div className="flex flex-col gap-2">
                <span className={SECTION_LABEL}>{t.activity.dateLabel}</span>
                <div className="flex flex-wrap gap-2">
                  {(["today", "last7", "last30", "allTime"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={datePreset === p}
                      onClick={() => setDateRange(p === "allTime" ? undefined : presetRange(p))}
                      className={cn(PRESET_CHIP, datePreset === p && PRESET_CHIP_ON)}
                    >
                      {presetLabel[p]}
                    </button>
                  ))}
                  <Popover open={customDateOpen} onOpenChange={setCustomDateOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-pressed={datePreset === "custom"}
                        className={cn(PRESET_CHIP, datePreset === "custom" && PRESET_CHIP_ON)}
                      >
                        {t.activity.custom}
                      </button>
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
              </div>

              {/* Buyer */}
              <div className="flex flex-col gap-2">
                <span className={SECTION_LABEL}>{t.activity.buyerLabel}</span>
                <Select value={buyerFilter} onValueChange={setBuyerFilter}>
                  <SelectTrigger
                    aria-label={t.activity.buyerLabel}
                    className={cn(
                      SELECT_TRIGGER,
                      buyerFilter === "all" ? "font-normal text-ek-mfg" : "font-semibold text-ek-fg"
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.activity.allBuyers}</SelectItem>
                    {buyersInLogs.map((buyer) => (
                      <SelectItem key={buyer} value={buyer}>
                        {buyer}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Supplier */}
              <div className="flex flex-col gap-2">
                <span className={SECTION_LABEL}>{t.activity.supplierLabel}</span>
                <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                  <SelectTrigger
                    aria-label={t.activity.supplierLabel}
                    className={cn(
                      SELECT_TRIGGER,
                      supplierFilter === "all" ? "font-normal text-ek-mfg" : "font-semibold text-ek-fg"
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.activity.allSuppliers}</SelectItem>
                    {suppliersInLogs.map((supplier) => (
                      <SelectItem key={supplier} value={supplier}>
                        {supplier}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Footer: Reset clears the popover filters only; filters apply live. */}
              <div className="flex items-center gap-2.5 border-t border-ek-border pt-3.5">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDateRange(undefined);
                    setBuyerFilter("all");
                    setSupplierFilter("all");
                  }}
                  className="h-11 rounded-[10px] px-2.5 text-[14.5px] font-semibold text-ek-mfg hover:bg-ek-muted hover:text-ek-fg"
                >
                  {t.activity.reset}
                </Button>
                <div className="flex-1" />
                <Button
                  onClick={() => setFiltersOpen(false)}
                  className="h-11 rounded-[11px] bg-ek-fg px-[18px] text-[15px] font-semibold text-white hover:bg-ek-fg/90"
                >
                  {t.activity.showEntries.replace("{n}", String(shownEntries))}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Active-filter strip */}
        {hasActiveFilters && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ek-border bg-ek-strip px-6 py-2 text-sm text-ek-mfg">
            <span>
              {showingBefore}
              <b className="text-ek-fg">{shownEntries}</b>
              {showingAfter}
            </span>
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ek-border bg-card pl-3 pr-1.5 text-[13.5px] font-semibold text-ek-fg"
              >
                {chip.label}
                <button
                  type="button"
                  aria-label={t.activity.removeFilter}
                  onClick={chip.clear}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-ek-mfg hover:bg-ek-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[14.5px] font-semibold text-ek-mfg hover:bg-ek-muted hover:text-ek-fg"
            >
              <X className="h-3.5 w-3.5" />
              {t.activity.clearFilters}
            </button>
          </div>
        )}

        <ActivitySplitView
          logs={filteredLogs}
          loading={loading}
          viewMode={viewMode}
          hasActiveFilters={!!hasActiveFilters}
          onClearFilters={clearFilters}
          onVoided={onVoided}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-4 border-b">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Clock className="h-5 w-5" />
            {t.activity.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {/* Timeline-shaped skeleton so the feed doesn't flash blank then pop */}
          <GroupedActivityLog logs={[]} loading viewMode={viewMode} />
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
        <CardHeader className="pb-4 border-b px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Clock className="h-5 w-5" />
              {t.activity.title}
            </CardTitle>

            <div className="flex items-center gap-2">
              {/* Export Button */}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={exportActivityLog}
                disabled={filteredLogs.length === 0}
              >
                <Download className="h-4 w-4" />
                Export
              </Button>

              {/* Per-SKU BOM export (outflows) */}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={exportSkuBom}
                disabled={!hasOutflows}
              >
                <Download className="h-4 w-4" />
                Export SKU BOM
              </Button>

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
                className="text-xs px-2.5 sm:px-3 py-1.5 rounded-md data-[state=on]:bg-background data-[state=on]:shadow-sm"
              >
                <Layers className="h-3.5 w-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">{t.activity.groupedView}</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="chronological"
                aria-label="Chronological view"
                className="text-xs px-2.5 sm:px-3 py-1.5 rounded-md data-[state=on]:bg-background data-[state=on]:shadow-sm"
              >
                <LayoutList className="h-3.5 w-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">{t.activity.chronologicalView}</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          </div>
        </CardHeader>

        {/* Filter Section */}
        <div className="px-4 sm:px-6 py-4 bg-muted/20 border-b">
          {/* Primary Row: Action Type + Filter Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup
              type="single"
              value={typeFilter}
              onValueChange={(value) => value && setTypeFilter(value as TypeFilter)}
              className="bg-background border rounded-lg p-1 w-full sm:w-auto"
            >
              <ToggleGroupItem
                value="all"
                size="sm"
                className="flex-1 sm:flex-none text-xs sm:text-sm px-2 sm:px-4 py-1.5 rounded-md data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {t.activity.all}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="quick"
                size="sm"
                className="flex-1 sm:flex-none text-xs sm:text-sm px-2 sm:px-4 py-1.5 rounded-md data-[state=on]:bg-orange-600 data-[state=on]:text-white"
              >
                {t.activity.orders}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="manual"
                size="sm"
                className="flex-1 sm:flex-none text-xs sm:text-sm px-2 sm:px-4 py-1.5 rounded-md data-[state=on]:bg-orange-600 data-[state=on]:text-white"
              >
                {t.activity.kastun}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="inflow"
                size="sm"
                className="flex-1 sm:flex-none text-xs sm:text-sm px-2 sm:px-4 py-1.5 rounded-md data-[state=on]:bg-green-600 data-[state=on]:text-white"
              >
                {t.activity.inflows}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="voided"
                size="sm"
                className="flex-1 sm:flex-none text-xs sm:text-sm px-2 sm:px-4 py-1.5 rounded-md data-[state=on]:bg-red-600 data-[state=on]:text-white"
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
                {mobileFilterCount > 0 && (
                  <Badge 
                    variant="secondary" 
                    className={cn(
                      "h-5 min-w-5 px-1.5 text-xs",
                      filtersOpen && "bg-primary-foreground/20 text-primary-foreground"
                    )}
                  >
                    {mobileFilterCount}
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
        <CardContent className="px-4 sm:px-6 pt-4">
          {filteredLogs.length === 0 ? (
            // Designed empty state (icon + headline + hint), filter-aware.
            <GroupedActivityLog
              logs={[]}
              hasActiveFilters={!!hasActiveFilters}
              showVoided={typeFilter === "voided"}
              viewMode={viewMode}
            />
          ) : (
            <ScrollArea className="h-auto sm:h-[calc(100vh-420px)] min-h-0 sm:min-h-[300px] max-h-none sm:max-h-[600px] pr-2 sm:pr-4">
              <GroupedActivityLog logs={filteredLogs} showVoided={typeFilter === "voided"} viewMode={viewMode} onVoided={onVoided} />
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
