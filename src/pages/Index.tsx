import { useState, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { format } from "date-fns";
import { Header } from "@/components/Header";
import { AppSidebar, SidebarKey } from "@/components/AppSidebar";
import { useIsTabletLandscape } from "@/hooks/use-mobile";
import { toOutflowLogPayloads } from "@/lib/orderPayload";
import { InflowForm } from "@/components/InflowForm";
import { OutflowPage } from "@/components/OutflowPage";
import { InventoryDashboard } from "@/components/InventoryDashboard";
import { Catalog } from "@/pages/Catalog";
import { ActivityLogList } from "@/components/ActivityLogList";
import { UserManagement } from "@/components/UserManagement";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InflowEntry, OutflowEntry } from "@/types/inventory";
import { ActivityLogMetadata } from "@/types/activityLog";
import { useInventorySync } from "@/hooks/useInventorySync";
import { useActivityLogs } from "@/hooks/useActivityLogs";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useOutflowOutbox } from "@/hooks/useOutflowOutbox";
import { useReturnOutbox } from "@/hooks/useReturnOutbox";
import { OutflowOutboxBanner } from "@/components/OutflowOutboxBanner";
import { toast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { useItemTypes } from "@/hooks/useItemTypes";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  calculateStockSummary,
  exportInflowsToCSV,
  downloadCSV,
  getProductUnit,
} from "@/lib/inventory";
import { PackagePlus, PackageMinus, LayoutDashboard, Library, History, BarChart2, Users } from "lucide-react";
import { InfosPage } from "@/components/InfosPage";
import { InventoryAssistant } from "@/components/InventoryAssistant";
import { Badge } from "@/components/ui/badge";

const TABS = ["dashboard", "inflow", "outflow", "infos", "activity", "catalog", "users"];

