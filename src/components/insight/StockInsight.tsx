import { useMemo } from "react";
import { Egg } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import type { InsightData } from "@/hooks/useInsightData";
import { addDays, localToday, toLocalDate } from "@/lib/buyerProfile";
import { EGG_FRESHNESS_DAYS, getStockUnit } from "@/lib/inventory";
import {
  Batch,
  Coverage,
  TREND_WEEKS,
  TURNOVER_RED_DAYS,
  ageBands,
  atRiskThisWeek,
  countVariance,
  dataAsOf,
  fifoAges,
  oldestBatches,
  periodSum,
  supplierName,
  turnoverDays,
  weeklySums,
} from "@/lib/insight";
import { resolveTolerance } from "@/lib/stockCount";
import { cn } from "@/lib/utils";
import type { InflowEntry, OutflowEntry, StockSummary } from "@/types/inventory";
import { Sparkline } from "./Sparkline";
import { CARD, CardHead, Delta, LegendDot, TABLE_HEAD } from "./ui";

interface StockInsightProps {
  stockSummary: StockSummary[];
  inflows: InflowEntry[];
  outflows: OutflowEntry[];
  freshnessDaysByProduct: Record<string, number>;
  data: InsightData;
  returnCov: Coverage;
  days: number;
  periodLabel: string;
  control: React.ReactNode;
}

const STOCK_GRID = "grid grid-cols-[minmax(150px,1.2fr)_82px_minmax(0,1fr)_86px_128px] items-center gap-3 px-[18px]";
const LOSS_GRID = "grid grid-cols-[minmax(140px,1.2fr)_1fr_1fr_110px] items-center gap-3 px-[18px]";

