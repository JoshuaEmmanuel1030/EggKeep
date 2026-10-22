import { useMemo, useRef, useState, type ReactNode } from "react";
import { format, isThisYear, isToday, isYesterday, parseISO } from "date-fns";
import { Cloud, CloudOff, Egg, FileText, MapPin, Package, Pencil, Square, Store, Undo2, type LucideIcon } from "lucide-react";
import { ActivityLog } from "@/types/activityLog";
import { CATEGORY_LABELS } from "@/types/inventory";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EntryKind } from "@/lib/activityGrouping";
import { nativeToPieces } from "@/lib/returnsCap";
import type { OutflowReturns } from "@/hooks/usePriorReturns";
import {
  ActivityEmptyState,
  ActivityTimelineSkeleton,
  BuyerOrder,
  DeliveredLine,
  ReturnBubble,
  useActivityFeed,
  useOrderReturns,
  useStockUnitLabel,
} from "./GroupedActivityLog";
import type { EditTarget } from "./EditOrderDialog";

export interface ActivitySplitViewProps {
  // Already-filtered logs to show.
  logs: ActivityLog[];
  loading?: boolean;
  viewMode: "grouped" | "chronological";
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onVoided?: () => void;
}

// One feed row. Ids are stable across refetches so the selection survives them.
interface Entry {
  id: string;
  kind: EntryKind;
  time: string; // ISO
  log: ActivityLog; // orders: their first log
  order?: BuyerOrder;
}

type UnitLabel = ReturnType<typeof useStockUnitLabel>;
type Feed = ReturnType<typeof useActivityFeed>;

const SECTION_ORDER: EntryKind[] = ["quick", "manual", "inflow"];

const isEggOutflow = (l: ActivityLog) => l.category === "egg" && l.action_type === "outflow";
const eggLogsOf = (e: Entry) => (e.order?.logs ?? [e.log]).filter(isEggOutflow);
const kindColor = (k: EntryKind) => (k === "inflow" ? "text-emerald-700" : "text-amber-700");
const hhmm = (iso: string) => format(parseISO(iso), "HH:mm");
const byTimeDesc = (a: Entry, b: Entry) => new Date(b.time).getTime() - new Date(a.time).getTime();

// Tablet landscape: 440px feed + docked detail panel, scrolling independently.
export function ActivitySplitView({
  logs,
  loading,
  viewMode,
  hasActiveFilters,
  onClearFilters,
  onVoided,
}: ActivitySplitViewProps) {
  const { t } = useLanguage();
  const feed = useActivityFeed(logs, onVoided);
  const unitLabel = useStockUnitLabel();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const days = useMemo(
    () =>
      feed.groupedData.map((group) => {
        const byKind: Record<EntryKind, Entry[]> = {
          quick: Array.from(group.quickOutflows, ([key, order]) => ({
            id: `q:${key}`, kind: "quick" as const, time: order.timestamp, log: order.logs[0], order,
          })),
          manual: group.manualOutflows.map(({ log }) => ({
            id: `m:${log.id}`, kind: "manual" as const, time: log.recorded_at, log,
          })),
          inflow: group.inflows.map((log) => ({
            id: `i:${log.id}`, kind: "inflow" as const, time: log.recorded_at, log,
          })),
        };
        // Chronological: one unlabelled, time-sorted section per day.
        const sections: { kind: EntryKind | null; entries: Entry[] }[] =
          viewMode === "grouped"
            ? SECTION_ORDER.filter((k) => byKind[k].length > 0).map((k) => ({ kind: k, entries: byKind[k] }))
            : [{ kind: null, entries: SECTION_ORDER.flatMap((k) => byKind[k]).sort(byTimeDesc) }];
        return { group, sections };
      }),
    [feed.groupedData, viewMode]
  );

  const visible = days.flatMap((d) => d.sections.flatMap((s) => s.entries));
  // A filtered-out selection falls back to the first visible entry, and the
  // fallback is stored so clearing the filter doesn't jump back to the old one.
  // An edited entry is replaced by new rows (new id): follow it via original_log_id.
  const selectedLogIds = useRef<string[]>([]);
  const logsOf = (e: Entry) => e.order?.logs ?? [e.log];
  const selected =
    visible.find((e) => e.id === selectedId) ??
    visible.find((e) => logsOf(e).some((l) => l.original_log_id && selectedLogIds.current.includes(l.original_log_id))) ??
    visible[0];
  if (selected) selectedLogIds.current = logsOf(selected).map((l) => l.id);
  if (selected && selected.id !== selectedId) setSelectedId(selected.id);

  const sectionLabel: Record<EntryKind, string> = {
    quick: t.activity.quickOutflows,
    manual: t.activity.kastun,
    inflow: t.activity.inflows,
  };

  let feedBody: ReactNode;
  if (loading) {
    feedBody = (
      <div className="p-5">
        <ActivityTimelineSkeleton />
      </div>
    );
  } else if (visible.length === 0) {
    feedBody = (
      <div className="px-5">
        <ActivityEmptyState hasActiveFilters={hasActiveFilters} onClearFilters={onClearFilters} />
      </div>
    );
  } else {
    feedBody = days.map(({ group, sections }) => (
      <section key={group.key}>
        {/* Rows shown, not log rows (an order is one row of several logs). */}
        <DayHeader dateKey={group.key} count={sections.reduce((n, s) => n + s.entries.length, 0)} />
        {sections.map(({ kind, entries }) => (
          <div key={kind ?? "all"}>
            {kind && (
              <div className={cn("px-5 pb-1.5 pt-3.5 text-xs font-bold uppercase tracking-[0.07em]", kindColor(kind))}>
                {sectionLabel[kind]}
              </div>
            )}
            {entries.map((entry) => (
              <FeedRow
                key={entry.id}
                entry={entry}
                selected={entry.id === selected?.id}
                onSelect={() => setSelectedId(entry.id)}
                returnsMap={feed.returnsMap}
                unitLabel={unitLabel}
              />
            ))}
          </div>
        ))}
      </section>
    ));
  }

  return (
    <div className="flex min-h-0 flex-1 leading-[1.2]">
      <div className="w-[440px] shrink-0 overflow-y-auto border-r border-ek-border bg-ek-bg">{feedBody}</div>
      <div className="flex min-w-0 flex-1 flex-col bg-card">
        {!loading && selected && <EntryDetail entry={selected} feed={feed} unitLabel={unitLabel} />}
      </div>
      {feed.dialogs}
    </div>
  );
}

