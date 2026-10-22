import { useState } from "react";
import { ArrowLeft, History, MapPin, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { useBuyerDcs } from "@/hooks/useBuyerDcs";
import { useBuyerOrderStats } from "@/hooks/usePurchaseOrders";
import { toLocalDate } from "@/lib/buyerProfile";
import type { Buyer } from "@/types/quickOutflow";
import { BuyerDcsDialog } from "./BuyerDcsDialog";
import { BuyerPlanning } from "./BuyerPlanning";
import { BuyerSkuPins } from "./BuyerSkuPins";

type T = ReturnType<typeof useLanguage>["t"];

export function buyerStatsLine(t: T, stat: { orders30d: number; lastOrderDate: string } | undefined, locale: string) {
  if (!stat) return t.buyerProfile.noOrders30d;
  return t.buyerProfile.stats30d
    .replace("{n}", String(stat.orders30d))
    .replace("{date}", toLocalDate(stat.lastOrderDate).toLocaleDateString(locale, { day: "numeric", month: "short" }));
}

interface BuyerProfileProps {
  buyer: Buyer;
  isAdmin: boolean;
  onBack?: () => void; // phone / portrait only
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
}

export function BuyerProfile({ buyer, isAdmin, onBack, onEdit, onDelete, onHistory }: BuyerProfileProps) {
  const { t, language } = useLanguage();
  const { dcsForBuyer } = useBuyerDcs();
  const { data: stats } = useBuyerOrderStats();
  const [dcsOpen, setDcsOpen] = useState(false);
  const dcs = dcsForBuyer(buyer.id);
  const locale = language === "id" ? "id-ID" : "en-US";

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-start gap-2">
        {onBack && (
          <Button variant="ghost" size="icon" aria-label={t.buyerProfile.back} onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{buyer.name}</h3>
          <p className="text-sm text-muted-foreground">{buyerStatsLine(t, stats?.get(buyer.name), locale)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" aria-label="View buyer history" onClick={onHistory}><History className="h-4 w-4" /></Button>
          {isAdmin && (
            <>
              <Button variant="ghost" size="icon" aria-label="Edit buyer" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="Delete buyer" onClick={onDelete}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="planning">
        <TabsList>
          <TabsTrigger value="planning">{t.buyerProfile.planning}</TabsTrigger>
          <TabsTrigger value="skus">{t.buyerProfile.skus}</TabsTrigger>
          <TabsTrigger value="dcs">{t.buyerProfile.dcs}</TabsTrigger>
        </TabsList>
        <TabsContent value="planning"><BuyerPlanning buyerName={buyer.name} /></TabsContent>
        <TabsContent value="skus"><BuyerSkuPins buyer={buyer} isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="dcs" className="space-y-3">
          {dcs.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="flex flex-wrap gap-1">{dcs.map((dc) => <Badge key={dc.id} variant="outline">{dc.name}</Badge>)}</div>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDcsOpen(true)}>
              <MapPin className="h-4 w-4" />
              {t.catalog.manageDcs}
            </Button>
          )}
        </TabsContent>
      </Tabs>

      <BuyerDcsDialog buyer={buyer} open={dcsOpen} onOpenChange={setDcsOpen} />
    </div>
  );
}
