import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  StockSummary, InventoryCategory, InflowEntry, OutflowEntry, CATEGORY_LABELS,
} from "@/types/inventory";
import {
  averageDailyOutflow, daysOfCover, butirEquivalent, EGG_FRESHNESS_DAYS,
} from "@/lib/inventory";
import {
  AlertTriangle, Clock, Filter, ChevronDown, ChevronRight, ChevronsUpDown,
  FileText, CheckCircle2, TrendingDown, TrendingUp, Minus, Truck,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useLanguage } from "@/contexts/LanguageContext";

interface InventoryDashboardProps {
  stockSummary: StockSummary[];
  inflows: InflowEntry[];
  outflows: OutflowEntry[];
  freshnessDaysByProduct: Record<string, number>;
  loading?: boolean;
}

// Reorder thresholds (days of cover). Cover = native stock / avg daily outflow.
const VELOCITY_WINDOW = 14; // days of history used to estimate daily velocity
const REORDER_DAYS = 4;     // below this a product enters the reorder watchlist
const CRITICAL_DAYS = 2;    // below this it's critical (binding dispatch constraint)
const EXPIRING_WINDOW = 2;  // eggs within N days of their freshness limit are "push out first"

type Severity = "crit" | "low";
interface ActionItem {
  product: string;
  category: InventoryCategory;
  kind: "expiring" | "reorder";
  severity: Severity;
  cover: number | null;
  avgDaily: number;
  stock: number;
  minDaysUntil: number; // expiring only (freshness − daysInWarehouse)
  expiringQty: number;  // native units, expiring only
}

