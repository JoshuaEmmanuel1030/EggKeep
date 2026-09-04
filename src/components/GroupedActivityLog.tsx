import { useState, useMemo, useRef, useEffect } from "react";
import { ActivityLog } from "@/types/activityLog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CATEGORY_LABELS } from "@/types/inventory";
import { format, parseISO } from "date-fns";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useVoidEntry } from "@/hooks/useVoidEntry";
import { VoidEntryDialog } from "./VoidEntryDialog";
import { RecordReturnDialog } from "./RecordReturnDialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  ShoppingCart,
  Egg,
  Package,
  Box,
  PackagePlus,
  PackageMinus,
  Store,
  Cloud,
  CloudOff,
  CloudUpload,
  Truck,
  FileText,
  Pencil,
  Undo2,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { orderBucketKey } from "@/lib/activityGrouping";

// Unit label for a logged quantity in the product's native stock unit
// (kg-native: weight-sold eggs log kg, count eggs log butir, others pcs).
function useStockUnitLabel() {
  const { conversionMap } = useItemTypes();
  return (product: string, category: string): string => {
    if (category !== "egg") return "pcs";
    return conversionMap[product]?.unit === "kg" ? "kg" : "butir";
  };
}

interface GroupedActivityLogProps {
  logs: ActivityLog[];
  showVoided?: boolean;
  viewMode?: "grouped" | "chronological";
  // While true, render a timeline skeleton instead of the (empty) feed.
  loading?: boolean;
  // Whether any filter is active — changes the empty-state copy.
  hasActiveFilters?: boolean;
  // Called after a successful void so the parent can refresh inventory/logs.
  onVoided?: () => void;
}

interface BuyerOrder {
  buyerName: string;
  orderLines: Array<{ skuCode?: string; packQty?: number; eggProduct?: string; looseQty?: number }>;
  materials: Array<{ product: string; quantity: number; type: string }>;
  timestamp: string;
  outflowDate?: string;
  invoiceRef?: string;
  isSynced: boolean;
  logs: ActivityLog[];
}

interface ManualEntry {
  log: ActivityLog;
}

interface DateGroup {
  date: string;
  quickOutflows: Map<string, BuyerOrder>;
  manualOutflows: ManualEntry[];
  inflows: ActivityLog[];
  count: number;
}

// The context each entry hands up so one set of dialogs can serve the whole feed.
interface ReturnRequest {
  buyerName?: string;
  eggLogs: ActivityLog[];
}

