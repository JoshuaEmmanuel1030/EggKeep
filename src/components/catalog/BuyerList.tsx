import { useState, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BuyerDialog } from "./BuyerDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { checkBuyerDependencies, DependencyCheckResult } from "@/lib/catalogDependencies";

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
                    {isAdmin && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(buyer)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(buyer)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
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
