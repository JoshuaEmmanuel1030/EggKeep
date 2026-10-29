import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useDrivers, isDuplicateDriverError } from "@/hooks/useDrivers";
import { isValidDriverName, normalizeDriverName } from "@/lib/drivers";
import type { Driver } from "@/types/deliveries";

interface DriverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driver: Driver | null; // null = add
  onSaved?: (driver: Driver) => void;
}

// Add / edit a driver (Supir). Admin-only callers (Catalog → Supir and the
// "tambah supir" shortcut on a delivery) — the gate is in the UI, like buyers.
export function DriverDialog({ open, onOpenChange, driver, onSaved }: DriverDialogProps) {
  const { t } = useLanguage();
  const { addDriver, updateDriver } = useDrivers();
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (open) {
      setName(driver?.name ?? "");
      setIsActive(driver?.isActive ?? true);
    }
  }, [open, driver]);

  const saving = addDriver.isPending || updateDriver.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidDriverName(name) || saving) return;
    try {
      if (driver) {
        await updateDriver.mutateAsync({ id: driver.id, name, isActive });
        toast.success(t.deliveries.driverUpdated);
        onSaved?.({ ...driver, name: normalizeDriverName(name), isActive });
      } else {
        const created = await addDriver.mutateAsync({ name });
        toast.success(t.deliveries.driverAdded);
        onSaved?.(created);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        isDuplicateDriverError(error)
          ? t.deliveries.driverExists
          : (error as { message?: string } | null)?.message || t.common.error
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{driver ? t.deliveries.editDriver : t.deliveries.addDriver}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="driver-name">{t.deliveries.driverName}</Label>
            <Input
              id="driver-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.deliveries.driverPlaceholder}
              autoFocus
            />
          </div>
          {driver && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="driver-active">{t.deliveries.active}</Label>
              <Switch id="driver-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={saving || !isValidDriverName(name)}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t.common.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
