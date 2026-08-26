import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, X } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useInventorySync } from "@/hooks/useInventorySync";
import { useStockCounts } from "@/hooks/useStockCounts";
import { calculateStockSummary, getStockUnit } from "@/lib/inventory";
import {
  STOCK_LOCATIONS,
  StockLocation,
  resolveTolerance,
  computeVariance,
  totalOnHand,
  parseCountInput,
} from "@/lib/stockCount";
import { StockCountSaveEntry } from "@/types/stockCount";

// Raw string inputs keyed `${itemTypeId}:${location}` (blank = not counted).
type Draft = Record<string, string>;

const todayStr = () => format(new Date(), "yyyy-MM-dd");

export default function StockCount() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { itemTypes, conversionMap } = useItemTypes();
  const { inflows } = useInventorySync();

  const [countDate, setCountDate] = useState<string>(todayStr());
  const isToday = countDate === todayStr();
  const { records, saveCounts, deleteCounts } = useStockCounts(countDate);
  const [draft, setDraft] = useState<Draft>({});
  // itemType ids shown as count lines (only the items the staffer chose to count).
  const [lines, setLines] = useState<string[]>([]);
  const [toAdd, setToAdd] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Egg products only in v1.
  const eggs = useMemo(
    () => itemTypes.filter((it) => it.category === "egg"),
    [itemTypes]
  );
  const eggById = useMemo(() => {
    const m: Record<string, (typeof eggs)[number]> = {};
    for (const it of eggs) m[it.id] = it;
    return m;
  }, [eggs]);

  // System (ledger) stock per product — the JS-warehouse perpetual number.
  const systemStock = useMemo(() => {
    const summary = calculateStockSummary(inflows, conversionMap, {});
    const map: Record<string, number> = {};
    for (const s of summary) if (s.category === "egg") map[s.product] = s.totalStock;
    return map;
  }, [inflows, conversionMap]);

  // Seed the draft AND the visible lines from saved rows whenever the date's
  // records load. Lines = the distinct egg products that have a saved count for
  // this date (in catalog order for stability); on a past date this is the whole
  // read-only snapshot, on today it's the starting point the staffer adds to.
  useEffect(() => {
    const next: Draft = {};
    const seeded: string[] = [];
    for (const it of eggs) {
      const recs = records.filter((r) => r.itemTypeId === it.id);
      if (recs.length === 0) continue;
      seeded.push(it.id);
      for (const r of recs) next[`${r.itemTypeId}:${r.location}`] = String(r.quantity);
    }
    setDraft(next);
    setLines(seeded);
  }, [countDate, records, eggs]);

  const draftValue = (itemTypeId: string, loc: StockLocation): number | null =>
    parseCountInput(draft[`${itemTypeId}:${loc}`] ?? "");

  const setDraftValue = (itemTypeId: string, loc: StockLocation, v: string) =>
    setDraft((prev) => ({ ...prev, [`${itemTypeId}:${loc}`]: v }));

  // Eggs not yet added as a line — the dropdown's options.
  const available = useMemo(
    () => eggs.filter((it) => !lines.includes(it.id)),
    [eggs, lines]
  );

  const addLine = () => {
    if (!toAdd || lines.includes(toAdd)) return;
    setLines((prev) => [...prev, toAdd]);
    setToAdd("");
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((x) => x !== id));
    setDraft((prev) => {
      const next = { ...prev };
      for (const loc of STOCK_LOCATIONS) delete next[`${id}:${loc}`];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const entries: StockCountSaveEntry[] = [];
    // Only the items currently shown as lines get (re)saved.
    for (const id of lines) {
      const it = eggById[id];
      if (!it) continue;
      for (const loc of STOCK_LOCATIONS) {
        const val = draftValue(id, loc);
        if (val == null) continue; // blank = not counted -> no row
        entries.push({
          itemTypeId: it.id,
          product: it.name,
          category: it.category,
          location: loc,
          quantity: val,
          // Snapshot the ledger for the JS bucket only.
          systemQty: loc === "js_warehouse" ? systemStock[it.name] ?? 0 : null,
        });
      }
    }
    // Any previously-saved cell that is now blank (cell cleared OR its whole line
    // removed) gets deleted so a correction actually sticks.
    const clears: { itemTypeId: string; location: StockLocation }[] = [];
    for (const r of records) {
      if (draftValue(r.itemTypeId, r.location) == null) {
        clears.push({ itemTypeId: r.itemTypeId, location: r.location });
      }
    }

    let ok = await saveCounts(entries, user?.email ?? "");
    if (ok && clears.length > 0) ok = await deleteCounts(clears);
    setSaving(false);
    toast(ok ? { title: t.stockCount.saved } : { title: t.stockCount.saveError });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4 sm:px-6 max-w-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" /> {t.stockCount.back}
          </Button>
          <div className="ml-1">
            <h1 className="font-display font-bold text-lg leading-tight">{t.stockCount.title}</h1>
            <p className="text-xs text-muted-foreground">{t.stockCount.subtitle}</p>
          </div>
        </div>

        <div className="mb-4">
          <Input
            type="date"
            value={countDate}
            max={todayStr()}
            onChange={(e) => setCountDate(e.target.value || todayStr())}
            className="w-full sm:w-56"
          />
          {!isToday && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t.stockCount.readOnly}</p>
          )}
        </div>

        {eggs.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t.stockCount.empty}</CardContent></Card>
        ) : (
          <div className="space-y-2.5">
            {/* Add-line control (today only) */}
            {isToday && (
              <div className="flex items-center gap-2">
                <Select value={toAdd} onValueChange={setToAdd}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t.stockCount.addItemPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((it) => (
                      <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={addLine} disabled={!toAdd}>{t.stockCount.addLine}</Button>
              </div>
            )}

            {lines.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
                {isToday ? t.stockCount.noItemsYet : t.stockCount.noCountForDate}
              </CardContent></Card>
            ) : (
              lines.map((id) => {
                const it = eggById[id];
                if (!it) return null;
                const unit = getStockUnit(it.name, "egg", conversionMap);
                const counts: Partial<Record<StockLocation, number | null>> = {};
                for (const loc of STOCK_LOCATIONS) counts[loc] = draftValue(id, loc);
                const total = totalOnHand(counts);
                const physicalJs = counts.js_warehouse;
                const tol = resolveTolerance(it.countTolerance, unit);
                const sys = systemStock[it.name] ?? 0;
                const variance =
                  physicalJs != null ? computeVariance(physicalJs, sys, tol) : null;

                return (
                  <Card key={id}>
                    <CardContent className="p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-sm">{it.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-muted-foreground">{unit}</span>
                          {isToday && (
                            <button
                              type="button"
                              onClick={() => removeLine(id)}
                              title={t.stockCount.removeLine}
                              aria-label={t.stockCount.removeLine}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {STOCK_LOCATIONS.map((loc) => (
                          <div key={loc}>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                              {loc === "js_warehouse" ? t.stockCount.locationJs
                                : loc === "tst_warehouse" ? t.stockCount.locationTst
                                : t.stockCount.locationLoaded}
                            </div>
                            <Input
                              type="text"
                              inputMode="decimal"
                              disabled={!isToday}
                              value={draft[`${id}:${loc}`] ?? ""}
                              onChange={(e) => setDraftValue(id, loc, e.target.value)}
                              className="h-9 text-center"
                              placeholder="—"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-2.5 flex items-center justify-between text-[11px] pt-2 border-t border-dashed">
                        <span className="font-semibold">
                          {t.stockCount.totalOnHand}: {total.toLocaleString()} {unit}
                        </span>
                        {variance && (
                          <span
                            className={`px-2 py-0.5 rounded-full font-semibold ${
                              variance.status === "off"
                                ? "bg-destructive/10 text-destructive"
                                : variance.status === "within"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : "bg-success/15 text-success"
                            }`}
                          >
                            {variance.status === "off"
                              ? `${t.stockCount.off} ${variance.delta > 0 ? "+" : ""}${variance.delta.toLocaleString()}`
                              : variance.status === "within"
                              ? `≈ ${t.stockCount.withinTolerance} ${variance.delta > 0 ? "+" : ""}${variance.delta.toLocaleString()}`
                              : `✓ ${t.stockCount.matches}`}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}

            {isToday && lines.length > 0 && (
              <Button className="w-full mt-2" onClick={handleSave} disabled={saving}>
                {t.stockCount.save}
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
