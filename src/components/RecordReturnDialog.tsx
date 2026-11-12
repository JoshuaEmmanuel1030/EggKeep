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
import { remainingReturnable, nativeToPieces } from "@/lib/returnsCap";
import { parseQtyInput, qtyInputText } from "@/lib/stockCount";
import { buildReturnLines, buildSkuEggMap, type ReturnRowInput } from "@/lib/returnLines";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { ActivityLog } from "@/types/activityLog";
import { RecordReturnInput, ReturnDisposition } from "@/types/returns";
import type { InventoryCategory } from "@/types/inventory";

interface RecordReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The buyer / source label shown in the header.
  buyerName?: string;
  // The EGG activity logs belonging to this order (or a single manual outflow).
  // Each log is one outflow row -> one or more returnable disposition lines.
  eggLogs: ActivityLog[];
  // The order's pack lines. When present (and non-empty), the dialog renders one
  // row PER pack SKU (pieces entered per line), grouping rows by egg product under
  // a shared cap. Absent/empty -> fall back to one row per egg log (loose/manual).
  orderLines?: Array<{ skuCode?: string; packQty?: number; eggProduct?: string; looseQty?: number }>;
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

export function RecordReturnDialog({
  open,
  onOpenChange,
  buyerName,
  eggLogs,
  orderLines,
  onRecorded,
}: RecordReturnDialogProps) {
  const { t } = useLanguage();
  const { conversionMap, boxCapacityMap } = useItemTypes();
  const { skus, isLoading: skusLoading } = usePackSKUs();
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

  const skuMap = useMemo(() => {
    // Box SKU (e.g. OSVN10B): it carries no egg count of its own — eggs come
    // from its nested base pack × box capacity (packs/box), mirroring
    // resolveBoxLine (shared rule: buildSkuEggMap). A box with no configured
    // capacity keeps the box row's own fields, as before.
    const eggs = buildSkuEggMap(skus, boxCapacityMap);
    const m: Record<string, { eggProduct: string; eggsPerPack: number }> = {};
    for (const s of skus) {
      const e = eggs[s.code];
      m[s.code] =
        s.basePackCode && s.boxMode && e.piecesPerBox != null
          ? { eggProduct: e.eggProduct, eggsPerPack: e.piecesPerBox }
          : { eggProduct: s.eggProduct, eggsPerPack: s.eggsPerPack };
    }
    return m;
  }, [skus, boxCapacityMap]);

  // The first egg log per product -> its outflow id / native sold qty / category.
  const eggLogByProduct = useMemo(() => {
    const m: Record<string, ActivityLog> = {};
    for (const log of eggLogs) if (!(log.product in m)) m[log.product] = log;
    return m;
  }, [eggLogs]);

  // One entry row per order line (pack SKU) when orderLines is given, plus one
  // row per egg log no pack row covers (Telur Lepas on a mixed PO); otherwise
  // fall back to one row per egg log (loose/manual — unchanged behaviour).
  interface Row {
    key: string;
    label: string;
    eggProduct: string;
    skuCode?: string;
    soldPieces?: number;
    // Pack rows take entry in PIECES (converted to native on submit). The
    // loose/manual fallback rows take entry directly in the egg's NATIVE unit.
    pieces: boolean;
  }
  const rows: Row[] = useMemo(() => {
    const nativeRow = (log: ActivityLog): Row => ({
      key: log.id,
      label: log.product,
      eggProduct: log.product,
      pieces: false,
    });
    // Same SKU on two lines (e.g. different labels) -> one summed row, so a
    // single entry is never emitted twice.
    const packQtyBySku = new Map<string, number>();
    for (const l of orderLines ?? []) {
      if (l.skuCode && l.packQty) packQtyBySku.set(l.skuCode, (packQtyBySku.get(l.skuCode) ?? 0) + l.packQty);
    }
    if (packQtyBySku.size === 0) return eggLogs.map(nativeRow);
    const packRows: Row[] = [...packQtyBySku].map(([skuCode, packQty]) => {
      const sku = skuMap[skuCode];
      return {
        key: skuCode,
        label: skuCode,
        eggProduct: sku?.eggProduct ?? skuCode,
        skuCode,
        soldPieces: sku ? packQty * sku.eggsPerPack : undefined,
        pieces: true,
      };
    });
    // Until SKUs load a pack row's egg is unknown, so "uncovered" can't be told yet.
    if (skusLoading) return packRows;
    // A loose egg a pack row already covers stays pooled under that row's cap.
    // Only uncovered eggs get a native row, so one egg's rows never mix pieces
    // and native entry (the shared-cap sums add raw entries).
    const covered = new Set(packRows.map((r) => r.eggProduct));
    return [...packRows, ...eggLogs.filter((log) => !covered.has(log.product)).map(nativeRow)];
  }, [orderLines, skuMap, eggLogs, skusLoading]);

  // Stable primitive identity for the row set, so the reset effect doesn't refire
  // on every render just because a hook (e.g. usePackSKUs) hands back a fresh array
  // ref — which would loop setState → re-render → new rows → reset forever.
  const rowsKey = useMemo(() => rows.map((r) => r.key).join("|"), [rows]);

  // Sum of prior returns per outflow, so a 2nd partial return caps to what's
  // actually left (matches the server's cumulative cap) instead of the full sold qty.
  const priorByOutflow = usePriorReturns(Object.values(resolvedIds));

  // Resolved outflow id for a row's egg product (via its egg log).
  const outflowIdForProduct = (product: string): string | null => {
    const log = eggLogByProduct[product];
    return log ? resolvedIds[log.id] ?? null : null;
  };

  // Remaining returnable in the egg's NATIVE unit (minus prior returns).
  const remainingNativeForProduct = (product: string): number => {
    const log = eggLogByProduct[product];
    if (!log) return 0;
    const outflowId = resolvedIds[log.id];
    const prior = outflowId ? priorByOutflow[outflowId]?.total ?? 0 : 0;
    return remainingReturnable(log.quantity_butir, prior);
  };

  // Remaining returnable in a row's ENTRY unit: pieces for pack rows, native for
  // the loose/manual fallback. Shared across all rows of the same egg product.
  const remainingEntryForRow = (row: Row): number => {
    const native = remainingNativeForProduct(row.eggProduct);
    return row.pieces ? nativeToPieces(native, conversionMap[row.eggProduct]?.unit) : native;
  };

  const unitLabel = (product: string): "kg" | "butir" =>
    conversionMap[product]?.unit === "kg" ? "kg" : "butir";

  // Pack rows enter pieces; fallback rows enter the egg's native unit.
  const entryUnit = (row: Row) => (row.pieces ? "butir" : unitLabel(row.eggProduct));
  // Blank or unreadable -> 0 so it can be summed safely.
  const bucketQty = (row: Row, raw: string) => parseQtyInput(raw, entryUnit(row)) ?? 0;
  const isBrokenBucket = (row: Row, raw: string) => raw.trim() !== "" && parseQtyInput(raw, entryUnit(row)) == null;

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
      rows.forEach((row) => {
        init[row.key] = { ...EMPTY_LINE };
      });
      setLines(init);
      setReason("");
      setReturnDate(format(new Date(), "yyyy-MM-dd"));
    }
    // Depend on the stable primitive key, not the `rows` object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rowsKey]);

  // Resolve each log's outflow row id once on open (async). Feeds the cap and is
  // reused on confirm so we don't re-query. Cleared here, not in the reset effect:
  // ids key by log id, so a row-set change must not drop them (that wiped the
  // prior-returns cap when pack SKUs loaded after open).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResolvedIds({});
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

  // Sum of a row's three buckets.
  const lineSum = (row: Row, state: LineState): number =>
    bucketQty(row, state.restock) + bucketQty(row, state.retakan) + bucketQty(row, state.writeoff);

  // Rows mapping to the same egg product share that egg's returnable budget.
  const sameEggRows = (row: Row): Row[] =>
    rows.filter((r) => r.eggProduct === row.eggProduct);

  const setBucket = (
    row: Row,
    key: ReturnDisposition,
    raw: string,
    maxPieces: number
  ) => {
    // Allow only digits + one decimal separator.
    const cleaned = raw.replace(/[^0-9.,]/g, "");
    setLines((prev) => {
      const state = prev[row.key] ?? { ...EMPTY_LINE };
      const otherBuckets = lineSum(row, { ...state, [key]: "" }); // this row's other two buckets
      // Pieces already claimed by OTHER rows mapping to the same egg.
      const otherRowsPieces = sameEggRows(row)
        .filter((r) => r.key !== row.key)
        .reduce((sum, r) => sum + lineSum(r, prev[r.key] ?? EMPTY_LINE), 0);
      const num = bucketQty(row, cleaned);
      // Clamp so this bucket keeps the egg-group's TOTAL pieces within the cap.
      const room = Math.max(0, maxPieces - otherBuckets - otherRowsPieces);
      const next = num > room ? qtyInputText(room) : cleaned;
      return { ...prev, [row.key]: { ...state, [key]: next } };
    });
  };

  const enteredLines = rows.filter((row) => lineSum(row, lines[row.key] ?? EMPTY_LINE) > 0);

  // A number we can't read blocks the return, so it's never dropped beside valid buckets.
  const hasBrokenBucket = rows.some((row) =>
    BUCKETS.some(({ key }) => isBrokenBucket(row, (lines[row.key] ?? EMPTY_LINE)[key]))
  );

  const canSubmit = enteredLines.length > 0 && !saving && !hasBrokenBucket;

  const handleConfirm = async () => {
    if (!canSubmit) return;

    // Resolve every egg's outflow id first (the async fallback included): the
    // shared builder is synchronous.
    const outflowIdByProduct: Record<string, string | null> = {};
    const remainingNativeByProduct: Record<string, number> = {};
    const unitByProduct: Record<string, string | undefined> = {};
    const categoryByProduct: Record<string, InventoryCategory> = {};
    for (const row of enteredLines) {
      const product = row.eggProduct;
      if (product in outflowIdByProduct) continue;
      const log = eggLogByProduct[product];
      outflowIdByProduct[product] = log ? outflowIdForProduct(product) ?? (await findRelatedEntryId(log)) : null;
      remainingNativeByProduct[product] = remainingNativeForProduct(product);
      unitByProduct[product] = conversionMap[product]?.unit;
      if (log) categoryByProduct[product] = log.category;
    }

    const builderRows: ReturnRowInput[] = enteredLines.map((row) => {
      const state = lines[row.key] ?? EMPTY_LINE;
      return {
        key: row.key,
        skuCode: row.skuCode,
        eggProduct: row.eggProduct,
        // Pack rows entered pieces; fallback rows are already native.
        inPieces: row.pieces,
        buckets: {
          restock: bucketQty(row, state.restock),
          retakan: bucketQty(row, state.retakan),
          writeoff: bucketQty(row, state.writeoff),
        },
      };
    });
    const built = buildReturnLines({
      rows: builderRows,
      outflowIdByProduct,
      remainingNativeByProduct,
      unitByProduct,
      categoryByProduct,
      ids: () => makeId(),
    });
    if (!built.ok) {
      const row = enteredLines.find((r) => r.eggProduct === built.product);
      if (built.kind === "unresolved") {
        toast.error(t.activity.returnLineUnresolved.replace("{product}", row?.label ?? built.product));
      } else {
        toast.error(
          t.activity.returnOverMax
            .replace("{max}", (row ? remainingEntryForRow(row) : 0).toLocaleString())
            .replace("{unit}", row?.pieces ? "butir" : unitLabel(built.product))
        );
      }
      return;
    }
    const resolved = built.lines;

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

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t.activity.returnNoEggLines}
          </p>
        ) : (
          <div className="space-y-3 py-2">
            {rows.map((row) => {
              const state = lines[row.key] ?? EMPTY_LINE;
              const unit = entryUnit(row);
              // Shared egg budget minus what OTHER rows of the same egg already claimed.
              const eggMax = remainingEntryForRow(row);
              const otherRowsSum = sameEggRows(row)
                .filter((r) => r.key !== row.key)
                .reduce((s, r) => s + lineSum(r, lines[r.key] ?? EMPTY_LINE), 0);
              const max = Math.max(0, eggMax - otherRowsSum);
              const sum = lineSum(row, state);
              const hasQty = sum > 0;
              const atMax = hasQty && sum >= max;
              const hasRetakan = bucketQty(row, state.retakan) > 0;

              return (
                <div
                  key={row.key}
                  className={cn(
                    "rounded-lg border border-l-[3px] bg-card p-3 space-y-2.5 transition-colors",
                    hasQty ? "border-l-primary" : "border-l-border"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Egg className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="font-semibold truncate">{row.label}</span>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs tabular-nums">
                      {t.activity.returnSold}: {(row.soldPieces ?? max).toLocaleString()} {unit}
                    </Badge>
                  </div>

                  {/* Split the returned amount across the three dispositions at once. */}
                  <div className="grid grid-cols-3 gap-2">
                    {BUCKETS.map(({ key, icon: Icon, accent, focus }) => {
                      const val = state[key];
                      const active = bucketQty(row, val) > 0;
                      const broken = isBrokenBucket(row, val);
                      return (
                        <div key={key} className="space-y-1.5 min-w-0">
                          <Label
                            htmlFor={`ret-${key}-${row.key}`}
                            className={cn(
                              "flex items-center gap-1 text-xs font-medium",
                              active ? accent : "text-muted-foreground"
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{bucketLabel(key)}</span>
                          </Label>
                          <Input
                            id={`ret-${key}-${row.key}`}
                            inputMode="decimal"
                            placeholder="0"
                            value={val}
                            onChange={(e) => setBucket(row, key, e.target.value, eggMax)}
                            aria-describedby={`ret-sub-${row.key}`}
                            aria-invalid={broken || undefined}
                            className={cn(
                              "h-11 text-base tabular-nums text-center transition-colors",
                              active && focus,
                              broken && "border-destructive focus-visible:ring-destructive"
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
                  <div id={`ret-sub-${row.key}`} className="min-h-[16px]">
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
            {hasBrokenBucket ? (
              <p role="alert" className="text-xs text-red-600 sm:mr-auto sm:self-center">
                {t.inflow.invalidQty}
              </p>
            ) : (
              !canSubmit && !saving && (
                <p className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
                  {t.activity.returnNeedsQty}
                </p>
              )
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
