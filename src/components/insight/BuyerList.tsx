import { Calculator } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/contexts/LanguageContext";
import { BuyerSummary, Coverage, weeklyCounts } from "@/lib/insight";
import { cn } from "@/lib/utils";
import { CASH_HUE, IdentityTile, PO_HUE } from "./IdentityTile";
import { Sparkline, trendColor } from "./Sparkline";
import { Delta, Flag } from "./ui";

export type BuyerFilter = "po" | "cash" | "attention" | null;

export const hueOf = (b: Pick<BuyerSummary, "kind">) => (b.kind === "po" ? PO_HUE : CASH_HUE);

export function BuyerFlags({ b }: { b: BuyerSummary }) {
  const { t } = useLanguage();
  const f = t.insight.flags;
  return (
    <>
      {b.late !== null && <Flag tone="red">{f.late.replace("{n}", String(b.late))}</Flag>}
      {b.isNew && <Flag tone="blue">{f.new}</Flag>}
      {b.returnsUp && <Flag tone="red">{f.returnsUp}</Flag>}
      {b.down && <Flag tone="amber">{f.down}</Flag>}
    </>
  );
}

const PILL = "h-9 whitespace-nowrap rounded-full border bg-card px-3 text-[13.5px] font-semibold transition-colors";
const hueStyle = (hue: number, on: boolean) => ({
  color: `oklch(${on ? ".38" : ".45"} .11 ${hue})`,
  borderColor: `oklch(${on ? ".78 .1" : ".88 .06"} ${hue})`,
  ...(on ? { background: `linear-gradient(150deg, oklch(.97 .035 ${hue}), oklch(.92 .06 ${hue}))` } : {}),
});

interface BuyerRowProps {
  b: BuyerSummary;
  rank?: number;
  selected: boolean;
  onSelect: (id: string) => void;
  sparkValues: (number | null)[];
  sub?: string;
  icon?: React.ReactNode;
}

function BuyerRow({ b, rank, selected, onSelect, sparkValues, sub, icon }: BuyerRowProps) {
  const hue = hueOf(b);
  return (
    <button
      type="button"
      onClick={() => onSelect(b.id)}
      aria-pressed={selected}
      className={cn(
        "mb-0.5 grid min-h-16 w-full grid-cols-[40px_minmax(0,1fr)_64px_56px] items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-[background,box-shadow] hover:bg-[oklch(.975_.012_var(--h))]",
        selected && "bg-card shadow-[0_0_0_1.5px_oklch(.75_.1_var(--h)),0_8px_18px_-10px_oklch(.45_.12_var(--h)/.45)] hover:bg-card"
      )}
      style={{ "--h": hue } as React.CSSProperties}
    >
      <span className="relative flex justify-center">
        <IdentityTile name={b.name} hue={hue} round={b.kind !== "po"} icon={icon} />
        {rank != null && (
          <em className="absolute -bottom-[3px] -right-[3px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full border border-ek-border bg-white px-1 font-display text-[10.5px] font-bold not-italic tabular-nums text-ek-mfg">
            {rank}
          </em>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <b className={cn("truncate text-[15px] font-semibold", selected && "text-[oklch(.36_.1_var(--h))]")}>{b.name}</b>
        {sub ? (
          <span className="text-[12.5px] leading-tight text-ek-mfg">{sub}</span>
        ) : (
          <span className="flex flex-wrap gap-1 empty:hidden">
            <BuyerFlags b={b} />
          </span>
        )}
      </span>
      <Sparkline values={sparkValues} color={trendColor(b.compare.delta)} area width={64} height={26} />
      <span className="flex flex-col items-end gap-0.5">
        <b className="font-display text-[19px] font-semibold leading-none tabular-nums">{b.compare.cur}</b>
        <Delta value={b.compare.delta} />
      </span>
    </button>
  );
}

interface BuyerListProps {
  loading: boolean;
  buyers: BuyerSummary[]; // sorted by current-period count
  kasAll: BuyerSummary | null;
  filter: BuyerFilter;
  onFilter: (f: BuyerFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  periodLabel: string;
  periodWeeks: number;
  asOfOf: (b: BuyerSummary) => string;
  covOf: (b: BuyerSummary) => Coverage;
  concentration: { pct: number; names: string[] } | null;
  footnote: string | null;
}

export function BuyerList({
  loading, buyers, kasAll, filter, onFilter, selectedId, onSelect, periodLabel, periodWeeks, asOfOf, covOf, concentration, footnote,
}: BuyerListProps) {
  const { t } = useLanguage();
  const i = t.insight;
  const sparkWeeks = Math.max(2 * periodWeeks, 8);
  const spark = (b: BuyerSummary) => weeklyCounts(b.orders.map((o) => o.outflowDate), asOfOf(b), sparkWeeks, covOf(b));
  const showKas = filter === null || filter === "cash";
  const toggle = (f: BuyerFilter) => onFilter(filter === f ? null : f);

  return (
    <div className="flex min-h-0 w-[360px] shrink-0 flex-col border-r border-ek-border bg-[#fbf9f5]">
      <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5 pt-3.5">
        <button type="button" aria-pressed={filter === "po"} onClick={() => toggle("po")} className={PILL} style={hueStyle(PO_HUE, filter === "po")}>
          {i.filters.po}
        </button>
        <button type="button" aria-pressed={filter === "cash"} onClick={() => toggle("cash")} className={PILL} style={hueStyle(CASH_HUE, filter === "cash")}>
          {i.filters.cash}
        </button>
        <button
          type="button"
          aria-pressed={filter === "attention"}
          onClick={() => toggle("attention")}
          className={cn(PILL, "border-[#fecaca] text-red-700", filter === "attention" && "border-[#fca5a5] bg-[#fef2f2]")}
        >
          {i.filters.attention}
        </button>
      </div>
      <div className="flex justify-between px-[18px] py-1 text-xs font-bold uppercase tracking-[0.04em] text-ek-mfg">
        <span>{i.tabs.buyers}</span>
        <span>{i.ordersPeriod.replace("{period}", periodLabel)}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1.5">
        {loading ? (
          Array.from({ length: 6 }, (_, n) => <Skeleton key={n} className="mb-1 h-16 w-full rounded-xl" />)
        ) : (
          <>
            {showKas && kasAll && (
              <div className="mb-2 border-b border-dashed border-ek-border">
                <BuyerRow
                  b={kasAll}
                  selected={selectedId === kasAll.id}
                  onSelect={onSelect}
                  sparkValues={spark(kasAll)}
                  sub={i.cash.allSales}
                  icon={<Calculator className="h-[18px] w-[18px]" />}
                />
              </div>
            )}
            {buyers.map((b, n) => (
              <BuyerRow key={b.id} b={b} rank={n + 1} selected={selectedId === b.id} onSelect={onSelect} sparkValues={spark(b)} />
            ))}
            {buyers.length === 0 && !showKas && <p className="p-5 text-center text-sm text-ek-mfg">{i.noBuyers}</p>}
          </>
        )}
      </div>
      <div className="border-t border-ek-border bg-card px-[18px] py-3 text-[13.5px] leading-[1.4]">
        {concentration && (
          <p>
            <b className="font-display text-base">{concentration.pct}%</b> {i.concentration}{" "}
            <span className="text-ek-mfg">({concentration.names.join(", ")})</span>
          </p>
        )}
        {footnote && <p className="mt-1 text-[12.5px] text-ek-mfg">{footnote}</p>}
      </div>
    </div>
  );
}
