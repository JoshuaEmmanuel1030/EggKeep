import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, AlertTriangle, Egg, PackageCheck, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useVoidEntry } from "@/hooks/useVoidEntry";
import { useRecordReturn } from "@/hooks/useRecordReturn";
import { usePriorReturns } from "@/hooks/usePriorReturns";
import { enqueueReturn } from "@/lib/returnOutbox";
import { remainingReturnable } from "@/lib/returnsCap";
import { ActivityLog } from "@/types/activityLog";
import {
  RecordReturnInput,
  ReturnDisposition,
  ReturnLineInput,
} from "@/types/returns";

interface RecordReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The buyer / source label shown in the header.
  buyerName?: string;
  // The EGG activity logs belonging to this order (or a single manual outflow).
  // Each log is one outflow row -> one or more returnable disposition lines.
  eggLogs: ActivityLog[];
  onRecorded?: () => void;
}

// A single returned line can split across all three dispositions at once
// (e.g. 12 good + 13 cracked + 25 broken of the same product). Each bucket is a
// raw input string; on submit each non-zero bucket becomes its own ReturnLineInput
// sharing the same outflowId (record_return sums them under one cumulative cap).
type LineState = Record<ReturnDisposition, string>;

const EMPTY_LINE: LineState = { restock: "", retakan: "", writeoff: "" };

interface BucketDef {
  key: ReturnDisposition;
  icon: typeof PackageCheck;
  // tailwind text/border accent per bucket
  accent: string;
  focus: string;
}

const BUCKETS: BucketDef[] = [
  {
    key: "restock",
    icon: PackageCheck,
    accent: "text-emerald-700 dark:text-emerald-400",
    focus: "focus-visible:ring-emerald-600 border-emerald-600 dark:border-emerald-400",
  },
  {
    key: "retakan",
    icon: AlertTriangle,
    accent: "text-amber-700 dark:text-amber-400",
    focus: "focus-visible:ring-amber-600 border-amber-600 dark:border-amber-400",
  },
  {
    key: "writeoff",
    icon: Trash2,
    accent: "text-destructive",
    focus: "focus-visible:ring-destructive border-destructive",
  },
];

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ret-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

