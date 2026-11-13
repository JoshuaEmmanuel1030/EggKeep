import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, Calculator, ChevronRight, Egg, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { addDays, localToday, nextLikelyWeekday, skuShares, toLocalDate, typicalDay, weekdayOf } from "@/lib/buyerProfile";
import { RETURN_REASON_LABEL_ID } from "@/lib/deliveryExport";
import {
  BuyerSummary,
  Coverage,
  KasCustomer,
  RELIABILITY_MIN_LOGGED,
  RETURN_RATE_RED,
  TREND_WEEKS,
  basketBreadth,
  isComparable,
  leadTime,
  reliability,
  returnSpike,
  weekEnd,
  weeklyCounts,
} from "@/lib/insight";
import { kasDateLabel } from "@/lib/kasTunai";
import { cn } from "@/lib/utils";
import type { InsightData } from "@/hooks/useInsightData";
import { useItemTypes } from "@/hooks/useItemTypes";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { getStockUnit } from "@/lib/inventory";
import { hueOf } from "./BuyerList";
import { IdentityTile } from "./IdentityTile";
import { WeeklyBars } from "./WeeklyBars";
import { CARD, CardHead, Delta, LegendDot, Stat } from "./ui";

interface BuyerProfileProps {
  b: BuyerSummary;
  asOf: string;
  cov: Coverage;
  days: number;
  periodLabel: string;
  data: InsightData;
  returnedIds: Set<string>;
  returnCov: Coverage;
  customers: KasCustomer[];
  customer: KasCustomer | null;
  kasTransactions: { total: number; named: number };
  onSelect: (id: string) => void;
}

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

// 18 Oct 2026 is a Sunday, so 18 + wd is weekday wd.
const useDayName = () => {
  const { language } = useLanguage();
  const locale = language === "id" ? "id-ID" : "en-US";
  return (wd: number, style: "short" | "long") => new Date(2026, 9, 18 + wd).toLocaleDateString(locale, { weekday: style });
};

