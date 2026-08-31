import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Calendar, AlertTriangle } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  parseCountInput,
} from "@/lib/stockCount";
import { StockCountSaveEntry } from "@/types/stockCount";

// Raw string inputs keyed `${itemTypeId}:${location}` (blank = not counted).
type Draft = Record<string, string>;

const todayStr = () => format(new Date(), "yyyy-MM-dd");
const fmt = (n: number) => n.toLocaleString();
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`;

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
  const [saving, setSaving] = useState(false);

  // Egg products only in v1 — the full roster shown as ledger rows.
  const eggs = useMemo(
    () => itemTypes.filter((it) => it.category === "egg"),
    [itemTypes]
  );

  // Live system (ledger) stock per product — the JS-warehouse perpetual number.
  const systemStock = useMemo(() => {
    const summary = calculateStockSummary(inflows, conversionMap, {});
    const map: Record<string, number> = {};
    for (const s of summary) if (s.category === "egg") map[s.product] = s.totalStock;
    return map;
  }, [inflows, conversionMap]);

  // Seed the draft from saved rows whenever the date's records load.
  useEffect(() => {
    const next: Draft = {};
    for (const r of records) next[`${r.itemTypeId}:${r.location}`] = String(r.quantity);
    setDraft(next);
  }, [countDate, records]);

  const draftValue = (itemTypeId: string, loc: StockLocation): number | null =>
    parseCountInput(draft[`${itemTypeId}:${loc}`] ?? "");

  const setDraftValue = (itemTypeId: string, loc: StockLocation, v: string) =>
    setDraft((prev) => ({ ...prev, [`${itemTypeId}:${loc}`]: v }));

  // JS-warehouse system stock to reconcile against. On a past date we use the
  // value snapshotted at save time (honest history); today we use live stock.
  const systemFor = (itemTypeId: string, product: string): number => {
    if (!isToday) {
      const rec = records.find(
        (r) => r.itemTypeId === itemTypeId && r.location === "js_warehouse"
      );
      if (rec && rec.systemQty != null) return rec.systemQty;
    }
    return systemStock[product] ?? 0;
  };

  // Per-row derived state: counts, JS-only variance, and % deviation.
  const rows = useMemo(() => {
    return eggs.map((it) => {
      const unit = getStockUnit(it.name, "egg", conversionMap);
      const js = draftValue(it.id, "js_warehouse");
      const tst = draftValue(it.id, "tst_warehouse");
      const loaded = draftValue(it.id, "loaded");
      const anyVal = js != null || tst != null || loaded != null;
      const sys = systemFor(it.id, it.name);
      const tol = resolveTolerance(it.countTolerance, unit);
      const variance = js != null ? computeVariance(js, sys, tol) : null;
      const pct = js != null && sys > 0 ? ((js - sys) / sys) * 100 : null;
      return { it, unit, js, tst, loaded, anyVal, sys, variance, pct };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eggs, draft, records, systemStock, isToday, conversionMap]);

  // Count-quality summary (never pools stock across products/units).
  const summary = useMemo(() => {
    const withJs = rows.filter((r) => r.variance);
    const offCount = withJs.filter((r) => r.variance!.status === "off").length;
    const meanDev =
      withJs.length > 0
        ? withJs.reduce((s, r) => s + Math.abs(r.pct ?? 0), 0) / withJs.length
        : 0;
    let worst: (typeof rows)[number] | null = null;
    for (const r of withJs) {
      if (!worst || Math.abs(r.pct ?? 0) > Math.abs(worst.pct ?? 0)) worst = r;
    }
    return { jsCounted: withJs.length, offCount, meanDev, worst };
  }, [rows]);

  const handleSave = async () => {
    setSaving(true);
    const entries: StockCountSaveEntry[] = [];
    for (const it of eggs) {
      for (const loc of STOCK_LOCATIONS) {
        const val = draftValue(it.id, loc);
        if (val == null) continue; // blank = not counted -> no row
        entries.push({
          itemTypeId: it.id,
          product: it.name,
          category: it.category,
          location: loc,
          quantity: val,
          systemQty: loc === "js_warehouse" ? systemStock[it.name] ?? 0 : null,
        });
      }
    }
    // Any previously-saved cell now blank gets deleted so a correction sticks.
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

  const devColor = (status: "match" | "within" | "off") =>
    status === "off"
      ? "text-destructive"
      : status === "within"
      ? "text-amber-600 dark:text-amber-400"
      : "text-success";

  const locLabel = (loc: StockLocation) =>
    loc === "js_warehouse" ? t.stockCount.locationJs
      : loc === "tst_warehouse" ? t.stockCount.locationTst
      : t.stockCount.locationLoaded;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4 sm:px-6 max-w-2xl">
        {/* Top bar: back + title + compact date chip */}
        <div className="flex items-center gap-2 mb-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="h-9 w-9 shrink-0">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg leading-tight">{t.stockCount.title}</h1>
            <p className="text-xs text-muted-foreground">{t.stockCount.subtitle}</p>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 rounded-lg border bg-card px-2 h-9 shrink-0">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <input
              type="date"
              value={countDate}
              max={todayStr()}
              onChange={(e) => setCountDate(e.target.value || todayStr())}
              className="bg-transparent text-xs font-semibold outline-none w-[104px]"
            />
          </div>
        </div>
        {!isToday && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">{t.stockCount.readOnly}</p>
        )}

        {eggs.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">{t.stockCount.empty}</CardContent></Card>
        ) : (
          <>
            {/* Count-quality summary — three stats, never pooled stock */}
            <div className="grid grid-cols-2 gap-px bg-border rounded-xl overflow-hidden border">
              <div className="bg-card p-2.5 text-center">
                <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{t.stockCount.sumOutOfTol}</div>
                <div className={`font-display font-semibold text-lg tabular-nums mt-0.5 ${summary.offCount > 0 ? "text-destructive" : ""}`}>
                  {summary.offCount}<span className="text-xs text-muted-foreground"> / {summary.jsCounted}</span>
                </div>
              </div>
              <div className="bg-card p-2.5 text-center">
                <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{t.stockCount.sumMeanDev}</div>
                <div className={`font-display font-semibold text-lg tabular-nums mt-0.5 ${summary.meanDev > 2 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                  {summary.meanDev.toFixed(1)}<span className="text-xs text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            {/* Largest deviation callout */}
            {summary.worst && summary.worst.variance!.status !== "match" && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-destructive/[0.07] text-xs text-destructive font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {t.stockCount.largestDev}: <b className="font-bold">{summary.worst.it.name} {summary.worst.pct! > 0 ? "+" : ""}{summary.worst.pct!.toFixed(1)}%</b>
                  {" "}({signed(summary.worst.variance!.delta)} {summary.worst.unit} {t.stockCount.ofWord} {fmt(summary.worst.sys)})
                </span>
              </div>
            )}

            {/* Ledger */}
            <div className="rounded-xl border bg-card overflow-hidden mt-3">
              <div className="grid grid-cols-[1fr_44px_44px_44px_60px] bg-muted">
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground px-3 py-2">{t.stockCount.colItem}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground py-2 text-center">{locLabel("js_warehouse")}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground py-2 text-center">{locLabel("tst_warehouse")}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground py-2 text-center">{locLabel("loaded")}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground py-2 text-center">{t.stockCount.colDev}</span>
              </div>

              {rows.map(({ it, unit, sys, variance, pct }) => (
                <div key={it.id} className="grid grid-cols-[1fr_44px_44px_44px_60px] border-t">
                  <div className="px-3 py-2 min-w-0 self-center">
                    <div className="text-[12.5px] font-semibold truncate">{it.name}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {unit} · {t.stockCount.expShort} {fmt(sys)}
                    </div>
                  </div>
                  {STOCK_LOCATIONS.map((loc) => (
                    <div key={loc} className="border-l">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={!isToday}
                        value={draft[`${it.id}:${loc}`] ?? ""}
                        onChange={(e) => setDraftValue(it.id, loc, e.target.value)}
                        placeholder="—"
                        className="w-full h-12 bg-transparent text-center text-[13px] font-semibold tabular-nums outline-none focus:bg-primary/5 placeholder:text-muted-foreground/50 disabled:cursor-default"
                      />
                    </div>
                  ))}
                  <div className="border-l flex flex-col items-center justify-center gap-0.5 px-1">
                    {variance ? (
                      <>
                        <span className={`text-[12px] font-bold tabular-nums leading-none ${devColor(variance.status)}`}>
                          {signed(variance.delta)}
                        </span>
                        {pct != null && (
                          <span className="text-[9px] text-muted-foreground tabular-nums leading-none">
                            {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground text-sm leading-none">·</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Tolerance legend */}
            <div className="flex items-center gap-3 mt-2.5 px-1 text-[10.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-success" />{t.stockCount.matches}</span>
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />{t.stockCount.withinTolerance}</span>
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-destructive" />{t.stockCount.off}</span>
            </div>

            {isToday && (
              <Button className="w-full mt-3 h-12" onClick={handleSave} disabled={saving}>
                {t.stockCount.save}
              </Button>
            )}

            <p className="text-[11px] text-muted-foreground text-center mt-3">{t.stockCount.footNote}</p>
          </>
        )}
      </main>
    </div>
  );
}
