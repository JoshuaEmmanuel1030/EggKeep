import { useRef } from "react";
import { format } from "date-fns";
import { ChevronDown, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { kasDateLabel } from "@/lib/kasTunai";
import { cn } from "@/lib/utils";

interface SubtleDateLinkProps {
  // yyyy-MM-dd of a past day; null means today.
  value: string | null;
  onChange: (value: string | null) => void;
}

// "hari ini ▾" inside a subtitle. Tapping opens the native picker (max = today);
// a past date shows in amber with a × back to today.
export function SubtleDateLink({ value, onChange }: SubtleDateLinkProps) {
  const { t, language } = useLanguage();
  const locale = language === "id" ? "id-ID" : "en-US";
  const dateRef = useRef<HTMLInputElement>(null);
  const max = format(new Date(), "yyyy-MM-dd");

  const openPicker = () => {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  return (
    <>
      <span className="relative inline-flex">
        <button
          type="button"
          onClick={openPicker}
          title={t.kas.changeDate}
          className={cn(
            "inline-flex items-center gap-0.5 whitespace-nowrap border-b border-dotted border-[#b8ab9a] leading-[1.2] hover:text-ek-fg",
            value && "border-amber-500 text-amber-700"
          )}
        >
          {value ? kasDateLabel(value, locale) : t.kas.today}
          <ChevronDown aria-hidden className="h-3 w-3 opacity-60" strokeWidth={2.4} />
        </button>
        <input
          ref={dateRef}
          type="date"
          value={value ?? max}
          max={max}
          tabIndex={-1}
          aria-label={t.common.date}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v && v < max ? v : null);
          }}
          className="pointer-events-none absolute bottom-0 left-0 h-px w-px border-0 p-0 opacity-0"
        />
      </span>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t.kas.backToToday}
          title={t.kas.backToToday}
          className="ml-0.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-ek-mfg hover:bg-ek-muted hover:text-ek-fg"
        >
          <X aria-hidden className="h-[11px] w-[11px]" strokeWidth={2.6} />
        </button>
      )}
    </>
  );
}