export function GroupedActivityLog({ logs, showVoided = false, viewMode = "grouped", loading = false, hasActiveFilters = false, onVoided }: GroupedActivityLogProps) {
  const { t } = useLanguage();
  const { canEdit, getEditWindowHours, voidOutflow, voidInflow, findRelatedEntryId } = useVoidEntry();

  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ActivityLog | null>(null);
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidOrderDialogOpen, setVoidOrderDialogOpen] = useState(false);
  const [voidOrderLogs, setVoidOrderLogs] = useState<ActivityLog[]>([]);

  // Record-return dialog is hoisted here so any card can open it.
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnRequest, setReturnRequest] = useState<ReturnRequest | null>(null);

  // Confirm-void-order lives here so the destructive action is gated by an
  // AlertDialog before the reason step.
  const [confirmVoidOrderOpen, setConfirmVoidOrderOpen] = useState(false);
  const [pendingVoidOrderLogs, setPendingVoidOrderLogs] = useState<ActivityLog[]>([]);

  // Entrance animation should play on the FIRST mount only — not on every
  // refetch/void, which would re-shimmer the whole feed.
  const hasAnimatedRef = useRef(false);
  const animateEntrance = !hasAnimatedRef.current;
  useEffect(() => {
    hasAnimatedRef.current = true;
  }, []);

  // At-a-glance summary of the currently displayed activity.
  const summary = useMemo(() => {
    let orders = 0;
    let inflows = 0;
    let pending = 0;
    const seenOrderKeys = new Set<string>();
    logs.forEach((log) => {
      if (!log.isSynced) pending += 1;
      if (log.action_type === "inflow") {
        inflows += 1;
      } else if (log.metadata?.orderType === "quick_outflow" && log.metadata?.buyerName) {
        // Count distinct orders, not line rows.
        const key = orderBucketKey({
          buyerName: log.metadata.buyerName,
          orderLines: log.metadata.orderLines || [],
          outflowDate: log.metadata.outflowDate,
          recordedAt: log.recorded_at,
        });
        if (!seenOrderKeys.has(key)) {
          seenOrderKeys.add(key);
          orders += 1;
        }
      } else {
        orders += 1;
      }
    });
    return { orders, inflows, pending };
  }, [logs]);

  // Group logs by date, then by type (quick outflow, manual outflow, inflow)
  const groupedData = useMemo(() => {
    const groups = new Map<string, DateGroup>();

    logs.forEach((log) => {
      const dateKey = format(parseISO(log.recorded_at), "yyyy-MM-dd");
      const displayDate = format(parseISO(log.recorded_at), "MMMM d, yyyy");

      if (!groups.has(dateKey)) {
        groups.set(dateKey, {
          date: displayDate,
          quickOutflows: new Map(),
          manualOutflows: [],
          inflows: [],
          count: 0,
        });
      }

      const group = groups.get(dateKey)!;
      group.count += 1;

      if (log.action_type === "inflow") {
        group.inflows.push(log);
      } else if (log.metadata?.orderType === "quick_outflow" && log.metadata?.buyerName) {
        // Quick outflow - group by buyer + order content + outflow date + a
        // 30-second time bucket (see orderBucketKey): materials from the same
        // order collapse together, orders placed minutes apart stay separate.
        const orderKey = orderBucketKey({
          buyerName: log.metadata.buyerName,
          orderLines: log.metadata.orderLines || [],
          outflowDate: log.metadata.outflowDate,
          recordedAt: log.recorded_at,
        });

        if (!group.quickOutflows.has(orderKey)) {
          group.quickOutflows.set(orderKey, {
            buyerName: log.metadata.buyerName,
            orderLines: log.metadata.orderLines || [],
            materials: log.metadata.relatedProducts || [],
            timestamp: log.recorded_at,
            outflowDate: log.metadata.outflowDate,
            invoiceRef: log.metadata.invoiceRef,
            isSynced: log.isSynced ?? true,
            logs: [log],
          });
        } else {
          const existing = group.quickOutflows.get(orderKey)!;
          existing.logs.push(log);
          if (!log.isSynced) {
            existing.isSynced = false;
          }
        }
      } else {
        // Manual outflow
        group.manualOutflows.push({ log });
      }
    });

    // Sort by date descending
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([_, value]) => value);
  }, [logs]);

  const handleEditClick = (log: ActivityLog) => {
    setSelectedEntry(log);
    setVoidDialogOpen(true);
  };

  const handleReturnClick = (req: ReturnRequest) => {
    setReturnRequest(req);
    setReturnDialogOpen(true);
  };

  const handleVoidConfirm = async (reason: string) => {
    if (!selectedEntry) return;

    setVoidLoading(true);
    try {
      const entryId = await findRelatedEntryId(selectedEntry);

      if (!entryId) {
        console.error("Could not find related entry");
        return;
      }

      if (selectedEntry.action_type === "outflow") {
        await voidOutflow(entryId, selectedEntry.id, reason);
      } else {
        await voidInflow(entryId, selectedEntry.id, reason);
      }
      onVoided?.();
    } finally {
      setVoidLoading(false);
      setSelectedEntry(null);
    }
  };

  // Destructive: first confirm intent, then collect a reason.
  const handleVoidOrderClick = (logs: ActivityLog[]) => {
    setPendingVoidOrderLogs(logs);
    setConfirmVoidOrderOpen(true);
  };

  const handleVoidOrderConfirmed = () => {
    setVoidOrderLogs(pendingVoidOrderLogs);
    setConfirmVoidOrderOpen(false);
    setVoidOrderDialogOpen(true);
  };

  const handleVoidOrderConfirm = async (reason: string) => {
    setVoidLoading(true);
    try {
      for (const log of voidOrderLogs) {
        const entryId = await findRelatedEntryId(log);
        if (!entryId) continue;
        if (log.action_type === 'outflow') {
          await voidOutflow(entryId, log.id, reason);
        } else {
          await voidInflow(entryId, log.id, reason);
        }
      }
      onVoided?.();
    } finally {
      setVoidLoading(false);
      setVoidOrderLogs([]);
    }
  };

  const isEditable = (log: ActivityLog) => {
    return canEdit(log.created_at, log.user_id) && !log.voided_at;
  };

  // Shared dialogs rendered once for the whole feed.
  const dialogs = (
    <>
      <VoidEntryDialog
        open={voidDialogOpen}
        onOpenChange={setVoidDialogOpen}
        entry={selectedEntry}
        onConfirm={handleVoidConfirm}
        loading={voidLoading}
      />
      <VoidEntryDialog
        open={voidOrderDialogOpen}
        onOpenChange={setVoidOrderDialogOpen}
        entry={voidOrderLogs[0] ?? null}
        onConfirm={handleVoidOrderConfirm}
        loading={voidLoading}
        orderLogsCount={voidOrderLogs.length}
      />
      <RecordReturnDialog
        open={returnDialogOpen}
        onOpenChange={setReturnDialogOpen}
        buyerName={returnRequest?.buyerName}
        eggLogs={returnRequest?.eggLogs ?? []}
        onRecorded={onVoided}
      />
      <AlertDialog open={confirmVoidOrderOpen} onOpenChange={setConfirmVoidOrderOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.activity.voidOrderConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.activity.voidOrderConfirmBody.replace(
                "{count}",
                String(pendingVoidOrderLogs.length)
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleVoidOrderConfirmed}
            >
              {t.activity.voidOrder}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (loading) {
    return <ActivityTimelineSkeleton />;
  }

  if (logs.length === 0) {
    return <ActivityEmptyState hasActiveFilters={hasActiveFilters} />;
  }

  // Chronological view - flat list sorted by time, on a continuous timeline rail.
  if (viewMode === "chronological") {
    const sortedLogs = [...logs].sort((a, b) =>
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
    );

    return (
      <div className="space-y-4">
        <StatusStrip summary={summary} />
        <div className="relative pl-6">
          {/* Continuous rail */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/40 via-border to-transparent" />
          <div className="space-y-2.5">
            {sortedLogs.map((log, i) => (
              <TimelineRow key={log.id} index={i} tone={rowTone(log)} animate={animateEntrance}>
                <ChronologicalEntry
                  log={log}
                  onEditClick={handleEditClick}
                  isEditable={isEditable}
                  getEditWindowHours={getEditWindowHours}
                  onReturnClick={handleReturnClick}
                />
              </TimelineRow>
            ))}
          </div>
        </div>
        {dialogs}
      </div>
    );
  }

  // Grouped view - hierarchical by date and type on a vivid timeline.
  return (
    <div className="space-y-6">
      <StatusStrip summary={summary} />
      <div className="space-y-8">
        {groupedData.map((dateGroup, idx) => (
          <DateSection
            key={idx}
            group={dateGroup}
            animate={animateEntrance}
            onEditClick={handleEditClick}
            isEditable={isEditable}
            getEditWindowHours={getEditWindowHours}
            onVoidOrderClick={handleVoidOrderClick}
            onReturnClick={handleReturnClick}
          />
        ))}
      </div>
      {dialogs}
    </div>
  );
}

// ── Live status strip ────────────────────────────────────────────────────────
// A compact dispatch-board summary of the currently displayed activity, so the
// feed reads as an active operations board. Uses theme tokens for dark mode.
// NOTE: no "returns" tile — real return data doesn't exist yet, and counting
// voids as returns (as an earlier draft did) is wrong. Add it when returns ship.
interface StatusStripProps {
  summary: { orders: number; inflows: number; pending: number };
}

function StatusStrip({ summary }: StatusStripProps) {
  const { t } = useLanguage();
  const tiles = [
    {
      label: t.activity.todayOrders,
      value: summary.orders,
      icon: Truck,
      // Graphical rail ≥3:1; number/icon fg ≥4.5:1 (amber-700 light / amber-400 dark).
      rail: "border-l-amber-600 dark:border-l-amber-400",
      fg: "text-amber-700 dark:text-amber-400",
    },
    {
      label: t.activity.todayInflows,
      value: summary.inflows,
      icon: PackagePlus,
      rail: "border-l-emerald-600 dark:border-l-emerald-400",
      fg: "text-emerald-700 dark:text-emerald-400",
    },
    {
      label: t.activity.todayPending,
      value: summary.pending,
      icon: CloudUpload,
      rail: summary.pending > 0 ? "border-l-amber-600 dark:border-l-amber-400" : "border-l-border",
      fg: summary.pending > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((tile, i) => (
        <div
          key={i}
          className={cn(
            "rounded-lg border border-l-[3px] bg-card px-3 py-2.5 flex flex-col gap-0.5",
            tile.rail
          )}
        >
          <div className="flex items-center gap-1.5">
            <tile.icon className={cn("h-3.5 w-3.5", tile.fg)} />
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground truncate">
              {tile.label}
            </span>
          </div>
          <span className={cn("text-2xl font-bold tabular-nums leading-none", tile.fg)}>
            {tile.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────
// A designed empty state consistent with the timeline aesthetic (not a bare
// one-liner). Different copy when the emptiness is a filter result vs no data.
function ActivityEmptyState({ hasActiveFilters }: { hasActiveFilters?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Inbox className="h-7 w-7 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">
          {hasActiveFilters ? t.activity.emptyFilteredTitle : t.activity.emptyTitle}
        </h3>
        <p className="text-sm text-muted-foreground max-w-[16rem]">
          {hasActiveFilters ? t.activity.emptyFilteredHint : t.activity.emptyHint}
        </p>
      </div>
    </div>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────
// A timeline skeleton (rail + shimmer node rows) so the feed never flashes blank
// then pops. Mirrors the real layout: sticky-marker line, then rail with nodes.
function ActivityTimelineSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-l-[3px] bg-card px-3 py-2.5 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="relative pl-6">
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-[22px] top-4 h-3 w-3 rounded-full bg-muted ring-4 ring-background" />
                <div className="rounded-xl border border-l-4 border-l-muted bg-card p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-9 w-28 ml-auto" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Direction accent tokens — one source of truth for node/rail/border color.
type Tone = "inflow" | "outflow" | "quick";

function rowTone(log: ActivityLog): Tone {
  if (log.action_type === "inflow") return "inflow";
  return log.metadata?.orderType === "quick_outflow" ? "quick" : "outflow";
}

// Graphical accents (dots) — need ≥3:1 vs the card/page. 600 in light, 400 in
// dark clears that with margin (see docs/activity-redesign/contrast.md).
function toneDot(tone: Tone): string {
  switch (tone) {
    case "inflow":
      return "bg-emerald-600 dark:bg-emerald-400";
    case "quick":
      return "bg-amber-600 dark:bg-amber-400";
    default:
      return "bg-amber-600 dark:bg-amber-400";
  }
}

function toneBorder(tone: Tone): string {
  switch (tone) {
    case "inflow":
      return "border-l-emerald-600 dark:border-l-emerald-400";
    case "quick":
      return "border-l-amber-600 dark:border-l-amber-400";
    default:
      return "border-l-amber-600 dark:border-l-amber-400";
  }
}

// A single row hanging off the timeline rail, with a colored node + entrance cue.
function TimelineRow({
  children,
  index,
  tone = "quick",
  animate = false,
}: {
  children: React.ReactNode;
  index: number;
  tone?: Tone;
  animate?: boolean;
}) {
  return (
    <div
      className={cn("relative", animate && "animate-timeline-rise")}
      style={animate ? { animationDelay: `${Math.min(index * 45, 400)}ms` } : undefined}
    >
      {/* Node dot centered on the rail (rail sits at left-[7px] in the parent) */}
      <span
        aria-hidden
        className={cn(
          "absolute -left-[22px] top-4 h-3 w-3 rounded-full ring-4 ring-background",
          toneDot(tone)
        )}
      />
      {children}
    </div>
  );
}

interface DateSectionProps {
  group: DateGroup;
  animate?: boolean;
  onEditClick: (log: ActivityLog) => void;
  isEditable: (log: ActivityLog) => boolean;
  getEditWindowHours: (createdAt: string) => number;
  onVoidOrderClick: (logs: ActivityLog[]) => void;
  onReturnClick: (req: ReturnRequest) => void;
}

function DateSection({ group, animate = false, onEditClick, isEditable, getEditWindowHours, onVoidOrderClick, onReturnClick }: DateSectionProps) {
  const { t } = useLanguage();
  const hasQuickOutflows = group.quickOutflows.size > 0;
  const hasManualOutflows = group.manualOutflows.length > 0;
  const hasInflows = group.inflows.length > 0;

  // Running index for entrance stagger across all rows in this section.
  let rowIndex = 0;
  const countLabel = `${group.count} ${group.count === 1 ? t.activity.entry : t.activity.entries}`;

  return (
    <section className="space-y-4">
      {/* Bold sticky date marker */}
      <div className="sticky top-0 z-20 -mx-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 py-2">
        <div className="flex items-baseline gap-3">
          <h3 className="text-xl font-bold tracking-tight">{group.date}</h3>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {countLabel}
          </span>
          <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
        </div>
      </div>

      {/* Timeline column: rail + nodes */}
      <div className="relative pl-6">
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gradient-to-b from-primary/40 via-border to-transparent" />

        <div className="space-y-5">
          {/* Quick Outflows */}
          {hasQuickOutflows && (
            <div className="space-y-2.5">
              <SectionLabel icon={<ShoppingCart className="h-3.5 w-3.5" />} tone="quick">
                {t.activity.quickOutflows || "Quick Outflows"}
              </SectionLabel>
              {Array.from(group.quickOutflows.values()).map((order, idx) => (
                <TimelineRow key={idx} index={rowIndex++} tone="quick" animate={animate}>
                  <BuyerOrderCard
                    order={order}
                    onEditClick={onEditClick}
                    isEditable={isEditable}
                    getEditWindowHours={getEditWindowHours}
                    onVoidOrderClick={onVoidOrderClick}
                    onReturnClick={onReturnClick}
                  />
                </TimelineRow>
              ))}
            </div>
          )}

          {/* Manual Outflows */}
          {hasManualOutflows && (
            <div className="space-y-2.5">
              <SectionLabel icon={<PackageMinus className="h-3.5 w-3.5" />} tone="outflow">
                {t.activity.manualOutflows || "Manual Outflows"}
              </SectionLabel>
              {group.manualOutflows.map((entry, idx) => (
                <TimelineRow key={idx} index={rowIndex++} tone="outflow" animate={animate}>
                  <ManualOutflowEntry
                    log={entry.log}
                    onEditClick={onEditClick}
                    isEditable={isEditable}
                    getEditWindowHours={getEditWindowHours}
                    onReturnClick={onReturnClick}
                  />
                </TimelineRow>
              ))}
            </div>
          )}

          {/* Inflows */}
          {hasInflows && (
            <div className="space-y-2.5">
              <SectionLabel icon={<PackagePlus className="h-3.5 w-3.5" />} tone="inflow">
                {t.activity.inflows || "Inflows"}
              </SectionLabel>
              {group.inflows.map((log) => (
                <TimelineRow key={log.id} index={rowIndex++} tone="inflow" animate={animate}>
                  <InflowEntry
                    log={log}
                    onEditClick={onEditClick}
                    isEditable={isEditable}
                    getEditWindowHours={getEditWindowHours}
                  />
                </TimelineRow>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SectionLabel({ icon, tone, children }: { icon: React.ReactNode; tone: Tone; children: React.ReactNode }) {
  // Small uppercase labels — AA text ≥4.5:1. 700 light / 400 dark.
  const color =
    tone === "inflow"
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-amber-700 dark:text-amber-400";
  return (
    <div className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider", color)}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

// Shared card shell: rounded, left accent border, voided/offline styling, hover lift.
function EntryCard({
  tone,
  isSynced,
  isVoided,
  children,
}: {
  tone: Tone;
  isSynced?: boolean;
  isVoided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl border border-l-4 bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md",
        toneBorder(tone),
        isSynced === false && "border-dashed border-yellow-500/50 bg-muted/40",
        isVoided && "opacity-60 bg-muted/30"
      )}
    >
      {children}
    </div>
  );
}

// Quiet metadata: time + sync cloud.
function TimeSync({ time, isSynced }: { time?: string; isSynced?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
      {time ? <span className="tabular-nums font-medium">{time}</span> : null}
      {isSynced === false ? (
        <CloudOff className="h-3.5 w-3.5 text-yellow-500" />
      ) : (
        <Cloud className="h-3.5 w-3.5 text-green-500" />
      )}
    </div>
  );
}

interface BuyerOrderCardProps {
  order: BuyerOrder;
  onEditClick: (log: ActivityLog) => void;
  isEditable: (log: ActivityLog) => boolean;
  getEditWindowHours: (createdAt: string) => number;
  onVoidOrderClick: (logs: ActivityLog[]) => void;
  onReturnClick: (req: ReturnRequest) => void;
}

function BuyerOrderCard({ order, onEditClick, isEditable, getEditWindowHours, onVoidOrderClick, onReturnClick }: BuyerOrderCardProps) {
  const { t } = useLanguage();
  const unitLabel = useStockUnitLabel();
  const [expanded, setExpanded] = useState(false);
  const formattedTime = format(parseISO(order.timestamp), "HH:mm");

  const firstLog = order.logs[0];
  const canEditOrder = firstLog && isEditable(firstLog);
  const hoursRemaining = firstLog ? getEditWindowHours(firstLog.created_at) : 0;
  const isVoided = firstLog?.voided_at != null;

  // EGG outflow rows are the returnable lines.
  const eggLogs = order.logs.filter((l) => l.category === "egg" && l.action_type === "outflow");
  const canReturn = !isVoided && eggLogs.length > 0;

  const outflowDateFormatted = order.outflowDate
    ? format(parseISO(order.outflowDate), "MMM d, yyyy")
    : null;

  return (
    <EntryCard tone="quick" isSynced={order.isSynced} isVoided={isVoided}>
      {isVoided && (
        <Badge variant="destructive" className="absolute top-2.5 right-2.5 z-10">
          {t.activity.voided}
        </Badge>
      )}

      {/* Header: buyer name is the hero */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className={cn("font-bold text-base leading-tight truncate", isVoided && "line-through")}>
              {order.buyerName}
            </span>
          </div>
          {(order.invoiceRef || outflowDateFormatted) && (
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              {order.invoiceRef && (
                <Badge variant="outline" className="text-[11px] gap-1 font-normal">
                  <FileText className="h-3 w-3" />
                  {order.invoiceRef}
                </Badge>
              )}
              {outflowDateFormatted && (
                <span className="text-[11px] text-muted-foreground">{outflowDateFormatted}</span>
              )}
            </div>
          )}
        </div>
        <TimeSync time={formattedTime} isSynced={order.isSynced} />
      </div>

      {/* Order Lines */}
      <div className={cn("space-y-1 mb-3", isVoided && "line-through")}>
        {order.orderLines.map((line, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            {line.skuCode && line.packQty && (
              <>
                <Badge variant="secondary" className="text-xs font-mono">
                  {line.skuCode}
                </Badge>
                <span className="text-muted-foreground">×</span>
                <span className="font-semibold">{line.packQty}</span>
                <span className="text-muted-foreground text-xs">{t.activity.packs}</span>
              </>
            )}
            {line.eggProduct && line.looseQty && (
              <>
                <Badge variant="outline" className="text-xs">
                  {line.eggProduct}
                </Badge>
                <span className="text-muted-foreground">×</span>
                <span className="font-semibold">{line.looseQty}</span>
                <span className="text-muted-foreground text-xs">{t.activity.loose}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Void Reason */}
      {isVoided && firstLog?.void_reason && (
        <div className="text-xs text-destructive mb-2 p-2 bg-destructive/10 rounded">
          {t.activity.voidReason}: {firstLog.void_reason}
        </div>
      )}

      {/* Action row: quiet, right-aligned. Return is a secondary outline button
          (not a full-width solid) so it doesn't compete with the feed's hierarchy. */}
      {!isVoided && (canReturn || canEditOrder) && (
        <div className="flex flex-wrap items-center justify-end gap-1 pt-1">
          {canReturn && (
            <Button
              size="sm"
              variant="outline"
              className="h-11 gap-1.5"
              onClick={() => onReturnClick({ buyerName: order.buyerName, eggLogs })}
            >
              <Undo2 className="h-4 w-4" />
              {t.activity.recordReturn}
            </Button>
          )}
          {canEditOrder && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                onClick={() => onEditClick(firstLog)}
                title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
                aria-label={t.activity.editEntry}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {order.logs.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 text-xs text-destructive hover:text-destructive px-3"
                  onClick={() => onVoidOrderClick(order.logs)}
                >
                  {t.activity.voidOrder}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* User email */}
      {firstLog?.user_email && (
        <div className="text-[11px] text-muted-foreground mt-2">by: {firstLog.user_email}</div>
      )}

      {/* Materials Breakdown (Expandable) */}
      {order.materials.length > 0 && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-2 mt-2 border-t">
              <span>{t.activity.viewMaterials}</span>
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="pt-2 space-y-1.5">
              {order.materials.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  {item.type === 'egg' && <Egg className="h-3 w-3 text-amber-600 dark:text-amber-400" />}
                  {item.type === 'packaging' && <Package className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
                  {item.type === 'box' && <Box className="h-3 w-3 text-blue-500" />}
                  <span className="text-muted-foreground">{item.product}:</span>
                  <span className="font-medium">{item.quantity.toLocaleString()}</span>
                  <span className="text-muted-foreground">{unitLabel(item.product, item.type)}</span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </EntryCard>
  );
}

interface EntryProps {
  log: ActivityLog;
  onEditClick: (log: ActivityLog) => void;
  isEditable: (log: ActivityLog) => boolean;
  getEditWindowHours: (createdAt: string) => number;
}

interface ReturnableEntryProps extends EntryProps {
  onReturnClick: (req: ReturnRequest) => void;
}

function ManualOutflowEntry({ log, onEditClick, isEditable, getEditWindowHours, onReturnClick }: ReturnableEntryProps) {
  const { t } = useLanguage();
  const unitLabel = useStockUnitLabel();
  const formattedTime = format(parseISO(log.recorded_at), "HH:mm");
  const canEditEntry = isEditable(log);
  const hoursRemaining = getEditWindowHours(log.created_at);
  const isVoided = log.voided_at != null;
  const canReturn = !isVoided && log.category === "egg" && log.action_type === "outflow";

  return (
    <EntryCard tone="outflow" isSynced={log.isSynced} isVoided={isVoided}>
      {isVoided && (
        <Badge variant="destructive" className="absolute top-2.5 right-2.5 z-10">
          {t.activity.voided}
        </Badge>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge variant="outline" className="text-xs shrink-0">
            {CATEGORY_LABELS[log.category]}
          </Badge>
          <span className={cn("font-semibold", isVoided && "line-through")}>{log.product}</span>
          <span className="text-muted-foreground">·</span>
          <span className={cn("font-bold tabular-nums", isVoided && "line-through")}>
            {log.quantity_butir.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">{unitLabel(log.product, log.category)}</span>
        </div>
        <TimeSync time={formattedTime} isSynced={log.isSynced} />
      </div>

      {isVoided && log.void_reason && (
        <div className="text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded">
          {t.activity.voidReason}: {log.void_reason}
        </div>
      )}

      {!isVoided && (canReturn || canEditEntry) && (
        <div className="flex flex-wrap items-center justify-end gap-1 pt-2.5">
          {canReturn && (
            <Button
              size="sm"
              variant="outline"
              className="h-11 gap-1.5"
              onClick={() => onReturnClick({ eggLogs: [log] })}
            >
              <Undo2 className="h-4 w-4" />
              {t.activity.recordReturn}
            </Button>
          )}
          {canEditEntry && (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              onClick={() => onEditClick(log)}
              title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
              aria-label={t.activity.editEntry}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {log.user_email && (
        <div className="text-[11px] text-muted-foreground mt-2">by: {log.user_email}</div>
      )}
    </EntryCard>
  );
}

function InflowEntry({ log, onEditClick, isEditable, getEditWindowHours }: EntryProps) {
  const { t } = useLanguage();
  const unitLabel = useStockUnitLabel();
  const formattedTime = format(parseISO(log.recorded_at), "HH:mm");
  const canEditEntry = isEditable(log);
  const hoursRemaining = getEditWindowHours(log.created_at);
  const isVoided = log.voided_at != null;

  return (
    <EntryCard tone="inflow" isSynced={log.isSynced} isVoided={isVoided}>
      {isVoided && (
        <Badge variant="destructive" className="absolute top-2.5 right-2.5 z-10">
          {t.activity.voided}
        </Badge>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge variant="outline" className="text-xs border-emerald-600/60 text-emerald-700 dark:text-emerald-400 shrink-0">
            {CATEGORY_LABELS[log.category]}
          </Badge>
          <span className={cn("font-semibold", isVoided && "line-through")}>{log.product}</span>
          <span className="text-muted-foreground">·</span>
          <span className={cn("font-bold tabular-nums text-emerald-700 dark:text-emerald-400", isVoided && "line-through")}>
            +{log.quantity_butir.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">{unitLabel(log.product, log.category)}</span>
        </div>
        <TimeSync time={formattedTime} isSynced={log.isSynced} />
      </div>

      {log.invoice_supplier && (
        <div className="text-[11px] text-muted-foreground mt-1.5">Invoice: {log.invoice_supplier}</div>
      )}

      <div className="flex items-center gap-3 flex-wrap mt-1.5">
        {log.metadata?.inflowDate && (
          <span className="text-[11px] text-muted-foreground">
            {format(parseISO(log.metadata.inflowDate), "MMM d, yyyy")}
          </span>
        )}
        {log.user_email && (
          <span className="text-[11px] text-muted-foreground">by: {log.user_email}</span>
        )}
      </div>

      {canEditEntry && !isVoided && (
        <div className="flex justify-end pt-2.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            onClick={() => onEditClick(log)}
            title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
            aria-label={t.activity.editEntry}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      )}

      {isVoided && log.void_reason && (
        <div className="text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded">
          {t.activity.voidReason}: {log.void_reason}
        </div>
      )}
    </EntryCard>
  );
}

// Chronological view entry - unified display for all log types, timeline-styled.
function ChronologicalEntry({ log, onEditClick, isEditable, getEditWindowHours, onReturnClick }: ReturnableEntryProps) {
  const { t } = useLanguage();
  const unitLabel = useStockUnitLabel();
  const formattedDateTime = format(parseISO(log.recorded_at), "MMM d, HH:mm");
  const canEditEntry = isEditable(log);
  const hoursRemaining = getEditWindowHours(log.created_at);
  const isVoided = log.voided_at != null;
  const isInflow = log.action_type === "inflow";
  const isQuickOutflow = log.metadata?.orderType === "quick_outflow";
  const tone: Tone = isInflow ? "inflow" : isQuickOutflow ? "quick" : "outflow";
  const canReturn = !isVoided && !isInflow && log.category === "egg";

  return (
    <EntryCard tone={tone} isSynced={log.isSynced} isVoided={isVoided}>
      {isVoided && (
        <Badge variant="destructive" className="absolute top-2.5 right-2.5 z-10">
          {t.activity.voided}
        </Badge>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{formattedDateTime}</span>

          <Badge
            variant={isInflow ? "outline" : "secondary"}
            className={cn("text-xs shrink-0", isInflow && "border-emerald-600/60 text-emerald-700 dark:text-emerald-400")}
          >
            {isInflow ? (
              <><PackagePlus className="h-3 w-3 mr-1" />Inflow</>
            ) : isQuickOutflow ? (
              <><ShoppingCart className="h-3 w-3 mr-1" />Quick</>
            ) : (
              <><PackageMinus className="h-3 w-3 mr-1" />Outflow</>
            )}
          </Badge>

          <Badge variant="outline" className="text-xs shrink-0">
            {CATEGORY_LABELS[log.category]}
          </Badge>

          <span className={cn("font-semibold truncate", isVoided && "line-through")}>{log.product}</span>
          <span className="text-muted-foreground shrink-0">·</span>
          <span
            className={cn(
              "font-bold tabular-nums shrink-0",
              isInflow && "text-emerald-700 dark:text-emerald-400",
              isVoided && "line-through"
            )}
          >
            {isInflow ? "+" : "-"}{log.quantity_butir.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {unitLabel(log.product, log.category)}
          </span>

          {isQuickOutflow && log.metadata?.buyerName && (
            <Badge variant="outline" className="text-xs gap-1 shrink-0">
              <Store className="h-3 w-3" />
              {log.metadata.buyerName}
            </Badge>
          )}
        </div>

        <TimeSync isSynced={log.isSynced} />
      </div>

      {log.user_email && (
        <div className="text-[11px] text-muted-foreground mt-1.5">by: {log.user_email}</div>
      )}
      {log.invoice_supplier && (
        <div className="text-[11px] text-muted-foreground mt-1">Invoice: {log.invoice_supplier}</div>
      )}

      {isVoided && log.void_reason && (
        <div className="text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded">
          {t.activity.voidReason}: {log.void_reason}
        </div>
      )}

      {!isVoided && (canReturn || canEditEntry) && (
        <div className="flex flex-wrap items-center justify-end gap-1 pt-2.5">
          {canReturn && (
            <Button
              size="sm"
              variant="outline"
              className="h-11 gap-1.5"
              onClick={() =>
                onReturnClick({ buyerName: log.metadata?.buyerName, eggLogs: [log] })
              }
            >
              <Undo2 className="h-4 w-4" />
              {t.activity.recordReturn}
            </Button>
          )}
          {canEditEntry && (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              onClick={() => onEditClick(log)}
              title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
              aria-label={t.activity.editEntry}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </EntryCard>
  );
}
