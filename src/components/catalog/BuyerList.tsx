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
import { Plus, Pencil, Trash2, Search, Loader2, History } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BuyerDialog } from "./BuyerDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
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
  const { t } = useLanguage();
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

  const filteredBuyers = buyers.filter((buyer) =>
    buyer.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

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

  const handleSave = async (data: { name: string; defaultBoxMode: string }) => {
    try {
      if (editingBuyer && updateBuyer) {
        await updateBuyer.mutateAsync({ id: editingBuyer.id, ...data });
        toast.success(t.catalog.updateSuccess);
      } else if (addBuyer) {
        await addBuyer.mutateAsync(data);
        toast.success(t.catalog.addSuccess);
      }
      setDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || t.common.error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.catalog.name}</TableHead>
              <TableHead>{t.catalog.defaultBoxMode}</TableHead>
              <TableHead className="text-right">{t.catalog.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBuyers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                  {t.catalog.noData}
                </TableCell>
              </TableRow>
            ) : (
              filteredBuyers.map((buyer) => (
                <TableRow key={buyer.id}>
                  <TableCell className="font-medium">{buyer.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{buyer.defaultBoxMode}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="View buyer history"
                        onClick={() => { setHistoryBuyer(buyer); setHistoryOpen(true); }}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Edit buyer"
                            onClick={() => handleEdit(buyer)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete buyer"
                            onClick={() => handleDeleteClick(buyer)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
    </div>
  );
}
