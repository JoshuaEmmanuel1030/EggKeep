import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCashCustomers } from "@/hooks/useCashCustomers";
import { cn } from "@/lib/utils";
import { isAnonymousName, isDuplicateCustomerError, type CashCustomer } from "@/lib/cashCustomers";

interface CashCustomerListProps {
  isAdmin?: boolean;
}

// Catalog → Pelanggan Tunai: the names offered on the Kas Tunai drawer.
// Everyone sees the list (and can add from the drawer, mid-sale); admins add,
// rename and toggle active here. A rename carries to past sales through
// metadata.customerId; an inactive customer leaves the picker but keeps history.
export function CashCustomerList({ isAdmin = false }: CashCustomerListProps) {
  const { t } = useLanguage();
  const { customers, isLoading, error, updateCustomer } = useCashCustomers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CashCustomer | null>(null);

  const toggleActive = async (customer: CashCustomer, next: boolean) => {
    try {
      await updateCustomer.mutateAsync({ id: customer.id, isActive: next });
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t.kas.customersHelp}</p>
        {isAdmin && (
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="shrink-0 gap-2">
            <Plus className="h-4 w-4" />
            {t.kas.addCustomerButton}
          </Button>
        )}
      </div>

      {error ? (
        <p className="py-8 text-center text-muted-foreground">{(error as { message?: string }).message || t.common.error}</p>
      ) : customers.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t.kas.noCustomers}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {customers.map((c) => {
            const busy = updateCustomer.isPending && updateCustomer.variables?.id === c.id;
            return (
              <li key={c.id} className="flex items-center gap-2 py-2 pl-3 pr-1">
                <span className={cn("min-w-0 flex-1 truncate font-medium", !c.isActive && "text-muted-foreground")}>{c.name}</span>
                {isAdmin ? (
                  <>
                    <Switch
                      checked={c.isActive}
                      disabled={busy}
                      onCheckedChange={(v) => toggleActive(c, v)}
                      aria-label={`${t.deliveries.active}: ${c.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t.kas.editCustomer}: ${c.name}`}
                      onClick={() => { setEditing(c); setDialogOpen(true); }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <Badge variant={c.isActive ? "default" : "secondary"} className="mr-2">
                    {c.isActive ? t.deliveries.active : t.deliveries.inactive}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CashCustomerDialog open={dialogOpen} onOpenChange={setDialogOpen} customer={editing} />
    </div>
  );
}

interface CashCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CashCustomer | null; // null = add
}

function CashCustomerDialog({ open, onOpenChange, customer }: CashCustomerDialogProps) {
  const { t } = useLanguage();
  const { addCustomer, updateCustomer } = useCashCustomers();
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName(customer?.name ?? "");
  }, [open, customer]);

  const saving = addCustomer.isPending || updateCustomer.isPending;
  // "Customer" / "Umum" are how an anonymous sale used to be typed: never a row.
  const valid = !isAnonymousName(name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    try {
      if (customer) await updateCustomer.mutateAsync({ id: customer.id, name });
      else await addCustomer.mutateAsync({ name });
      toast.success(t.kas.customerSaved);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        isDuplicateCustomerError(error) ? t.kas.customerExists : (error as { message?: string } | null)?.message || t.common.error
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{customer ? t.kas.editCustomer : t.kas.addCustomerButton}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cash-customer-name">{t.kas.customerName}</Label>
            <Input id="cash-customer-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={saving || !valid}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t.common.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
