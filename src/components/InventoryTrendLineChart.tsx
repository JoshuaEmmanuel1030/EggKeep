import { useMemo, useState } from "react";
import { InflowEntry, OutflowEntry, InventoryCategory } from "@/types/inventory";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, parseISO, startOfYear, startOfMonth, startOfWeek } from "date-fns";

interface InventoryTrendLineChartProps {
  inflows: InflowEntry[];
  outflows: OutflowEntry[];
}

type CategoryFilter = InventoryCategory;
type TimePeriod = "all" | "year" | "month" | "week";

const CATEGORY_OPTIONS: { value: CategoryFilter; labelKey: string }[] = [
  { value: "egg", labelKey: "eggs" },
  { value: "packaging", labelKey: "packaging" },
  { value: "box", labelKey: "boxes" },
  { value: "label", labelKey: "labels" },
];

const TIME_PERIOD_OPTIONS: { value: TimePeriod; labelKey: keyof typeof import("@/locales/en").en.infos }[] = [
  { value: "all", labelKey: "allTime" },
  { value: "year", labelKey: "thisYear" },
  { value: "month", labelKey: "thisMonth" },
  { value: "week", labelKey: "thisWeek" },
];

export function InventoryTrendLineChart({ inflows, outflows }: InventoryTrendLineChartProps) {
  const { t } = useLanguage();
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("egg");
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("month");

  const chartData = useMemo(() => {
    // Calculate date boundary based on selected period
    const now = new Date();
    let startDate: Date | null = null;

    switch (selectedPeriod) {
      case "year":
        startDate = startOfYear(now);
        break;
      case "month":
        startDate = startOfMonth(now);
        break;
      case "week":
        startDate = startOfWeek(now, { weekStartsOn: 1 }); // Monday start
        break;
      default:
        startDate = null; // all time
    }

    // Filter by time period first
    const periodFilteredInflows = startDate
      ? inflows.filter((i) => parseISO(i.date) >= startDate!)
      : inflows;
    const periodFilteredOutflows = startDate
      ? outflows.filter((o) => parseISO(o.date) >= startDate!)
      : outflows;

    // Then filter by category
    const filteredInflows = periodFilteredInflows.filter((i) => i.category === selectedCategory);
    const filteredOutflows = periodFilteredOutflows.filter((o) => o.category === selectedCategory);

    // Get all unique dates
    const allDates = new Set<string>();
    filteredInflows.forEach((i) => allDates.add(i.date));
    filteredOutflows.forEach((o) => allDates.add(o.date));

    if (allDates.size === 0) {
      return [];
    }

    // Sort dates
    const sortedDates = Array.from(allDates).sort();

    // Aggregate by date
    const data = sortedDates.map((date) => {
      const dayInflows = filteredInflows
        .filter((i) => i.date === date)
        .reduce((sum, i) => sum + i.quantityInButir, 0);

      const dayOutflows = filteredOutflows
        .filter((o) => o.date === date)
        .reduce((sum, o) => sum + o.quantityInButir, 0);

      return {
        date,
        displayDate: format(parseISO(date), "MMM d"),
        inflow: dayInflows,
        outflow: dayOutflows,
        net: dayInflows - dayOutflows,
      };
    });

    return data;
  }, [inflows, outflows, selectedCategory, selectedPeriod]);

  const chartConfig = {
    inflow: {
      label: t.infos.inflow,
      color: "hsl(142, 76%, 36%)", // green
    },
    outflow: {
      label: t.infos.outflow,
      color: "hsl(0, 84%, 60%)", // red
    },
    net: {
      label: t.infos.netFlow,
      color: "hsl(217, 91%, 60%)", // blue
    },
  };

  const getCategoryLabel = (cat: CategoryFilter) => {
    switch (cat) {
      case "egg": return t.outflow.eggs;
      case "packaging": return t.outflow.packaging;
      case "box": return t.common.boxes;
      case "label": return "Labels";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 justify-end">
        <Select
          value={selectedPeriod}
          onValueChange={(val) => setSelectedPeriod(val as TimePeriod)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t.infos.timePeriod} />
          </SelectTrigger>
          <SelectContent>
            {TIME_PERIOD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {t.infos[opt.labelKey]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={selectedCategory}
          onValueChange={(val) => setSelectedCategory(val as CategoryFilter)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t.infos.selectCategory} />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {getCategoryLabel(opt.value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          No data available for {getCategoryLabel(selectedCategory)}
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="h-80 w-full">
          <LineChart data={chartData} margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis 
              dataKey="displayDate" 
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => value.toLocaleString()}
            />
            <ChartTooltip 
              content={<ChartTooltipContent />}
            />
            <Legend 
              wrapperStyle={{ paddingTop: 20 }}
              formatter={(value) => chartConfig[value as keyof typeof chartConfig]?.label || value}
            />
            <Line
              type="monotone"
              dataKey="inflow"
              stroke={chartConfig.inflow.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              name="inflow"
            />
            <Line
              type="monotone"
              dataKey="outflow"
              stroke={chartConfig.outflow.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              name="outflow"
            />
            <Line
              type="monotone"
              dataKey="net"
              stroke={chartConfig.net.color}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              name="net"
            />
          </LineChart>
        </ChartContainer>
      )}
    </div>
  );
}
