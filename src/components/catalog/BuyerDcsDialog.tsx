import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBuyerDcs, isDuplicateDcError } from "@/hooks/useBuyerDcs";
import { Buyer } from "@/types/quickOutflow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface BuyerDcsDialogProps {
  buyer: Buyer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Catalog → Buyers → DCs. Deleting a DC only removes it from the picker;
// past orders keep their dcName snapshot.
export function BuyerDcsDialog({ buyer, open, onOpenChange }: BuyerDcsDialogProps) {
  const { t } = useLanguage();
  const { dcsForBuyer, addDc, deleteDc, error: loadError } = useBuyerDcs();
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open, buyer?.id]);

  if (!buyer) return null;

  const dcs = dcsForBuyer(buyer.id);
  const errorMessage = (error: unknown) => (error as { message?: string } | null)?.message || t.common.error;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || addDc.isPending) return;
    try {
      await addDc.mutateAsync({ buyerId: buyer.id, name: trimmed });
      setName("");
      toast.success(t.catalog.dcAdded);
    } catch (error) {
      toast.error(isDuplicateDcError(error) ? t.catalog.dcExists : errorMessage(error));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDc.mutateAsync(id);
      toast.success(t.catalog.dcDeleted);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            {t.catalog.dcsFor.replace("{buyer}", buyer.name)}
          </DialogTitle>
          <DialogDescription>{t.catalog.dcsHint}</DialogDescription>
        </DialogHeader>

        {dcs.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">
            {loadError ? errorMessage(loadError) : t.catalog.noDcs}
          </p>
        ) : (
          <ul className="max-h-[300px] overflow-y-auto divide-y rounded-lg border">
            {dcs.map((dc) => (
              <li key={dc.id} className="flex items-center justify-between gap-2 pl-3 pr-1 py-1">
                <span className="text-sm font-medium break-words min-w-0">{dc.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t.catalog.deleteDc}
                  disabled={deleteDc.isPending && deleteDc.variables === dc.id}
                  onClick={() => handleDelete(dc.id)}
                >
                  {deleteDc.isPending && deleteDc.variables === dc.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-destructive" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.catalog.dcNamePlaceholder}
            autoFocus
          />
          <Button type="submit" className="gap-2 shrink-0" disabled={addDc.isPending || !name.trim()}>
            {addDc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t.catalog.addDc}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
