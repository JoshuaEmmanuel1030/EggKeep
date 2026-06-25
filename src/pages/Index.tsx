import { useState, useCallback, useMemo } from "react";
import { Header } from "@/components/Header";
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
import { useUserRole } from "@/hooks/useUserRole";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  calculateStockSummary,
  exportInflowsToCSV,
  downloadCSV,
} from "@/lib/inventory";
import { PackagePlus, PackageMinus, LayoutDashboard, Library, History, BarChart2, Users } from "lucide-react";
import { InfosPage } from "@/components/InfosPage";
import { InventoryAssistant } from "@/components/InventoryAssistant";
import { Badge } from "@/components/ui/badge";

const Index = () => {
  const { inflows, outflows, loading, addMultipleInflows, addOutflow, refetch: refetchInventory } = useInventorySync();
  const { logs, loading: logsLoading, pendingCount, isOnline, refetch: refetchLogs } = useActivityLogs();
  const { addActivityLog } = useOfflineSync();
  const { isAdmin } = useUserRole();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState("dashboard");

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
      for (const entry of entries) {
        const success = await addOutflow(entry, entry.quantityInButir);
        if (success) {
          await addActivityLog({
            action_type: 'outflow',
            product: entry.product,
            quantity_butir: entry.quantityInButir,
            recorded_at: new Date().toISOString(),
            category: entry.category,
            invoice_supplier: entry.invoiceSupplier,
            user_email: userEmail,
            metadata: { ...metadata, relatedEntryId: entry.id },
          });
        } else {
          return false;
        }
      }
      setActiveTab("dashboard");
      return true;
    },
    [addOutflow, addActivityLog]
  );

  const handleExport = useCallback(() => {
    const csv = exportInflowsToCSV(inflows);
    const filename = `js-online-inflows-${new Date().toISOString().split("T")[0]}.csv`;
    downloadCSV(csv, filename);
  }, [inflows]);

  const stockSummary = useMemo(() => calculateStockSummary(inflows), [inflows]);

  return (
    <div className="min-h-screen bg-background">
      <Header onExport={handleExport} />

      <main className="container py-6 px-4 sm:px-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
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

          <TabsContent value="dashboard" className="m-0">
            <InventoryDashboard stockSummary={stockSummary} loading={loading} />
          </TabsContent>

          <TabsContent value="inflow" className="m-0">
            <div className="max-w-2xl mx-auto">
              <InflowForm onSubmit={handleInflowSubmit} />
            </div>
          </TabsContent>

          <TabsContent value="outflow" className="m-0">
            <div className="max-w-4xl mx-auto">
              <OutflowPage 
                stockSummary={stockSummary} 
                inflows={inflows} 
                onSubmit={handleOutflowSubmit} 
              />
            </div>
          </TabsContent>

          <TabsContent value="infos" className="m-0">
            <div className="max-w-4xl mx-auto">
              <InfosPage 
                stockSummary={stockSummary} 
                inflows={inflows} 
                outflows={outflows} 
              />
            </div>
          </TabsContent>

          <TabsContent value="activity" className="m-0">
            <div className="max-w-2xl mx-auto">
              <ActivityLogList
                logs={logs}
                loading={logsLoading}
                pendingCount={pendingCount}
                isOnline={isOnline}
                onVoided={() => { refetchInventory(); refetchLogs(); }}
              />
            </div>
          </TabsContent>

          <TabsContent value="catalog" className="m-0">
            <div className="max-w-4xl mx-auto">
              <Catalog />
            </div>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="users" className="m-0">
              <div className="max-w-4xl mx-auto">
                <UserManagement />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </main>

      <footer className="border-t mt-auto py-4">
        <div className="container text-center text-xs text-muted-foreground px-4">
          <p>{t.footer.syncedToCloud}</p>
        </div>
      </footer>

      <InventoryAssistant />
    </div>
  );
};

export default Index;