function DayHeader({ dateKey, count }: { dateKey: string; count: number }) {
  const { t } = useLanguage();
  const d = parseISO(dateKey);
  const relative = isToday(d) ? t.activity.today : isYesterday(d) ? t.activity.yesterday : null;
  return (
    <div className="sticky top-0 z-10 flex items-baseline gap-2.5 border-b border-ek-border bg-ek-bg/95 px-5 pb-2.5 pt-4 backdrop-blur-[6px]">
      <h3 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-ek-fg">
        {relative ?? format(d, isThisYear(d) ? "d MMM" : "d MMM yyyy")}
      </h3>
      {relative && (
        <span className="whitespace-nowrap text-[15px] font-medium text-ek-mfg">{format(d, "EEE, d MMM yyyy")}</span>
      )}
      <span className="ml-auto whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.05em] text-ek-mfg">
        {count} {count === 1 ? t.activity.entry : t.activity.entries}
      </span>
    </div>
  );
}

function SyncGlyph({ synced }: { synced: boolean }) {
  const Icon = synced ? Cloud : CloudOff;
  return <Icon aria-hidden className={cn("h-[18px] w-[18px] shrink-0", synced ? "text-green-600" : "text-yellow-600")} />;
}

function VoidedPill({ className }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <span className={cn("inline-flex shrink-0 rounded-full bg-red-100 px-[9px] py-[3px] text-xs font-bold text-red-700", className)}>
      {t.activity.voided}
    </span>
  );
}

const isSynced = (e: Entry) => (e.order ? e.order.isSynced : e.log.isSynced !== false);
// Created by an edit (original_log_id) -> "Edited" tag.
const isEdited = (e: Entry) => (e.order ? !!e.order.edited : !!e.log.original_log_id);
const TAG = "shrink-0 whitespace-nowrap rounded-md bg-ek-muted px-[7px] py-0.5 text-xs font-semibold text-ek-mfg";

