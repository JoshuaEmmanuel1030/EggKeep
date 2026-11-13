import { useMemo, useState } from "react";
import { BarChart2, Package, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { InsightOrder, useInsightData } from "@/hooks/useInsightData";
import { addDays, localToday, toLocalDate } from "@/lib/buyerProfile";
import {
  BuyerSummary,
  RETURNS_STALE_DAYS,
  concentration,
  dataAsOf,
  dataCoverage,
  isComparable,
  kasSalesFromLogs,
  kasTunaiCustomers,
  needsAttention,
  summarizeBuyer,
} from "@/lib/insight";
import type { ActivityLog } from "@/types/activityLog";
import type { InflowEntry, OutflowEntry, StockSummary } from "@/types/inventory";
import { BuyerFilter, BuyerList } from "./insight/BuyerList";
import { BuyerProfile } from "./insight/BuyerProfile";
import { MaterialsInsight } from "./insight/MaterialsInsight";
import { StockInsight } from "./insight/StockInsight";
import { Segmented } from "./insight/ui";

interface InsightPageProps {
  stockSummary: StockSummary[];
  inflows: InflowEntry[];
  outflows: OutflowEntry[];
  logs: ActivityLog[];
  freshnessDaysByProduct: Record<string, number>;
  loading: boolean;
  logsLoading: boolean;
}

type Tab = "buyers" | "stock";

// Tablet Insight (design handoff 8a), read-only. Phone keeps InfosPage.
export function InsightPage({ stockSummary, inflows, outflows, logs, freshnessDaysByProduct, loading, logsLoading }: InsightPageProps) {
  const { t, language } = useLanguage();
  const i = t.insight;
  const locale = language === "id" ? "id-ID" : "en-US";
  const [tab, setTab] = useState<Tab>("buyers");
  const [days, setDays] = useState(28);
  const [stockView, setStockView] = useState<"eggs" | "materials">("eggs");
  const [filter, setFilter] = useState<BuyerFilter>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useInsightData();
  const today = localToday();

  const periodLabel = days === 7 ? i.period.d7 : days === 28 ? i.period.w4 : i.period.w8;

  const poDates = useMemo(() => (data?.orders ?? []).map((o) => o.outflowDate), [data]);
  const asOf = useMemo(() => dataAsOf(poDates, today), [poDates, today]);
  const poCov = useMemo(() => dataCoverage(poDates, asOf), [poDates, asOf]);
  const returnCov = useMemo(() => dataCoverage((data?.returns ?? []).map((r) => r.date), asOf, RETURNS_STALE_DAYS), [data, asOf]);
  const returnedIds = useMemo(() => new Set((data?.returns ?? []).map((r) => r.outflowId)), [data]);

  const kasSales = useMemo(() => kasSalesFromLogs(logs), [logs]);
  // Only the drawer's rows mark when cash sales really started being recorded.
  const kasCov = useMemo(() => dataCoverage(kasSales.filter((s) => s.tracked).map((s) => s.outflowDate), today), [kasSales, today]);
  const customers = useMemo(() => kasTunaiCustomers(kasSales), [kasSales]);

  const buyers = useMemo(() => {
    const byName = new Map<string, InsightOrder[]>();
    for (const o of data?.orders ?? []) byName.set(o.buyerName, [...(byName.get(o.buyerName) ?? []), o]);
    const po = [...byName].map(([name, rows]) =>
      summarizeBuyer(`po:${name}`, "po", name, rows, asOf, days, poCov, { outflowIds: returnedIds, cov: returnCov })
    );
    const cash = customers.map((c) => summarizeBuyer(`kas:${c.key}`, "cash", c.name, c.sales, today, days, kasCov));
    return [...po, ...cash].sort((a, b) => b.compare.cur - a.compare.cur || a.name.localeCompare(b.name));
  }, [data, asOf, days, poCov, returnedIds, returnCov, customers, today, kasCov]);

  const kasAll = useMemo(
    () => summarizeBuyer("kas", "cashAll", i.cash.title, kasSales, today, days, kasCov),
    [kasSales, today, days, kasCov, i.cash.title]
  );

  const visible = useMemo(
    () => buyers.filter((b) => (filter === "po" ? b.kind === "po" : filter === "cash" ? b.kind === "cash" : filter === "attention" ? needsAttention(b) : true)),
    [buyers, filter]
  );

  const current: BuyerSummary | null = useMemo(() => {
    if (selected === "kas") return kasAll;
    return buyers.find((b) => b.id === selected) ?? buyers.find(needsAttention) ?? buyers[0] ?? null;
  }, [selected, kasAll, buyers]);

  const kasTransactions = useMemo(() => {
    const start = addDays(today, -(days - 1));
    const inPeriod = kasSales.filter((s) => s.outflowDate >= start);
    return { total: inPeriod.length, named: inPeriod.filter((s) => s.customerName?.trim()).length };
  }, [kasSales, today, days]);

  const footnote = useMemo(() => {
    if (poDates.length === 0) return null;
    const fmt = (s: string) => toLocalDate(s).toLocaleDateString(locale, { day: "numeric", month: "short" });
    const parts = [i.dataTo.replace("{date}", fmt(asOf))];
    if (!isComparable(poCov, asOf, days)) parts.push(i.cannotCompare.replace("{period}", periodLabel).replace("{date}", fmt(poCov.start as string)));
    return parts.join(" ");
  }, [poDates, asOf, poCov, days, periodLabel, locale, i]);

  const inventoryReady = !loading && inflows.length > 0;
  const stockControl = (
    <div className="mb-3.5">
      <Segmented<"eggs" | "materials">
        small
        label={i.tabs.stock}
        value={stockView}
        onChange={setStockView}
        options={[
          { value: "eggs", label: i.stock.eggs },
          { value: "materials", label: i.stock.materials },
        ]}
      />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-ek-bg text-ek-fg">
      <header className="flex items-center gap-4 border-b border-ek-border px-6 pb-4 pt-[18px]">
        <h1 className="mr-2 flex items-center gap-2.5 font-display text-[28px] font-semibold tracking-[-0.02em]">
          <BarChart2 className="h-[26px] w-[26px]" />
          {t.nav.infos}
        </h1>
        <Segmented<Tab>
          label={t.nav.infos}
          value={tab}
          onChange={setTab}
          options={[
            { value: "buyers", label: i.tabs.buyers, icon: <Users /> },
            { value: "stock", label: i.tabs.stock, icon: <Package /> },
          ]}
        />
        <div className="flex-1" />
        <Segmented<number>
          small
          label={i.periodLabel}
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: i.period.d7 },
            { value: 28, label: i.period.w4 },
            { value: 56, label: i.period.w8 },
          ]}
        />
      </header>

      {isError ? (
        // A failed read must never look like a quiet period.
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-[15px] font-semibold">{i.loadFailed}</p>
          <Button variant="outline" className="h-11" onClick={() => refetch()}>
            {i.retry}
          </Button>
        </div>
      ) : tab === "buyers" ? (
        <div className="flex min-h-0 flex-1">
          <BuyerList
            loading={isLoading || logsLoading}
            buyers={visible}
            kasAll={kasAll}
            filter={filter}
            onFilter={setFilter}
            selectedId={current?.id ?? null}
            onSelect={setSelected}
            periodLabel={periodLabel}
            periodWeeks={days / 7}
            asOfOf={(b) => (b.kind === "po" ? asOf : today)}
            covOf={(b) => (b.kind === "po" ? poCov : kasCov)}
            concentration={concentration(buyers.map((b) => ({ name: b.name, count: b.compare.cur })))}
            footnote={footnote}
          />
          {data && current ? (
            <BuyerProfile
              key={current.id}
              b={current}
              asOf={current.kind === "po" ? asOf : today}
              cov={current.kind === "po" ? poCov : kasCov}
              days={days}
              periodLabel={periodLabel}
              data={data}
              returnedIds={returnedIds}
              returnCov={returnCov}
              customers={customers}
              customer={customers.find((c) => `kas:${c.key}` === current.id) ?? null}
              kasTransactions={kasTransactions}
              onSelect={setSelected}
            />
          ) : (
            <div className="flex-1" />
          )}
        </div>
      ) : !data || !inventoryReady ? (
        <p className="p-8 text-sm text-ek-mfg">{i.loading}</p>
      ) : stockView === "eggs" ? (
        <StockInsight
          stockSummary={stockSummary}
          inflows={inflows}
          outflows={outflows}
          freshnessDaysByProduct={freshnessDaysByProduct}
          data={data}
          returnCov={returnCov}
          days={days}
          periodLabel={periodLabel}
          control={stockControl}
        />
      ) : (
        <MaterialsInsight stockSummary={stockSummary} outflows={outflows} control={stockControl} />
      )}
    </div>
  );
}
