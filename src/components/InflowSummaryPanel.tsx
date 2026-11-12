import { parseISO } from "date-fns";
import { PackagePlus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import type { InventoryCategory } from "@/types/inventory";

export interface InflowSummaryLine {
  id: string;
  product: string;
  invoiceSupplier: string;
  // All in the product's native stock unit (kg-native: no conversion).
  quantity: number;
  now: number;
  after: number;
  unit: string;
}

export interface InflowSummaryGroup {
  category: InventoryCategory;
  Icon: LucideIcon;
  color: string;
  lines: InflowSummaryLine[];
}

interface InflowSummaryPanelProps {
  date: string;
  groups: InflowSummaryGroup[]; // enabled categories only
  submitting: boolean;
  brokenNote: string | null; // a typed Jumlah that won't be recorded: why the submit is blocked
}

// Tablet Masuk right panel: the Ringkasan plus the pinned submit button. Sits
// inside InflowForm's <form>, so the button submits it.
export function InflowSummaryPanel({ date, groups, submitting, brokenNote }: InflowSummaryPanelProps) {
  const { t, language } = useLanguage();
  const locale = language === "id" ? "id-ID" : "en-US";
  const nf = (n: number) => n.toLocaleString(locale);
  const validCount = groups.reduce((sum, g) => sum + g.lines.length, 0);

  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col border-l border-ek-border bg-card text-ek-fg">
      <div className="min-h-0 flex-1 overflow-y-auto p-[18px]">
        <h3 className="mb-2 font-display text-lg font-semibold">{t.inflow.summary}</h3>
        <div className="-mt-1 mb-1.5 text-sm text-ek-mfg">
          {parseISO(date).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </div>

        {groups.length === 0 && <p className="my-1.5 text-[14.5px] text-ek-mfg">{t.inflow.selectCategories}</p>}

        {groups.map(({ category, Icon, color, lines }) => (
          <div key={category} className="mt-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Icon aria-hidden className={cn("h-4 w-4", color)} />
              {t.categories[category]}
              <span className="ml-auto text-[13px] font-medium text-ek-mfg">
                {lines.length} {t.common.items}
              </span>
            </div>
            {lines.length === 0 ? (
              <p className="mb-2 mt-1 text-[13.5px] text-ek-mfg">{t.common.clickAddItem}</p>
            ) : (
              lines.map((line) => {
                // The after value is bold, so the template splits around it.
                const [beforeAfter, afterAfter] = t.inflow.stockLine
                  .replace("{now}", nf(line.now))
                  .replace("{unit}", line.unit)
                  .split("{after}");
                return (
                  <div key={line.id} className="border-b border-ek-border py-2 pl-6">
                    <div className="flex justify-between gap-2 text-sm font-semibold">
                      <span className="min-w-0">{line.product}</span>
                      <span className="whitespace-nowrap tabular-nums text-emerald-600">
                        +{nf(line.quantity)} {line.unit}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12.5px] tabular-nums text-ek-mfg">
                      {line.invoiceSupplier && `${line.invoiceSupplier} · `}
                      {beforeAfter}
                      <b className="font-bold text-ek-fg">{nf(line.after)}</b>
                      {afterAfter}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 border-t border-ek-border px-[18px] pb-4 pt-3.5">
        {brokenNote ? (
          <div role="alert" className="text-[13.5px] leading-[1.35] text-red-600">{brokenNote}</div>
        ) : validCount > 0 ? (
          <div className="flex items-center gap-2 text-sm text-ek-mfg">
            <b className="rounded-full bg-ek-muted px-2.5 py-[3px] text-[13px] font-semibold text-ek-fg">
              {validCount} {t.common.items}
            </b>
            {t.common.readyToAdd}
          </div>
        ) : (
          <div className="text-[13.5px] leading-[1.35] text-ek-mfg">{t.inflow.pleaseAddOneItem}</div>
        )}
        <Button
          type="submit"
          disabled={submitting || validCount === 0 || !!brokenNote}
          className="h-[54px] w-full gap-2 rounded-[13px] bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-[.45] [&_svg]:size-[18px]"
        >
          <PackagePlus aria-hidden />
          {submitting ? t.common.saving : t.inflow.addToInventory}
        </Button>
      </div>
    </aside>
  );
}
