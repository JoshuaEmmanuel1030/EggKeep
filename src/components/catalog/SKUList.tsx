import { useState, useCallback } from "react";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { useLanguage } from "@/contexts/LanguageContext";
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
import { SKUDialog } from "./SKUDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { PackSKU } from "@/types/catalog";
import { checkSKUDependencies, DependencyCheckResult } from "@/lib/catalogDependencies";

interface SKUListProps {
  isAdmin?: boolean;
}

export function SKUList({ isAdmin = false }: SKUListProps) {
  const { t } = useLanguage();
  const { skus, isLoading, addSKU, updateSKU, deleteSKU, restoreSKU } = usePackSKUs();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSKU, setEditingSKU] = useState<PackSKU | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [skuToDelete, setSkuToDelete] = useState<PackSKU | null>(null);
  const [dependencies, setDependencies] = useState<DependencyCheckResult | null>(null);
  const [isCheckingDependencies, setIsCheckingDependencies] = useState(false);

  const filteredSKUs = skus.filter(
    (sku) =>
      sku.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sku.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sku.eggProduct.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAdd = () => {
    setEditingSKU(null);
    setDialogOpen(true);
  };

  const handleEdit = (sku: PackSKU) => {
    setEditingSKU(sku);
    setDialogOpen(true);
  };

  const handleDeleteClick = useCallback(async (sku: PackSKU) => {
    setSkuToDelete(sku);
    setDeleteDialogOpen(true);
    setDependencies(null);
    setIsCheckingDependencies(true);

    try {
      const result = await checkSKUDependencies(sku.code);
      setDependencies(result);
    } catch (error) {
      console.error("Failed to check dependencies:", error);
      setDependencies({ hasDependencies: false, dependencyCount: 0, dependencyDetails: [] });
    } finally {
      setIsCheckingDependencies(false);
    }
  }, []);

  const handleDeleteConfirm = async () => {
    if (!skuToDelete) return;
    
    const deletedId = skuToDelete.id;
    const deletedCode = skuToDelete.code;
    
    try {
      await deleteSKU.mutateAsync(deletedId);
      setDeleteDialogOpen(false);
      setSkuToDelete(null);
      
      // Show undo toast
      toast.success(t.catalog.deleteSuccess, {
        action: {
          label: t.common.undo,
          onClick: async () => {
            try {
              await restoreSKU.mutateAsync(deletedId);
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

  const handleSave = async (data: any) => {
    try {
      if (editingSKU) {
        await updateSKU.mutateAsync({ id: editingSKU.id, ...data });
        toast.success(t.catalog.updateSuccess);
      } else {
        await addSKU.mutateAsync(data);
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
            {t.catalog.addSku}
          </Button>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.catalog.code}</TableHead>
              <TableHead>{t.catalog.displayName}</TableHead>
              <TableHead className="text-center">{t.catalog.eggsPerPack}</TableHead>
              <TableHead>{t.catalog.eggProduct}</TableHead>
              <TableHead>{t.catalog.packagingItem}</TableHead>
              <TableHead className="text-center">{t.catalog.status}</TableHead>
              <TableHead className="text-right">{t.catalog.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSKUs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {t.catalog.noData}
                </TableCell>
              </TableRow>
            ) : (
              filteredSKUs.map((sku) => (
                <TableRow key={sku.id}>
                  <TableCell className="font-mono font-medium">{sku.code}</TableCell>
                  <TableCell>{sku.displayName}</TableCell>
                  <TableCell className="text-center">{sku.eggsPerPack}</TableCell>
                  <TableCell>{sku.eggProduct}</TableCell>
                  <TableCell>{sku.packagingItem || "—"}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={sku.isActive ? "default" : "secondary"}>
                      {sku.isActive ? t.catalog.active : t.catalog.inactive}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit SKU"
                          onClick={() => handleEdit(sku)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete SKU"
                          onClick={() => handleDeleteClick(sku)}
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

      <SKUDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        sku={editingSKU}
        onSave={handleSave}
        isLoading={addSKU.isPending || updateSKU.isPending}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        itemName={skuToDelete?.code || ""}
        itemType="SKU"
        dependencies={dependencies}
        isCheckingDependencies={isCheckingDependencies}
        isDeleting={deleteSKU.isPending}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
