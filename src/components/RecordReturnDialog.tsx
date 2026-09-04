import { useEffect, useMemo, useState } from "react";
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
import { AlertCircle, Egg, PackageCheck, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useVoidEntry } from "@/hooks/useVoidEntry";
import { useRecordReturn } from "@/hooks/useRecordReturn";
import { ActivityLog } from "@/types/activityLog";
import { clampReturnQty } from "@/lib/activityGrouping";
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
  // Each log is one outflow row -> one returnable line.
  eggLogs: ActivityLog[];
  onRecorded?: () => void;
}

interface LineState {
  qty: string;
  disposition: ReturnDisposition;
}

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ret-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
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

  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const unitLabel = (product: string): string =>
    conversionMap[product]?.unit === "kg" ? "kg" : "butir";

  // Reset all state whenever the dialog opens with a fresh order.
  useEffect(() => {
    if (open) {
      const init: Record<string, LineState> = {};
      eggLogs.forEach((log) => {
        init[log.id] = { qty: "", disposition: "restock" };
      });
      setLines(init);
      setReason("");
      setReturnDate(format(new Date(), "yyyy-MM-dd"));
    }
  }, [open, eggLogs]);

  // Parse a raw qty into a number (accepting comma decimals, id-locale friendly).
  const parseQty = (raw: string): number => parseFloat(raw.replace(",", "."));

  const setQty = (logId: string, raw: string, max: number) => {
    // Allow only digits + one decimal separator; clamp to the line's amount.
    const cleaned = raw.replace(/[^0-9.,]/g, "");
    const num = parseQty(cleaned);
    const next = !isNaN(num) && num > max ? String(max) : cleaned;
    setLines((prev) => ({ ...prev, [logId]: { ...prev[logId], qty: next } }));
  };

  const setDisposition = (logId: string, disposition: ReturnDisposition) => {
    setLines((prev) => ({ ...prev, [logId]: { ...prev[logId], disposition } }));
  };

  const enteredLines = useMemo(
    () =>
      eggLogs.filter((log) => {
        const v = parseQty(lines[log.id]?.qty ?? "");
        return !isNaN(v) && v > 0;
      }),
    [eggLogs, lines]
  );

  const canSubmit = enteredLines.length > 0 && !saving;

  const handleConfirm = async () => {
    if (!canSubmit) return;

    // Resolve each entered line to its underlying outflow row id.
    const resolved: ReturnLineInput[] = [];
    for (const log of enteredLines) {
      const outflowId = await findRelatedEntryId(log);
      if (!outflowId) {
        toast.error(
          t.activity.returnLineUnresolved.replace("{product}", log.product)
        );
        return;
      }
      // Final safety clamp — never send more than the line sold.
      const quantity = clampReturnQty(lines[log.id].qty, log.quantity_butir);
      resolved.push({
        id: makeId(),
        outflowId,
        product: log.product,
        category: log.category,
        quantity,
        disposition: lines[log.id].disposition,
      });
    }

    const input: RecordReturnInput = {
      returnDate,
      buyerName: buyerName || undefined,
      reason: reason.trim() || undefined,
      lines: resolved,
    };

    const { ok, message } = await recordReturn(input);
    if (ok) {
      toast.success(t.activity.returnRecorded);
      onRecorded?.();
      onOpenChange(false);
    } else {
      // RPC not live yet -> friendly pending note; otherwise the real error.
      toast.error(t.activity.returnFailed, {
        description: message?.includes("record_return")
          ? t.activity.returnPending
          : message,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-primary" />
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
              const max = log.quantity_butir;
              const state = lines[log.id] ?? { qty: "", disposition: "restock" };
              const unit = unitLabel(log.product);
              const entered = parseQty(state.qty);
              const hasQty = !isNaN(entered) && entered > 0;
              const atMax = hasQty && entered >= max;
              const isRestock = state.disposition === "restock";

              return (
                <div
                  key={log.id}
                  className={cn(
                    "rounded-lg border border-l-[3px] bg-card p-3 space-y-2.5 transition-colors",
                    !hasQty
                      ? "border-l-border"
                      : isRestock
                        ? "border-l-emerald-500"
                        : "border-l-destructive"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Egg className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="font-semibold truncate">{log.product}</span>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs tabular-nums">
                      {t.activity.returnSold}: {max.toLocaleString()} {unit}
                    </Badge>
                  </div>

                  <div className="flex items-end gap-3">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <Label
                        htmlFor={`ret-qty-${log.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        {t.activity.returnQuantity} ({unit})
                      </Label>
                      <Input
                        id={`ret-qty-${log.id}`}
                        inputMode="decimal"
                        placeholder="0"
                        value={state.qty}
                        onChange={(e) => setQty(log.id, e.target.value, max)}
                        aria-describedby={`ret-sub-${log.id}`}
                        className={cn(
                          "h-11 text-base tabular-nums transition-colors",
                          hasQty &&
                            (isRestock
                              ? "border-emerald-500 focus-visible:ring-emerald-500"
                              : "border-destructive focus-visible:ring-destructive")
                        )}
                      />
                    </div>

                    {/* Restock / write-off toggle — 44px tap targets */}
                    <div
                      role="group"
                      aria-label={t.activity.returnDisposition}
                      className="flex rounded-lg border p-1 gap-1 bg-muted/40"
                    >
                      <button
                        type="button"
                        aria-pressed={isRestock}
                        onClick={() => setDisposition(log.id, "restock")}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-3 h-11 text-xs font-medium transition-colors",
                          isRestock
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <PackageCheck className="h-3.5 w-3.5" />
                        {t.activity.returnRestock}
                      </button>
                      <button
                        type="button"
                        aria-pressed={!isRestock}
                        onClick={() => setDisposition(log.id, "writeoff")}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-3 h-11 text-xs font-medium transition-colors",
                          !isRestock
                            ? "bg-destructive text-destructive-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t.activity.returnWriteOff}
                      </button>
                    </div>
                  </div>

                  {/* Live subtotal + over-max hint */}
                  <div id={`ret-sub-${log.id}`} className="min-h-[16px]">
                    {atMax ? (
                      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <AlertCircle className="h-3 w-3" />
                        {t.activity.returnOverMax
                          .replace("{max}", max.toLocaleString())
                          .replace("{unit}", unit)}
                      </span>
                    ) : hasQty ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {t.activity.returnOfSold
                          .replace("{qty}", entered.toLocaleString())
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
