import { useState, useMemo } from "react";
import { ActivityLog } from "@/types/activityLog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CATEGORY_LABELS } from "@/types/inventory";
import { format, parseISO } from "date-fns";
import { useLanguage } from "@/contexts/LanguageContext";
import { useVoidEntry } from "@/hooks/useVoidEntry";
import { useAuth } from "@/hooks/useAuth";
import { VoidEntryDialog } from "./VoidEntryDialog";
import { 
  ChevronDown,
  ShoppingCart,
  Egg,
  Package,
  Box,
  PackagePlus,
  PackageMinus,
  Store,
  Calendar,
  Cloud,
  CloudOff,
  FileText,
  Pencil
} from "lucide-react";
import { cn } from "@/lib/utils";

interface GroupedActivityLogProps {
  logs: ActivityLog[];
  showVoided?: boolean;
  viewMode?: "grouped" | "chronological";
}

interface BuyerOrder {
  buyerName: string;
  orderLines: Array<{ skuCode?: string; packQty?: number; eggProduct?: string; looseQty?: number }>;
  materials: Array<{ product: string; quantity: number; type: string }>;
  timestamp: string;
  outflowDate?: string;
  invoiceRef?: string;
  isSynced: boolean;
  logs: ActivityLog[];
}

interface ManualEntry {
  log: ActivityLog;
}

interface DateGroup {
  date: string;
  quickOutflows: Map<string, BuyerOrder>;
  manualOutflows: ManualEntry[];
  inflows: ActivityLog[];
}

