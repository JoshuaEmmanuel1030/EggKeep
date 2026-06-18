import { useMemo } from "react";
import { StockSummary, InventoryCategory } from "@/types/inventory";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";

interface InventoryStackedBarChartProps {
  stockSummary: StockSummary[];
}

// Color palette for products within each category - high contrast alternating dark/light
const CATEGORY_COLORS: Record<InventoryCategory, string[]> = {
  egg: [
    "hsl(142, 85%, 28%)",   // deep forest green
    "hsl(85, 75%, 55%)",    // bright lime
    "hsl(172, 80%, 35%)",   // dark teal
    "hsl(160, 85%, 50%)",   // bright emerald
    "hsl(195, 90%, 40%)",   // ocean blue
    "hsl(140, 70%, 65%)",   // light mint
    "hsl(100, 60%, 45%)",   // olive green
    "hsl(180, 75%, 55%)",   // bright cyan
    "hsl(120, 50%, 35%)",   // dark green
  ],
  packaging: [
    "hsl(270, 85%, 40%)",   // deep violet
    "hsl(320, 80%, 60%)",   // bright magenta
    "hsl(250, 70%, 55%)",   // royal indigo
    "hsl(290, 75%, 70%)",   // light orchid
    "hsl(280, 90%, 35%)",   // dark purple
    "hsl(340, 85%, 65%)",   // bright pink
  ],
  box: [
    "hsl(25, 95%, 45%)",    // deep orange
    "hsl(50, 95%, 55%)",    // bright yellow
    "hsl(35, 90%, 60%)",    // golden amber
    "hsl(15, 85%, 55%)",    // coral
  ],
  label: [
    "hsl(350, 85%, 40%)",   // deep rose
    "hsl(15, 90%, 65%)",    // bright coral
    "hsl(0, 80%, 50%)",     // crimson
    "hsl(340, 70%, 70%)",   // salmon pink
  ],
};

const CATEGORY_ORDER: InventoryCategory[] = ["packaging", "egg", "box", "label"];

export function InventoryStackedBarChart({ stockSummary }: InventoryStackedBarChartProps) {
  const { t } = useLanguage();

  const { chartData, chartConfig, productsByCategory } = useMemo(() => {
    // Group products by category
    const grouped: Record<InventoryCategory, { product: string; total: number }[]> = {
      egg: [],
      packaging: [],
      box: [],
      label: [],
    };

    stockSummary.forEach((item) => {
      if (item.totalStock > 0) {
        grouped[item.category].push({
          product: item.product,
          total: item.totalStock,
        });
      }
    });

    // Sort each category by total stock descending
    Object.keys(grouped).forEach((cat) => {
      grouped[cat as InventoryCategory].sort((a, b) => b.total - a.total);
    });

    // Build chart data - one bar per category
    const categoryLabels: Record<InventoryCategory, string> = {
      packaging: t.outflow.packaging,
      egg: t.outflow.eggs,
      box: t.common.boxes,
      label: t.outflow.labelsPaused.replace(' (Paused)', '').replace(' (Dijeda)', ''),
    };

    const data = CATEGORY_ORDER.map((category) => {
      const entry: Record<string, string | number> = {
        category: categoryLabels[category],
        categoryKey: category,
      };
      
      grouped[category].forEach((item, idx) => {
        const key = `${category}_${idx}`;
        entry[key] = item.total;
      });
      
      return entry;
    });

    // Build chart config for colors
    const config: Record<string, { label: string; color: string }> = {};
    const productsByCat: Record<InventoryCategory, string[]> = {
      egg: [],
      packaging: [],
      box: [],
      label: [],
    };

    CATEGORY_ORDER.forEach((category) => {
      grouped[category].forEach((item, idx) => {
        const key = `${category}_${idx}`;
        const colors = CATEGORY_COLORS[category];
        config[key] = {
          label: item.product,
          color: colors[idx % colors.length],
        };
        productsByCat[category].push(item.product);
      });
    });

    return { 
      chartData: data, 
      chartConfig: config,
      productsByCategory: productsByCat,
    };
  }, [stockSummary, t]);

  // Get all unique bar keys
  const allKeys = useMemo(() => {
    const keys: string[] = [];
    CATEGORY_ORDER.forEach((category) => {
      const items = stockSummary.filter(s => s.category === category && s.totalStock > 0);
      items.forEach((_, idx) => {
        keys.push(`${category}_${idx}`);
      });
    });
    return keys;
  }, [stockSummary]);

  if (stockSummary.length === 0 || allKeys.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {t.common.loading}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ChartContainer config={chartConfig} className="h-80 w-full">
        <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
          <XAxis type="number" tickFormatter={(value) => value.toLocaleString()} />
          <YAxis 
            type="category" 
            dataKey="category" 
            width={100}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip 
            content={<ChartTooltipContent />}
            cursor={{ fill: 'hsl(var(--muted))' }}
          />
          {allKeys.map((key) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="stack"
              fill={chartConfig[key]?.color || 'hsl(var(--muted))'}
              radius={0}
            />
          ))}
        </BarChart>
      </ChartContainer>

      {/* Legend by category */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
        {CATEGORY_ORDER.map((category) => {
          const products = productsByCategory[category];
          if (products.length === 0) return null;
          
          const categoryLabel = category === 'egg' ? t.outflow.eggs 
            : category === 'packaging' ? t.outflow.packaging
            : category === 'box' ? t.common.boxes
            : 'Labels';
          
          return (
            <div key={category} className="space-y-1">
              <div className="font-medium text-sm flex items-center gap-2">
                {categoryLabel}
                {category === 'label' && (
                  <Badge variant="secondary" className="text-xs">
                    {t.activity.pending}
                  </Badge>
                )}
              </div>
              <div className="space-y-0.5">
                {products.map((product, idx) => {
                  const colors = CATEGORY_COLORS[category];
                  return (
                    <div key={product} className="flex items-center gap-2 text-xs">
                      <div 
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: colors[idx % colors.length] }}
                      />
                      <span className="truncate text-muted-foreground">{product}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