export function InventoryDashboard({
  stockSummary,
  inflows,
  outflows,
  freshnessDaysByProduct,
  loading = false,
}: InventoryDashboardProps) {
  const { t } = useLanguage();
  const { itemTypes, conversionMap } = useItemTypes();

  const [selectedCategory, setSelectedCategory] = useState<InventoryCategory | "all">("all");
  const [sortBy, setSortBy] = useState<"stock" | "name" | "days">("stock");
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [inventoryOpen, setInventoryOpen] = useState(false);

  // Stable "now" for this render pass so velocity/expiry math is consistent.
  const now = useMemo(() => new Date(), []);

  // ---- kg-native display helpers (load-bearing — see CLAUDE.md) ----------
  const isKgProduct = (product: string) => {
    const config = conversionMap[product];
    return config?.unit === "kg" && config.eggs_per_unit > 0;
  };
  const butirEstimate = (product: string, kg: number) =>
    Math.round(kg * conversionMap[product].eggs_per_unit);
  const formatStock = (product: string, category: InventoryCategory, quantity: number) => {
    if (category === "egg" && isKgProduct(product)) {
      return `${quantity.toLocaleString()} kg (≈ ${butirEstimate(product, quantity).toLocaleString()} butir)`;
    }
    return `${quantity.toLocaleString()} ${category === "egg" ? "butir" : "pcs"}`;
  };
  const toButirEquivalent = (product: string, category: InventoryCategory, quantity: number) =>
    category === "egg" && isKgProduct(product) ? butirEstimate(product, quantity) : quantity;

  const freshnessOf = (product: string) =>
    freshnessDaysByProduct[product] ?? EGG_FRESHNESS_DAYS;

  // Merge stock with catalog so zero-stock items (and their low-stock thresholds) appear.
  const mergedSummary = useMemo(() => {
    const stockMap = new Map<string, StockSummary>();
    stockSummary.forEach((item) => stockMap.set(`${item.category}-${item.product}`, item));
    itemTypes.forEach((itemType) => {
      const key = `${itemType.category}-${itemType.name}`;
      if (!stockMap.has(key)) {
        stockMap.set(key, {
          product: itemType.name, totalStock: 0, oldestDate: null,
          maxDaysInWarehouse: 0, isAtRisk: false, category: itemType.category,
          atRiskQuantity: 0, safeQuantity: 0, batches: [],
        });
      }
    });
    return Array.from(stockMap.values());
  }, [stockSummary, itemTypes]);

  const thresholdOf = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of itemTypes) {
      if (it.lowStockThreshold != null && it.lowStockThreshold > 0) {
        map[`${it.category}-${it.name}`] = it.lowStockThreshold;
      }
    }
    return map;
  }, [itemTypes]);

  // ---- Derived analytics: cover, expiring, action lists ------------------
  const { eggActions, supplyActions, binding, lowestCover, eggTypesOk } = useMemo(() => {
    const eggs: ActionItem[] = [];
    const supplies: ActionItem[] = [];
    let bindingItem: { product: string; category: InventoryCategory; cover: number } | null = null;
    let minCover = Infinity;
    let okEggTypes = 0;

    for (const s of mergedSummary) {
      const avgDaily = averageDailyOutflow(outflows, s.product, VELOCITY_WINDOW, now);
      const cover = daysOfCover(s.totalStock, avgDaily);
      const threshold = thresholdOf[`${s.category}-${s.product}`];

      if (s.category === "egg" && s.totalStock > 0) okEggTypes += 1;

      if (cover != null && cover < minCover) {
        minCover = cover;
        bindingItem = { product: s.product, category: s.category, cover };
      }

      // Expiring analysis (eggs only)
      let minDaysUntil = Infinity;
      let expiringQty = 0;
      if (s.category === "egg") {
        for (const b of s.batches) {
          const daysUntil = freshnessOf(s.product) - b.daysInWarehouse;
          if (daysUntil <= EXPIRING_WINDOW && b.quantity > 0) {
            expiringQty += b.quantity;
            if (daysUntil < minDaysUntil) minDaysUntil = daysUntil;
          }
        }
      }
      const hasExpiring = expiringQty > 0;
      const lowCover = cover != null && cover < REORDER_DAYS;
      const belowThreshold = threshold != null && s.totalStock < threshold;
      if (!hasExpiring && !lowCover && !belowThreshold) continue; // healthy

      let item: ActionItem;
      if (hasExpiring) {
        item = {
          product: s.product, category: s.category, kind: "expiring",
          severity: minDaysUntil <= 1 ? "crit" : "low",
          cover, avgDaily, stock: s.totalStock, minDaysUntil, expiringQty,
        };
      } else {
        const crit = (cover != null && cover < CRITICAL_DAYS) || s.totalStock <= 0;
        item = {
          product: s.product, category: s.category, kind: "reorder",
          severity: crit ? "crit" : "low",
          cover, avgDaily, stock: s.totalStock, minDaysUntil: Infinity, expiringQty: 0,
        };
      }
      (s.category === "egg" ? eggs : supplies).push(item);
    }

    const rank = (a: ActionItem) => {
      const sev = a.severity === "crit" ? 0 : 1;
      const secondary = a.kind === "expiring" ? a.minDaysUntil : (a.cover ?? Infinity);
      return sev * 1000 + secondary;
    };
    eggs.sort((a, b) => rank(a) - rank(b));
    supplies.sort((a, b) => rank(a) - rank(b));

    return {
      eggActions: eggs,
      supplyActions: supplies,
      binding: bindingItem,
      lowestCover: minCover === Infinity ? null : minCover,
      eggTypesOk: okEggTypes,
    };
  }, [mergedSummary, outflows, thresholdOf, freshnessDaysByProduct, now]);

  const urgentCount = eggActions.length + supplyActions.length;
  const hasUrgent = urgentCount > 0;
  const anyExpiring = eggActions.some((a) => a.kind === "expiring");

  // ---- Headline (readiness hero) ----------------------------------------
  const headline = useMemo(() => {
    if (!hasUrgent) return { tone: "clear" as const };
    const label = (p: string, c: InventoryCategory) =>
      c === "egg" ? p : `${p} (${CATEGORY_LABELS[c]})`;
    if (binding && binding.cover < CRITICAL_DAYS) {
      return {
        tone: "blocked" as const, icon: Truck,
        title: `${t.dashboard.dispatchLimitedBy} ${label(binding.product, binding.category)}`,
        sub: `${binding.cover.toFixed(1)} ${t.dashboard.daysCover} · ${t.dashboard.othersSufficient}`,
      };
    }
    if (anyExpiring) {
      return {
        tone: "blocked" as const, icon: AlertTriangle,
        title: t.dashboard.pushOutTitle, sub: t.dashboard.pushOutSub,
      };
    }
    if (binding) {
      return {
        tone: "blocked" as const, icon: Truck,
        title: `${t.dashboard.reorderSoonTitle}: ${label(binding.product, binding.category)}`,
        sub: `${binding.cover.toFixed(1)} ${t.dashboard.daysCover} · ${t.dashboard.othersSufficient}`,
      };
    }
    return {
      tone: "blocked" as const, icon: AlertTriangle,
      title: t.dashboard.reorderSoonTitle, sub: t.dashboard.pushOutSub,
    };
  }, [hasUrgent, binding, anyExpiring, t]);

  // ---- 7-day egg net-flow trajectory ------------------------------------
  const trajectory = useMemo(() => {
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayKeys.push(d.toISOString().split("T")[0]);
    }
    const equiv = (product: string, qty: number) =>
      butirEquivalent(product, qty, conversionMap);

    const dailyNet: number[] = dayKeys.map((key) => {
      const inflow = inflows
        .filter((i) => i.category === "egg" && !i.voidedAt && i.date === key)
        .reduce((sum, i) => sum + equiv(i.product, i.quantityInButir), 0);
      const outflow = outflows
        .filter((o) => o.category === "egg" && !o.voidedAt && o.date === key)
        .reduce((sum, o) => sum + equiv(o.product, o.quantityInButir), 0);
      return inflow - outflow;
    });
    const weeklyOut = outflows
      .filter((o) => o.category === "egg" && !o.voidedAt && dayKeys.includes(o.date))
      .reduce((sum, o) => sum + equiv(o.product, o.quantityInButir), 0);

    let running = 0;
    const cumulative = dailyNet.map((n) => (running += n));
    const net = cumulative[cumulative.length - 1] ?? 0;
    const band = Math.max(50, weeklyOut * 0.1);
    const tone: "down" | "up" | "flat" = net < -band ? "down" : net > band ? "up" : "flat";
    return { cumulative, net, tone };
  }, [inflows, outflows, conversionMap, now]);

  const sparkPoints = (vals: number[], w = 380, h = 40, pad = 4) => {
    if (vals.length === 0) return "";
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    return vals
      .map((v, i) => {
        const x = (i / (vals.length - 1 || 1)) * w;
        const y = h - pad - ((v - min) / range) * (h - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  // ---- Full inventory table (relocated into a collapsible) ---------------
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

  const toggleExpanded = (product: string) => {
    const next = new Set(expandedProducts);
    next.has(product) ? next.delete(product) : next.add(product);
    setExpandedProducts(next);
  };

  // ---- Presentational helpers -------------------------------------------
  const sevText = (sev: Severity) =>
    sev === "crit" ? "text-destructive" : "text-amber-600 dark:text-amber-400";
  const sevStripe = (sev: Severity) => (sev === "crit" ? "bg-destructive" : "bg-amber-500");
  const pillClass = (sev: Severity) =>
    sev === "crit"
      ? "bg-destructive/10 text-destructive"
      : "bg-amber-500/15 text-amber-700 dark:text-amber-400";

  const coverText = (c: number | null) => {
    if (c == null) return "—";
    const n = c < 10 ? c.toFixed(1) : Math.round(c).toString();
    return `${n}${c === 1 ? "d" : "d"}`;
  };
  const expiringText = (a: ActionItem) => {
    if (a.minDaysUntil <= 0) return t.dashboard.overdue;
    if (a.minDaysUntil === 1) return `1 ${t.dashboard.dayLeft}`;
    return `${a.minDaysUntil} ${t.dashboard.daysLeft}`;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full rounded-lg" />
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  const ActionRow = ({ a }: { a: ActionItem }) => (
    <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b last:border-b-0">
      <div className={`w-1 self-stretch rounded-full shrink-0 ${sevStripe(a.severity)}`} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">
          {a.category === "egg" ? a.product : `${a.product} · ${CATEGORY_LABELS[a.category]}`}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {a.kind === "expiring"
            ? formatStock(a.product, "egg", a.expiringQty)
            : `${formatStock(a.product, a.category, a.stock)} ${t.dashboard.onHand} · ${t.dashboard.avg} ${Math.round(a.avgDaily).toLocaleString()}${t.dashboard.perDayOut}`}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-display font-bold text-sm ${sevText(a.severity)}`}>
          {a.kind === "expiring" ? expiringText(a) : coverText(a.cover)}
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold mt-0.5 ${pillClass(a.severity)}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {a.kind === "expiring"
            ? t.dashboard.expiring
            : a.severity === "crit" ? t.dashboard.reorderNow : t.dashboard.reorder}
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Attention summary line */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {urgentCount === 0
            ? t.dashboard.nothingToday
            : urgentCount === 1
              ? t.dashboard.oneThingToday
              : `${urgentCount} ${t.dashboard.manyThingsToday}`}
        </p>
        <span className="text-xs text-muted-foreground shrink-0">{format(now, "EEE, d MMM")}</span>
      </div>

      {/* Readiness hero */}
      {headline.tone === "clear" ? (
        <div className="rounded-xl border border-success/35 bg-gradient-to-br from-success/[0.14] to-success/[0.04] px-4 py-5 text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-success/[0.18] text-success">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <p className="font-display font-semibold text-lg">{t.dashboard.allClearTitle}</p>
          <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">{t.dashboard.allClearSub}</p>
        </div>
      ) : (
        <div className="flex items-center gap-3.5 rounded-xl border border-warning/40 bg-gradient-to-br from-warning/[0.14] to-primary/[0.06] px-4 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning/[0.22] text-amber-700 dark:text-amber-300 shrink-0">
            <headline.icon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-semibold text-[15px] leading-tight">{headline.title}</div>
            <div className="text-xs text-amber-700 dark:text-amber-300/90 mt-0.5">{headline.sub}</div>
          </div>
        </div>
      )}

      {/* All-clear summary stats */}
      {!hasUrgent && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Card className="shadow-soft"><CardContent className="p-3 text-center">
            <p className="font-display font-bold text-lg sm:text-xl">{eggTypesOk}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">{t.dashboard.eggTypesOk}</p>
          </CardContent></Card>
          <Card className="shadow-soft"><CardContent className="p-3 text-center">
            <p className="font-display font-bold text-lg sm:text-xl">{coverText(lowestCover)}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">{t.dashboard.lowestCover}</p>
          </CardContent></Card>
          <Card className="shadow-soft"><CardContent className="p-3 text-center">
            <p className="font-display font-bold text-lg sm:text-xl">0</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">{t.dashboard.expiringShort}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Action groups */}
      {eggActions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 px-0.5">
            <h3 className="font-display font-semibold text-sm">{t.dashboard.eggs} · {t.dashboard.needAttention}</h3>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">{eggActions.length}</span>
          </div>
          <Card className="shadow-soft overflow-hidden">
            {eggActions.map((a) => <ActionRow key={`egg-${a.product}`} a={a} />)}
          </Card>
        </div>
      )}
      {supplyActions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 px-0.5">
            <h3 className="font-display font-semibold text-sm">{t.dashboard.supplies} · {t.dashboard.needAttention}</h3>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">{supplyActions.length}</span>
          </div>
          <Card className="shadow-soft overflow-hidden">
            {supplyActions.map((a) => <ActionRow key={`sup-${a.category}-${a.product}`} a={a} />)}
          </Card>
        </div>
      )}

      {/* 7-day trajectory */}
      <Card className="shadow-soft">
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t.dashboard.trajectoryTitle}
            </span>
            <span className={`font-display font-bold text-lg flex items-center gap-1 ${
              trajectory.tone === "down" ? "text-destructive"
              : trajectory.tone === "up" ? "text-amber-600 dark:text-amber-400"
              : "text-success"}`}>
              {trajectory.tone === "down" ? <TrendingDown className="h-4 w-4" />
                : trajectory.tone === "up" ? <TrendingUp className="h-4 w-4" />
                : <Minus className="h-4 w-4" />}
              {trajectory.net > 0 ? "+" : ""}{Math.round(trajectory.net).toLocaleString()}
            </span>
          </div>
          <svg width="100%" height="40" viewBox="0 0 380 40" preserveAspectRatio="none" className="overflow-visible">
            <polyline
              fill="none"
              strokeWidth="2"
              stroke={trajectory.tone === "down" ? "hsl(var(--destructive))"
                : trajectory.tone === "up" ? "hsl(38 92% 50%)" : "hsl(var(--success))"}
              points={sparkPoints(trajectory.cumulative)}
            />
          </svg>
          <p className="text-[11px] text-muted-foreground mt-1">
            {trajectory.tone === "down" ? t.dashboard.depleting
              : trajectory.tone === "up" ? t.dashboard.accumulating
              : t.dashboard.balanced}
          </p>
        </CardContent>
      </Card>

      {/* Collapsed full inventory (the previous dashboard table) */}
      <Collapsible open={inventoryOpen} onOpenChange={setInventoryOpen}>
        <Card className="shadow-soft">
          <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3.5 text-left">
            <span className="font-display font-semibold text-sm">
              {t.dashboard.allInventory}
              <span className="text-muted-foreground font-normal ml-1.5">· {mergedSummary.length}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardHeader className="pt-0 pb-3 px-3 sm:px-6">
              <div className="flex items-center justify-end gap-2">
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
                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && hasBatches && toggleExpanded(item.product)}
                            tabIndex={hasBatches ? 0 : undefined}
                            role={hasBatches ? "button" : undefined}
                            aria-expanded={hasBatches ? isExpanded : undefined}
                            className={`border-b transition-colors hover:bg-muted/50 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                              item.isAtRisk && item.totalStock > 0 ? "bg-destructive/5 border-l-2 border-l-destructive" : ""
                            } ${hasBatches ? "cursor-pointer" : ""}`}
                          >
                            <td className="py-2 sm:py-3 px-1 sm:px-2">
                              {hasBatches && (isExpanded
                                ? <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
                                : <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />)}
                            </td>
                            <td className="py-2 sm:py-3 px-1 sm:px-2">
                              <span className="font-medium text-xs sm:text-sm line-clamp-2">{item.product}</span>
                            </td>
                            <td className="py-2 sm:py-3 px-1 sm:px-2 hidden xs:table-cell">
                              <Badge variant="outline" className="text-[10px] sm:text-xs">{CATEGORY_LABELS[item.category]}</Badge>
                            </td>
                            <td className="py-2 sm:py-3 px-1 sm:px-2 text-right tabular-nums">
                              {item.category === "egg" && isKgProduct(item.product) ? (
                                <div className="flex flex-col items-end">
                                  <span className={`text-xs sm:text-sm ${item.totalStock === 0 ? "text-muted-foreground" : "font-semibold"}`}>
                                    {item.totalStock.toLocaleString()} kg
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    (≈ {butirEstimate(item.product, item.totalStock).toLocaleString()} butir)
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <span className={`text-xs sm:text-sm ${item.totalStock === 0 ? "text-muted-foreground" : "font-semibold"}`}>
                                    {item.totalStock.toLocaleString()}
                                  </span>
                                  <span className="text-[10px] sm:text-xs text-muted-foreground ml-0.5 sm:ml-1">
                                    {item.category === "egg" ? "butir" : "pcs"}
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="py-2 sm:py-3 px-1 sm:px-2 text-right tabular-nums hidden md:table-cell">
                              {item.category === "egg" && item.atRiskQuantity > 0 ? (
                                isKgProduct(item.product) ? (
                                  <div className="flex flex-col items-end">
                                    <span className="text-destructive font-medium text-sm">{item.atRiskQuantity.toLocaleString()} kg</span>
                                    <span className="text-[10px] text-muted-foreground">(≈ {butirEstimate(item.product, item.atRiskQuantity).toLocaleString()} butir)</span>
                                  </div>
                                ) : (
                                  <span className="text-destructive font-medium text-sm">{item.atRiskQuantity.toLocaleString()}</span>
                                )
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2 sm:py-3 px-1 sm:px-2 text-right hidden md:table-cell">
                              {item.totalStock > 0 ? (
                                <span className="flex items-center justify-end gap-1">
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span className={`text-sm ${item.isAtRisk ? "text-destructive font-medium" : ""}`}>{item.maxDaysInWarehouse}</span>
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
                                  <AlertTriangle className="h-2.5 w-2.5 sm:h-3 sm:w-3" />Risk
                                </Badge>
                              ) : (
                                <Badge className="text-[10px] sm:text-xs bg-success hover:bg-success/90 px-1.5 sm:px-2.5">OK</Badge>
                              )}
                            </td>
                          </tr>
                          {isExpanded && item.batches.map((batch) => (
                            <tr key={batch.id} className={`border-b text-xs sm:text-sm ${batch.isAtRisk ? "bg-destructive/10" : "bg-muted/30"}`}>
                              <td className="py-1.5 sm:py-2 px-1 sm:px-2"></td>
                              <td className="py-1.5 sm:py-2 px-1 sm:px-2 pl-4 sm:pl-6" colSpan={2}>
                                <div className="flex flex-col xs:flex-row xs:items-center gap-0.5 xs:gap-2">
                                  <span className="text-muted-foreground text-xs">{format(parseISO(batch.date), "dd/MM/yy")}</span>
                                  {batch.invoiceSupplier && (
                                    <span className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground truncate max-w-[100px] sm:max-w-none">
                                      <FileText className="h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0" />{batch.invoiceSupplier}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right tabular-nums">
                                {item.category === "egg" && isKgProduct(item.product) ? (
                                  <div className="flex flex-col items-end">
                                    <span className="font-medium text-xs sm:text-sm">{batch.quantity.toLocaleString()} kg</span>
                                    <span className="text-[10px] text-muted-foreground">(≈ {butirEstimate(item.product, batch.quantity).toLocaleString()} butir)</span>
                                  </div>
                                ) : (
                                  <>
                                    <span className="font-medium text-xs sm:text-sm">{batch.quantity.toLocaleString()}</span>
                                    <span className="text-[10px] sm:text-xs text-muted-foreground ml-0.5 sm:ml-1">{item.category === "egg" ? "butir" : "pcs"}</span>
                                  </>
                                )}
                              </td>
                              <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right hidden md:table-cell">
                                <span className={`text-xs ${batch.isAtRisk ? "text-destructive font-medium" : "text-muted-foreground"}`}>{batch.daysInWarehouse} days</span>
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
                      <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No items found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <p className="text-center text-[11px] text-muted-foreground">{t.dashboard.fullStockOneTap}</p>
    </div>
  );
}