function FeedRow({
  entry,
  selected,
  onSelect,
  returnsMap,
  unitLabel,
}: {
  entry: Entry;
  selected: boolean;
  onSelect: () => void;
  returnsMap: Record<string, OutflowReturns>;
  unitLabel: UnitLabel;
}) {
  const { t } = useLanguage();
  const { kind, log, order } = entry;
  const synced = isSynced(entry);
  const voided = log.voided_at != null;
  const unit = unitLabel(log.product, log.category);

  // Returned eggs across the entry's egg outflow lines, in pieces.
  const returned = eggLogsOf(entry).reduce(
    (sum, l) =>
      sum + nativeToPieces(returnsMap[l.metadata?.relatedEntryId ?? ""]?.total ?? 0, unitLabel(l.product, "egg")),
    0
  );

  const summary = order
    ? order.orderLines
        .map((l) =>
          l.skuCode && l.packQty
            ? `${l.skuCode} × ${l.packQty.toLocaleString()}`
            : l.eggProduct && l.looseQty
              ? `${l.eggProduct} × ${l.looseQty.toLocaleString()}`
              : null
        )
        .filter(Boolean)
        .join(" · ")
    : kind === "manual"
      ? `${t.activity.kastun} · ${log.quantity_butir.toLocaleString()} ${unit}`
      : `+${log.quantity_butir.toLocaleString()} ${unit}${log.invoice_supplier ? ` · ${log.invoice_supplier}` : ""}`;

  const syncLabel = synced ? t.activity.synced : t.activity.waitingToSync;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-[78px] w-full items-center gap-[14px] border-b border-l-4 border-ek-border bg-card py-4 pl-4 pr-[18px] text-left",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ek-fg",
        kind === "inflow" ? "border-l-emerald-600" : "border-l-amber-600",
        !synced && "bg-amber-50 [border-left-style:dashed]",
        voided && "opacity-60",
        selected && "bg-ek-selected shadow-[inset_0_0_0_2px_#d97706]"
      )}
    >
      <span className="text-[15px] font-semibold tabular-nums text-ek-mfg">{hhmm(entry.time)}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("min-w-0 truncate text-[17px] font-bold text-ek-fg", voided && "line-through")}>
            {order ? order.buyerName : log.product}
          </span>
          {order?.dcName && (
            <span className="shrink-0 whitespace-nowrap rounded-md bg-ek-muted px-[7px] py-0.5 font-mono text-xs font-semibold text-ek-mfg">
              {order.dcName}
            </span>
          )}
          {order?.invoiceRef && (
            <span className="shrink-0 whitespace-nowrap rounded-md bg-ek-muted px-[7px] py-0.5 font-mono text-xs font-semibold text-ek-mfg">
              {order.invoiceRef}
            </span>
          )}
          {isEdited(entry) && <span className={TAG}>{t.activity.edited}</span>}
        </span>
        <span className={cn("truncate text-[14.5px] text-ek-mfg", kind === "inflow" && "font-semibold text-emerald-700")}>
          {summary}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        {returned > 0 && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-[13px] font-semibold tabular-nums text-amber-700">
            <Undo2 aria-hidden className="h-[13px] w-[13px]" />
            {t.activity.returnedBadge.replace("{n}", returned.toLocaleString())}
          </span>
        )}
        {voided && <VoidedPill />}
        <span role="img" aria-label={syncLabel} title={syncLabel} className="flex">
          <SyncGlyph synced={synced} />
        </span>
      </span>
    </button>
  );
}

function Block({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-6">
      <h4 className="mb-1.5 flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.07em] text-ek-mfg">
        {title}
        {extra}
      </h4>
      {children}
    </div>
  );
}

const LINE_ROW = "flex items-center gap-2.5 border-t border-ek-border py-[13px] text-[16px] last:border-b";
const PRODUCT_CHIP = "rounded-[7px] border border-ek-border px-[9px] py-[3px] text-sm font-semibold";

