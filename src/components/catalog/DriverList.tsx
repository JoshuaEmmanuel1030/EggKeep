import { useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import { useDrivers } from "@/hooks/useDrivers";
import { cn } from "@/lib/utils";
import type { Driver } from "@/types/deliveries";
import { DriverDialog } from "@/components/deliveries/DriverDialog";

interface DriverListProps {
  isAdmin?: boolean;
}

// Catalog → Supir: the drivers offered on the delivery log. Everyone can see
// the list; admins add, rename and toggle active (same gate as buyers).
export function DriverList({ isAdmin = false }: DriverListProps) {
  const { t } = useLanguage();
  const { drivers, isLoading, error, updateDriver } = useDrivers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);

  const toggleActive = async (driver: Driver, next: boolean) => {
    try {
      await updateDriver.mutateAsync({ id: driver.id, isActive: next });
    } catch (e) {
      toast.error((e as { message?: string } | null)?.message || t.common.error);
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
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" />
            {t.deliveries.addDriver}
          </Button>
        </div>
      )}

      {error ? (
        <p className="py-8 text-center text-muted-foreground">{(error as { message?: string }).message || t.common.error}</p>
      ) : drivers.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t.deliveries.noDrivers}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {drivers.map((d) => {
            const busy = updateDriver.isPending && updateDriver.variables?.id === d.id;
            return (
              <li key={d.id} className="flex items-center gap-2 py-2 pl-3 pr-1">
                <span className={cn("min-w-0 flex-1 truncate font-medium", !d.isActive && "text-muted-foreground")}>{d.name}</span>
                {isAdmin ? (
                  <>
                    <Switch
                      checked={d.isActive}
                      disabled={busy}
                      onCheckedChange={(v) => toggleActive(d, v)}
                      aria-label={`${t.deliveries.active}: ${d.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t.deliveries.editDriver}: ${d.name}`}
                      onClick={() => { setEditing(d); setDialogOpen(true); }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <Badge variant={d.isActive ? "default" : "secondary"} className="mr-2">
                    {d.isActive ? t.deliveries.active : t.deliveries.inactive}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <DriverDialog open={dialogOpen} onOpenChange={setDialogOpen} driver={editing} />
    </div>
  );
}
