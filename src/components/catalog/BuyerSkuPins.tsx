import { useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBuyers } from "@/hooks/useBuyers";
import { usePackSKUs } from "@/hooks/usePackSKUs";
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders";
import { localToday, skuShares } from "@/lib/buyerProfile";
import type { Buyer } from "@/types/quickOutflow";

interface BuyerSkuPinsProps {
  buyer: Buyer;
  isAdmin: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}

// Which SKUs float to the top of this buyer's PO SKU dropdown. Admins tick and
// save; "Suggest" adds SKUs ordered in the last 8 weeks (never removes ticks).
export function BuyerSkuPins({ buyer, isAdmin, onSaved, onCancel }: BuyerSkuPinsProps) {
  const { t } = useLanguage();
  const { skus, isLoading, error } = usePackSKUs();
  const { setPinnedSkus } = useBuyers();
  const { data: orders = [] } = usePurchaseOrders(buyer.name);
  const active = useMemo(() => skus.filter((s) => s.isActive !== false), [skus]);
  const counts = useMemo(() => new Map(skuShares(orders, localToday()).map((s) => [s.code, s.orders])), [orders]);
  const saved = buyer.pinnedSkuIds ?? [];
  const [ticked, setTicked] = useState(() => new Set(saved));

  if (!isAdmin) {
    const pinned = active.filter((s) => saved.includes(s.id));
    if (pinned.length === 0) return <p className="text-sm text-muted-foreground">{t.buyerProfile.noPins}</p>;
    return (
      <ul className="space-y-1 text-sm">
        {pinned.map((s) => (
          <li key={s.id} className="truncate"><span className="font-mono text-xs mr-2">{s.code}</span>{s.displayName}</li>
        ))}
      </ul>
    );
  }

  // Until the catalog has loaded, `active` is empty and a save would write [] over the real pins.
  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-sm text-destructive">{t.common.error}</p>;

  const toggle = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const suggest = () =>
    setTicked((prev) => new Set([...prev, ...active.filter((s) => counts.has(s.code)).map((s) => s.id)]));
  const cancel = () => {
    setTicked(new Set(saved));
    onCancel?.();
  };
  const save = async () => {
    if (active.length === 0) return;
    try {
      // Only active ids are written, which also drops pins of retired SKUs.
      await setPinnedSkus.mutateAsync({ id: buyer.id, skuIds: active.filter((s) => ticked.has(s.id)).map((s) => s.id) });
      toast.success(t.catalog.updateSuccess);
      onSaved?.();
    } catch (error: any) {
      toast.error(error.message || t.common.error);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={suggest} className="gap-2">
          <Sparkles className="h-4 w-4" />
          {t.buyerProfile.suggestFromHistory}
        </Button>
      </div>
      <div className="divide-y rounded-lg border">
        {active.map((s) => (
          <label key={s.id} className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm">
            <Checkbox checked={ticked.has(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} />
            <span className="min-w-0 flex-1 truncate"><span className="font-mono text-xs mr-2">{s.code}</span>{s.displayName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {t.buyerProfile.ordersIn8Weeks.replace("{n}", String(counts.get(s.code) ?? 0))}
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={cancel}>{t.common.cancel}</Button>
        <Button onClick={save} disabled={setPinnedSkus.isPending || active.length === 0}>
          {setPinnedSkus.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t.common.save}
        </Button>
      </div>
    </div>
  );
}
