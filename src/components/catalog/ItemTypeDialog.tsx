import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { ItemType } from "@/types/inventory";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface ItemTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ItemType | null;
  categoryLabel: string;
  onSave: (name: string) => Promise<void>;
  isLoading: boolean;
}

export function ItemTypeDialog({
  open,
  onOpenChange,
  item,
  categoryLabel,
  onSave,
  isLoading,
}: ItemTypeDialogProps) {
  const { t } = useLanguage();
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) {
      setName(item?.name || "");
    }
  }, [open, item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave(name.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {item ? t.catalog.editItem : t.catalog.addItem} - {categoryLabel}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t.catalog.name}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Enter ${categoryLabel.toLowerCase()} name`}
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={isLoading || !name.trim()}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t.common.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