export function GroupedActivityLog({ logs, showVoided = false, viewMode = "grouped" }: GroupedActivityLogProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { canEdit, getEditWindowHours, voidOutflow, voidInflow, findRelatedEntryId, isAdmin } = useVoidEntry();
  
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ActivityLog | null>(null);
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidOrderDialogOpen, setVoidOrderDialogOpen] = useState(false);
  const [voidOrderLogs, setVoidOrderLogs] = useState<ActivityLog[]>([]);

  // Group logs by date, then by type (quick outflow, manual outflow, inflow)
  const groupedData = useMemo(() => {
    const groups = new Map<string, DateGroup>();

    logs.forEach((log) => {
      const dateKey = format(parseISO(log.recorded_at), "yyyy-MM-dd");
      const displayDate = format(parseISO(log.recorded_at), "MMMM d, yyyy");

      if (!groups.has(dateKey)) {
        groups.set(dateKey, {
          date: displayDate,
          quickOutflows: new Map(),
          manualOutflows: [],
          inflows: [],
        });
      }

      const group = groups.get(dateKey)!;

      if (log.action_type === "inflow") {
        group.inflows.push(log);
      } else if (log.metadata?.orderType === "quick_outflow" && log.metadata?.buyerName) {
        // Quick outflow - group by buyer + order content + outflow date + time bucket
        // Use 30-second buckets to group materials from the same order together,
        // but separate orders placed minutes/hours apart
        const timeBucket = Math.floor(new Date(log.recorded_at).getTime() / 30000); // 30-second bucket
        const orderKey = `${log.metadata.buyerName}_${JSON.stringify(log.metadata.orderLines || [])}_${log.metadata.outflowDate || 'null'}_${timeBucket}`;
        
        if (!group.quickOutflows.has(orderKey)) {
          group.quickOutflows.set(orderKey, {
            buyerName: log.metadata.buyerName,
            orderLines: log.metadata.orderLines || [],
            materials: log.metadata.relatedProducts || [],
            timestamp: log.recorded_at,
            outflowDate: log.metadata.outflowDate,
            invoiceRef: log.metadata.invoiceRef,
            isSynced: log.isSynced ?? true,
            logs: [log],
          });
        } else {
          const existing = group.quickOutflows.get(orderKey)!;
          existing.logs.push(log);
          if (!log.isSynced) {
            existing.isSynced = false;
          }
        }
      } else {
        // Manual outflow
        group.manualOutflows.push({ log });
      }
    });

    // Sort by date descending
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([_, value]) => value);
  }, [logs]);

  const handleEditClick = (log: ActivityLog) => {
    setSelectedEntry(log);
    setVoidDialogOpen(true);
  };

  const handleVoidConfirm = async (reason: string) => {
    if (!selectedEntry) return;
    
    setVoidLoading(true);
    try {
      const entryId = await findRelatedEntryId(selectedEntry);
      
      if (!entryId) {
        console.error("Could not find related entry");
        return;
      }

      if (selectedEntry.action_type === "outflow") {
        await voidOutflow(entryId, selectedEntry.id, reason);
      } else {
        await voidInflow(entryId, selectedEntry.id, reason);
      }
    } finally {
      setVoidLoading(false);
      setSelectedEntry(null);
    }
  };

  const handleVoidOrderClick = (logs: ActivityLog[]) => {
    setVoidOrderLogs(logs);
    setVoidOrderDialogOpen(true);
  };

  const handleVoidOrderConfirm = async (reason: string) => {
    setVoidLoading(true);
    try {
      for (const log of voidOrderLogs) {
        const entryId = await findRelatedEntryId(log);
        if (!entryId) continue;
        if (log.action_type === 'outflow') {
          await voidOutflow(entryId, log.id, reason);
        } else {
          await voidInflow(entryId, log.id, reason);
        }
      }
    } finally {
      setVoidLoading(false);
      setVoidOrderLogs([]);
    }
  };

  const isEditable = (log: ActivityLog) => {
    return canEdit(log.created_at, log.user_id) && !log.voided_at;
  };

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {t.activity.title} - No activity logs yet
      </div>
    );
  }

  // Chronological view - flat list sorted by time
  if (viewMode === "chronological") {
    const sortedLogs = [...logs].sort((a, b) => 
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
    );

    return (
      <div className="space-y-2">
        {sortedLogs.map((log) => (
          <ChronologicalEntry
            key={log.id}
            log={log}
            onEditClick={handleEditClick}
            isEditable={isEditable}
            getEditWindowHours={getEditWindowHours}
          />
        ))}
        
        <VoidEntryDialog
          open={voidDialogOpen}
          onOpenChange={setVoidDialogOpen}
          entry={selectedEntry}
          onConfirm={handleVoidConfirm}
          loading={voidLoading}
        />
      </div>
    );
  }

  // Grouped view - hierarchical by date and type
  return (
    <div className="space-y-6">
      {groupedData.map((dateGroup, idx) => (
        <DateSection
          key={idx}
          group={dateGroup}
          onEditClick={handleEditClick}
          isEditable={isEditable}
          getEditWindowHours={getEditWindowHours}
          onVoidOrderClick={handleVoidOrderClick}
        />
      ))}
      
      <VoidEntryDialog
        open={voidDialogOpen}
        onOpenChange={setVoidDialogOpen}
        entry={selectedEntry}
        onConfirm={handleVoidConfirm}
        loading={voidLoading}
      />
      <VoidEntryDialog
        open={voidOrderDialogOpen}
        onOpenChange={setVoidOrderDialogOpen}
        entry={voidOrderLogs[0] ?? null}
        onConfirm={handleVoidOrderConfirm}
        loading={voidLoading}
        orderLogsCount={voidOrderLogs.length}
      />
    </div>
  );
}

interface DateSectionProps {
  group: DateGroup;
  onEditClick: (log: ActivityLog) => void;
  isEditable: (log: ActivityLog) => boolean;
  getEditWindowHours: (createdAt: string) => number;
  onVoidOrderClick: (logs: ActivityLog[]) => void;
}

