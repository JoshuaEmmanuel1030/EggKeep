import { StockSummary, InflowEntry, OutflowEntry } from "@/types/inventory";
import { InventoryStackedBarChart } from "./InventoryStackedBarChart";
import { InventoryTrendLineChart } from "./InventoryTrendLineChart";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface InfosPageProps {
  stockSummary: StockSummary[];
  inflows: InflowEntry[];
  outflows: OutflowEntry[];
}

export function InfosPage({ stockSummary, inflows, outflows }: InfosPageProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-foreground">{t.infos.title}</h2>
      
      <Card>
        <CardHeader>
          <CardTitle>{t.infos.stockByCategory}</CardTitle>
        </CardHeader>
        <CardContent>
          <InventoryStackedBarChart stockSummary={stockSummary} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.infos.flowTrends}</CardTitle>
        </CardHeader>
        <CardContent>
          <InventoryTrendLineChart inflows={inflows} outflows={outflows} />
        </CardContent>
      </Card>
    </div>
  );
}
