import { useMemo } from "react";
import { Box, Package, Tag } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import { addDays, localToday, toLocalDate } from "@/lib/buyerProfile";
import { averageDailyOutflow, daysOfCover } from "@/lib/inventory";
import { COVER_WINDOW_DAYS, MATERIAL_AMBER_DAYS, dataAsOf, materialTone } from "@/lib/insight";
import { cn } from "@/lib/utils";
import type { InventoryCategory, OutflowEntry, StockSummary } from "@/types/inventory";
import { CARD, CardHead, TABLE_HEAD } from "./ui";

interface MaterialsInsightProps {
  stockSummary: StockSummary[];
  outflows: OutflowEntry[];
  control: React.ReactNode;
}

const CATEGORIES: { category: InventoryCategory; Icon: typeof Box }[] = [
  { category: "packaging", Icon: Package },
  { category: "label", Icon: Tag },
  { category: "box", Icon: Box },
];
const GRID = "grid grid-cols-[minmax(130px,1.2fr)_90px_100px_minmax(0,1fr)] items-center gap-3.5 px-[18px]";
const COVER_SCALE_DAYS = 14;
const TONE_BAR = { ok: "bg-[#a7d8c4]", amber: "bg-[#f6c56b]", red: "bg-red-600" };
const TONE_TEXT = { ok: "", amber: "text-amber-700", red: "text-red-600" };

export function MaterialsInsight({ stockSummary, outflows, control }: MaterialsInsightProps) {
  const { t, language } = useLanguage();
  const { itemTypes } = useItemTypes();
  const i = t.insight;
  const s = i.stock;
  const locale = language === "id" ? "id-ID" : "en-US";
  const nf = (n: number) => Math.round(n).toLocaleString(locale);
  const today = localToday();

  const rows = useMemo(() => {
    const materialOutflows = outflows.filter((o) => o.category !== "egg");
    const asOf = dataAsOf(materialOutflows.map((o) => o.date), today);
    // averageDailyOutflow counts back from `now`, so the day after asOf gives
    // exactly COVER_WINDOW_DAYS calendar days ending on asOf.
    const windowEnd = toLocalDate(addDays(asOf, 1));
    return itemTypes
      .filter((it) => it.category !== "egg")
      .map((it) => {
        const perDay = averageDailyOutflow(materialOutflows.filter((o) => o.category === it.category), it.name, COVER_WINDOW_DAYS, windowEnd);
        const stock = stockSummary.find((x) => x.product === it.name && x.category === it.category)?.totalStock ?? 0;
        return { name: it.name, category: it.category, stock, perDay, cover: daysOfCover(stock, perDay) };
      })
      // Catalog items with no stock and no use have nothing to say.
      .filter((r) => r.stock > 0 || r.perDay > 0)
      .sort((a, b) => (a.cover ?? Infinity) - (b.cover ?? Infinity) || a.name.localeCompare(b.name));
  }, [itemTypes, stockSummary, outflows, today]);

  const toOrder = rows.filter((r) => r.cover !== null && r.cover < MATERIAL_AMBER_DAYS);
  // One decimal under 10 days: a red "2,6 hari" must not round up to "3 hari".
  const coverLabel = (c: number) =>
    c < 1 ? s.underOneDay : s.nDays.replace("{n}", c.toLocaleString(locale, { maximumFractionDigits: c < 10 ? 1 : 0 }));

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-7 pt-5">
        {control}
        <div className={CARD}>
          <CardHead pad title={s.materials} note={s.materialsNote} />
          <div className={cn(GRID, TABLE_HEAD, "min-h-9 border-t border-ek-border")}>
            <span>{s.material}</span>
            <span>{s.stockCol}</span>
            <span>{s.usedPerDay}</span>
            <span>{s.enoughFor}</span>
          </div>
          {CATEGORIES.map(({ category, Icon }) => {
            const mine = rows.filter((r) => r.category === category);
            if (mine.length === 0) return null;
            const noUse = mine.every((r) => r.perDay === 0);
            return (
              <div key={category}>
                <div className="border-t border-ek-border px-[18px] pb-1.5 pt-3.5 text-[12.5px] font-bold text-ek-mfg">
                  {s.groups[category]}
                  {noUse && <span className="ml-2 font-medium">· {s.noUseRecorded}</span>}
                </div>
                {mine.map((r) => {
                  const tone = r.cover === null ? "ok" : materialTone(r.cover);
                  return (
                    <div key={r.name} className={cn(GRID, "min-h-[50px] border-t border-ek-border text-sm")}>
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-[#8a7d6e]" />
                        <b className="truncate text-sm font-semibold">{r.name}</b>
                      </span>
                      <span className="whitespace-nowrap tabular-nums text-ek-mfg">
                        <b className="text-ek-fg">{nf(r.stock)}</b> pcs
                      </span>
                      <span className="whitespace-nowrap tabular-nums text-ek-mfg">{r.perDay > 0 ? `${nf(r.perDay)} pcs` : "—"}</span>
                      {r.cover === null ? (
                        <span className="text-ek-mfg">—</span>
                      ) : (
                        <span className="flex items-center gap-2.5">
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-ek-muted">
                            <i className={cn("block h-full rounded-full", TONE_BAR[tone])} style={{ width: `${Math.min(100, (r.cover / COVER_SCALE_DAYS) * 100)}%` }} />
                          </span>
                          <b className={cn("min-w-[52px] whitespace-nowrap text-right text-[13.5px] tabular-nums", TONE_TEXT[tone])}>{coverLabel(r.cover)}</b>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="flex min-h-0 w-[280px] shrink-0 flex-col border-l border-ek-border bg-card">
        {/* pb-20: the last rows scroll clear of the floating chat button. */}
        <div className="flex-1 overflow-y-auto p-[18px] pb-20">
          <h3 className="mb-1.5 font-display text-[17px] font-semibold">{s.toOrder}</h3>
          <p className="mb-2.5 text-[13.5px] leading-[1.4] text-ek-mfg">{s.toOrderHint.replace("{n}", String(MATERIAL_AMBER_DAYS))}</p>
          {toOrder.length === 0 && <p className="text-sm text-ek-mfg">{s.nothingToOrder}</p>}
          {toOrder.map((r) => {
            const tone = materialTone(r.cover as number);
            return (
              <div key={r.name} className="flex justify-between gap-2.5 border-b border-ek-border py-2.5 last:border-b-0">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <b className="text-sm font-semibold">{r.name}</b>
                  <span className="text-[12.5px] leading-[1.3] text-ek-mfg">{s.inWarehouse.replace("{n}", nf(r.stock))}</span>
                </div>
                <span className={cn("whitespace-nowrap text-[13px] font-bold tabular-nums", tone === "red" ? "text-red-600" : "text-amber-700")}>{coverLabel(r.cover as number)}</span>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
