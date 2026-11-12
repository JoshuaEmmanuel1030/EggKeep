import { useCallback, useEffect, useState } from "react";
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
import { toast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  AdjustmentLine,
  CONFIRM_WORD,
  adjustmentErrorCode,
  applyAdjustment,
  fetchAdjustmentPreview,
} from "@/lib/stockAdjustment";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the adjustment is saved (refresh stock). */
  onApplied: () => void;
}

// Native unit only, as on the Stok Fisik page (no kg↔butir conversion here).
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const signed = (n: number) => `${n > 0 ? "+" : ""}${fmt(n)}`;
const unitLabel = (unit: string | null) => (unit === "kg" ? "kg" : "butir");

/**
 * Penyesuaian Stok Fisik: preview of today's count against EggKeep at
 * yesterday's close, applied only after the admin types SESUAIKAN.
 */
export function StockAdjustmentDialog({ open, onOpenChange, onApplied }: Props) {
  const { t } = useLanguage();
  const s = t.stockCount;
  const [lines, setLines] = useState<AdjustmentLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [word, setWord] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLines(await fetchAdjustmentPreview());
    } catch (e) {
      console.error("Error loading stock adjustment preview:", e);
      setLines([]);
      toast({ title: s.adjustError, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [s.adjustError]);

  useEffect(() => {
    if (!open) return;
    setWord("");
    load();
  }, [open, load]);

  const nothingToDo = !loading && lines.length > 0 && lines.every((l) => l.applied === 0);
  const canConfirm =
    word.trim().toUpperCase() === CONFIRM_WORD && !busy && !loading && lines.length > 0 && !nothingToDo;

  const confirm = async () => {
    setBusy(true);
    try {
      await applyAdjustment(lines);
      toast({ title: s.adjustSuccess });
      onApplied();
      onOpenChange(false);
    } catch (e) {
      const code = adjustmentErrorCode(e);
      if (code === "PREVIEW_STALE") {
        toast({ title: s.adjustStale });
        setWord("");
        await load();
      } else if (code === "NOTHING_TO_ADJUST") {
        toast({ title: s.adjustNothing });
        onOpenChange(false);
      } else {
        console.error("Error applying stock adjustment:", e);
        toast({
          title: code === "NOT_ADMIN" ? s.adjustNotAdmin : code === "NO_COUNT_TODAY" ? s.adjustNoCount : s.adjustError,
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{s.adjustTitle}</DialogTitle>
          <DialogDescription>{s.adjustIntro}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{s.adjustLoading}</p>
        ) : (
          <div className="max-h-[50vh] overflow-auto rounded-lg border">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-bold px-2 py-1.5">{s.adjustColItem}</th>
                  <th className="text-right font-bold px-2 py-1.5">{s.adjustColPhysical}</th>
                  <th className="text-right font-bold px-2 py-1.5">{s.adjustColBook}</th>
                  <th className="text-right font-bold px-2 py-1.5">{s.adjustColChange}</th>
                  <th className="text-right font-bold px-2 py-1.5">{s.adjustColAfter}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.item_type_id} data-testid={`adj-line-${l.product}`} className="border-t align-top">
                    <td className="px-2 py-1.5">
                      <div className="font-semibold">{l.product}</div>
                      <div className="text-[10px] text-muted-foreground">{unitLabel(l.unit)}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right">{fmt(l.target)}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(l.book_at_count)}</td>
                    <td
                      className={`px-2 py-1.5 text-right font-bold ${
                        l.applied < 0 ? "text-destructive" : l.applied > 0 ? "text-success" : "text-muted-foreground"
                      }`}
                    >
                      <div>{signed(l.applied)}</div>
                      {l.shortfall > 0 && (
                        <div className="text-[10px] font-semibold text-destructive">
                          {s.adjustShortfall} {fmt(l.shortfall)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">{fmt(l.book_now + l.applied)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nothingToDo && <p className="text-sm text-muted-foreground">{s.adjustNothing}</p>}

        <label className="text-sm space-y-1.5 block">
          <span>
            {s.adjustTypeToConfirm} <b className="font-mono">{CONFIRM_WORD}</b>
          </span>
          <Input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            disabled={busy}
          />
        </label>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {s.adjustCancel}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={!canConfirm}>
            {s.adjustConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
