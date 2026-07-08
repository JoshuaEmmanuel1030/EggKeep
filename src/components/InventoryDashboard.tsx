import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  FileText, CheckCircle2, TrendingDown, TrendingUp, Minus, Truck, SlidersHorizontal,
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

// The egg types the user tracks most closely. Persisted per device; editable in-UI.
const FOCUS_KEY = "eggkeep_focus_eggs";
const DEFAULT_FOCUS = [
  "NEGERI BIASA", "NEGERI OMEGA", "KAMPUNG BIASA", "KAMPUNG MERAH", "ASIN MATENG",
];

type Severity = "crit" | "low";
interface ActionItem {
  product: string;
  category: InventoryCategory;
  kind: "expiring" | "reorder";
  severity: Severity;
  cover: number | null;
  avgDaily: number;
  stock: number;
  minDaysUntil: number;
  expiringQty: number;
}
interface EggMetric {
  stock: number;
  cover: number | null;
  avgDaily: number;
  expiringQty: number;
  minDaysUntil: number;
  atRiskQty: number;
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
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusedEggs, setFocusedEggs] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(FOCUS_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore malformed */ }
    return DEFAULT_FOCUS;
  });
  useEffect(() => {
    localStorage.setItem(FOCUS_KEY, JSON.stringify(focusedEggs));
  }, [focusedEggs]);

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
  const freshnessOf = (product: string) =>
    freshnessDaysByProduct[product] ?? EGG_FRESHNESS_DAYS;

  // Merge stock with catalog so zero-stock items (and low-stock thresholds) appear.
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

  const allEggProducts = useMemo(
    () => mergedSummary.filter((s) => s.category === "egg").map((s) => s.product).sort(),
    [mergedSummary]
  );

  const thresholdOf = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of itemTypes) {
      if (it.lowStockThreshold != null && it.lowStockThreshold > 0) {
        map[`${it.category}-${it.name}`] = it.lowStockThreshold;
      }
    }
    return map;
  }, [itemTypes]);

  // ---- Derived analytics: cover, expiring, action lists, per-egg metrics --
  const { eggActions, supplyActions, binding, eggMetrics } = useMemo(() => {
    const eggs: ActionItem[] = [];
    const supplies: ActionItem[] = [];
    const metrics = new Map<string, EggMetric>();
    let bindingItem: { product: string; category: InventoryCategory; cover: number } | null = null;
    let minCover = Infinity;

    for (const s of mergedSummary) {
      const avgDaily = averageDailyOutflow(outflows, s.product, VELOCITY_WINDOW, now);
      const cover = daysOfCover(s.totalStock, avgDaily);
      const threshold = thresholdOf[`${s.category}-${s.product}`];

      if (cover != null && cover < minCover) {
        minCover = cover;
        bindingItem = { product: s.product, category: s.category, cover };
      }

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
        metrics.set(s.product, {
          stock: s.totalStock, cover, avgDaily, expiringQty, minDaysUntil,
          atRiskQty: s.atRiskQuantity,
        });
      }

      const hasExpiring = expiringQty > 0;
      const lowCover = cover != null && cover < REORDER_DAYS;
      const belowThreshold = threshold != null && s.totalStock < threshold;
      if (!hasExpiring && !lowCover && !belowThreshold) continue;

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
      eggActions: eggs, supplyActions: supplies, binding: bindingItem, eggMetrics: metrics,
    };
  }, [mergedSummary, outflows, thresholdOf, freshnessDaysByProduct, now]);

  // Focus set restricted to egg types that actually exist, in the user's order.
  const focusList = useMemo(
    () => focusedEggs.filter((p) => eggMetrics.has(p)),
    [focusedEggs, eggMetrics]
  );
  const focusSet = useMemo(() => new Set(focusList), [focusList]);

  // Non-focused egg concerns (focused eggs already surface status in their cards).
  const otherEggActions = useMemo(
    () => eggActions.filter((a) => !focusSet.has(a.product)),
    [eggActions, focusSet]
  );

  const urgentCount = eggActions.length + supplyActions.length;
  const hasUrgent = urgentCount > 0;
  const anyExpiring = eggActions.some((a) => a.kind === "expiring");

  // Per-focused-egg 7-day STOCK LEVEL line + explicit in/out totals, in the
  // product's native unit. The level is reconstructed backward from the current
  // remaining stock (level today = current stock; each earlier day removes that
  // day's net) so the line reflects actual on-hand over time — a sale dips it, a
  // restock raises it. A net-flow line hid sales whenever a bigger inflow landed
  // the same day; explicit in/out figures make a sale legible regardless of scale.
  const focusFlows = useMemo(() => {
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayKeys.push(d.toISOString().split("T")[0]);
    }
    const result: Record<string, { level: number[]; inTotal: number; outTotal: number }> = {};
    for (const p of focusList) {
      const current = eggMetrics.get(p)?.stock ?? 0;
      const dailyIn = dayKeys.map((key) =>
        inflows
          .filter((i) => i.category === "egg" && !i.voidedAt && i.product === p && i.date === key)
          .reduce((sum, i) => sum + i.quantityInButir, 0)
      );
      const dailyOut = dayKeys.map((key) =>
        outflows
          .filter((o) => o.category === "egg" && !o.voidedAt && o.product === p && o.date === key)
          .reduce((sum, o) => sum + o.quantityInButir, 0)
      );
      const net = dailyIn.map((v, i) => v - dailyOut[i]);
      const level = new Array<number>(dayKeys.length);
      level[level.length - 1] = current;
      for (let i = level.length - 1; i > 0; i--) {
        level[i - 1] = Math.round((level[i] - net[i]) * 100) / 100;
      }
      result[p] = {
        level,
        inTotal: dailyIn.reduce((a, b) => a + b, 0),
        outTotal: dailyOut.reduce((a, b) => a + b, 0),
      };
    }
    return result;
  }, [focusList, inflows, outflows, eggMetrics, now]);

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

  // ---- Global 7-day egg net-flow trajectory -----------------------------
  const trajectory = useMemo(() => {
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayKeys.push(d.toISOString().split("T")[0]);
    }
    const equiv = (product: string, qty: number) => butirEquivalent(product, qty, conversionMap);
    const dailyNet = dayKeys.map((key) => {
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
  const toggleFocus = (product: string) => {
    setFocusedEggs((prev) =>
      prev.includes(product) ? prev.filter((p) => p !== product) : [...prev, product]
    );
  };

  // ---- Presentational helpers -------------------------------------------
  const sevText = (sev: Severity) =>
    sev === "crit" ? "text-destructive" : "text-amber-600 dark:text-amber-400";
  const sevStripe = (sev: Severity) => (sev === "crit" ? "bg-destructive" : "bg-amber-500");
  const pillClass = (sev: Severity) =>
    sev === "crit"
      ? "bg-destructive/10 text-destructive"
      : "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  const coverText = (c: number | null) =>
    c == null ? "—" : `${c < 10 ? c.toFixed(1) : Math.round(c)}d`;
  const expiringText = (minDaysUntil: number) => {
    if (minDaysUntil <= 0) return t.dashboard.overdue;
    if (minDaysUntil === 1) return `1 ${t.dashboard.dayLeft}`;
    return `${minDaysUntil} ${t.dashboard.daysLeft}`;
  };

  type CardStatus = "crit" | "low" | "ok";
  const eggCardStatus = (m: EggMetric): CardStatus => {
    const critExp = m.expiringQty > 0 && m.minDaysUntil <= 1;
    const critCover = m.cover != null && m.cover < CRITICAL_DAYS;
    if (critExp || critCover || m.atRiskQty > 0) return "crit";
    const lowExp = m.expiringQty > 0;
    const lowCover = m.cover != null && m.cover < REORDER_DAYS;
    if (lowExp || lowCover) return "low";
    return "ok";
  };
  const statusBorder = (s: CardStatus) =>
    s === "crit" ? "border-destructive/50" : s === "low" ? "border-amber-400/70" : "border-border";
  const statusDot = (s: CardStatus) =>
    s === "crit" ? "bg-destructive" : s === "low" ? "bg-amber-500" : "bg-success";
  const coverColor = (c: number | null) =>
    c == null ? "text-muted-foreground"
      : c < CRITICAL_DAYS ? "text-destructive"
      : c < REORDER_DAYS ? "text-amber-600 dark:text-amber-400"
      : "text-foreground";

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-16 w-full rounded-lg" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
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
          {a.kind === "expiring" ? expiringText(a.minDaysUntil) : coverText(a.cover)}
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

  const EggCard = ({ product }: { product: string }) => {
    const m = eggMetrics.get(product)!;
    const status = eggCardStatus(m);
    const kg = isKgProduct(product);
    const flow = focusFlows[product] ?? { level: [], inTotal: 0, outTotal: 0 };
    const level = flow.level;
    // Trend of on-hand stock across the window (down = net depletion).
    const trendUp = level.length >= 2 && level[level.length - 1] >= level[0];
    const unit = kg ? "kg" : "butir";
    const fmtFlow = (v: number) => `${Math.round(v).toLocaleString()} ${unit}`;
    return (
      <Card className={`shadow-soft border-2 ${statusBorder(status)}`}>
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-1.5">
            <span className="font-semibold text-[13px] leading-tight line-clamp-2">{product}</span>
            <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${statusDot(status)}`} />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="font-display font-bold text-xl">{m.stock.toLocaleString()}</span>
            <span className="text-[11px] text-muted-foreground">{kg ? "kg" : "butir"}</span>
          </div>
          {kg && (
            <div className="text-[10px] text-muted-foreground -mt-0.5">
              ≈ {butirEstimate(product, m.stock).toLocaleString()} butir
            </div>
          )}
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              <span className={`font-display font-bold text-[13px] ${coverColor(m.cover)}`}>{coverText(m.cover)}</span> {t.dashboard.coverLabel}
            </span>
            <span className="text-muted-foreground">
              {Math.round(m.avgDaily).toLocaleString()}{t.dashboard.perDay}
            </span>
          </div>
          {(m.expiringQty > 0 || m.atRiskQty > 0) && (
            <div className="mt-1.5">
              {m.expiringQty > 0 ? (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${pillClass(m.minDaysUntil <= 1 ? "crit" : "low")}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {formatStock(product, "egg", m.expiringQty)} · {expiringText(m.minDaysUntil)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-destructive/10 text-destructive">
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {m.atRiskQty.toLocaleString()} {t.dashboard.atRisk}
                </span>
              )}
            </div>
          )}
          {/* Explicit 7-day in/out — legible even when a big restock dwarfs a sale */}
          {(flow.inTotal > 0 || flow.outTotal > 0) && (
            <div className="mt-2 flex items-center gap-2 text-[10px] font-medium tabular-nums">
              <span className="text-success">▲ {fmtFlow(flow.inTotal)}</span>
              <span className="text-destructive">▼ {fmtFlow(flow.outTotal)}</span>
              <span className="text-muted-foreground">7d</span>
            </div>
          )}
          {level.length >= 2 && (
            <svg width="100%" height="24" viewBox="0 0 120 24" preserveAspectRatio="none" className="mt-1.5 overflow-visible">
              <polyline
                fill="none" strokeWidth="1.75"
                stroke={trendUp ? "hsl(var(--success))" : "hsl(var(--destructive))"}
                points={sparkPoints(level, 120, 24, 3)}
              />
            </svg>
          )}
        </CardContent>
      </Card>
    );
  };

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
        <div className="flex items-center gap-3 rounded-xl border border-success/35 bg-gradient-to-br from-success/[0.14] to-success/[0.04] px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/[0.18] text-success shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-display font-semibold text-[15px] leading-tight">{t.dashboard.allClearTitle}</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">{t.dashboard.allClearSub}</p>
          </div>
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

      {/* Focus eggs: per-type stat cards */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h3 className="font-display font-semibold text-sm">{t.dashboard.focusEggs}</h3>
          <Popover open={focusOpen} onOpenChange={setFocusOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t.dashboard.focusEggs} ({focusList.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 max-h-80 overflow-y-auto">
              <p className="text-xs font-medium mb-2">{t.dashboard.focusEggs}</p>
              <div className="space-y-1.5">
                {allEggProducts.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
                    <Checkbox
                      checked={focusedEggs.includes(p)}
                      onCheckedChange={() => toggleFocus(p)}
                    />
                    <span className="truncate">{p}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {focusList.length === 0 ? (
          <Card className="shadow-soft"><CardContent className="p-6 text-center text-xs text-muted-foreground">
            {t.dashboard.noFocusEggs}
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
            {focusList.map((p) => <EggCard key={p} product={p} />)}
          </div>
        )}
      </div>

      {/* Other (non-focused) eggs needing attention */}
      {otherEggActions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 px-0.5">
            <h3 className="font-display font-semibold text-sm">{t.dashboard.otherEggs} · {t.dashboard.needAttention}</h3>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">{otherEggActions.length}</span>
          </div>
          <Card className="shadow-soft overflow-hidden">
            {otherEggActions.map((a) => <ActionRow key={`egg-${a.product}`} a={a} />)}
          </Card>
        </div>
      )}

      {/* Supplies needing attention */}
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

      {/* Global 7-day trajectory */}
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
              fill="none" strokeWidth="2"
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
