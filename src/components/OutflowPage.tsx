import { useRef, useState } from "react";
import { QuickOutflowBuilder } from "./QuickOutflowBuilder";
import { OutflowForm } from "./OutflowForm";
import { KasTunaiSale } from "./KasTunaiSale";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { StockSummary, InflowEntry, OutflowEntry } from "@/types/inventory";
import { ActivityLog, ActivityLogMetadata } from "@/types/activityLog";
import { ChevronDown, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

interface OutflowPageProps {
  stockSummary: StockSummary[];
  inflows: InflowEntry[];
  onSubmit: (entries: OutflowEntry[], userEmail: string, metadata?: ActivityLogMetadata) => Promise<boolean>;
  // Activity logs, for the tablet Kas Tunai "Hari ini" list.
  logs?: ActivityLog[];
  tablet?: boolean;
}

export function OutflowPage({ stockSummary, inflows, onSubmit, logs = [], tablet = false }: OutflowPageProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const [kasOpen, setKasOpen] = useState(false);
  const [kasCount, setKasCount] = useState(0);
  const railRef = useRef<HTMLButtonElement>(null);
  const { t } = useLanguage();

  // One tree for both layouts: the builder stays the first child of the same
  // element, so rotating across the tablet threshold never remounts it (and
  // never loses an unsaved order or queue). Only what follows it branches.
  return (
    <div className={tablet ? "relative flex min-h-0 flex-1 bg-ek-bg" : "space-y-6"}>
      <QuickOutflowBuilder
        tablet={tablet}
        stockSummary={stockSummary}
        inflows={inflows}
        onSubmit={onSubmit}
      />

      {tablet ? (
        <>
          {/* Kas Tunai rail: sits above the drawer so its toggle stays reachable. */}
          <div className="relative z-[21] flex w-12 shrink-0 flex-col items-center gap-2.5 border-l border-ek-border bg-card pt-3.5">
            <button
              ref={railRef}
              type="button"
              onClick={() => setKasOpen((o) => !o)}
              aria-expanded={kasOpen}
              className={cn(
                "flex w-10 items-center gap-2.5 rounded-[11px] border border-ek-border py-4 text-[15px] font-semibold text-ek-nav [writing-mode:vertical-rl]",
                kasOpen && "border-amber-500 bg-ek-accent text-amber-700"
              )}
            >
              <ShoppingCart aria-hidden className="h-[18px] w-[18px] rotate-90" />
              <span>{t.kas.title}</span>
              {kasCount > 0 && <span className="sr-only">, {t.outflow.linesCount.replace("{n}", String(kasCount))}</span>}
              <ChevronDown aria-hidden className={cn("h-4 w-4", kasOpen ? "-rotate-90" : "rotate-90")} />
            </button>
            {kasCount > 0 && (
              <span aria-hidden className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-amber-600 px-1.5 text-xs font-bold text-white">
                {kasCount}
              </span>
            )}
          </div>

          {/* Overlays the right panel (nothing reflows). Hidden, not unmounted,
              so a half-entered sale and the rail count survive closing it. */}
          <div
            className={cn(
              "absolute bottom-0 right-12 top-0 z-20 flex w-[380px] flex-col border-l border-ek-border bg-card shadow-[0_0_40px_rgba(0,0,0,.16)]",
              !kasOpen && "hidden"
            )}
          >
            <KasTunaiSale
              inflows={inflows}
              logs={logs}
              onSubmit={onSubmit}
              onClose={() => {
                // The drawer hides with focus inside it; hand focus back to the rail.
                setKasOpen(false);
                railRef.current?.focus();
              }}
              onValidCountChange={setKasCount}
            />
          </div>
        </>
      ) : (
        <>
          {/* Separator */}
          <div className="flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">or</span>
            <Separator className="flex-1" />
          </div>

          {/* Manual Outflow Form (collapsible) */}
          <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between h-12"
              >
                <span className="text-sm">{t.outflow.manualToggle}</span>
                <ChevronDown className={cn(
                  "h-4 w-4 transition-transform",
                  manualOpen && "rotate-180"
                )} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <OutflowForm inflows={inflows} onSubmit={onSubmit} />
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}
