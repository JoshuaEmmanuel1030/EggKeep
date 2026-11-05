import { cn } from "@/lib/utils";

interface WeeklyBarsProps {
  values: (number | null)[]; // oldest first; null = no data for that week
  currentWeeks: number;
  labelOf: (i: number) => string;
  format: (v: number) => string;
  noDataLabel: string;
  height?: number;
}

const LABEL_BAND = 16; // room above the tallest bar for its value

// Current period amber, the one before it taupe, older weeks pale. A week with
// no data behind it is hatched so it can't be mistaken for a week with no orders.
export function WeeklyBars({ values, currentWeeks, labelOf, format, noDataLabel, height = 110 }: WeeklyBarsProps) {
  const max = Math.max(1, ...values.filter((v): v is number => v !== null));
  const n = values.length;
  return (
    <div>
      <div className="flex items-end gap-[5px]" style={{ height: height + LABEL_BAND }}>
        {values.map((v, i) => {
          const fromEnd = n - i;
          const isCurrent = fromEnd <= currentWeeks;
          const isPrevious = !isCurrent && fromEnd <= 2 * currentWeeks;
          const weekLabel = labelOf(i);
          if (v === null) {
            return (
              <div
                key={i}
                title={`${weekLabel}: ${noDataLabel}`}
                className="min-w-0 flex-1 rounded-[4px]"
                style={{
                  height,
                  background: "repeating-linear-gradient(135deg, transparent 0 4px, #f2efe9 4px 6px)",
                }}
              />
            );
          }
          return (
            <div key={i} title={`${weekLabel}: ${format(v)}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-[3px]">
              {isCurrent && <span className="whitespace-nowrap text-[11px] font-bold tabular-nums leading-none text-amber-700">{format(v)}</span>}
              <i
                className={cn(
                  "block w-full rounded-t-[4px] rounded-b-[2px]",
                  isCurrent ? "bg-gradient-to-b from-amber-500 to-amber-600" : isPrevious ? "bg-[#c9bca9]" : "bg-[#ece5d9]"
                )}
                style={{ height: Math.max(2, (v / max) * height) }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[5px]">
        {values.map((_, i) => (
          <span key={i} className="min-w-0 flex-1 whitespace-nowrap text-center text-[11px] text-ek-mfg">
            {(n - 1 - i) % 4 === 0 ? labelOf(i) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