export function StockInsight({ stockSummary, inflows, outflows, freshnessDaysByProduct, data, returnCov, days, periodLabel, control }: StockInsightProps) {
  const { t, language } = useLanguage();
  const { itemTypes, conversionMap } = useItemTypes();
  const i = t.insight;
  const s = i.stock;
  const locale = language === "id" ? "id-ID" : "en-US";
  const today = localToday();
  const nf = (n: number, unit: string) => n.toLocaleString(locale, { maximumFractionDigits: unit === "kg" ? 1 : 0 });
  const qty = (n: number, unit: string) => `${nf(n, unit)} ${unit}`;
  const unitOf = (p: string) => getStockUnit(p, "egg", conversionMap);
  const freshnessOf = (p: string) => freshnessDaysByProduct[p] ?? EGG_FRESHNESS_DAYS;
  const fmtDay = (d: string) => toLocalDate(d).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  const fmtShort = (d: string) => toLocalDate(d).toLocaleDateString(locale, { day: "numeric", month: "short" });

  // (RETAKAN) children never go out as sales, so they'd sit on top of every
  // age list. They have their own card below.
  const eggs = useMemo(() => itemTypes.filter((it) => it.category === "egg" && !it.isRetakan), [itemTypes]);
  const batches = useMemo<Batch[]>(() => {
    const names = new Set(eggs.map((e) => e.name));
    return inflows
      .filter((b) => b.remainingButir > 0 && names.has(b.product))
      // A Penyesuaian Stok Fisik batch is stock, but it has no supplier.
      .map((b) => ({ id: b.id, product: b.product, date: b.date, remaining: b.remainingButir, supplier: b.stockAdjustmentId ? undefined : supplierName(b.invoiceSupplier) ?? undefined }));
  }, [inflows, eggs]);
  const ages = useMemo(() => fifoAges(data.deductions, outflows, inflows), [data.deductions, outflows, inflows]);
  const asOf = useMemo(() => dataAsOf(outflows.filter((o) => o.category === "egg" && !o.stockAdjustmentId).map((o) => o.date), today), [outflows, today]);

  const rows = useMemo(
    () =>
      eggs
        .map((it) => {
          const unit = unitOf(it.name);
          const mine = batches.filter((b) => b.product === it.name);
          return {
            name: it.name,
            unit,
            window: freshnessOf(it.name),
            stock: stockSummary.find((x) => x.product === it.name && x.category === "egg")?.totalStock ?? 0,
            bands: ageBands(mine, today, freshnessOf(it.name)),
            turnover: turnoverDays(ages, it.name, asOf, days),
            variance: countVariance(data.counts, it.name, 6, resolveTolerance(it.countTolerance, unit as "kg" | "butir")),
          };
        })
        .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eggs, batches, stockSummary, ages, asOf, days, data.counts, today, conversionMap, freshnessDaysByProduct]
  );

  const losses = useMemo(() => {
    const products = [...new Set(data.returns.filter((r) => r.disposition !== "restock").map((r) => r.product))].sort();
    const of = (p: string, d: string) => data.returns.filter((r) => r.product === p && r.disposition === d).map((r) => ({ date: r.date, qty: r.quantity }));
    return products.map((p) => ({
      product: p,
      unit: unitOf(p),
      retakan: periodSum(of(p, "retakan"), asOf, days, returnCov),
      writeoff: periodSum(of(p, "writeoff"), asOf, days, returnCov),
      trend: weeklySums([...of(p, "retakan"), ...of(p, "writeoff")], asOf, TREND_WEEKS, returnCov),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.returns, asOf, days, returnCov, conversionMap]);

  const atRisk = useMemo(() => atRiskThisWeek(batches, today, freshnessOf), [batches, today, freshnessDaysByProduct]); // eslint-disable-line react-hooks/exhaustive-deps
  const oldest = useMemo(() => oldestBatches(batches, today), [batches, today]);
  const asOfStart = addDays(asOf, -(days - 1));

  const lossCell = (c: { cur: number | null; delta: number | null }, unit: string) =>
    c.cur === null ? (
      <span className="text-ek-mfg">—</span>
    ) : (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <b className="tabular-nums">{qty(c.cur, unit)}</b>
        <Delta value={c.delta} format={(v) => nf(v, unit)} risingIsBad />
      </span>
    );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-7 pt-5">
        {control}
        <div className={CARD}>
          <CardHead
            pad
            title={s.ageTurnover}
            note={
              <>
                <LegendDot color="#a7d8c4" /> {s.band0} <LegendDot color="#f6c56b" /> {s.band1} <LegendDot color="#dc2626" /> {s.band2}
              </>
            }
          />
          <div className={cn(STOCK_GRID, TABLE_HEAD, "border-b border-ek-border pb-2 pt-2.5")}>
            <span>{s.product}</span>
            <span>{s.stockCol}</span>
            <span>{s.age}</span>
            <span>{s.turnover}</span>
            <span title={s.varianceHint}>{s.variance}</span>
          </div>
          {rows.map((r) => {
            const off = !!r.variance?.off;
            return (
              <div key={r.name} className={cn(STOCK_GRID, "min-h-14 border-b border-ek-border text-sm last:border-b-0")}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Egg className="h-4 w-4 shrink-0 text-amber-500" />
                  <b className="truncate text-[13.5px] font-semibold">{r.name}</b>
                </span>
                <span className="whitespace-nowrap tabular-nums text-ek-mfg">
                  {r.stock > 0 ? (
                    <>
                      <b className="text-ek-fg">{nf(r.stock, r.unit)}</b> {r.unit}
                    </>
                  ) : (
                    s.out
                  )}
                </span>
                {r.stock > 0 ? (
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" title={`${qty(r.bands.fresh, r.unit)} · ${qty(r.bands.mid, r.unit)} · ${qty(r.bands.risk, r.unit)}`}>
                      <i className="bg-[#a7d8c4]" style={{ flex: r.bands.fresh }} />
                      <i className="bg-[#f6c56b]" style={{ flex: r.bands.mid }} />
                      <i className="bg-red-600" style={{ flex: r.bands.risk }} />
                    </span>
                    <small className="text-xs text-ek-mfg">
                      {r.bands.risk > 0 ? (
                        <>
                          <b className="text-red-600">{qty(r.bands.risk, r.unit)}</b> {s.overDays.replace("{n}", String(r.window))}
                        </>
                      ) : (
                        s.allFresh
                      )}
                      {r.window !== EGG_FRESHNESS_DAYS && ` · ${s.windowNote.replace("{n}", String(r.window))}`}
                    </small>
                  </span>
                ) : (
                  <span className="text-ek-mfg">—</span>
                )}
                <span className="tabular-nums text-ek-mfg">
                  {r.turnover === null ? (
                    "—"
                  ) : (
                    <>
                      <b className={cn("text-[15px]", r.turnover >= TURNOVER_RED_DAYS ? "text-red-600" : "text-ek-fg")}>{r.turnover.toLocaleString(locale)}</b> {s.days}
                    </>
                  )}
                </span>
                <span className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[13px] tabular-nums text-ek-nav" title={s.varianceHint}>
                  {r.variance ? (
                    <>
                      <Sparkline values={r.variance.series} width={32} height={20} color={off ? "#dc2626" : "#7a6f63"} />
                      <span className={cn("truncate", off && "text-red-600")}>
                        {r.variance.latest > 0 ? "+" : r.variance.latest < 0 ? "−" : ""}
                        {qty(Math.abs(r.variance.latest), r.unit)}
                      </span>
                    </>
                  ) : (
                    <span className="text-ek-mfg">—</span>
                  )}
                </span>
              </div>
            );
          })}
          {data.counts.length > 0 && (
            <p className="px-[18px] py-2.5 text-[12.5px] text-ek-mfg">
              {s.varianceAsOf.replace("{date}", fmtShort(dataAsOf(data.counts.map((c) => c.countDate), today)))}
            </p>
          )}
        </div>

        <div className={cn(CARD, "mt-4")}>
          <CardHead pad title={s.cracks} note={s.cracksNote.replace("{period}", periodLabel)} />
          {returnCov.staleSince && (
            <p className="mx-[18px] mb-2 rounded-lg bg-ek-accent px-3 py-2 text-[13px] leading-[1.35] text-[#78350f]">
              {s.returnsStale.replace("{date}", fmtShort(returnCov.staleSince))}
            </p>
          )}
          <div className={cn(LOSS_GRID, TABLE_HEAD, "min-h-9 border-t border-ek-border")}>
            <span>{s.product}</span>
            <span>{s.retakan}</span>
            <span>{s.writeoff}</span>
            <span>{s.trend16}</span>
          </div>
          {losses.length === 0 && <p className="border-t border-ek-border px-[18px] py-3 text-sm text-ek-mfg">{i.notEnoughData}</p>}
          {losses.map((l) => (
            <div key={l.product} className={cn(LOSS_GRID, "min-h-12 border-t border-ek-border text-[13.5px]")}>
              <span className="flex min-w-0 items-center gap-2">
                <Egg className="h-4 w-4 shrink-0 text-amber-500" />
                <b className="truncate text-sm font-semibold">{l.product}</b>
              </span>
              {lossCell(l.retakan, l.unit)}
              {lossCell(l.writeoff, l.unit)}
              <Sparkline values={l.trend} width={110} height={22} color="#b45309" />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-ek-mfg">{s.outflowAsOf.replace("{from}", fmtShort(asOfStart)).replace("{to}", fmtShort(asOf))}</p>
      </div>

      <aside className="flex min-h-0 w-[280px] shrink-0 flex-col border-l border-ek-border bg-card">
        {/* pb-20: the last rows scroll clear of the floating chat button. */}
        <div className="flex-1 overflow-y-auto p-[18px] pb-20">
          <h3 className="mb-1.5 font-display text-[17px] font-semibold">{s.atRisk}</h3>
          <p className="mb-2.5 text-[13.5px] leading-[1.4] text-ek-mfg">{s.atRiskHint}</p>
          {atRisk.length === 0 && <p className="text-sm text-ek-mfg">{s.noneAtRisk}</p>}
          {atRisk.map((b) => {
            const now = b.crossDate === today;
            return (
              <div key={b.id} className="flex justify-between gap-2.5 border-b border-ek-border py-2.5 last:border-b-0">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <b className="text-sm font-semibold">{b.product}</b>
                  <span className="text-[12.5px] leading-[1.3] text-ek-mfg">
                    {s.inOn.replace("{date}", fmtDay(b.date))}
                    {b.supplier ? ` · ${b.supplier}` : ""}
                  </span>
                </div>
                <span className={cn("flex flex-col items-end whitespace-nowrap text-[13px] font-bold", now ? "text-red-600" : "text-amber-700")}>
                  {now ? s.today : fmtDay(b.crossDate)}
                  <small className="text-[12.5px] font-medium tabular-nums text-ek-mfg">{qty(b.remaining, unitOf(b.product))}</small>
                </span>
              </div>
            );
          })}
          <div className="my-3.5 h-px bg-ek-border" />
          <h3 className="mb-1.5 font-display text-[17px] font-semibold">{s.oldest}</h3>
          {oldest.map((b) => (
            <div key={b.id} className="flex justify-between gap-2.5 border-b border-ek-border py-2.5 last:border-b-0">
              <div className="flex min-w-0 flex-col gap-0.5">
                <b className="text-sm font-semibold">{b.product}</b>
                <span className="text-[12.5px] leading-[1.3] text-ek-mfg">
                  {fmtShort(b.date)}
                  {b.supplier ? ` · ${b.supplier}` : ""}
                </span>
              </div>
              <span className="flex flex-col items-end whitespace-nowrap text-[13px] font-bold text-red-600">
                {s.nDays.replace("{n}", String(b.age))}
                <small className="text-[12.5px] font-medium tabular-nums text-ek-mfg">{s.left.replace("{qty}", qty(b.remaining, unitOf(b.product)))}</small>
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
