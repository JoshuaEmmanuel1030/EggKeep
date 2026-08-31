import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Calendar, AlertTriangle, ArrowUp, ArrowDown, Plus, Check } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useInventorySync } from "@/hooks/useInventorySync";
import { useStockCounts } from "@/hooks/useStockCounts";
import { supabase } from "@/integrations/supabase/client";
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
const pctStr = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

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
  const [lines, setLines] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prior, setPrior] = useState<{ accuracy: number; date: string } | null>(null);

  const eggs = useMemo(
    () => itemTypes.filter((it) => it.category === "egg"),
    [itemTypes]
  );
  const eggById = useMemo(() => {
    const m: Record<string, (typeof eggs)[number]> = {};
    for (const it of eggs) m[it.id] = it;
    return m;
  }, [eggs]);

  // Live system (ledger) stock per product — the JS-warehouse perpetual number.
  const systemStock = useMemo(() => {
    const summary = calculateStockSummary(inflows, conversionMap, {});
    const map: Record<string, number> = {};
    for (const s of summary) if (s.category === "egg") map[s.product] = s.totalStock;
    return map;
  }, [inflows, conversionMap]);

  // Seed draft + visible lines from saved rows whenever the date's records load.
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

  // Previous count's accuracy, for the trend chip (uses that count's stored
  // system_qty snapshot). Hidden until there is a prior count to compare to.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: dates } = await supabase
        .from("stock_counts")
        .select("count_date")
        .lt("count_date", countDate)
        .order("count_date", { ascending: false })
        .limit(1);
      const pd = dates?.[0]?.count_date;
      if (!pd) { if (active) setPrior(null); return; }
      const { data: rows } = await supabase
        .from("stock_counts")
        .select("quantity, system_qty")
        .eq("count_date", pd)
        .eq("location", "js_warehouse");
      const devs: number[] = [];
      for (const r of rows ?? []) {
        const s = r.system_qty != null ? Number(r.system_qty) : 0;
        if (s > 0) devs.push(Math.abs(Number(r.quantity) - s) / s);
      }
      const acc = devs.length ? (1 - devs.reduce((a, b) => a + b, 0) / devs.length) * 100 : null;
      if (active) setPrior(acc != null ? { accuracy: acc, date: pd } : null);
    })();
    return () => { active = false; };
  }, [countDate, records]);

  const draftValue = (itemTypeId: string, loc: StockLocation): number | null =>
    parseCountInput(draft[`${itemTypeId}:${loc}`] ?? "");

  const setDraftValue = (itemTypeId: string, loc: StockLocation, v: string) =>
    setDraft((prev) => ({ ...prev, [`${itemTypeId}:${loc}`]: v }));

  const systemFor = (itemTypeId: string, product: string): number => {
    if (!isToday) {
      const rec = records.find(
        (r) => r.itemTypeId === itemTypeId && r.location === "js_warehouse"
      );
      if (rec && rec.systemQty != null) return rec.systemQty;
    }
    return systemStock[product] ?? 0;
  };

  const addLine = (id: string) =>
    setLines((prev) => (prev.includes(id) ? prev : [...prev, id]));

  // Per-line derived state.
  const rows = useMemo(() => {
    return lines.map((id) => {
      const it = eggById[id];
      const unit = it ? getStockUnit(it.name, "egg", conversionMap) : "butir";
      const js = draftValue(id, "js_warehouse");
      const anyVal =
        js != null || draftValue(id, "tst_warehouse") != null || draftValue(id, "loaded") != null;
      const sys = it ? systemFor(id, it.name) : 0;
      const tol = it ? resolveTolerance(it.countTolerance, unit) : 0;
      const variance = js != null ? computeVariance(js, sys, tol) : null;
      const pct = js != null && sys > 0 ? ((js - sys) / sys) * 100 : null;
      return { id, it, unit, js, anyVal, sys, variance, pct };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, draft, records, systemStock, isToday, conversionMap, eggById]);

  // Count-quality KPIs — each product's own deviation ratio, averaged (never pooled).
  const kpi = useMemo(() => {
    const withVar = rows.filter((r) => r.variance);
    const withPct = rows.filter((r) => r.pct != null);
    const accuracy =
      withPct.length > 0
        ? 100 - withPct.reduce((s, r) => s + Math.abs(r.pct!), 0) / withPct.length
        : null;
    const netBias =
      withPct.length > 0
        ? withPct.reduce((s, r) => s + r.pct!, 0) / withPct.length
        : null;
    const offCount = withVar.filter((r) => r.variance!.status === "off").length;
    const entered = rows.filter((r) => r.anyVal).length;
    let worst: (typeof rows)[number] | null = null;
    for (const r of withPct) {
      if (!worst || Math.abs(r.pct!) > Math.abs(worst.pct!)) worst = r;
    }
    return { accuracy, netBias, offCount, jsCounted: withVar.length, entered, worst };
  }, [rows]);

  const handleSave = async () => {
    setSaving(true);
    const entries: StockCountSaveEntry[] = [];
    for (const id of lines) {
      const it = eggById[id];
      if (!it) continue;
      for (const loc of STOCK_LOCATIONS) {
        const val = draftValue(id, loc);
        if (val == null) continue;
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

  const accuracyColor =
    kpi.accuracy == null
      ? "text-muted-foreground"
      : kpi.accuracy >= 95
      ? "text-success"
      : kpi.accuracy >= 90
      ? "text-amber-600 dark:text-amber-400"
      : "text-destructive";
  const accuracyFill =
    kpi.accuracy == null
      ? "bg-border"
      : kpi.accuracy >= 95
      ? "bg-success"
      : kpi.accuracy >= 90
      ? "bg-amber-500"
      : "bg-destructive";
  const bandOn = kpi.accuracy != null ? Math.min(10, Math.max(0, Math.floor(kpi.accuracy / 10))) : 0;
  const trendPts = kpi.accuracy != null && prior ? kpi.accuracy - prior.accuracy : null;

  const netColor =
    kpi.netBias == null
      ? ""
      : Math.abs(kpi.netBias) > 2
      ? "text-destructive"
      : Math.abs(kpi.netBias) > 0.5
      ? "text-amber-600 dark:text-amber-400"
      : "text-success";
  const netDesc =
    kpi.netBias == null
      ? ""
      : kpi.netBias < -0.05
      ? t.stockCount.runningShort
      : kpi.netBias > 0.05
      ? t.stockCount.runningOver
      : t.stockCount.balanced;

  const devColor = (status: "match" | "within" | "off") =>
    status === "off" ? "text-destructive"
      : status === "within" ? "text-amber-600 dark:text-amber-400"
      : "text-success";

  const locLabel = (loc: StockLocation) =>
    loc === "js_warehouse" ? t.stockCount.locationJs
      : loc === "tst_warehouse" ? t.stockCount.locationTst
      : t.stockCount.locationLoaded;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4 sm:px-6 max-w-2xl">
        {/* Top bar */}
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
            {/* Accuracy hero */}
            <Card>
              <CardContent className="p-4 pb-3.5">
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t.stockCount.accuracyLabel}
                  <span className="font-semibold normal-case tracking-normal opacity-80">· {t.stockCount.jsVsSystem}</span>
                </div>
                {kpi.accuracy == null ? (
                  <div className="text-sm text-muted-foreground mt-2">{t.stockCount.accuracyEmpty}</div>
                ) : (
                  <>
                    <div className="flex items-end gap-2 mt-1.5">
                      <span className={`font-display font-semibold text-4xl leading-none tabular-nums ${accuracyColor}`}>
                        {kpi.accuracy.toFixed(1)}<span className="text-xl">%</span>
                      </span>
                      {trendPts != null && (
                        <span className={`flex items-center gap-0.5 mb-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${trendPts >= 0 ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive"}`}>
                          {trendPts >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                          {Math.abs(trendPts).toFixed(1)} pts
                        </span>
                      )}
                      <span className="ml-auto mb-1 text-[10.5px] font-semibold text-muted-foreground border rounded-full px-2 py-0.5">
                        {t.stockCount.targetLabel}
                      </span>
                    </div>
                    <div className="flex gap-0.5 mt-3">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <span key={i} className={`flex-1 h-1 rounded-full ${i < bandOn ? accuracyFill : "bg-border"}`} />
                      ))}
                    </div>
                    <div className="flex justify-between mt-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>
                        {prior
                          ? `${t.stockCount.vsWord} ${prior.accuracy.toFixed(1)}% ${t.stockCount.lastCountLabel} · ${format(new Date(prior.date + "T00:00:00"), "d MMM")}`
                          : ""}
                      </span>
                      <span>{kpi.jsCounted} {t.stockCount.itemsWord}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Net bias + out of tolerance */}
            <div className="grid grid-cols-2 gap-px bg-border rounded-xl overflow-hidden border mt-2">
              <div className="bg-card p-2.5">
                <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{t.stockCount.netBias}</div>
                <div className={`font-display font-semibold text-xl tabular-nums mt-0.5 ${netColor}`}>
                  {kpi.netBias == null ? "—" : pctStr(kpi.netBias)}
                </div>
                {netDesc && <div className="text-[10.5px] text-muted-foreground mt-0.5">{netDesc}</div>}
              </div>
              <div className="bg-card p-2.5">
                <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{t.stockCount.outOfTolerance}</div>
                <div className={`font-display font-semibold text-xl tabular-nums mt-0.5 ${kpi.offCount > 0 ? "text-destructive" : ""}`}>
                  {kpi.offCount}<span className="text-xs text-muted-foreground"> / {kpi.jsCounted}</span>
                </div>
                {kpi.offCount > 0 && <div className="text-[10.5px] text-muted-foreground mt-0.5">{t.stockCount.needsRecount}</div>}
              </div>
            </div>

            {/* Largest deviation */}
            {kpi.worst && kpi.worst.variance!.status !== "match" && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-destructive/[0.07] text-xs text-destructive font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {t.stockCount.largestDev}: <b className="font-bold">{kpi.worst.it?.name} {pctStr(kpi.worst.pct!)}</b>
                  {" "}({signed(kpi.worst.variance!.delta)} {kpi.worst.unit} {t.stockCount.ofWord} {fmt(kpi.worst.sys)})
                </span>
              </div>
            )}

            {/* Ledger — only added lines */}
            <div className="rounded-xl border bg-card overflow-hidden mt-3">
              <div className="grid grid-cols-[1fr_44px_44px_44px_60px] bg-muted">
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground px-3 py-2">{t.stockCount.colItem}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground py-2 text-center">{locLabel("js_warehouse")}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground py-2 text-center">{locLabel("tst_warehouse")}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground py-2 text-center">{locLabel("loaded")}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground py-2 text-center">{t.stockCount.colDev}</span>
              </div>

              {rows.map(({ id, it, unit, sys, variance, pct }) => (
                <div key={id} className="grid grid-cols-[1fr_44px_44px_44px_60px] border-t">
                  <div className="px-3 py-2 min-w-0 self-center">
                    <div className="text-[12.5px] font-semibold truncate">{it?.name}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">{unit} · {t.stockCount.expShort} {fmt(sys)}</div>
                  </div>
                  {STOCK_LOCATIONS.map((loc) => (
                    <div key={loc} className="border-l">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={!isToday}
                        value={draft[`${id}:${loc}`] ?? ""}
                        onChange={(e) => setDraftValue(id, loc, e.target.value)}
                        placeholder="—"
                        className="w-full h-12 bg-transparent text-center text-[13px] font-semibold tabular-nums outline-none focus:bg-primary/5 placeholder:text-muted-foreground/50 disabled:cursor-default"
                      />
                    </div>
                  ))}
                  <div className="border-l flex flex-col items-center justify-center gap-0.5 px-1">
                    {variance ? (
                      <>
                        <span className={`text-[12px] font-bold tabular-nums leading-none ${devColor(variance.status)}`}>{signed(variance.delta)}</span>
                        {pct != null && <span className="text-[9px] text-muted-foreground tabular-nums leading-none">{pctStr(pct)}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground text-sm leading-none">·</span>
                    )}
                  </div>
                </div>
              ))}

              {isToday && (
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <button className="w-full flex items-center gap-2.5 h-12 px-3 border-t bg-primary/5 text-[13px] font-semibold text-primary">
                      <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground shrink-0">
                        <Plus className="h-3 w-3" />
                      </span>
                      {t.stockCount.addItemLine}
                      <span className="ml-auto text-[10.5px] font-medium text-muted-foreground">
                        {kpi.entered} {t.stockCount.ofWord} {eggs.length} {t.stockCount.productsEntered}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="p-0 w-[calc(100vw-3rem)] max-w-[360px]">
                    <Command>
                      <CommandInput placeholder={t.stockCount.searchPlaceholder} />
                      <CommandList>
                        <CommandEmpty>{t.stockCount.noResults}</CommandEmpty>
                        <CommandGroup>
                          {eggs.map((it) => {
                            const added = lines.includes(it.id);
                            const unit = getStockUnit(it.name, "egg", conversionMap);
                            const sys = systemStock[it.name] ?? 0;
                            return (
                              <CommandItem
                                key={it.id}
                                value={it.name}
                                disabled={added}
                                onSelect={() => { addLine(it.id); setPickerOpen(false); }}
                                className={`flex items-center gap-2 ${added ? "opacity-45" : ""}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-semibold truncate">{it.name}</div>
                                  <div className="text-[10.5px] text-muted-foreground tabular-nums">
                                    {added ? t.stockCount.alreadyEntered : `${unit} · ${t.stockCount.systemWord} ${fmt(sys)}`}
                                  </div>
                                </div>
                                {added ? <Check className="h-4 w-4 text-muted-foreground" /> : <Plus className="h-4 w-4 text-primary" />}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {lines.length > 0 && (
              <div className="flex items-center gap-3 mt-2.5 px-1 text-[10.5px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-success" />{t.stockCount.matches}</span>
                <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />{t.stockCount.withinTolerance}</span>
                <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-destructive" />{t.stockCount.off}</span>
              </div>
            )}

            {isToday && lines.length > 0 && (
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
