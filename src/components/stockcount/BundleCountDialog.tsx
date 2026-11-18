// Count a product's stock as bundles instead of one hand-computed number.
//
// Why it exists: Stok Fisik takes a single figure per product per location, in the
// product's native unit. Counting Negeri meant someone summing iketan, iket and
// loose eggs into kilograms on paper — and that figure is what writes the stock
// adjustment, so an arithmetic slip there corrects the book the wrong way.
//
// It writes the TOTAL into the existing cell and nothing else: no change to
// stock_counts, to the save path, or to the adjustment RPC. The trade-off is that
// the breakdown is not persisted — what is saved is the number, as before.

import { useEffect, useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { parseQtyInput, STOCK_LOCATIONS, type StockLocation } from "@/lib/stockCount";
import {
  entryUnit, formUnitWord, sumCountedBundles, toNative, type EggForm,
} from "@/lib/eggForms";

const nf = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

export interface BundleCountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  /** Bundles that can be on the floor: countFormsFor(product, itemTypes). */
  forms: EggForm[];
  nativeUnit: "kg" | "butir" | "pcs";
  eggsPerUnit?: number;
  /** Which cell the dialog was opened from. */
  location: StockLocation;
  onApply: (location: StockLocation, total: number) => void;
}

export function BundleCountDialog({
  open, onOpenChange, productName, forms, nativeUnit, eggsPerUnit, location, onApply,
}: BundleCountDialogProps) {
  const { t } = useLanguage();
  const [loc, setLoc] = useState<StockLocation>(location);
  const [raw, setRaw] = useState<Record<string, string>>({});

  // A fresh tally each time it opens: a count is a moment, not a draft to resume.
  useEffect(() => {
    if (open) {
      setLoc(location);
      setRaw({});
    }
  }, [open, location]);

  // Weighed forms (Tonase) are excluded: their size is one delivery's scale reading,
  // not a property of a bundle sitting on a shelf.
  const countable = useMemo(() => forms.filter((f) => f.unit !== "weighed"), [forms]);

  const counts = useMemo(() => {
    const out: Record<string, number | null> = {};
    // entryUnit decides integers-vs-decimals: a bundle is counted in whole units,
    // while Curah is the native unit and takes a decimal comma.
    for (const f of countable) {
      out[f.id] = parseQtyInput(raw[f.id] ?? "", entryUnit(f, nativeUnit));
    }
    return out;
  }, [countable, raw, nativeUnit]);

  const { total, lines } = useMemo(
    () => sumCountedBundles({ forms: countable, counts, nativeUnit, eggsPerUnit }),
    [countable, counts, nativeUnit, eggsPerUnit]
  );

  const locLabel = (l: StockLocation) =>
    l === "js_warehouse" ? t.stockCount.locationJs
      : l === "tst_warehouse" ? t.stockCount.locationTst
      : t.stockCount.locationLoaded;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4 shrink-0" aria-hidden />
            {productName}
          </DialogTitle>
        </DialogHeader>

        <div role="group" aria-label={t.stockCount.colLocation} className="grid grid-cols-3 gap-1.5">
          {STOCK_LOCATIONS.map((l) => (
            <Button
              key={l}
              type="button"
              variant="outline"
              aria-pressed={l === loc}
              onClick={() => setLoc(l)}
              className={cn("h-10", l === loc && "border-primary bg-primary/10 font-semibold")}
            >
              {locLabel(l)}
            </Button>
          ))}
        </div>

        {countable.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.stockCount.noBundles}</p>
        ) : (
          <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-md border p-1">
            {countable.map((form) => {
              const count = counts[form.id];
              const native = count != null && count > 0
                ? toNative({ form, count, nativeUnit, eggsPerUnit })
                : null;
              return (
                <div key={form.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{form.name}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {native != null
                        ? `${nf(count!)} ${formUnitWord(form, nativeUnit)} → ${nf(native)} ${nativeUnit}`
                        : form.unit === "native"
                          ? t.stockCount.bundleNative.replace("{unit}", nativeUnit)
                          : `${nf(form.size ?? 0)} ${form.unit} / ${formUnitWord(form, nativeUnit)}`}
                    </p>
                  </div>
                  <Input
                    type="text"
                    inputMode="decimal"
                    aria-label={form.name}
                    placeholder="—"
                    value={raw[form.id] ?? ""}
                    onChange={(e) => setRaw((p) => ({ ...p, [form.id]: e.target.value }))}
                    className="h-10 w-[72px] shrink-0 text-center tabular-nums"
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-baseline justify-between rounded-md bg-muted px-3 py-2">
          <span className="text-[13px] font-semibold">{t.stockCount.bundleTotal}</span>
          <span className="font-display text-lg font-bold tabular-nums">
            {nf(total)} {nativeUnit}
          </span>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            // Nothing counted means nothing to write: applying 0 would read as a
            // counted zero and show up as a full-stock variance.
            disabled={lines === 0}
            onClick={() => { onApply(loc, total); onOpenChange(false); }}
          >
            {t.stockCount.bundleApply.replace("{loc}", locLabel(loc))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