const Index = () => {
  const { inflows, outflows, loading, addMultipleInflows, submitOrderOutflows, refetch: refetchInventory } = useInventorySync();
  const { logs, loading: logsLoading, pendingCount, isOnline, refetch: refetchLogs } = useActivityLogs();
  const { addActivityLog } = useOfflineSync();
  const { isAdmin } = useUserRole();
  const { itemTypes, conversionMap } = useItemTypes();
  const { t } = useLanguage();
  const isTablet = useIsTabletLandscape();
  // The tablet sidebar on other routes (e.g. /stock-count) deep-links back via
  // navigate("/", { state: { tab } }).
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(() => {
    const tab = (location.state as { tab?: unknown } | null)?.tab;
    return typeof tab === "string" && TABS.includes(tab) ? tab : "dashboard";
  });

  // Offline outbox for outflow orders: refetch inventory + logs after a queued
  // order is replayed successfully so this device shows the DB-computed stock.
  const handleOutboxSynced = useCallback(() => {
    refetchInventory();
    refetchLogs();
  }, [refetchInventory, refetchLogs]);
  const {
    orders: outboxOrders,
    enqueue: enqueueOutflowOrder,
    discard: discardOutboxOrder,
    retry: retryOutboxOrder,
  } = useOutflowOutbox({ onOrderSynced: handleOutboxSynced });

  // Offline outbox replay for returns (retur): a return recorded while offline is
  // queued in localStorage and replayed here on start/reconnect/focus. Refetch
  // stock+logs after a synced return so restock/retakan changes show up.
  useReturnOutbox({ onSynced: handleOutboxSynced });

  const handleInflowSubmit = useCallback(async (entries: InflowEntry[], userEmail: string) => {
    const success = await addMultipleInflows(entries);
    if (success) {
      // Create activity logs for each entry
      for (const entry of entries) {
        await addActivityLog({
          action_type: 'inflow',
          product: entry.product,
          quantity_butir: entry.quantityInButir,
          quantity_original: entry.quantity,
          recorded_at: new Date().toISOString(),
          category: entry.category,
          invoice_supplier: entry.invoiceSupplier,
          user_email: userEmail,
          metadata: {
            inflowDate: entry.date,
            relatedEntryId: entry.id,
          },
        });
      }
      setActiveTab("dashboard");
    }
    return success;
  }, [addMultipleInflows, addActivityLog]);

  const handleOutflowSubmit = useCallback(
    async (entries: OutflowEntry[], userEmail: string, metadata?: ActivityLogMetadata) => {
      // One atomic call for the whole order: eggs, packaging, labels, and boxes
      // all go through together or none of them do.
      const result = await submitOrderOutflows(entries);

      const logPayloads = toOutflowLogPayloads(entries, userEmail, metadata, new Date().toISOString());

      if (!result.ok) {
        if (result.kind === "network") {
          // Offline / connection dropped: queue the whole order (entries + the
          // activity logs to write after success) and replay it when back online.
          // The RPC skips already-recorded entry ids, so a replay after a
          // partially-observed success can never double-deduct stock.
          enqueueOutflowOrder(entries, logPayloads);
          toast({
            title: t.outbox.savedOffline,
            description: t.outbox.savedOfflineDesc,
          });
          setActiveTab("dashboard");
          return true; // order accepted — forms clear, banner shows pending sync
        }
        return false; // server rejected (e.g. INSUFFICIENT_STOCK) — already toasted
      }

      for (const log of logPayloads) {
        await addActivityLog(log);
      }
      setActiveTab("dashboard");
      return true;
    },
    [submitOrderOutflows, addActivityLog, enqueueOutflowOrder, t]
  );

  const handleExport = useCallback(() => {
    // Derive each egg row's unit from the catalog conversion map instead of the
    // hardcoded product names baked into the DB row mapping.
    const withUnits = inflows.map((i) =>
      i.category === "egg" ? { ...i, unit: getProductUnit(i.product, conversionMap) } : i
    );
    const csv = exportInflowsToCSV(withUnits);
    const filename = `js-online-inflows-${format(new Date(), "yyyy-MM-dd")}.csv`;
    downloadCSV(csv, filename);
  }, [inflows, conversionMap]);

  // Per-egg freshness windows from the catalog (falls back to the 5-day default).
  const freshnessDaysByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of itemTypes) {
      if (t.category === "egg" && t.freshnessDays != null && t.freshnessDays > 0) {
        map[t.name] = t.freshnessDays;
      }
    }
    return map;
  }, [itemTypes]);

  const stockSummary = useMemo(
    () => calculateStockSummary(inflows, conversionMap, freshnessDaysByProduct),
    [inflows, conversionMap, freshnessDaysByProduct]
  );

  // Shared by both layouts. Mobile keeps its "m-0" panes; on tablet each pane
  // scrolls on its own and Activities fills the height with its split view.
  const pane = isTablet ? "m-0 min-h-0 flex-1 overflow-y-auto px-6 py-6" : "m-0";
  // Tablet has no TabsList, so drop Radix's tabpanel role, its aria-labelledby
  // (pointing at a trigger that isn't rendered) and the extra tab stop.
  const paneA11y = isTablet ? { role: undefined, "aria-labelledby": undefined, tabIndex: undefined } : undefined;

  const tabContents = (
    <>
      <TabsContent value="dashboard" className={pane} {...paneA11y}>
        <InventoryDashboard
          stockSummary={stockSummary}
          inflows={inflows}
          outflows={outflows}
          freshnessDaysByProduct={freshnessDaysByProduct}
          loading={loading}
        />
      </TabsContent>

      <TabsContent value="inflow" className={pane} {...paneA11y}>
        <div className="max-w-2xl mx-auto">
          <InflowForm onSubmit={handleInflowSubmit} />
        </div>
      </TabsContent>

      <TabsContent value="outflow" className={pane} {...paneA11y}>
        <div className="max-w-4xl mx-auto">
          <OutflowPage
            stockSummary={stockSummary}
            inflows={inflows}
            onSubmit={handleOutflowSubmit}
          />
        </div>
      </TabsContent>

      <TabsContent value="infos" className={pane} {...paneA11y}>
        <div className="max-w-4xl mx-auto">
          <InfosPage
            stockSummary={stockSummary}
            inflows={inflows}
            outflows={outflows}
          />
        </div>
      </TabsContent>

      {/* data-[state=active]:flex, not flex: a display utility would beat the
          [hidden] rule Radix relies on for inactive panes. */}
      <TabsContent
        value="activity"
        className={isTablet ? "m-0 min-h-0 flex-1 flex-col data-[state=active]:flex" : "m-0"}
        {...paneA11y}
      >
        {/* Same element in both layouts so rotating keeps the filter state. */}
        <div className={isTablet ? "contents" : "max-w-2xl mx-auto"}>
          <ActivityLogList
            tablet={isTablet}
            logs={logs}
            loading={logsLoading}
            pendingCount={pendingCount}
            isOnline={isOnline}
            onVoided={() => { refetchInventory(); refetchLogs(); }}
          />
        </div>
      </TabsContent>

      <TabsContent value="catalog" className={pane} {...paneA11y}>
        <div className="max-w-4xl mx-auto">
          <Catalog />
        </div>
      </TabsContent>

      {isAdmin && (
        <TabsContent value="users" className={pane} {...paneA11y}>
          <div className="max-w-4xl mx-auto">
            <UserManagement />
          </div>
        </TabsContent>
      )}
    </>
  );

  // One tree for both layouts: only the chrome is conditional, and the panes,
  // banner and assistant keep their positions, so crossing the tablet threshold
  // (rotating) doesn't remount them and lose an unsaved order or open chat.
  return (
    <div className={isTablet ? "flex h-app overflow-hidden bg-background" : "min-h-screen bg-background"}>
      {isTablet ? (
        <AppSidebar
          active={activeTab as SidebarKey}
          onSelectTab={setActiveTab}
          pendingCount={pendingCount}
          isOnline={isOnline}
          onExport={handleExport}
        />
      ) : (
        <Header onExport={handleExport} />
      )}

      <main className={isTablet ? "flex min-w-0 flex-1 flex-col" : "container py-6 px-4 sm:px-6"}>
        <div className={isTablet && outboxOrders.length > 0 ? "px-6 pt-4" : undefined}>
          <OutflowOutboxBanner
            orders={outboxOrders}
            onDiscard={discardOutboxOrder}
            onRetry={retryOutboxOrder}
          />
        </div>
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className={isTablet ? "flex min-h-0 flex-1 flex-col" : "space-y-6"}
        >
          {!isTablet && (
            <TabsList className={`grid w-full h-auto sm:h-12 p-1 gap-1 ${isAdmin ? 'grid-cols-4 sm:grid-cols-7' : 'grid-cols-3 sm:grid-cols-6'}`}>
              <TabsTrigger value="dashboard" title={t.nav.dashboard} className="gap-1.5 sm:gap-2 data-[state=active]:shadow-sm h-10 sm:h-auto text-xs sm:text-sm">
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                <span className="hidden xs:inline truncate">{t.nav.dashboard}</span>
              </TabsTrigger>
              <TabsTrigger value="inflow" title={t.nav.inflow} className="gap-1.5 sm:gap-2 data-[state=active]:shadow-sm h-10 sm:h-auto text-xs sm:text-sm">
                <PackagePlus className="h-4 w-4 shrink-0" />
                <span className="hidden xs:inline truncate">{t.nav.inflow}</span>
              </TabsTrigger>
              <TabsTrigger value="outflow" title={t.nav.outflow} className="gap-1.5 sm:gap-2 data-[state=active]:shadow-sm h-10 sm:h-auto text-xs sm:text-sm">
                <PackageMinus className="h-4 w-4 shrink-0" />
                <span className="hidden xs:inline truncate">{t.nav.outflow}</span>
              </TabsTrigger>
              <TabsTrigger value="infos" title={t.nav.infos} className="gap-1.5 sm:gap-2 data-[state=active]:shadow-sm h-10 sm:h-auto text-xs sm:text-sm">
                <BarChart2 className="h-4 w-4 shrink-0" />
                <span className="hidden xs:inline truncate">{t.nav.infos}</span>
              </TabsTrigger>
              <TabsTrigger value="activity" title={t.nav.activity} className="gap-1.5 sm:gap-2 data-[state=active]:shadow-sm h-10 sm:h-auto text-xs sm:text-sm relative">
                <History className="h-4 w-4 shrink-0" />
                <span className="hidden xs:inline truncate">{t.nav.activity}</span>
                {pendingCount > 0 && (
                  <Badge 
                    variant="destructive" 
                    className="absolute -top-1 -right-1 h-4 w-4 sm:h-5 sm:w-5 p-0 flex items-center justify-center text-[8px] sm:text-[10px]"
                  >
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="catalog" title={t.nav.catalog} className="gap-1.5 sm:gap-2 data-[state=active]:shadow-sm h-10 sm:h-auto text-xs sm:text-sm">
                <Library className="h-4 w-4 shrink-0" />
                <span className="hidden xs:inline truncate">{t.nav.catalog}</span>
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="users" title={t.admin?.users || 'Users'} className="gap-1.5 sm:gap-2 data-[state=active]:shadow-sm h-10 sm:h-auto text-xs sm:text-sm">
                  <Users className="h-4 w-4 shrink-0" />
                  <span className="hidden xs:inline truncate">{t.admin?.users || 'Users'}</span>
                </TabsTrigger>
              )}
            </TabsList>
          )}

          {tabContents}
        </Tabs>
      </main>

      {!isTablet && (
        <footer className="border-t mt-auto py-4">
          <div className="container text-center text-xs text-muted-foreground px-4">
            <p>{t.footer.syncedToCloud}</p>
          </div>
        </footer>
      )}

      <InventoryAssistant />
    </div>
  );
};

export default Index;
