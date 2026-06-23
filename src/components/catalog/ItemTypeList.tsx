import { useState, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import { InventoryCategory, ItemType } from "@/types/inventory";
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
import { Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ItemTypeDialog, ItemTypeSaveData } from "./ItemTypeDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { checkItemTypeDependencies, DependencyCheckResult } from "@/lib/catalogDependencies";

interface ItemTypeListProps {
  category: InventoryCategory;
  isAdmin?: boolean;
}

export function ItemTypeList({ category, isAdmin = false }: ItemTypeListProps) {
  const { t } = useLanguage();
  const { getTypesByCategory, loading, addItemType, updateItemType, deleteItemType, restoreItemType } = useItemTypes();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemType | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ItemType | null>(null);
  const [dependencies, setDependencies] = useState<DependencyCheckResult | null>(null);
  const [isCheckingDependencies, setIsCheckingDependencies] = useState(false);

  const items = getTypesByCategory(category);
  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getCategoryLabel = () => {
    switch (category) {
      case "egg": return t.catalog.eggs;
      case "box": return t.catalog.boxes;
      case "label": return t.catalog.labels;
      case "packaging": return t.catalog.packaging;
      default: return category;
    }
  };

  const handleAdd = () => {
    setEditingItem(null);
    setDialogOpen(true);
  };

  const handleEdit = (item: ItemType) => {
    setEditingItem(item);
    setDialogOpen(true);
  };

  const handleDeleteClick = useCallback(async (item: ItemType) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
    setDependencies(null);
    setIsCheckingDependencies(true);

    try {
      const result = await checkItemTypeDependencies(item.name, category);
      setDependencies(result);
    } catch (error) {
      console.error("Failed to check dependencies:", error);
      setDependencies({ hasDependencies: false, dependencyCount: 0, dependencyDetails: [] });
    } finally {
      setIsCheckingDependencies(false);
    }
  }, [category]);

  const handleDeleteConfirm = async () => {
    if (!itemToDelete || !deleteItemType) return;
    
    const deletedId = itemToDelete.id;
    
    try {
      await deleteItemType.mutateAsync(deletedId);
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      
      // Show undo toast
      toast.success(t.catalog.deleteSuccess, {
        action: {
          label: t.common.undo,
          onClick: async () => {
            try {
              await restoreItemType.mutateAsync(deletedId);
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

  const handleSave = async (data: ItemTypeSaveData) => {
    try {
      if (editingItem && updateItemType) {
        await updateItemType.mutateAsync({
          id: editingItem.id,
          name: data.name,
          unit: data.unit,
          eggsPerUnit: data.eggsPerUnit,
        });
        toast.success(t.catalog.updateSuccess);
      } else if (addItemType) {
        await addItemType.mutateAsync({
          name: data.name,
          category,
          unit: data.unit,
          eggsPerUnit: data.eggsPerUnit,
        });
        toast.success(t.catalog.addSuccess);
      }
      setDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || t.common.error);
    }
  };

  if (loading) {
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
            {t.catalog.addItem}
          </Button>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.catalog.name}</TableHead>
              <TableHead className="text-right">{t.catalog.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                  {t.catalog.noData}
                </TableCell>
              </TableRow>
            ) : (
              filteredItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit item type"
                          onClick={() => handleEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete item type"
                          onClick={() => handleDeleteClick(item)}
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

      <ItemTypeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editingItem}
        categoryLabel={getCategoryLabel()}
        isEgg={category === "egg"}
        onSave={handleSave}
        isLoading={addItemType?.isPending || updateItemType?.isPending || false}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        itemName={itemToDelete?.name || ""}
        itemType={getCategoryLabel()}
        dependencies={dependencies}
        isCheckingDependencies={isCheckingDependencies}
        isDeleting={deleteItemType?.isPending || false}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