// Parse a raw qty into a number (accepting comma decimals, id-locale friendly).
// Non-numeric / empty -> 0 so it can be summed safely.
function parseQty(raw: string): number {
  const n = parseFloat((raw ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export function RecordReturnDialog({
  open,
  onOpenChange,
  buyerName,
  eggLogs,
  onRecorded,
}: RecordReturnDialogProps) {
  const { t } = useLanguage();
  const { conversionMap } = useItemTypes();
  const { findRelatedEntryId } = useVoidEntry();
  const { recordReturn, saving } = useRecordReturn();
  // Held in a ref so the resolve effect keys only off open/eggLogs, never the
  // function identity (guards against an unstable findRelatedEntryId re-looping).
  const findRelatedEntryIdRef = useRef(findRelatedEntryId);
  findRelatedEntryIdRef.current = findRelatedEntryId;

  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState(format(new Date(), "yyyy-MM-dd"));
  // Each log's underlying outflow row id, resolved once on open and reused on
  // confirm. Also drives the prior-returns cap below.
  const [resolvedIds, setResolvedIds] = useState<Record<string, string | null>>({});

  // Sum of prior returns per outflow, so a 2nd partial return caps to what's
  // actually left (matches the server's cumulative cap) instead of the full sold qty.
  const priorByOutflow = usePriorReturns(Object.values(resolvedIds));
  const remainingFor = (log: ActivityLog): number => {
    const outflowId = resolvedIds[log.id];
    const prior = outflowId ? priorByOutflow[outflowId]?.total ?? 0 : 0;
    return remainingReturnable(log.quantity_butir, prior);
  };

  const unitLabel = (product: string): string =>
    conversionMap[product]?.unit === "kg" ? "kg" : "butir";

  const bucketLabel = (key: ReturnDisposition): string =>
    key === "restock"
      ? t.activity.returnRestock
      : key === "retakan"
        ? t.activity.returnRetakan
        : t.activity.returnWriteOff;

  // Reset all state whenever the dialog opens with a fresh order.
  useEffect(() => {
    if (open) {
      const init: Record<string, LineState> = {};
      eggLogs.forEach((log) => {
        init[log.id] = { ...EMPTY_LINE };
      });
      setLines(init);
      setReason("");
      setReturnDate(format(new Date(), "yyyy-MM-dd"));
      setResolvedIds({});
    }
  }, [open, eggLogs]);

  // Resolve each log's outflow row id once on open (async). Feeds the cap and is
  // reused on confirm so we don't re-query.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const pairs = await Promise.all(
        eggLogs.map(async (log) => [log.id, await findRelatedEntryIdRef.current(log)] as const)
      );
      if (!cancelled) setResolvedIds(Object.fromEntries(pairs));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, eggLogs]);

  // Sum of a log's three buckets.
  const lineSum = (state: LineState): number =>
    parseQty(state.restock) + parseQty(state.retakan) + parseQty(state.writeoff);

  const setBucket = (
    logId: string,
    key: ReturnDisposition,
    raw: string,
    max: number
  ) => {
    // Allow only digits + one decimal separator.
    const cleaned = raw.replace(/[^0-9.,]/g, "");
    setLines((prev) => {
      const state = prev[logId] ?? { ...EMPTY_LINE };
      const others = lineSum({ ...state, [key]: "" }); // other two buckets
      const num = parseQty(cleaned);
      // Clamp this bucket so the line's TOTAL never exceeds what was sold.
      const room = Math.max(0, max - others);
      const next = num > room ? String(room) : cleaned;
      return { ...prev, [logId]: { ...state, [key]: next } };
    });
  };

  const enteredLines = useMemo(
    () => eggLogs.filter((log) => lineSum(lines[log.id] ?? EMPTY_LINE) > 0),
    [eggLogs, lines]
  );

  const canSubmit = enteredLines.length > 0 && !saving;

  const handleConfirm = async () => {
    if (!canSubmit) return;

    const resolved: ReturnLineInput[] = [];
    for (const log of enteredLines) {
      const outflowId = resolvedIds[log.id] ?? (await findRelatedEntryId(log));
      if (!outflowId) {
        toast.error(
          t.activity.returnLineUnresolved.replace("{product}", log.product)
        );
        return;
      }
      // Emit one line per non-zero bucket, all sharing this outflowId. Enforce the
      // returnable cap (sold minus prior returns) with a running remainder so the
      // combined total can never exceed it, even if the UI clamp was bypassed.
      const state = lines[log.id] ?? EMPTY_LINE;
      let remaining = remainingFor(log);
      for (const { key } of BUCKETS) {
        const want = parseQty(state[key]);
        const quantity = Math.min(want, remaining);
        if (quantity <= 0) continue;
        resolved.push({
          id: makeId(),
          outflowId,
          product: log.product,
          category: log.category,
          quantity,
          disposition: key,
        });
        remaining -= quantity;
      }
    }

    if (resolved.length === 0) return;

    const input: RecordReturnInput = {
      returnDate,
      buyerName: buyerName || undefined,
      reason: reason.trim() || undefined,
      lines: resolved,
    };

    const res = await recordReturn(input);
    if (res.ok) {
      toast.success(t.activity.returnRecorded);
      onRecorded?.();
      onOpenChange(false);
    } else if (res.kind === "network") {
      // Offline / connection dropped: queue the whole return and replay it when
      // back online. record_return skips already-recorded line ids, so a replay
      // after a partially-observed success can never double-restock.
      enqueueReturn(input);
      toast.success(t.outbox.returnSavedOffline, {
        description: t.outbox.returnSavedOfflineDesc,
      });
      onRecorded?.();
      onOpenChange(false);
    } else {
      toast.error(t.activity.returnFailed, { description: res.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            {t.activity.recordReturn}
          </DialogTitle>
          <DialogDescription>
            {buyerName
              ? t.activity.returnDescriptionBuyer.replace("{buyer}", buyerName)
              : t.activity.returnDescription}
          </DialogDescription>
        </DialogHeader>

        {eggLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t.activity.returnNoEggLines}
          </p>
        ) : (
          <div className="space-y-3 py-2">
            {eggLogs.map((log) => {
              const max = remainingFor(log);
              const state = lines[log.id] ?? EMPTY_LINE;
              const unit = unitLabel(log.product);
              const sum = lineSum(state);
              const hasQty = sum > 0;
              const atMax = hasQty && sum >= max;
              const hasRetakan = parseQty(state.retakan) > 0;

              return (
                <div
                  key={log.id}
                  className={cn(
                    "rounded-lg border border-l-[3px] bg-card p-3 space-y-2.5 transition-colors",
                    hasQty ? "border-l-primary" : "border-l-border"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Egg className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="font-semibold truncate">{log.product}</span>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs tabular-nums">
                      {t.activity.returnSold}: {log.quantity_butir.toLocaleString()} {unit}
                    </Badge>
                  </div>

                  {/* Split the returned amount across the three dispositions at once. */}
                  <div className="grid grid-cols-3 gap-2">
                    {BUCKETS.map(({ key, icon: Icon, accent, focus }) => {
                      const val = state[key];
                      const active = parseQty(val) > 0;
                      return (
                        <div key={key} className="space-y-1.5 min-w-0">
                          <Label
                            htmlFor={`ret-${key}-${log.id}`}
                            className={cn(
                              "flex items-center gap-1 text-xs font-medium",
                              active ? accent : "text-muted-foreground"
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{bucketLabel(key)}</span>
                          </Label>
                          <Input
                            id={`ret-${key}-${log.id}`}
                            inputMode="decimal"
                            placeholder="0"
                            value={val}
                            onChange={(e) => setBucket(log.id, key, e.target.value, max)}
                            aria-describedby={`ret-sub-${log.id}`}
                            className={cn(
                              "h-11 text-base tabular-nums text-center transition-colors",
                              active && focus
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {hasRetakan && (
                    <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      {t.activity.returnRetakanHelp}
                    </p>
                  )}

                  {/* Live total + over-max hint */}
                  <div id={`ret-sub-${log.id}`} className="min-h-[16px]">
                    {atMax ? (
                      <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                        <AlertCircle className="h-3 w-3" />
                        {t.activity.returnOverMax
                          .replace("{max}", max.toLocaleString())
                          .replace("{unit}", unit)}
                      </span>
                    ) : hasQty ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t.activity.returnOfSold
                          .replace("{qty}", sum.toLocaleString())
                          .replace("{max}", max.toLocaleString())
                          .replace("{unit}", unit)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}

            <Separator />

            {/* Return date + reason */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="return-date" className="text-sm font-medium">
                  {t.activity.returnDate}
                </Label>
                <Input
                  id="return-date"
                  type="date"
                  value={returnDate}
                  max={format(new Date(), "yyyy-MM-dd")}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="return-reason" className="text-sm font-medium">
                  {t.activity.returnReason}
                </Label>
                <Textarea
                  id="return-reason"
                  placeholder={t.activity.returnReasonPlaceholder}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="min-h-[64px]"
                />
              </div>
            </div>
          </div>
        )}

        {eggLogs.length > 0 && (
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:gap-0">
            {!canSubmit && !saving && (
              <p className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
                {t.activity.returnNeedsQty}
              </p>
            )}
            <Button
              variant="outline"
              className="h-11"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t.common.cancel}
            </Button>
            <Button className="h-11" onClick={handleConfirm} disabled={!canSubmit}>
              {saving ? t.common.saving : t.activity.confirmReturn}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
