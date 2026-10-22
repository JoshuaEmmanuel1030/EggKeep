import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { useItemTypes } from "@/hooks/useItemTypes";
import { butirEquivalent, getStockUnit } from "@/lib/inventory";
import { cn } from "@/lib/utils";
import {
  dayOfMonthPattern, localToday, monthlyTotals, nextLikelyWeekday, skuShares, spanDays, toLocalDate, typicalDay, weekdayPattern,
} from "@/lib/buyerProfile";

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">
        {title} {hint && <span className="font-normal text-muted-foreground">· {hint}</span>}
      </h4>
      {children}
    </section>
  );
}

// Planning view of one buyer's Purchase Orders (rules: src/lib/buyerProfile.ts).
export function BuyerPlanning({ buyerName }: { buyerName: string }) {
  const { t, language } = useLanguage();
  const locale = language === "id" ? "id-ID" : "en-US";
  const { data: orders = [], isLoading, error, refetch } = usePurchaseOrders(buyerName);
  const { skus, isLoading: skusLoading } = usePackSKUs();
  const { conversionMap } = useItemTypes();
  const today = localToday();

  const stats = useMemo(() => weekdayPattern(orders, today), [orders, today]);
  const [picked, setPicked] = useState<number | null>(null);
  const weekday = picked ?? nextLikelyWeekday(stats, today);
  const typical = useMemo(() => (weekday === null ? null : typicalDay(orders, today, weekday)), [orders, today, weekday]);
  const top = useMemo(() => skuShares(orders, today).slice(0, 5), [orders, today]);
  const monthly = useMemo(() => monthlyTotals(orders), [orders]);
  const dom = useMemo(() => dayOfMonthPattern(orders, today), [orders, today]);
  const span = spanDays(orders, today);

  // 18 Oct 2026 is a Sunday, so 18 + wd is weekday wd.
  const dayName = (wd: number, style: "short" | "long" = "short") =>
    new Date(2026, 9, 18 + wd).toLocaleDateString(locale, { weekday: style });
  const unitOf = (code: string) => (skus.find((s) => s.code === code)?.basePackCode ? t.buyerProfile.box : t.buyerProfile.pack);
  const eggQty = (product: string, q: number) =>
    getStockUnit(product, "egg", conversionMap) === "kg"
      ? `${num(q)} kg (≈ ${butirEquivalent(product, q, conversionMap).toLocaleString()} butir)`
      : `${num(q)} butir`;
  const monthLabel = (m: string) =>
    toLocalDate(`${m}-01`).toLocaleDateString(locale, { month: "short", year: "numeric" }) +
    (m === today.slice(0, 7) ? ` (${t.buyerProfile.soFar})` : "");

  if (isLoading || skusLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error) {
    return (
      <div className="flex items-center gap-3 py-6 text-sm">
        {t.buyerProfile.loadFailed}
        <Button variant="outline" size="sm" onClick={() => refetch()}>{t.buyerProfile.retry}</Button>
      </div>
    );
  }
  if (orders.length === 0) return <p className="py-6 text-sm text-muted-foreground">{t.buyerProfile.noOrders.replace("{buyer}", buyerName)}</p>;

  return (
    <div className="min-w-0 space-y-6">
      {span < 56 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t.buyerProfile.thinData.replace("{weeks}", String(Math.max(1, Math.round(span / 7))))}
        </p>
      )}

      <Section title={t.buyerProfile.byWeekday}>
        <div className="space-y-1">
          {WEEK_ORDER.map((wd) => {
            const s = stats[wd];
            const pct = s.available ? (s.withOrder / s.available) * 100 : 0;
            return (
              <button
                key={wd}
                type="button"
                onClick={() => setPicked(wd)}
                className={cn("grid w-full grid-cols-[3rem_1fr_7rem] items-center gap-2 rounded px-1 py-1 text-left text-sm", wd === weekday && "bg-accent")}
              >
                <span className={cn(s.usual && "font-semibold")}>{dayName(wd)}</span>
                <span className="h-2 rounded-full bg-muted">
                  <span className="block h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">{s.withOrder}/{s.available} · {t.buyerProfile.ordersCount.replace("{n}", String(s.orders))}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {typical && weekday !== null && typical.orderDays > 0 && (
        <Section
          title={t.buyerProfile.typicalDay.replace("{day}", dayName(weekday, "long"))}
          hint={t.buyerProfile.medianOf.replace("{n}", String(typical.orderDays))}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t.buyerProfile.prep}</p>
              {typical.skus.map((l) => (
                <div key={l.key} className="flex flex-wrap justify-between gap-x-2 border-b py-1 text-sm">
                  <span className="min-w-0 break-words font-mono text-xs">{l.key}</span>
                  <span className="shrink-0 tabular-nums">
                    {num(l.median)} {unitOf(l.key)}
                    {l.days < typical.orderDays && <span className="ml-1 text-muted-foreground">{l.days}/{typical.orderDays}</span>}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t.buyerProfile.buy}</p>
              {typical.eggs.map((l) => (
                <div key={l.key} className="flex flex-wrap justify-between gap-x-2 border-b py-1 text-sm">
                  <span className="min-w-0 break-words">{l.key}</span>
                  <span className="shrink-0 tabular-nums">{eggQty(l.key, l.median)}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      {top.length > 0 && (
        <Section title={t.buyerProfile.mostFrequent}>
          <div className="flex flex-wrap gap-1.5">
            {top.map((s) => (
              <span key={s.code} className="rounded-md border px-2 py-0.5 text-xs">
                <span className="font-mono">{s.code}</span> {Math.round(s.share * 100)}%
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title={t.buyerProfile.perMonth}>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-normal" />
                {monthly.months.map((m) => <th key={m} className="whitespace-nowrap px-2 py-1 text-right font-normal">{monthLabel(m)}</th>)}
              </tr>
            </thead>
            <tbody>
              {monthly.skus.map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="py-1 font-mono text-xs">{r.key}</td>
                  {monthly.months.map((m) => (
                    <td key={m} className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                      {r.byMonth[m] ? `${num(r.byMonth[m])} ${unitOf(r.key)}` : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              {monthly.eggs.map((r) => (
                <tr key={r.key} className="border-t text-muted-foreground">
                  <td className="py-1 text-xs">{r.key}</td>
                  {monthly.months.map((m) => (
                    <td key={m} className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                      {r.byMonth[m] ? eggQty(r.key, r.byMonth[m]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t.buyerProfile.dayOfMonth} hint={span < 90 ? t.buyerProfile.needsMonths : undefined}>
        <div className="grid grid-cols-8 gap-1 sm:grid-cols-[repeat(16,minmax(0,1fr))]">
          {dom.map((d) => (
            <span
              key={d.day}
              title={`${d.orderDays}/${d.dates}`}
              className="rounded border py-0.5 text-center text-xs tabular-nums"
              style={{ backgroundColor: d.rate ? `hsl(var(--primary) / ${0.15 + d.rate * 0.6})` : undefined }}
            >
              {d.day}
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