function EntryDetail({ entry, feed, unitLabel }: { entry: Entry; feed: Feed; unitLabel: UnitLabel }) {
  const { t } = useLanguage();
  const { kind, log, order } = entry;
  const synced = isSynced(entry);
  const voided = log.voided_at != null;
  const unit = unitLabel(log.product, log.category);

  const eggLogs = eggLogsOf(entry);
  const canReturn = !voided && eggLogs.length > 0; // never true for inflows
  const canVoid = feed.isEditable(log);
  // Purchase Orders and Cash entries can be edited (1h window); inflows can't.
  const editTarget: EditTarget | null = order
    ? { kind: "quick", order }
    : kind === "manual"
      ? { kind: "manual", log }
      : null;
  const canEditOrder = !!editTarget && feed.canEditOrder(editTarget);
  const businessDate = kind === "inflow" ? log.metadata?.inflowDate : log.metadata?.outflowDate;

  return (
    <>
      <div key={entry.id} className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        <div className={cn("flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.07em]", kindColor(kind))}>
          {kind === "quick" && <Store aria-hidden className="h-[18px] w-[18px]" />}
          {kind === "quick" ? t.activity.quickOutflow : kind === "manual" ? t.activity.kastun : t.activity.statInflow}
          {isEdited(entry) && <span className={cn(TAG, "ml-1 normal-case tracking-normal")}>{t.activity.edited}</span>}
        </div>
        <h2 className="mb-2.5 mt-1.5 flex items-center gap-3 font-display text-[30px] font-semibold tracking-[-0.02em] text-ek-fg">
          <span className={cn("min-w-0 break-words", voided && "text-ek-mfg line-through")}>
            {order ? order.buyerName : log.product}
          </span>
          {voided && <VoidedPill className="text-sm" />}
        </h2>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14.5px] text-ek-mfg">
          {order ? (
            <>
              {order.invoiceRef && (
                <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-lg border border-ek-border px-[9px] py-[3px] font-medium text-ek-fg">
                  <FileText aria-hidden className="h-3.5 w-3.5" />
                  {order.invoiceRef}
                </span>
              )}
              {order.dcName && (
                <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-lg border border-ek-border px-[9px] py-[3px] font-medium text-ek-fg">
                  <MapPin aria-hidden className="h-3.5 w-3.5" />
                  {t.activity.dc} {order.dcName}
                </span>
              )}
              {order.outflowDate && (
                <span>{t.activity.outflowOn.replace("{date}", format(parseISO(order.outflowDate), "d MMM yyyy"))}</span>
              )}
            </>
          ) : (
            <>
              <span>{CATEGORY_LABELS[log.category]}</span>
              {log.invoice_supplier && <span>{t.activity.invoiceLabel.replace("{ref}", log.invoice_supplier)}</span>}
              {businessDate && <span>{format(parseISO(businessDate), "d MMM yyyy")}</span>}
            </>
          )}
          <span className="inline-flex items-center gap-[5px] tabular-nums">
            {hhmm(entry.time)}
            <SyncGlyph synced={synced} />
            {synced ? t.activity.synced : t.activity.waitingToSync}
          </span>
        </div>

        {order ? (
          <OrderBlocks order={order} voided={voided} returnsMap={feed.returnsMap} unitLabel={unitLabel} />
        ) : (
          <Block title={t.activity.quantity}>
            <div className={LINE_ROW}>
              <span className={PRODUCT_CHIP}>{log.product}</span>
              {kind === "inflow" ? (
                <span className="inline-flex items-baseline gap-1.5">
                  <span className={cn("text-[22px] font-bold tabular-nums text-emerald-700", voided && "line-through")}>
                    +{log.quantity_butir.toLocaleString()}
                  </span>
                  <span className="text-sm text-ek-mfg">{unit}</span>
                </span>
              ) : (
                <DeliveredLine
                  size="lg"
                  className="text-[22px]"
                  sold={log.quantity_butir}
                  unit={unit}
                  returns={feed.returnsMap[log.metadata?.relatedEntryId ?? ""]}
                  struck={voided}
                />
              )}
            </div>
          </Block>
        )}

        {voided && log.void_reason && (
          <div className="mt-5 rounded-[10px] bg-red-50 px-3.5 py-3 text-[15px] text-red-700">
            {t.activity.voidReason}: {log.void_reason}
          </div>
        )}
        {log.user_email && (
          <div className="mt-5 text-sm text-ek-mfg">{t.activity.byUser.replace("{email}", log.user_email)}</div>
        )}
      </div>

      {/* At 1024px the panel is 376px wide: three full-label buttons don't fit
          on one line, so the bar wraps instead of truncating them. */}
      {!voided && (canReturn || canEditOrder || canVoid) && (
        <div className="flex flex-wrap items-center gap-2.5 border-t border-ek-border bg-card px-7 py-3.5">
          {canReturn && (
            <Button
              className="h-12 min-w-0 gap-2 rounded-[11px] bg-ek-fg px-[18px] text-[15px] font-semibold text-white hover:bg-ek-fg/90 [&_svg]:size-[18px]"
              onClick={() =>
                feed.handleReturnClick(
                  order ? { buyerName: order.buyerName, eggLogs, orderLines: order.orderLines } : { eggLogs }
                )
              }
            >
              <Undo2 />
              <span className="truncate">{t.activity.recordReturn}</span>
            </Button>
          )}
          {canEditOrder && (
            <Button
              variant="outline"
              className="h-12 min-w-0 gap-2 rounded-[11px] border-ek-border bg-card px-[18px] text-[15px] font-semibold text-ek-fg hover:bg-ek-muted hover:text-ek-fg [&_svg]:size-[18px]"
              title={t.activity.editMinutesLeft.replace("{minutes}", String(feed.editMinutes(editTarget)))}
              onClick={() => feed.handleEditOrderClick(editTarget)}
            >
              <Pencil />
              <span className="truncate">{order ? t.activity.editOrder : t.activity.editCash}</span>
            </Button>
          )}
          {/* One void action: the whole order for Purchase Orders, the entry for
              Cash / Inflow. Same 48h rule as before (no separate pencil). */}
          {canVoid && (
            <Button
              variant="ghost"
              className="ml-auto h-12 min-w-0 rounded-[11px] px-[18px] text-[15px] font-semibold text-red-600 hover:bg-red-50 hover:text-red-700"
              title={t.activity.withinEditWindow.replace("{hours}", String(feed.getEditWindowHours(log.created_at)))}
              onClick={() => (order ? feed.handleVoidOrderClick(order.logs) : feed.handleEditClick(log))}
            >
              <span className="truncate">{order ? t.activity.voidOrder : t.activity.voidEntry}</span>
            </Button>
          )}
        </div>
      )}
    </>
  );
}

