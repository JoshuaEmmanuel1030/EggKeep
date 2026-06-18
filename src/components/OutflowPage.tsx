import { useState } from "react";
import { QuickOutflowBuilder } from "./QuickOutflowBuilder";
import { OutflowForm } from "./OutflowForm";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { StockSummary, InflowEntry, OutflowEntry } from "@/types/inventory";
import { ActivityLogMetadata } from "@/types/activityLog";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface OutflowPageProps {
  stockSummary: StockSummary[];
  inflows: InflowEntry[];
  onSubmit: (entries: OutflowEntry[], userEmail: string, metadata?: ActivityLogMetadata) => Promise<boolean>;
}

export function OutflowPage({ stockSummary, inflows, onSubmit }: OutflowPageProps) {
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Quick Outflow Builder */}
      <QuickOutflowBuilder 
        stockSummary={stockSummary} 
        inflows={inflows}
        onSubmit={onSubmit}
      />

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
            <span className="text-sm">Manual Outflow (Legacy / Advanced)</span>
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
    </div>
  );
}
