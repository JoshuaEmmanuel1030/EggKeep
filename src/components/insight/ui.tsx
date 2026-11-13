import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared bits of the Insight page, in the 8a handoff's look.

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  small,
  label,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-max gap-1 rounded-xl bg-ek-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-10 items-center gap-[7px] rounded-[9px] font-semibold text-ek-nav transition-colors [&_svg]:size-[17px]",
            small ? "px-3 text-sm" : "px-3.5 text-[15px]",
            o.value === value && "bg-card text-ek-fg shadow-[0_1px_3px_rgba(0,0,0,.08)]"
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ↑ +2 / ↓ −3 / → 0. Up is green unless more is worse (losses). Null: no comparison.
export function Delta({ value, format, risingIsBad, big }: { value: number | null; format?: (v: number) => string; risingIsBad?: boolean; big?: boolean }) {
  if (value === null) return <span className={cn("font-bold text-ek-mfg", big ? "text-sm" : "text-[12.5px]")}>—</span>;
  const f = format ?? String;
  const good = value > 0 !== !!risingIsBad;
  return (
    <span
      className={cn(
        "whitespace-nowrap font-bold tabular-nums",
        big ? "text-sm" : "text-[12.5px]",
        value === 0 ? "text-ek-mfg" : good ? "text-[#15803d]" : "text-red-600"
      )}
    >
      {value > 0 ? `↑ +${f(value)}` : value < 0 ? `↓ −${f(-value)}` : "→ 0"}
    </span>
  );
}

const FLAG_TONES = {
  red: "bg-[#fee2e2] text-red-700 shadow-[inset_0_0_0_1px_#fecaca]",
  amber: "bg-ek-accent text-amber-700 shadow-[inset_0_0_0_1px_#fcd9a4]",
  blue: "bg-[#dbeafe] text-[#1d4ed8] shadow-[inset_0_0_0_1px_#bfdbfe]",
};

export function Flag({ tone, children }: { tone: keyof typeof FLAG_TONES; children: ReactNode }) {
  return <span className={cn("whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-bold", FLAG_TONES[tone])}>{children}</span>;
}

export const CARD = "rounded-2xl border border-ek-border bg-card shadow-[0_1px_2px_rgba(42,38,34,.04),0_6px_16px_-10px_rgba(42,38,34,.12)]";

export function CardHead({ title, note, pad }: { title: string; note?: ReactNode; pad?: boolean }) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-0.5", pad ? "px-[18px] pb-1.5 pt-4" : "mb-3")}>
      <h3 className="font-display text-[17px] font-semibold">{title}</h3>
      {note && <small className="flex flex-wrap items-center gap-[5px] text-[12.5px] text-ek-mfg">{note}</small>}
    </div>
  );
}

export function LegendDot({ color }: { color: string }) {
  return <i className="ml-1.5 inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />;
}

export function Stat({ label, value, sub, valueClass }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-px text-[12.5px]">
      <span className="font-semibold text-ek-mfg">{label}</span>
      <b className={cn("font-display text-[22px] font-semibold leading-[1.2] tabular-nums", valueClass)}>{value}</b>
      {sub && <span className="text-ek-mfg">{sub}</span>}
    </div>
  );
}

export const TABLE_HEAD = "text-xs font-bold uppercase tracking-[0.04em] text-ek-mfg";