const MATERIAL_ICON: Record<string, [LucideIcon, string]> = {
  egg: [Egg, "text-amber-600"],
  packaging: [Package, "text-emerald-600"],
  box: [Square, "text-blue-500"],
};

// Separate component so useOrderReturns runs as a hook per selected order.
function OrderBlocks({
  order,
  voided,
  returnsMap,
  unitLabel,
}: {
  order: BuyerOrder;
  voided: boolean;
  returnsMap: Record<string, OutflowReturns>;
  unitLabel: UnitLabel;
}) {
  const { t } = useLanguage();
  const { returnsByProduct, skuToEgg, skuReturns } = useOrderReturns(order, returnsMap);
  const anyReturns = Object.values(returnsByProduct).some((r) => r.total > 0);

  const legend = anyReturns && (
    <span className="ml-auto flex gap-2.5 text-[13px] font-medium normal-case tracking-normal">
      {(
        [
          ["O", "text-emerald-600", t.activity.returnRestock],
          ["R", "text-orange-600", t.activity.returnRetakan],
          ["H", "text-red-600", t.activity.returnWriteOff],
        ] as const
      ).map(([code, color, word]) => (
        <span key={code}>
          <span className={cn("font-bold", color)}>{code}</span> {word.toLowerCase()}
        </span>
      ))}
    </span>
  );

  return (
    <>
      <Block title={t.activity.orderLines} extra={legend}>
        {order.orderLines.map((line, idx) => (
          <div key={idx} className={cn(LINE_ROW, voided && "line-through")}>
            {line.skuCode && line.packQty ? (
              <>
                <span className="rounded-[7px] bg-ek-muted px-[9px] py-[3px] font-mono text-sm font-semibold">{line.skuCode}</span>
                <span className="text-ek-mfg">×</span>
                <span className="font-bold tabular-nums">{line.packQty.toLocaleString()}</span>
                <span className="text-sm text-ek-mfg">{t.activity.packs}</span>
                <ReturnBubble
                  returns={skuReturns(line.skuCode)}
                  unit={unitLabel(skuToEgg[line.skuCode] ?? "", "egg")}
                  className="ml-auto px-[11px] py-1 text-[13.5px] font-semibold [&>svg]:h-3.5 [&>svg]:w-3.5"
                />
              </>
            ) : line.eggProduct && line.looseQty ? (
              <>
                <span className={PRODUCT_CHIP}>{line.eggProduct}</span>
                <span className="text-ek-mfg">×</span>
                <DeliveredLine
                  size="lg"
                  sold={line.looseQty}
                  unit={t.activity.loose}
                  returns={returnsByProduct[line.eggProduct]}
                  struck={voided}
                />
              </>
            ) : null}
          </div>
        ))}
      </Block>

      {order.materials.length > 0 && (
        <Block title={t.activity.materialsBreakdown}>
          {order.materials.map((item, idx) => {
            const [Icon, color] = MATERIAL_ICON[item.type] ?? [];
            return (
              <div
                key={idx}
                className="grid grid-cols-[22px_1fr_auto] items-center gap-2.5 border-t border-ek-border py-2.5 text-[15px] last:border-b"
              >
                <span className="flex">{Icon && <Icon aria-hidden className={cn("h-4 w-4", color)} />}</span>
                <span className="text-ek-fg">{item.product}</span>
                <DeliveredLine
                  size="lg"
                  className="items-end text-right"
                  sold={item.quantity}
                  unit={unitLabel(item.product, item.type)}
                  returns={item.type === "egg" ? returnsByProduct[item.product] : undefined}
                />
              </div>
            );
          })}
        </Block>
      )}
    </>
  );
}