function DateSection({ group, onEditClick, isEditable, getEditWindowHours, onVoidOrderClick }: DateSectionProps) {
  const { t } = useLanguage();
  const hasQuickOutflows = group.quickOutflows.size > 0;
  const hasManualOutflows = group.manualOutflows.length > 0;
  const hasInflows = group.inflows.length > 0;

  return (
    <div className="space-y-4">
      {/* Date Header */}
      <div className="flex items-center gap-2 sticky top-0 bg-background py-2 z-10">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-lg">{group.date}</h3>
        <div className="flex-1 border-t border-border ml-2" />
      </div>

      {/* Quick Outflows */}
      {hasQuickOutflows && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ShoppingCart className="h-4 w-4" />
            <span>{t.activity.quickOutflows || "Quick Outflows"}</span>
          </div>
          <div className="space-y-2 pl-2">
            {Array.from(group.quickOutflows.values()).map((order, idx) => (
              <BuyerOrderCard
                key={idx}
                order={order}
                onEditClick={onEditClick}
                isEditable={isEditable}
                getEditWindowHours={getEditWindowHours}
                onVoidOrderClick={onVoidOrderClick}
              />
            ))}
          </div>
        </div>
      )}

      {/* Manual Outflows */}
      {hasManualOutflows && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <PackageMinus className="h-4 w-4" />
            <span>{t.activity.manualOutflows || "Manual Outflows"}</span>
          </div>
          <div className="space-y-2 pl-2">
            {group.manualOutflows.map((entry, idx) => (
              <ManualOutflowEntry 
                key={idx} 
                log={entry.log} 
                onEditClick={onEditClick}
                isEditable={isEditable}
                getEditWindowHours={getEditWindowHours}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inflows */}
      {hasInflows && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <PackagePlus className="h-4 w-4" />
            <span>{t.activity.inflows || "Inflows"}</span>
          </div>
          <div className="space-y-2 pl-2">
            {group.inflows.map((log) => (
              <InflowEntry 
                key={log.id} 
                log={log} 
                onEditClick={onEditClick}
                isEditable={isEditable}
                getEditWindowHours={getEditWindowHours}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface BuyerOrderCardProps {
  order: BuyerOrder;
  onEditClick: (log: ActivityLog) => void;
  isEditable: (log: ActivityLog) => boolean;
  getEditWindowHours: (createdAt: string) => number;
  onVoidOrderClick: (logs: ActivityLog[]) => void;
}

function BuyerOrderCard({ order, onEditClick, isEditable, getEditWindowHours, onVoidOrderClick }: BuyerOrderCardProps) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const formattedTime = format(parseISO(order.timestamp), "HH:mm");
  
  const firstLog = order.logs[0];
  const canEditOrder = firstLog && isEditable(firstLog);
  const hoursRemaining = firstLog ? getEditWindowHours(firstLog.created_at) : 0;
  const isVoided = firstLog?.voided_at != null;
  
  // Format the outflow date (the business date when outflow actually occurred)
  const outflowDateFormatted = order.outflowDate 
    ? format(parseISO(order.outflowDate), "MMM d, yyyy")
    : null;

  return (
    <Card className={cn(
      "overflow-hidden relative",
      !order.isSynced && "border-dashed border-yellow-500/50 bg-muted/50",
      isVoided && "opacity-60 bg-muted/30"
    )}>
      {isVoided && (
        <Badge variant="destructive" className="absolute top-2 right-2 z-10">
          {t.activity.voided}
        </Badge>
      )}
      <CardContent className="p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Store className="h-4 w-4 text-primary" />
            <span className={cn("font-medium", isVoided && "line-through")}>{order.buyerName}</span>
            {order.invoiceRef && (
              <Badge variant="outline" className="text-xs gap-1">
                <FileText className="h-3 w-3" />
                {order.invoiceRef}
              </Badge>
            )}
            {outflowDateFormatted && (
              <Badge variant="outline" className="text-xs gap-1">
                <Calendar className="h-3 w-3" />
                {outflowDateFormatted}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            <span>{formattedTime}</span>
            {order.isSynced ? (
              <Cloud className="h-3 w-3 text-green-500" />
            ) : (
              <CloudOff className="h-3 w-3 text-yellow-500" />
            )}
            {canEditOrder && !isVoided && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onEditClick(firstLog)}
                  title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
                  aria-label="Edit"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                {order.logs.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-destructive hover:text-destructive px-2"
                    aria-label="Void entire order"
                    onClick={() => onVoidOrderClick(order.logs)}
                  >
                    Void Order
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* User Email */}
        {firstLog?.user_email && (
          <div className="text-xs text-muted-foreground mb-2">
            by: {firstLog.user_email}
          </div>
        )}

        {/* Order Lines */}
        <div className={cn("space-y-1 mb-2", isVoided && "line-through")}>
          {order.orderLines.map((line, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              {line.skuCode && line.packQty && (
                <>
                  <Badge variant="secondary" className="text-xs font-mono">
                    {line.skuCode}
                  </Badge>
                  <span className="text-muted-foreground">×</span>
                  <span className="font-medium">{line.packQty}</span>
                  <span className="text-muted-foreground text-xs">{t.activity.packs}</span>
                </>
              )}
              {line.eggProduct && line.looseQty && (
                <>
                  <Badge variant="outline" className="text-xs">
                    {line.eggProduct}
                  </Badge>
                  <span className="text-muted-foreground">×</span>
                  <span className="font-medium">{line.looseQty}</span>
                  <span className="text-muted-foreground text-xs">{t.activity.loose}</span>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Void Reason */}
        {isVoided && firstLog?.void_reason && (
          <div className="text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded">
            {t.activity.voidReason}: {firstLog.void_reason}
          </div>
        )}

        {/* Materials Breakdown (Expandable) */}
        {order.materials.length > 0 && (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1 border-t">
                <span>{t.activity.viewMaterials}</span>
                <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-2 space-y-1.5">
                {order.materials.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    {item.type === 'egg' && <Egg className="h-3 w-3 text-amber-500" />}
                    {item.type === 'packaging' && <Package className="h-3 w-3 text-emerald-500" />}
                    {item.type === 'box' && <Box className="h-3 w-3 text-blue-500" />}
                    <span className="text-muted-foreground">{item.product}:</span>
                    <span className="font-medium">{item.quantity.toLocaleString()}</span>
                    <span className="text-muted-foreground">{item.type === 'egg' ? 'butir' : 'pcs'}</span>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

interface EntryProps {
  log: ActivityLog;
  onEditClick: (log: ActivityLog) => void;
  isEditable: (log: ActivityLog) => boolean;
  getEditWindowHours: (createdAt: string) => number;
}

function ManualOutflowEntry({ log, onEditClick, isEditable, getEditWindowHours }: EntryProps) {
  const { t } = useLanguage();
  const formattedTime = format(parseISO(log.recorded_at), "HH:mm");
  const canEditEntry = isEditable(log);
  const hoursRemaining = getEditWindowHours(log.created_at);
  const isVoided = log.voided_at != null;

  return (
    <Card className={cn(
      "overflow-hidden relative",
      !log.isSynced && "border-dashed border-yellow-500/50 bg-muted/50",
      isVoided && "opacity-60 bg-muted/30"
    )}>
      {isVoided && (
        <Badge variant="destructive" className="absolute top-2 right-2 z-10">
          {t.activity.voided}
        </Badge>
      )}
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {CATEGORY_LABELS[log.category]}
            </Badge>
            <span className={cn("font-medium", isVoided && "line-through")}>{log.product}</span>
            <span className="text-muted-foreground">:</span>
            <span className={cn("font-medium", isVoided && "line-through")}>{log.quantity_butir.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">
              {log.category === 'egg' ? 'butir' : 'pcs'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formattedTime}</span>
            {log.isSynced ? (
              <Cloud className="h-3 w-3 text-green-500" />
            ) : (
              <CloudOff className="h-3 w-3 text-yellow-500" />
            )}
            {canEditEntry && !isVoided && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onEditClick(log)}
                title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
                aria-label="Edit"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
        {log.user_email && (
          <div className="text-xs text-muted-foreground mt-1">
            by: {log.user_email}
          </div>
        )}
        {/* Void Reason */}
        {isVoided && log.void_reason && (
          <div className="text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded">
            {t.activity.voidReason}: {log.void_reason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InflowEntry({ log, onEditClick, isEditable, getEditWindowHours }: EntryProps) {
  const { t } = useLanguage();
  const formattedTime = format(parseISO(log.recorded_at), "HH:mm");
  const canEditEntry = isEditable(log);
  const hoursRemaining = getEditWindowHours(log.created_at);
  const isVoided = log.voided_at != null;

  return (
    <Card className={cn(
      "overflow-hidden border-green-500/30 relative",
      !log.isSynced && "border-dashed border-yellow-500/50 bg-muted/50",
      isVoided && "opacity-60 bg-muted/30"
    )}>
      {isVoided && (
        <Badge variant="destructive" className="absolute top-2 right-2 z-10">
          {t.activity.voided}
        </Badge>
      )}
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs border-green-500/50 text-green-600">
              {CATEGORY_LABELS[log.category]}
            </Badge>
            <span className={cn("font-medium", isVoided && "line-through")}>{log.product}</span>
            <span className="text-muted-foreground">:</span>
            <span className={cn("font-medium text-green-600", isVoided && "line-through")}>+{log.quantity_butir.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">
              {log.category === 'egg' ? 'butir' : 'pcs'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formattedTime}</span>
            {log.isSynced ? (
              <Cloud className="h-3 w-3 text-green-500" />
            ) : (
              <CloudOff className="h-3 w-3 text-yellow-500" />
            )}
            {canEditEntry && !isVoided && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onEditClick(log)}
                title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
                aria-label="Edit"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
        {log.invoice_supplier && (
          <div className="text-xs text-muted-foreground mt-1">
            Invoice: {log.invoice_supplier}
          </div>
        )}
        {/* User email and inflow date */}
        <div className="flex items-center gap-3 flex-wrap mt-1">
          {log.metadata?.inflowDate && (
            <Badge variant="outline" className="text-xs gap-1">
              <Calendar className="h-3 w-3" />
              {format(parseISO(log.metadata.inflowDate), "MMM d, yyyy")}
            </Badge>
          )}
          {log.user_email && (
            <span className="text-xs text-muted-foreground">
              by: {log.user_email}
            </span>
          )}
        </div>
        {/* Void Reason */}
        {isVoided && log.void_reason && (
          <div className="text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded">
            {t.activity.voidReason}: {log.void_reason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Chronological view entry - unified display for all log types
function ChronologicalEntry({ log, onEditClick, isEditable, getEditWindowHours }: EntryProps) {
  const { t } = useLanguage();
  const formattedDateTime = format(parseISO(log.recorded_at), "MMM d, yyyy HH:mm");
  const canEditEntry = isEditable(log);
  const hoursRemaining = getEditWindowHours(log.created_at);
  const isVoided = log.voided_at != null;
  const isInflow = log.action_type === "inflow";
  const isQuickOutflow = log.metadata?.orderType === "quick_outflow";

  return (
    <Card className={cn(
      "overflow-hidden relative",
      !log.isSynced && "border-dashed border-yellow-500/50 bg-muted/50",
      isVoided && "opacity-60 bg-muted/30",
      isInflow && "border-green-500/30"
    )}>
      {isVoided && (
        <Badge variant="destructive" className="absolute top-2 right-2 z-10">
          {t.activity.voided}
        </Badge>
      )}
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
            {/* Timestamp */}
            <span className="text-xs text-muted-foreground shrink-0">{formattedDateTime}</span>
            
            {/* Action Type Badge */}
            <Badge variant={isInflow ? "outline" : "secondary"} className={cn(
              "text-xs shrink-0",
              isInflow && "border-green-500/50 text-green-600"
            )}>
              {isInflow ? (
                <><PackagePlus className="h-3 w-3 mr-1" />Inflow</>
              ) : isQuickOutflow ? (
                <><ShoppingCart className="h-3 w-3 mr-1" />Quick</>
              ) : (
                <><PackageMinus className="h-3 w-3 mr-1" />Outflow</>
              )}
            </Badge>

            {/* Category */}
            <Badge variant="outline" className="text-xs shrink-0">
              {CATEGORY_LABELS[log.category]}
            </Badge>

            {/* Product & Quantity */}
            <span className={cn("font-medium truncate", isVoided && "line-through")}>{log.product}</span>
            <span className="text-muted-foreground shrink-0">:</span>
            <span className={cn(
              "font-medium shrink-0",
              isInflow && "text-green-600",
              isVoided && "line-through"
            )}>
              {isInflow ? "+" : "-"}{log.quantity_butir.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              {log.category === 'egg' ? 'butir' : 'pcs'}
            </span>

            {/* Buyer name for quick outflows */}
            {isQuickOutflow && log.metadata?.buyerName && (
              <Badge variant="outline" className="text-xs gap-1 shrink-0">
                <Store className="h-3 w-3" />
                {log.metadata.buyerName}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {log.isSynced ? (
              <Cloud className="h-3 w-3 text-green-500" />
            ) : (
              <CloudOff className="h-3 w-3 text-yellow-500" />
            )}
            {canEditEntry && !isVoided && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onEditClick(log)}
                title={t.activity.withinEditWindow.replace('{hours}', String(hoursRemaining))}
                aria-label="Edit"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* User email */}
        {log.user_email && (
          <div className="text-xs text-muted-foreground mt-1">
            by: {log.user_email}
          </div>
        )}

        {/* Invoice reference */}
        {log.invoice_supplier && (
          <div className="text-xs text-muted-foreground mt-1">
            Invoice: {log.invoice_supplier}
          </div>
        )}

        {/* Void Reason */}
        {isVoided && log.void_reason && (
          <div className="text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded">
            {t.activity.voidReason}: {log.void_reason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
