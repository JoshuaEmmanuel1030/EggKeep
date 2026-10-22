import { useState, useCallback, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBuyers } from "@/hooks/useBuyers";
import { Buyer } from "@/types/quickOutflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Loader2, History } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBuyerDcs } from "@/hooks/useBuyerDcs";
import { useIsTabletLandscape } from "@/hooks/use-mobile";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { useBuyerOrderStats } from "@/hooks/usePurchaseOrders";
import { pinnedCodesFor } from "@/lib/buyerProfile";
import { cn } from "@/lib/utils";
import { BuyerDialog } from "./BuyerDialog";
import { BuyerProfile, buyerStatsLine } from "./BuyerProfile";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { RenameWarningDialog } from "./RenameWarningDialog";
import { checkBuyerDependencies, DependencyCheckResult } from "@/lib/catalogDependencies";

function BuyerHistoryDialog({ buyer, open, onOpenChange }: { buyer: Buyer | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !buyer) return;
    setLoading(true);
    supabase
      .from('activity_logs')
      .select('recorded_at, product, quantity_butir, invoice_supplier, metadata, voided_at')
      .eq('action_type', 'outflow')
      .filter('metadata->>buyerName', 'eq', buyer.name)
      .is('voided_at', null)
      .order('recorded_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setLogs(data || []);
        setLoading(false);
      });
  }, [open, buyer]);

  if (!buyer) return null;

  const totalButir = logs.reduce((sum, l) => sum + (l.quantity_butir || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {buyer.name} — Order History
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No outflow history found.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {logs.length} orders · {totalButir.toLocaleString()} butir total
            </p>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty (butir)</TableHead>
                    <TableHead>Invoice / Ref</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {new Date(log.recorded_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm">{log.product}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {(log.quantity_butir || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {log.metadata?.invoiceRef || log.invoice_supplier || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BuyerListProps {
  isAdmin?: boolean;
}

export function BuyerList({ isAdmin = false }: BuyerListProps) {
  const { t, language } = useLanguage();
  const isTablet = useIsTabletLandscape();
  const { data: orderStats } = useBuyerOrderStats();
  const { skus } = usePackSKUs();
  const { buyers, isLoading, addBuyer, updateBuyer, deleteBuyer, restoreBuyer } = useBuyers();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBuyer, setEditingBuyer] = useState<Buyer | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [buyerToDelete, setBuyerToDelete] = useState<Buyer | null>(null);
  const [dependencies, setDependencies] = useState<DependencyCheckResult | null>(null);
  const [isCheckingDependencies, setIsCheckingDependencies] = useState(false);
  const [historyBuyer, setHistoryBuyer] = useState<Buyer | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { dcsForBuyer } = useBuyerDcs();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameWarn, setRenameWarn] = useState<{
    data: { name: string };
    oldName: string;
    deps: DependencyCheckResult;
  } | null>(null);

  const filteredBuyers = buyers.filter((buyer) =>
    buyer.name.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const activeSkus = skus.filter((s) => s.isActive !== false);
  // A deleted buyer drops out of `buyers`, which returns the view to the list.
  const selected = buyers.find((b) => b.id === selectedId) ?? null;
  const locale = language === "id" ? "id-ID" : "en-US";

  const handleAdd = () => {
    setEditingBuyer(null);
    setDialogOpen(true);
  };

  const handleEdit = (buyer: Buyer) => {
    setEditingBuyer(buyer);
    setDialogOpen(true);
  };

  const handleDeleteClick = useCallback(async (buyer: Buyer) => {
    setBuyerToDelete(buyer);
    setDeleteDialogOpen(true);
    setDependencies(null);
    setIsCheckingDependencies(true);

    try {
      const result = await checkBuyerDependencies(buyer.name);
      setDependencies(result);
    } catch (error) {
      console.error("Failed to check dependencies:", error);
      setDependencies({ hasDependencies: false, dependencyCount: 0, dependencyDetails: [] });
    } finally {
      setIsCheckingDependencies(false);
    }
  }, []);

  const handleDeleteConfirm = async () => {
    if (!buyerToDelete || !deleteBuyer) return;
    
    const deletedId = buyerToDelete.id;
    
    try {
      await deleteBuyer.mutateAsync(deletedId);
      setDeleteDialogOpen(false);
      setBuyerToDelete(null);
      
      // Show undo toast
      toast.success(t.catalog.deleteSuccess, {
        action: {
          label: t.common.undo,
          onClick: async () => {
            try {
              await restoreBuyer.mutateAsync(deletedId);
              toast.success(t.catalog.itemRestored);
            } catch {
              toast.error(t.common.error);
            }
          },
        },
        duration: 5000,
      });
    } catch (error) {
      toast.error(t.common.error);
    }
  };

  const performSave = async (data: { name: string }) => {
    try {
      if (editingBuyer && updateBuyer) {
        await updateBuyer.mutateAsync({ id: editingBuyer.id, ...data });
        toast.success(t.catalog.updateSuccess);
      } else if (addBuyer) {
        await addBuyer.mutateAsync(data);
        toast.success(t.catalog.addSuccess);
      }
      setDialogOpen(false);
      setRenameWarn(null);
    } catch (error: any) {
      toast.error(error.message || t.common.error);
    }
  };

  const handleSave = async (data: { name: string }) => {
    // Guard buyer renames: order history filters by buyerName in activity_logs metadata,
    // so renaming a used buyer hides their past orders.
    if (editingBuyer && data.name !== editingBuyer.name) {
      try {
        const deps = await checkBuyerDependencies(editingBuyer.name);
        if (deps.hasDependencies) {
          setRenameWarn({ data, oldName: editingBuyer.name, deps });
          return;
        }
      } catch (error) {
        console.error("Rename dependency check failed:", error);
      }
    }
    await performSave(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const list = (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t.common.searchDots}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        {isAdmin && (
          <Button onClick={handleAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            {t.catalog.addBuyer}
          </Button>
        )}
      </div>

      {filteredBuyers.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t.catalog.noData}</p>
      ) : (
        <div className="space-y-2">
          {filteredBuyers.map((buyer) => {
            const pins = pinnedCodesFor(activeSkus, buyer.pinnedSkuIds).size;
            return (
              <button
                key={buyer.id}
                type="button"
                onClick={() => {
                  setSelectedId(buyer.id);
                  if (!isTablet) window.scrollTo({ top: 0 });
                }}
                className={cn(
                  "w-full min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
                  selectedId === buyer.id && isTablet && "border-primary bg-accent"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{buyer.name}</span>
                  {pins > 0 && (
                    <Badge variant="secondary" className="shrink-0">{t.buyerProfile.pinnedCount.replace("{n}", String(pins))}</Badge>
                  )}
                </div>
                {orderStats && <p className="text-xs text-muted-foreground">{buyerStatsLine(t, orderStats.get(buyer.name), locale)}</p>}
                {dcsForBuyer(buyer.id).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {dcsForBuyer(buyer.id).map((dc) => <Badge key={dc.id} variant="outline" className="max-w-full"><span className="truncate">{dc.name}</span></Badge>)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const profile = selected && (
    <BuyerProfile
      key={selected.id}
      buyer={selected}
      isAdmin={isAdmin}
      onBack={isTablet ? undefined : () => setSelectedId(null)}
      onEdit={() => handleEdit(selected)}
      onDelete={() => handleDeleteClick(selected)}
      onHistory={() => { setHistoryBuyer(selected); setHistoryOpen(true); }}
    />
  );

  return (
    <div className="space-y-4">
      {isTablet ? (
        <div className="flex gap-4">
          <div className="sticky top-0 w-[280px] shrink-0 self-start">{list}</div>
          <div className="min-w-0 flex-1 border-l pl-4">
            {profile ?? <p className="py-8 text-center text-muted-foreground">{t.buyerProfile.pickBuyer}</p>}
          </div>
        </div>
      ) : (
        profile ?? list
      )}

      <BuyerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        buyer={editingBuyer}
        onSave={handleSave}
        isLoading={addBuyer?.isPending || updateBuyer?.isPending || false}
      />

      <BuyerHistoryDialog
        buyer={historyBuyer}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        itemName={buyerToDelete?.name || ""}
        itemType={t.catalog.buyers}
        dependencies={dependencies}
        isCheckingDependencies={isCheckingDependencies}
        isDeleting={deleteBuyer?.isPending || false}
        onConfirm={handleDeleteConfirm}
      />

      <RenameWarningDialog
        open={!!renameWarn}
        onOpenChange={(open) => { if (!open) setRenameWarn(null); }}
        oldName={renameWarn?.oldName || ""}
        newName={renameWarn?.data.name || ""}
        dependencies={renameWarn?.deps || null}
        isSaving={updateBuyer?.isPending || false}
        onConfirm={() => { if (renameWarn) performSave(renameWarn.data); }}
      />
    </div>
  );
}
