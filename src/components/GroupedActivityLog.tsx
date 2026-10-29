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
import { useAuth } from "@/hooks/useAuth";
import { VoidEntryDialog } from "./VoidEntryDialog";
import { RecordReturnDialog } from "./RecordReturnDialog";
import { EditOrderDialog, type EditTarget } from "./EditOrderDialog";
import { canCorrect, editMinutesLeft } from "@/lib/orderCorrection";
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
  Undo2,
  Inbox,
  MapPin,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { orderBucketKey, returnCode } from "@/lib/activityGrouping";
import { nativeToPieces } from "@/lib/returnsCap";
import { usePriorReturns, ReturnsSummary, OutflowReturns } from "@/hooks/usePriorReturns";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { useDeliveryStatuses } from "@/hooks/useDeliveries";
import { normalizeInvoiceRef } from "@/lib/deliveryFlags";
import { DeliveryStatusChip } from "./deliveries/DeliveryStatusChip";

// Unit label for a logged quantity in the product's native stock unit
// (kg-native: weight-sold eggs log kg, count eggs log butir, others pcs).
export function useStockUnitLabel() {
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

export interface BuyerOrder {
  buyerName: string;
  orderLines: Array<{ skuCode?: string; packQty?: number; eggProduct?: string; looseQty?: number }>;
  materials: Array<{ product: string; quantity: number; type: string }>;
  timestamp: string;
  outflowDate?: string;
  invoiceRef?: string;
  dcName?: string;
  isSynced: boolean;
  // Any row was created by an edit (original_log_id set) -> "Edited" badge.
  edited?: boolean;
  logs: ActivityLog[];
}

export interface ManualEntry {
  log: ActivityLog;
}

export interface DateGroup {
  key: string; // yyyy-MM-dd
  date: string;
  quickOutflows: Map<string, BuyerOrder>;
  manualOutflows: ManualEntry[];
  inflows: ActivityLog[];
  count: number;
}

// The context each entry hands up so one set of dialogs can serve the whole feed.
export interface ReturnRequest {
  buyerName?: string;
  eggLogs: ActivityLog[];
  orderLines?: BuyerOrder["orderLines"];
}

// Shared feed state: return lookups, date/type grouping, edit/void/return
// handlers and the one set of dialogs they open. Used by the mobile feed and
// the tablet split view so both behave identically.
export function useActivityFeed(logs: ActivityLog[], onVoided?: () => void) {
  const { t } = useLanguage();
  const { canEdit, getEditWindowHours, voidOutflow, voidInflow, findRelatedEntryId, isAdmin } = useVoidEntry();
  const { user } = useAuth();

  // Bumped after a return is recorded so the bubbles refetch immediately (the
  // outflow-id set doesn't change, so usePriorReturns needs this nudge).
  const [returnsRefresh, setReturnsRefresh] = useState(0);

  // Per-outflow return breakdown for every egg outflow line in the feed, so each
  // line can show actually-delivered qty. Keyed by outflows.id via relatedEntryId.
  const returnsMap = usePriorReturns(
    useMemo(
      () =>
        logs
          .filter((l) => l.category === "egg" && l.action_type === "outflow")
          .map((l) => l.metadata?.relatedEntryId),
      [logs]
    ),
    returnsRefresh
  );

  // Delivery status per faktur for the order cards' chip (deep-links to /deliveries).
  const deliveryMap = useDeliveryStatuses(useMemo(() => logs.map((l) => l.metadata?.invoiceRef), [logs]));

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

  // Edit-order dialog (1h correction window).
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  // Re-render every 30s while any outflow is still inside the edit window, so
  // Edit buttons disappear when their hour runs out. The tick only triggers a
  // render; the window itself is always checked against the real clock.
  const [tick, setTick] = useState(0);
  const hasEditableAge = useMemo(
    () => logs.some((l) => l.action_type === "outflow" && !l.voided_at && editMinutesLeft(l.created_at) > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick re-checks the clock
    [logs, tick]
  );
  useEffect(() => {
    if (!hasEditableAge) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [hasEditableAge]);

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
          dcId: log.metadata?.dcId,
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
          key: dateKey,
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
          dcId: log.metadata?.dcId,
        });

        if (!group.quickOutflows.has(orderKey)) {
          group.quickOutflows.set(orderKey, {
            buyerName: log.metadata.buyerName,
            orderLines: log.metadata.orderLines || [],
            materials: log.metadata.relatedProducts || [],
            timestamp: log.recorded_at,
            outflowDate: log.metadata.outflowDate,
            invoiceRef: log.metadata.invoiceRef,
            dcName: log.metadata.dcName,
            isSynced: log.isSynced ?? true,
            edited: !!log.original_log_id,
            logs: [log],
          });
        } else {
          const existing = group.quickOutflows.get(orderKey)!;
          existing.logs.push(log);
          if (!log.isSynced) {
            existing.isSynced = false;
          }
          if (log.original_log_id) existing.edited = true;
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
    // Rows already voided on their own (e.g. from the chronological view) are
    // skipped, so the count is right and nothing tries to void them twice.
    const live = logs.filter((l) => !l.voided_at);
    if (live.length === 0) return;
    if (live.length === 1) {
      handleEditClick(live[0]); // one row: the single-entry void-with-reason flow
      return;
    }
    setPendingVoidOrderLogs(live);
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

  // The rows an edit replaces, and the earliest of them: the server checks
  // every row against the 1h window, so the oldest decides it.
  const editRows = (target: EditTarget) => (target.kind === "quick" ? target.order.logs : [target.log]);
  const oldestRow = (rows: ActivityLog[]) =>
    rows.reduce((a, b) => (new Date(b.created_at) < new Date(a.created_at) ? b : a), rows[0]);

  // Mirrors public.correct_order's checks: owner or admin, inside the window,
  // every row live (any voided row -> ALREADY_CHANGED) and synced, no returns.
  const canEditOrder = (target: EditTarget): boolean => {
    const rows = editRows(target);
    const first = oldestRow(rows);
    if (!first) return false;
    // The card must hold exactly one whole order (one row per material, each
    // product once): a search hides some rows, and identical orders entered
    // together merge into one card. Editing either would void the wrong set.
    if (
      target.kind === "quick" &&
      (rows.length !== target.order.materials.length || new Set(rows.map((l) => l.product)).size !== rows.length)
    ) {
      return false;
    }
    return canCorrect({
      createdAt: first.created_at,
      entryUserId: first.user_id,
      currentUserId: user?.id,
      isAdmin: !!isAdmin,
      voided: rows.some((l) => l.voided_at),
      synced: rows.every((l) => l.isSynced !== false),
      hasReturns: rows.some(
        (l) =>
          l.category === "egg" &&
          l.action_type === "outflow" &&
          (returnsMap[l.metadata?.relatedEntryId ?? ""]?.total ?? 0) > 0
      ),
    });
  };

  const editMinutes = (target: EditTarget): number => {
    const first = oldestRow(editRows(target));
    return first ? editMinutesLeft(first.created_at) : 0;
  };

  const handleEditOrderClick = (target: EditTarget) => {
    setEditTarget(target);
    setEditOpen(true);
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
      <EditOrderDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        target={editTarget}
        onSaved={() => {
          setReturnsRefresh((n) => n + 1);
          onVoided?.();
        }}
      />
      <RecordReturnDialog
        open={returnDialogOpen}
        onOpenChange={setReturnDialogOpen}
        buyerName={returnRequest?.buyerName}
        eggLogs={returnRequest?.eggLogs ?? []}
        orderLines={returnRequest?.orderLines}
        onRecorded={() => {
          setReturnsRefresh((n) => n + 1); // refetch bubbles immediately
          onVoided?.();
        }}
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

  return {
    returnsMap,
    deliveryMap,
    summary,
    groupedData,
    isEditable,
    getEditWindowHours,
    handleEditClick,
    handleReturnClick,
    handleVoidOrderClick,
    canEditOrder,
    editMinutes,
    handleEditOrderClick,
    dialogs,
  };
}

// The edit hooks the phone cards need, handed down as one prop.
type OrderEdit = Pick<ReturnType<typeof useActivityFeed>, "canEditOrder" | "editMinutes" | "handleEditOrderClick">;
type DeliveryMap = ReturnType<typeof useDeliveryStatuses>;

export function GroupedActivityLog({ logs, showVoided = false, viewMode = "grouped", loading = false, hasActiveFilters = false, onVoided }: GroupedActivityLogProps) {
  const {
    returnsMap,
    deliveryMap,
    summary,
    groupedData,
    isEditable,
    getEditWindowHours,
    handleEditClick,
    handleReturnClick,
    handleVoidOrderClick,
    canEditOrder,
    editMinutes,
    handleEditOrderClick,
    dialogs,
  } = useActivityFeed(logs, onVoided);
  const edit: OrderEdit = { canEditOrder, editMinutes, handleEditOrderClick };

  // Entrance animation should play on the FIRST mount only — not on every
  // refetch/void, which would re-shimmer the whole feed.
  const hasAnimatedRef = useRef(false);
  const animateEntrance = !hasAnimatedRef.current;
  useEffect(() => {
    hasAnimatedRef.current = true;
  }, []);

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
                  returnsMap={returnsMap}
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
            returnsMap={returnsMap}
            deliveryMap={deliveryMap}
            edit={edit}
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
export function ActivityEmptyState({
  hasActiveFilters,
  onClearFilters,
}: {
  hasActiveFilters?: boolean;
  // Tablet: shows a "Clear filters" button under a filtered-empty result.
  onClearFilters?: () => void;
}) {
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
      {hasActiveFilters && onClearFilters && (
        <Button variant="outline" className="h-11 rounded-[11px] px-[18px] text-[15px] font-semibold" onClick={onClearFilters}>
          {t.activity.clearFilters}
        </Button>
      )}
    </div>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────
// A timeline skeleton (rail + shimmer node rows) so the feed never flashes blank
// then pops. Mirrors the real layout: sticky-marker line, then rail with nodes.
export function ActivityTimelineSkeleton() {
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
// dark clears that with margin (measured in commit 9ea2ecf).
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
  returnsMap: Record<string, OutflowReturns>;
  deliveryMap: DeliveryMap;
  edit: OrderEdit;
}

function DateSection({ group, animate = false, onEditClick, isEditable, getEditWindowHours, onVoidOrderClick, onReturnClick, returnsMap, deliveryMap, edit }: DateSectionProps) {
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
                {t.activity.quickOutflows}
              </SectionLabel>
              {Array.from(group.quickOutflows.values()).map((order, idx) => (
                <TimelineRow key={idx} index={rowIndex++} tone="quick" animate={animate}>
                  <BuyerOrderCard
                    order={order}
                    isEditable={isEditable}
                    getEditWindowHours={getEditWindowHours}
                    onVoidOrderClick={onVoidOrderClick}
                    onReturnClick={onReturnClick}
                    returnsMap={returnsMap}
                    deliveryMap={deliveryMap}
                    edit={edit}
                  />
                </TimelineRow>
              ))}
            </div>
          )}

          {/* Manual Outflows */}
          {hasManualOutflows && (
            <div className="space-y-2.5">
              <SectionLabel icon={<PackageMinus className="h-3.5 w-3.5" />} tone="outflow">
                {t.activity.kastun}
              </SectionLabel>
              {group.manualOutflows.map((entry, idx) => (
                <TimelineRow key={idx} index={rowIndex++} tone="outflow" animate={animate}>
                  <ManualOutflowEntry
                    log={entry.log}
                    onEditClick={onEditClick}
                    isEditable={isEditable}
                    getEditWindowHours={getEditWindowHours}
                    onReturnClick={onReturnClick}
                    returnsMap={returnsMap}
                    edit={edit}
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

// Renders a quantity as "delivered" when a return trimmed it: the net number,
// the struck-through original, and an amber (N returned · code) badge. Falls
// back to the plain number+unit when there are no returns.
export function DeliveredLine({
  sold,
  unit,
  returns,
  struck,
  size = "sm",
  className,
}: {
  sold: number;
  unit: string;
  returns?: ReturnsSummary;
  struck?: boolean;
  // "lg" is the tablet detail panel's larger type; "sm" is the mobile card.
  size?: "sm" | "lg";
  className?: string;
}) {
  const { t } = useLanguage();
  const lg = size === "lg";
  if (!returns || returns.total <= 0) {
    if (lg) {
      return (
        <span className={cn("inline-flex items-baseline gap-1.5", className)}>
          <span className={cn("font-bold tabular-nums", struck && "line-through")}>
            {sold.toLocaleString()}
          </span>
          <span className="text-sm text-ek-mfg">{unit}</span>
        </span>
      );
    }
    return (
      <>
        <span className={cn("font-bold tabular-nums", struck && "line-through")}>
          {sold.toLocaleString()}
        </span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </>
    );
  }
  const delivered = sold - returns.total;
  return (
    <span className={cn("inline-flex flex-col gap-0.5 min-w-0", className)}>
      <span className={cn("flex gap-1.5", lg ? "items-baseline" : "items-center")}>
        <span className="font-bold tabular-nums">{delivered.toLocaleString()}</span>
        <span className={lg ? "text-sm text-ek-mfg" : "text-xs text-muted-foreground"}>{unit}</span>
        <span className={cn("line-through tabular-nums", lg ? "text-[13px] text-ek-mfg" : "text-[11px] text-muted-foreground")}>
          {t.activity.wasQty.replace("{qty}", sold.toLocaleString())}
        </span>
      </span>
      <span className={cn("text-amber-700 dark:text-amber-400 tabular-nums", lg ? "text-[13.5px]" : "text-[11px]")}>
        ({t.activity.returnedBadge.replace("{n}", returns.total.toLocaleString())} · <ReturnCodeParts returns={returns} />) {unit}
      </span>
    </span>
  );
}

// The O/R/H return code, each segment bold in its disposition colour:
// O (OK/restock) green, R (Retak/retakan) orange, H (Hancur/writeoff) red.
// Reuses returnCode so the order + zero-suppression stay single-sourced.
const RETURN_CODE_COLOR: Record<string, string> = {
  O: "text-emerald-600 dark:text-emerald-400",
  R: "text-orange-600 dark:text-orange-400",
  H: "text-red-600 dark:text-red-400",
};
export function ReturnCodeParts({ returns }: { returns: ReturnsSummary }) {
  const code = returnCode(returns);
  if (!code) return null;
  return (
    <>
      {code.split(" ").map((seg, i) => (
        <span key={i}>
          {i > 0 ? " " : ""}
          <span className={cn("font-bold", RETURN_CODE_COLOR[seg.slice(-1)])}>{seg}</span>
        </span>
      ))}
    </>
  );
}

// A compact amber pill showing how many eggs came back + the O/R/H code.
// Used on pack-SKU order lines. Returns are stored in the egg's NATIVE unit (kg
// for Negeri); on the order line we always show BUTIR/pieces (kg conversion is
// reserved for the materials breakdown), so kg-native products are converted back
// to pieces at the flat 15.5. Renders nothing when there's no return.
export function ReturnBubble({ returns, unit, className }: { returns?: ReturnsSummary; unit?: string; className?: string }) {
  const { t } = useLanguage();
  if (!returns || returns.total <= 0) return null;
  const toP = (n: number) => nativeToPieces(n, unit);
  const restock = toP(returns.restock);
  const retakan = toP(returns.retakan);
  const writeoff = toP(returns.writeoff);
  // Sum the converted buckets so the displayed total always matches the code.
  const pieces: ReturnsSummary = {
    restock, retakan, writeoff, total: restock + retakan + writeoff,
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400 tabular-nums", className)}>
      <Undo2 className="h-3 w-3" />
      {t.activity.returnedBadge.replace("{n}", pieces.total.toLocaleString())} · <ReturnCodeParts returns={pieces} />
    </span>
  );
}

// Per-order return lookups (egg lines, returns per egg product, pack SKU -> egg,
// per-SKU return). Shared by the mobile order card and the tablet detail panel.
export function useOrderReturns(order: BuyerOrder, returnsMap: Record<string, OutflowReturns>) {
  // EGG outflow rows are the returnable lines.
  const eggLogs = order.logs.filter((l) => l.category === "egg" && l.action_type === "outflow");
  // Sum returns per egg product across this order's egg outflow logs, so a line
  // or material row can be matched by product name.
  const returnsByProduct = useMemo(() => {
    const m: Record<string, ReturnsSummary> = {};
    for (const l of eggLogs) {
      const r = returnsMap[l.metadata?.relatedEntryId ?? ""];
      if (!r) continue;
      const acc = m[l.product] ?? (m[l.product] = { restock: 0, retakan: 0, writeoff: 0, total: 0 });
      acc.restock += r.restock;
      acc.retakan += r.retakan;
      acc.writeoff += r.writeoff;
      acc.total += r.total;
    }
    return m;
  }, [eggLogs, returnsMap]);

  // Catalog-driven pack SKU -> egg product, so a pack line can show the return
  // recorded against its underlying egg. Several SKUs can map to the same egg
  // (e.g. KP10B/KP6B -> KAMPUNG BIASA); each such line shows that egg's return.
  const { skus } = usePackSKUs();
  const skuToEgg = useMemo(() => {
    const byCode: Record<string, (typeof skus)[number]> = {};
    for (const s of skus) byCode[s.code] = s;
    const m: Record<string, string> = {};
    for (const s of skus) {
      // Box SKUs (e.g. OSVN10O) carry no eggProduct of their own — their egg
      // comes from the nested base pack. Resolve it so box-SKU lines match their
      // returns (mirrors the dialog's skuMap); normal packs use eggProduct directly.
      m[s.code] = (s.basePackCode ? byCode[s.basePackCode]?.eggProduct : null) || s.eggProduct;
    }
    return m;
  }, [skus]);

  // A pack line shows ONLY its own per-SKU return (from the egg outflow's bySku),
  // so two SKUs sharing one egg don't both show the egg's pooled total (doubling).
  const skuReturns = (skuCode: string): ReturnsSummary | undefined => {
    const eggProduct = skuToEgg[skuCode];
    const log = eggLogs.find((l) => l.product === eggProduct);
    const outflow = log ? returnsMap[log.metadata?.relatedEntryId ?? ""] : undefined;
    return outflow?.bySku?.[skuCode];
  };

  return { eggLogs, returnsByProduct, skuToEgg, skuReturns };
}

// Phone: outline "Edit order" / "Edit entry" button. Callers render it only
// when canEditOrder (inside the 1h correction window).
function EditOrderButton({ target, edit, label }: { target: EditTarget; edit: OrderEdit; label: string }) {
  const { t } = useLanguage();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-11 gap-1.5"
      title={t.activity.editMinutesLeft.replace("{minutes}", String(edit.editMinutes(target)))}
      onClick={() => edit.handleEditOrderClick(target)}
    >
      <Pencil className="h-4 w-4" />
      {label}
    </Button>
  );
}

// Small "Edited" tag for rows an edit created (original_log_id set).
function EditedBadge() {
  const { t } = useLanguage();
  return (
    <Badge variant="outline" className="text-[11px] gap-1 font-normal shrink-0">
      <Pencil className="h-3 w-3" />
      {t.activity.edited}
    </Badge>
  );
}

interface BuyerOrderCardProps {
  order: BuyerOrder;
  isEditable: (log: ActivityLog) => boolean;
  getEditWindowHours: (createdAt: string) => number;
  onVoidOrderClick: (logs: ActivityLog[]) => void;
  onReturnClick: (req: ReturnRequest) => void;
  returnsMap: Record<string, OutflowReturns>;
  deliveryMap: DeliveryMap;
  edit: OrderEdit;
}

function BuyerOrderCard({ order, isEditable, getEditWindowHours, onVoidOrderClick, onReturnClick, returnsMap, deliveryMap, edit }: BuyerOrderCardProps) {
  const { t } = useLanguage();
  const unitLabel = useStockUnitLabel();
  const [expanded, setExpanded] = useState(false);
  const formattedTime = format(parseISO(order.timestamp), "HH:mm");

  const firstLog = order.logs[0];
  const canVoidOrder = firstLog && isEditable(firstLog);
  const hoursRemaining = firstLog ? getEditWindowHours(firstLog.created_at) : 0;
  const isVoided = firstLog?.voided_at != null;
  const editTarget: EditTarget = { kind: "quick", order };
  const canEditOrder = edit.canEditOrder(editTarget);

  const { eggLogs, returnsByProduct, skuToEgg, skuReturns } = useOrderReturns(order, returnsMap);
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
          {(order.invoiceRef || order.dcName || outflowDateFormatted || order.edited) && (
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              {order.edited && <EditedBadge />}
              {order.invoiceRef && (
                <Badge variant="outline" className="text-[11px] gap-1 font-normal">
                  <FileText className="h-3 w-3" />
                  {order.invoiceRef}
                </Badge>
              )}
              {/* Delivery log status (read-only here; tap to open the faktur on /deliveries). */}
              {order.invoiceRef && deliveryMap.loaded && (
                <DeliveryStatusChip
                  status={deliveryMap.statuses[normalizeInvoiceRef(order.invoiceRef)] ?? null}
                  invoiceRef={order.invoiceRef}
                />
              )}
              {order.dcName && (
                <Badge variant="outline" className="text-[11px] gap-1 font-normal">
                  <MapPin className="h-3 w-3" />
                  {order.dcName}
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
                <ReturnBubble
                  returns={skuReturns(line.skuCode)}
                  unit={unitLabel(skuToEgg[line.skuCode] ?? "", "egg")}
                />
              </>
            )}
            {line.eggProduct && line.looseQty && (
              <>
                <Badge variant="outline" className="text-xs">
                  {line.eggProduct}
                </Badge>
                <span className="text-muted-foreground">×</span>
                <DeliveredLine
                  sold={line.looseQty}
                  unit={t.activity.loose}
                  returns={returnsByProduct[line.eggProduct]}
                  struck={isVoided}
                />
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
      {!isVoided && (canReturn || canEditOrder || canVoidOrder) && (
        <div className="flex flex-wrap items-center justify-end gap-1 pt-1">
          {canReturn && (
            <Button
              size="sm"
              variant="outline"
              className="h-11 gap-1.5"
              onClick={() => onReturnClick({ buyerName: order.buyerName, eggLogs, orderLines: order.orderLines })}
            >
              <Undo2 className="h-4 w-4" />
              {t.activity.recordReturn}
            </Button>
          )}
          {canEditOrder && <EditOrderButton target={editTarget} edit={edit} label={t.activity.editOrder} />}
          {/* One void action per order (any number of materials); the old pencil
              opened the same void-with-reason flow for just one row. */}
          {canVoidOrder && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 text-xs text-destructive hover:text-destructive px-3"
              onClick={() => onVoidOrderClick(order.logs)}
              title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
            >
              {t.activity.voidOrder}
            </Button>
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
                  <DeliveredLine
                    sold={item.quantity}
                    unit={unitLabel(item.product, item.type)}
                    returns={item.type === 'egg' ? returnsByProduct[item.product] : undefined}
                  />
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
  returnsMap: Record<string, OutflowReturns>;
}

function ManualOutflowEntry({
  log,
  onEditClick,
  isEditable,
  getEditWindowHours,
  onReturnClick,
  returnsMap,
  edit,
}: ReturnableEntryProps & { edit: OrderEdit }) {
  const { t } = useLanguage();
  const unitLabel = useStockUnitLabel();
  const formattedTime = format(parseISO(log.recorded_at), "HH:mm");
  const canEditEntry = isEditable(log);
  const hoursRemaining = getEditWindowHours(log.created_at);
  const isVoided = log.voided_at != null;
  const canReturn = !isVoided && log.category === "egg" && log.action_type === "outflow";
  const editTarget: EditTarget = { kind: "manual", log };
  const canCorrectEntry = edit.canEditOrder(editTarget);

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
          {log.original_log_id && <EditedBadge />}
          <span className={cn("font-semibold", isVoided && "line-through")}>{log.product}</span>
          <span className="text-muted-foreground">·</span>
          <DeliveredLine
            sold={log.quantity_butir}
            unit={unitLabel(log.product, log.category)}
            returns={returnsMap[log.metadata?.relatedEntryId ?? ""]}
            struck={isVoided}
          />
        </div>
        <TimeSync time={formattedTime} isSynced={log.isSynced} />
      </div>

      {isVoided && log.void_reason && (
        <div className="text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded">
          {t.activity.voidReason}: {log.void_reason}
        </div>
      )}

      {!isVoided && (canReturn || canCorrectEntry || canEditEntry) && (
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
          {canCorrectEntry && <EditOrderButton target={editTarget} edit={edit} label={t.activity.editCash} />}
          {canEditEntry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 text-xs text-destructive hover:text-destructive px-3"
              onClick={() => onEditClick(log)}
              title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
            >
              {t.activity.voidEntry}
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
            size="sm"
            className="h-11 text-xs text-destructive hover:text-destructive px-3"
            onClick={() => onEditClick(log)}
            title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
          >
            {t.activity.voidEntry}
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
function ChronologicalEntry({ log, onEditClick, isEditable, getEditWindowHours, onReturnClick, returnsMap }: ReturnableEntryProps) {
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
              <><PackagePlus className="h-3 w-3 mr-1" /><span className="capitalize">{t.activity.statInflow}</span></>
            ) : isQuickOutflow ? (
              <><ShoppingCart className="h-3 w-3 mr-1" />{t.activity.quickOutflow}</>
            ) : (
              <><PackageMinus className="h-3 w-3 mr-1" />{t.activity.kastun}</>
            )}
          </Badge>

          <Badge variant="outline" className="text-xs shrink-0">
            {CATEGORY_LABELS[log.category]}
          </Badge>

          <span className={cn("font-semibold truncate", isVoided && "line-through")}>{log.product}</span>
          <span className="text-muted-foreground shrink-0">·</span>
          {isInflow ? (
            <>
              <span className={cn("font-bold tabular-nums text-emerald-700 dark:text-emerald-400", isVoided && "line-through")}>
                +{log.quantity_butir.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {unitLabel(log.product, log.category)}
              </span>
            </>
          ) : (
            <DeliveredLine
              sold={log.quantity_butir}
              unit={unitLabel(log.product, log.category)}
              returns={returnsMap[log.metadata?.relatedEntryId ?? ""]}
              struck={isVoided}
            />
          )}

          {isQuickOutflow && log.metadata?.buyerName && (
            <Badge variant="outline" className="text-xs gap-1 max-w-full">
              <Store className="h-3 w-3 shrink-0" />
              <span className="truncate">{log.metadata.buyerName}</span>
            </Badge>
          )}
          {isQuickOutflow && log.metadata?.dcName && (
            <Badge variant="outline" className="text-xs gap-1 max-w-full">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{log.metadata.dcName}</span>
            </Badge>
          )}
          {log.original_log_id && <EditedBadge />}
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
              size="sm"
              className="h-11 text-xs text-destructive hover:text-destructive px-3"
              onClick={() => onEditClick(log)}
              title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
            >
              {t.activity.voidEntry}
            </Button>
          )}
        </div>
      )}
    </EntryCard>
  );
}