const joinAnd = (xs: string[], and: string) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}` : xs[0] ?? "");

export function BuyerProfile(props: BuyerProfileProps) {
  const { b, asOf, days, cov } = props;
  const { t, language } = useLanguage();
  const i = t.insight;
  const locale = language === "id" ? "id-ID" : "en-US";
  const dayName = useDayName();
  const isPo = b.kind === "po";
  const isAll = b.kind === "cashAll";
  const fmtDate = (s: string) => kasDateLabel(s, locale);
  const fmtMonth = (s: string) => toLocalDate(s).toLocaleDateString(locale, { month: "short", year: "numeric" });

  const usualDays = MONDAY_FIRST.filter((w) => b.pattern[w].usual);
  const usualNames = joinAnd(usualDays.map((w) => dayName(w, "long")), i.and);
  const usualShort = joinAnd(usualDays.map((w) => dayName(w, "short")), i.and);

  let sub: string;
  if (isAll) sub = i.cash.aggregateSub;
  else if (isPo) {
    const dcs = new Set(b.orders.map((o) => o.dcName).filter(Boolean)).size;
    sub = [i.poSince.replace("{date}", b.firstDate ? fmtMonth(b.firstDate) : "—"), dcs ? `${dcs} DC` : ""].filter(Boolean).join(" · ");
  } else sub = b.isNew ? i.cash.firstCame.replace("{date}", fmtDate(b.firstDate as string)) : i.cash.since.replace("{date}", b.firstDate ? fmtMonth(b.firstDate) : "—");

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-7 pt-5">
      <div className="mb-3.5 flex items-center gap-3.5">
        <IdentityTile name={b.name} hue={hueOf(b)} round={!isPo} large icon={isAll ? <Calculator className="h-6 w-6" /> : undefined} />
        <div className="min-w-0">
          <h2 className="truncate font-display text-[26px] font-semibold tracking-[-0.02em]">{b.name}</h2>
          <div className="mt-1 text-[13.5px] text-ek-mfg">{sub}</div>
        </div>
      </div>

      {b.late !== null && (
        <div className={cn("mb-3.5 flex gap-2.5 rounded-[13px] py-2.5 pl-3.5 pr-2.5 text-sm leading-[1.4]", isPo ? "bg-ek-accent text-[#78350f]" : "bg-[#fef2f2] text-red-700")}>
          <History className="mt-px h-[18px] w-[18px] shrink-0" />
          <span>
            <b>{i.overdue.replace("{n}", String(b.late))}</b>{" "}
            {(isPo ? i.usuallyOrders : i.usuallyComes).replace("{days}", usualNames)}{" "}
            {(isPo ? i.noOrderSince : i.lastCame).replace("{date}", fmtDate(b.lastDate as string))}
          </span>
        </div>
      )}

      <TrendCard {...props} />
      <div className="grid grid-cols-2 gap-3.5">
        {isAll ? <TopProducts {...props} /> : <UsualCard {...props} />}
        {isPo ? <ReliabilityCard {...props} /> : isAll ? <NewVsReturning {...props} /> : <CustomerCard {...props} />}
      </div>
      {!isAll && <RhythmCard b={b} usualNames={usualShort} />}
    </div>
  );
}

function TrendCard({ b, asOf, cov, days, periodLabel, kasTransactions }: BuyerProfileProps) {
  const { t, language } = useLanguage();
  const i = t.insight;
  const locale = language === "id" ? "id-ID" : "en-US";
  const nf = (n: number, digits = 1) => n.toLocaleString(locale, { maximumFractionDigits: digits });
  const isPo = b.kind === "po";
  const isAll = b.kind === "cashAll";
  const values = useMemo(() => weeklyCounts(b.orders.map((o) => o.outflowDate), asOf, TREND_WEEKS, cov), [b.orders, asOf, cov]);
  const labelOf = (n: number) => toLocalDate(weekEnd(asOf, n, TREND_WEEKS)).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const breadth = useMemo(() => basketBreadth(b.orders, asOf, days), [b.orders, asOf, days]);
  const lead = useMemo(() => leadTime(b.orders), [b.orders]);

  // Fewer than 2 orders, or a previous period the data doesn't reach: no delta at all.
  const enough = b.orders.length >= 2 && b.compare.delta !== null;
  const countSub = enough ? <Delta value={b.compare.delta} big /> : <span>{i.notEnoughData}</span>;
  const title = isAll ? i.trendTransactions : isPo ? i.trend : i.trendVisits;

  return (
    <div className={cn(CARD, "mb-3.5 px-[18px] py-4")}>
      <CardHead
        title={title}
        note={
          <>
            {i.perWeek} · <LegendDot color="#d97706" /> {i.lastPeriod.replace("{period}", periodLabel)} <LegendDot color="#c9bca9" /> {i.previous}
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_190px] items-end gap-[22px]">
        <WeeklyBars values={values} currentWeeks={days / 7} labelOf={labelOf} format={(v) => nf(v, 0)} noDataLabel={i.noDataWeek} />
        <div className="flex flex-col gap-3">
          {isAll ? (
            <>
              <Stat label={i.cash.transactions} value={b.compare.cur} sub={countSub} />
              <Stat label={i.cash.perDay} value={nf((b.compare.cur as number) / days)} sub={i.average} />
              <Stat
                label={i.cash.named}
                value={kasTransactions.total ? `${Math.round((kasTransactions.named / kasTransactions.total) * 100)}%` : "—"}
                sub={i.cash.ofTransactions}
              />
            </>
          ) : isPo ? (
            <>
              <Stat label={i.orders} value={b.compare.cur} sub={countSub} />
              <Stat
                label={i.skuPerOrder}
                value={breadth.cur === null ? "—" : nf(breadth.cur)}
                sub={breadth.prev === null || !enough ? undefined : i.from.replace("{n}", nf(breadth.prev))}
              />
              <Stat label={i.leadTime} value={lead === null ? "—" : i.nDays.replace("{n}", nf(lead))} sub={lead === null ? i.leadTimeNoData : i.average} />
            </>
          ) : (
            <>
              <Stat label={i.cash.visits} value={b.compare.cur} sub={countSub} />
              <Stat
                label={i.cash.productsPerVisit}
                value={breadth.cur === null ? "—" : nf(breadth.cur)}
                sub={breadth.prev === null || !enough ? undefined : i.from.replace("{n}", nf(breadth.prev))}
              />
              <Stat
                label={i.cash.lastCame}
                value={<span className="text-[17px]">{b.lastDate ? toLocalDate(b.lastDate).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }) : "—"}</span>}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ShareRow({ lead, name, qty, share, shareLabel }: { lead: React.ReactNode; name: string; qty: string; share: number; shareLabel: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-[5px] border-t border-ek-border py-[9px] text-sm first:border-t-0">
      {lead}
      <span className="truncate text-ek-nav">{name}</span>
      <span className="whitespace-nowrap font-bold tabular-nums">{qty}</span>
      <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-ek-muted">
        <i className="block h-full rounded-full bg-amber-500" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span className="whitespace-nowrap text-right text-xs text-ek-mfg">{shareLabel}</span>
    </div>
  );
}

function UsualCard({ b, asOf }: BuyerProfileProps) {
  const { t, language } = useLanguage();
  const { skus } = usePackSKUs();
  const { conversionMap } = useItemTypes();
  const i = t.insight;
  const locale = language === "id" ? "id-ID" : "en-US";
  const isPo = b.kind === "po";
  const rows = useMemo(() => {
    const medians = new Map(typicalDay(b.orders, asOf, null).skus.map((l) => [l.key, l.median]));
    return skuShares(b.orders, asOf).slice(0, 5).map((s) => ({ ...s, median: medians.get(s.code) ?? 0 }));
  }, [b.orders, asOf]);
  return (
    <div className={cn(CARD, "mb-3.5 px-[18px] py-4")}>
      <CardHead title={isPo ? i.usualOrder : i.cash.usuallyBuys} note={(isPo ? i.medianPerOrderDay : i.cash.medianPerVisit) + " · " + i.eightWeeks} />
      {rows.length === 0 && <p className="text-sm text-ek-mfg">{i.notEnoughData}</p>}
      {rows.map((r) => {
        const sku = skus.find((s) => s.code === r.code);
        const unit = isPo ? sku?.unitLabel ?? "pak" : getStockUnit(r.code, "egg", conversionMap);
        return (
          <ShareRow
            key={r.code}
            lead={isPo ? <code className="font-mono text-[12.5px] font-bold">{r.code}</code> : <Egg className="h-4 w-4 text-amber-500" />}
            name={isPo ? sku?.displayName ?? r.code : r.code}
            qty={`${r.median.toLocaleString(locale, { maximumFractionDigits: 1 })} ${unit}`}
            share={r.share}
            shareLabel={(isPo ? i.pctOrders : i.cash.pctVisits).replace("{n}", String(Math.round(r.share * 100)))}
          />
        );
      })}
    </div>
  );
}

// Aggregate: best-selling egg products, each in its own unit (rule 1).
function TopProducts({ b, asOf, days, periodLabel }: BuyerProfileProps) {
  const { t, language } = useLanguage();
  const { conversionMap } = useItemTypes();
  const i = t.insight;
  const locale = language === "id" ? "id-ID" : "en-US";
  const rows = useMemo(() => {
    const start = addDays(asOf, -(days - 1));
    const inPeriod = b.orders.filter((o) => o.outflowDate >= start);
    const per = new Map<string, { qty: number; sales: number }>();
    for (const o of inPeriod) {
      for (const p of new Set(o.eggTotals.map((e) => e.product))) {
        const qty = o.eggTotals.filter((e) => e.product === p).reduce((n, e) => n + e.quantity, 0);
        const r = per.get(p) ?? { qty: 0, sales: 0 };
        per.set(p, { qty: r.qty + qty, sales: r.sales + 1 });
      }
    }
    return [...per].map(([product, r]) => ({ product, ...r, share: r.sales / inPeriod.length })).sort((x, y) => y.sales - x.sales).slice(0, 5);
  }, [b.orders, asOf, days]);
  return (
    <div className={cn(CARD, "mb-3.5 px-[18px] py-4")}>
      <CardHead title={i.cash.topProducts} note={i.cash.nativeUnitPeriod.replace("{period}", periodLabel)} />
      {rows.length === 0 && <p className="text-sm text-ek-mfg">{i.cash.noSales}</p>}
      {rows.map((r) => (
        <ShareRow
          key={r.product}
          lead={<Egg className="h-4 w-4 text-amber-500" />}
          name={r.product}
          qty={`${r.qty.toLocaleString(locale, { maximumFractionDigits: 1 })} ${getStockUnit(r.product, "egg", conversionMap)}`}
          share={r.share}
          shareLabel={i.cash.pctTransactions.replace("{n}", String(Math.round(r.share * 100)))}
        />
      ))}
    </div>
  );
}

function ReliabilityCard({ b, asOf, days, periodLabel, data, returnedIds, returnCov }: BuyerProfileProps) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const i = t.insight;
  const locale = language === "id" ? "id-ID" : "en-US";
  const r = useMemo(() => reliability(b.orders, asOf, data.deliveries, data.deliveryLines, returnedIds), [b.orders, asOf, data, returnedIds]);
  const spike = useMemo(() => returnSpike(b.orders, asOf, days, returnedIds, returnCov), [b.orders, asOf, days, returnedIds, returnCov]);
  const pct = (n: number, of: number) => (of ? `${(Math.round((n / of) * 1000) / 10).toLocaleString(locale)}%` : "—");
  const returnRate = r.orders ? r.withReturn / r.orders : 0;
  // "Terkirim 0" with only a few fakturs logged would read as nothing delivered.
  const logCovered = r.logged >= r.orders * RELIABILITY_MIN_LOGGED && r.logged > 0;

  return (
    <div className={cn(CARD, "mb-3.5 px-[18px] py-4")}>
      <CardHead title={i.reliability} note={i.eightWeeks} />
      <div className="flex gap-7">
        <Stat label={i.delivered} value={logCovered ? r.delivered : "—"} sub={i.invoices} />
        <Stat label={i.rejected} value={logCovered ? r.rejected : "—"} valueClass={logCovered && r.rejected ? "text-red-600" : undefined} sub={logCovered ? pct(r.rejected, r.logged) : undefined} />
        <Stat label={i.withReturn} value={r.withReturn} valueClass={returnRate > RETURN_RATE_RED ? "text-red-600" : undefined} sub={pct(r.withReturn, r.orders)} />
      </div>
      {r.reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {r.reasons.map((x) => (
            <span key={x.reason} className="inline-flex h-7 items-center gap-[5px] rounded-lg bg-ek-muted px-2.5 text-[13px] text-ek-nav">
              {RETURN_REASON_LABEL_ID[x.reason] ?? x.reason} <b className="text-ek-fg">{x.count}</b>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-col gap-1 text-[12.5px] leading-[1.4] text-ek-mfg">
        <p>{i.loggedOf.replace("{n}", String(r.logged)).replace("{total}", String(r.orders))}</p>
        {returnCov.staleSince && <p>{i.returnsRecordedTo.replace("{date}", toLocalDate(returnCov.staleSince).toLocaleDateString(locale, { day: "numeric", month: "short" }))}</p>}
      </div>
      {spike.spike && (
        <div className="mt-3.5 flex flex-col gap-2.5 rounded-[13px] bg-[#fef2f2] p-3 text-sm leading-[1.4] text-red-700">
          <span className="flex gap-2.5">
            <AlertCircle className="mt-px h-[18px] w-[18px] shrink-0" />
            {i.returnSpike.replace("{n}", String(spike.cur)).replace("{period}", periodLabel).replace("{usual}", spike.usual.toLocaleString(locale))}
          </span>
          <Button
            variant="outline"
            className="h-11 w-full gap-2 rounded-[11px] border-ek-border bg-card text-sm font-semibold text-ek-fg"
            onClick={() => navigate(`/deliveries?${new URLSearchParams({ buyer: b.name, returns: "1", from: addDays(asOf, -(days - 1)) })}`)}
          >
            {i.seeInDeliveries} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function CustomerCard({ b, cov, days, customer }: BuyerProfileProps) {
  const { t } = useLanguage();
  const i = t.insight;
  const known = isComparable(cov, localToday(), days);
  return (
    <div className={cn(CARD, "mb-3.5 px-[18px] py-4")}>
      <CardHead title={i.cash.customer} />
      <div className="flex gap-7">
        <Stat label={i.cash.status} value={!known ? "—" : b.isNew ? i.flags.new : i.cash.returning} sub={!known ? i.notEnoughData : undefined} />
        <Stat label={i.cash.transactions} value={b.orders.length} sub={i.cash.total} />
      </div>
      <div className="my-3.5 h-px bg-ek-border" />
      <span className="text-[12.5px] font-semibold text-ek-mfg">{i.mergedSpellings}</span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(customer?.variants ?? []).map((v) => (
          <span key={v} className="whitespace-pre rounded-lg border border-ek-border bg-[#faf8f4] px-[9px] py-1 text-[13px]">
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function NewVsReturning({ customers, cov, onSelect }: BuyerProfileProps) {
  const { t } = useLanguage();
  const i = t.insight;
  const today = localToday();
  const start = addDays(today, -27);
  // Names only started being recorded recently: until the 4 weeks before this
  // one are covered, a "new" customer may just be a regular's first record.
  const known = isComparable(cov, today, 28);
  const active = customers.filter((c) => c.sales.some((s) => s.outflowDate >= start));
  const fresh = active.filter((c) => c.firstDate >= start);
  const regulars = [...active]
    .map((c) => ({ c, visits: c.sales.filter((s) => s.outflowDate >= start).length }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 4);
  return (
    <div className={cn(CARD, "mb-3.5 px-[18px] py-4")}>
      <CardHead title={i.cash.newVsReturning} note={i.fourWeeks} />
      {known ? (
        <>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
            <i className="bg-emerald-600" style={{ flex: active.length - fresh.length }} />
            <i className="bg-[#60a5fa]" style={{ flex: fresh.length }} />
          </div>
          <div className="mt-2.5 flex flex-col gap-1 text-[13.5px] text-ek-nav">
            <span><b className="text-ek-fg">{active.length - fresh.length}</b> {i.cash.returningCustomers}</span>
            <span>
              <b className="text-ek-fg">{fresh.length}</b> {i.cash.newCustomers}
              {fresh.length > 0 && ": "}
              {fresh.map((c, n) => (
                <span key={c.key}>
                  {n > 0 && ", "}
                  <button type="button" className="text-amber-700 hover:text-[#92400e]" onClick={() => onSelect(`kas:${c.key}`)}>{c.name}</button>
                </span>
              ))}
            </span>
          </div>
        </>
      ) : (
        <p className="text-sm text-ek-mfg">{i.notEnoughData}. {i.cash.namesJustStarted}</p>
      )}
      <div className="my-3.5 h-px bg-ek-border" />
      <h3 className="mb-1 font-display text-[15px] font-semibold">{i.cash.regulars}</h3>
      {regulars.length === 0 && <p className="text-sm text-ek-mfg">{i.cash.noNamedYet}</p>}
      {regulars.map(({ c, visits }) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onSelect(`kas:${c.key}`)}
          className="flex h-11 w-full items-center gap-2 border-t border-ek-border px-1 text-sm font-semibold hover:text-amber-700"
        >
          <span className="flex-1 truncate text-left">{c.name}</span>
          <span className="text-[13px] font-medium text-ek-mfg">{i.cash.nVisits.replace("{n}", String(visits))}</span>
          <ChevronRight className="h-4 w-4 text-ek-mfg" />
        </button>
      ))}
    </div>
  );
}

function RhythmCard({ b, usualNames }: { b: BuyerSummary; usualNames: string }) {
  const { t, language } = useLanguage();
  const i = t.insight;
  const locale = language === "id" ? "id-ID" : "en-US";
  const dayName = useDayName();
  const isPo = b.kind === "po";
  const today = localToday();
  const fmt = (s: string) => toLocalDate(s).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });

  const next = useMemo(() => {
    if (!b.pattern.some((s) => s.usual)) return null;
    const wd = nextLikelyWeekday(b.pattern, today);
    if (wd === null) return null;
    for (let n = 0; n < 7; n++) if (weekdayOf(addDays(today, n)) === wd) return addDays(today, n);
    return null;
  }, [b.pattern, today]);

  return (
    <div className={cn(CARD, "mb-3.5 px-[18px] py-4")}>
      <CardHead title={isPo ? i.rhythm : i.rhythmVisits} note={(isPo ? i.pctDaysWithOrder : i.pctDaysWithVisit) + " · " + i.eightWeeks} />
      <div className="grid grid-cols-7 gap-2">
        {MONDAY_FIRST.map((wd) => {
          const s = b.pattern[wd];
          const rate = s.available ? s.withOrder / s.available : null;
          return (
            <div
              key={wd}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl pb-2.5 pt-2 text-[13px] font-semibold text-ek-mfg",
                s.usual && "bg-ek-accent text-amber-700"
              )}
            >
              <span className={cn(weekdayOf(today) === wd && "underline underline-offset-[3px]")}>{dayName(wd, "short")}</span>
              <div className={cn("flex h-[54px] w-[26px] items-end overflow-hidden rounded-[7px]", s.usual ? "bg-white" : "bg-ek-muted")}>
                <i className={cn("block w-full rounded-[5px]", s.usual ? "bg-amber-600" : "bg-[#c9bca9]")} style={{ height: `${Math.max(3, (rate ?? 0) * 100)}%` }} />
              </div>
              <b className="text-[12.5px] tabular-nums text-ek-fg">{rate === null ? "—" : `${Math.round(rate * 100)}%`}</b>
            </div>
          );
        })}
      </div>
      <div className="mt-3.5 flex gap-7 border-t border-ek-border pt-3 [&_b]:text-base">
        <Stat label={i.usually} value={usualNames || i.noFixedDays} />
        <Stat label={i.last} value={b.lastDate ? fmt(b.lastDate) : "—"} />
        <Stat label={i.next} value={b.late !== null ? i.late : next ? fmt(next) : "—"} valueClass={b.late !== null ? "text-red-600" : undefined} />
      </div>
    </div>
  );
}
