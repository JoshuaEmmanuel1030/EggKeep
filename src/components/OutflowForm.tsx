import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  OutflowEntry,
  InflowEntry,
  InventoryCategory,
  CATEGORY_LABELS,
  ConversionMap,
} from "@/types/inventory";
import { useItemTypes } from "@/hooks/useItemTypes";
import { getTotalAvailableStock } from "@/lib/inventory";
import { parseCountInput } from "@/lib/stockCount";
import { PackageMinus, Plus, Trash2, ChevronsUpDown, Check, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";

interface OutflowFormProps {
  inflows: InflowEntry[];
  onSubmit: (entries: OutflowEntry[], userEmail: string) => Promise<boolean>;
}

interface CategoryItem {
  id: string;
  product: string;
  quantity: string;
  invoiceSupplier: string;
  inputUnit?: "butir" | "kg"; // For Negeri products
}

interface CategoryData {
  enabled: boolean;
  items: CategoryItem[];
}

const CATEGORIES: InventoryCategory[] = ["egg", "box", "label", "packaging"];

export function OutflowForm({ inflows, onSubmit }: OutflowFormProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { getTypesByCategory, conversionMap, eggProductNames } = useItemTypes();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [submitting, setSubmitting] = useState(false);
  
  const [categoryData, setCategoryData] = useState<Record<InventoryCategory, CategoryData>>({
    egg: { enabled: false, items: [] },
    box: { enabled: false, items: [] },
    label: { enabled: false, items: [] },
    packaging: { enabled: false, items: [] },
  });

  const toggleCategory = (category: InventoryCategory) => {
    setCategoryData((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        enabled: !prev[category].enabled,
        items: !prev[category].enabled ? [createEmptyItem()] : [],
      },
    }));
  };

  const createEmptyItem = (): CategoryItem => ({
    id: crypto.randomUUID(),
    product: "",
    quantity: "",
    invoiceSupplier: "",
    inputUnit: "butir",
  });

  const addItemToCategory = (category: InventoryCategory) => {
    setCategoryData((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        items: [...prev[category].items, createEmptyItem()],
      },
    }));
  };

  const removeItemFromCategory = (category: InventoryCategory, itemId: string) => {
    setCategoryData((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        items: prev[category].items.filter((i) => i.id !== itemId),
      },
    }));
  };

  const updateItem = (
    category: InventoryCategory,
    itemId: string,
    field: keyof CategoryItem,
    value: string
  ) => {
    setCategoryData((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        items: prev[category].items.map((item) =>
          item.id === itemId ? { ...item, [field]: value } : item
        ),
      },
    }));
  };

  const getProductOptions = (category: InventoryCategory): string[] => {
    if (category === "egg") {
      return eggProductNames;
    }
    return getTypesByCategory(category).map((t) => t.name);
  };

  const getAvailableStock = (category: InventoryCategory, product: string): number => {
    return inflows
      .filter((i) => i.product === product && i.category === category && i.remainingButir > 0)
      .reduce((sum, i) => sum + i.remainingButir, 0);
  };

  const totalItemCount = useMemo(() => {
    return Object.values(categoryData).reduce(
      (sum, cat) => sum + (cat.enabled ? cat.items.filter((i) => i.product && i.quantity).length : 0),
      0
    );
  }, [categoryData]);

  const hasOverstock = useMemo(() => {
    for (const category of CATEGORIES) {
      const data = categoryData[category];
      if (!data.enabled) continue;

      for (const item of data.items) {
        if (!item.product || !item.quantity) continue;
        // Compare in the product's native stock unit (kg for weight-sold eggs):
        // a butir entry on a kg product converts to estimated kg first.
        let qty = parseCountInput(item.quantity) ?? 0;
        if (category === "egg" && item.inputUnit !== "kg") {
          const config = conversionMap[item.product];
          if (config && config.unit === "kg" && config.eggs_per_unit > 0) {
            qty = Math.round((qty / config.eggs_per_unit) * 100) / 100;
          }
        }
        const available = getAvailableStock(category, item.product);
        if (qty > available + 1e-9) return true;
      }
    }
    return false;
  }, [categoryData, inflows, conversionMap]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (hasOverstock) {
      toast({
        title: t.outflow.insufficientStock,
        description: t.outflow.oneOrMoreExceed,
        variant: "destructive",
      });
      return;
    }

    const entries: OutflowEntry[] = [];

    for (const category of CATEGORIES) {
      const data = categoryData[category];
      if (!data.enabled) continue;

      for (const item of data.items) {
        if (!item.product || !item.quantity) continue;

        const quantityNum = parseCountInput(item.quantity);
        if (quantityNum == null || quantityNum <= 0) continue;

        // kg-native: deduct in the product's stock unit. kg input on a kg
        // product passes through exactly; a butir entry on a kg product
        // converts to estimated kg.
        let quantityInButir = quantityNum;
        if (category === "egg" && item.inputUnit !== "kg") {
          const config = conversionMap[item.product];
          if (config && config.unit === "kg" && config.eggs_per_unit > 0) {
            quantityInButir = Math.round((quantityNum / config.eggs_per_unit) * 100) / 100;
          }
        }

        entries.push({
          id: crypto.randomUUID(),
          date,
          product: item.product,
          quantityInButir,
          createdAt: new Date().toISOString(),
          category,
          invoiceSupplier: item.invoiceSupplier || undefined,
        });
      }
    }

    if (entries.length === 0) {
      toast({
        title: t.common.error,
        description: t.inflow.pleaseAddOneItem,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    const userEmail = user?.email || "";
    const ok = await onSubmit(entries, userEmail);
    setSubmitting(false);

    if (!ok) {
      toast({
        title: t.inflow.failedToSave,
        description: t.outflow.outflowNotSaved,
        variant: "destructive",
      });
      return;
    }

    // Reset form
    setCategoryData({
      egg: { enabled: false, items: [] },
      box: { enabled: false, items: [] },
      label: { enabled: false, items: [] },
      packaging: { enabled: false, items: [] },
    });

    toast({
      title: t.outflow.stockRemoved,
      description: `${entries.length} ${t.outflow.itemsRemovedFromInventory}`,
    });
  };

  return (
    <Card className="shadow-soft animate-fade-in">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <PackageMinus className="h-5 w-5 text-destructive" />
          {t.outflow.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="outflow-date">{t.common.date}</Label>
            <Input
              id="outflow-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-12"
            />
          </div>

          {/* Category Selection */}
          <div className="space-y-3">
            <Label>{t.outflow.selectCategories}</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <div key={category} className="flex items-center space-x-2">
                  <Checkbox
                    id={`out-cat-${category}`}
                    checked={categoryData[category].enabled}
                    onCheckedChange={() => toggleCategory(category)}
                  />
                  <label
                    htmlFor={`out-cat-${category}`}
                    className="text-sm font-medium cursor-pointer"
                  >
                    {CATEGORY_LABELS[category]}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Category Forms */}
          {CATEGORIES.map((category) => {
            const data = categoryData[category];
            if (!data.enabled) return null;

            return (
              <OutflowCategorySection
                key={category}
                category={category}
                items={data.items}
                productOptions={getProductOptions(category)}
                conversionMap={conversionMap}
                getAvailableStock={(product) => getAvailableStock(category, product)}
                onAddItem={() => addItemToCategory(category)}
                onRemoveItem={(itemId) => removeItemFromCategory(category, itemId)}
                onUpdateItem={(itemId, field, value) =>
                  updateItem(category, itemId, field, value)
                }
              />
            );
          })}

          {totalItemCount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-accent/50 rounded-lg">
              <Badge variant="secondary">{totalItemCount} {t.common.items}</Badge>
              <span className="text-sm text-muted-foreground">{t.common.readyToRemove}</span>
            </div>
          )}

          <Button
            type="submit"
            variant="destructive"
            className="w-full h-12 text-base font-medium"
            disabled={submitting || totalItemCount === 0 || hasOverstock}
          >
            <PackageMinus className="h-4 w-4 mr-2" />
            {submitting ? t.common.saving : t.outflow.removeFromInventory}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface OutflowCategorySectionProps {
  category: InventoryCategory;
  items: CategoryItem[];
  productOptions: string[];
  conversionMap: ConversionMap;
  getAvailableStock: (product: string) => number;
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, field: keyof CategoryItem, value: string) => void;
}

function OutflowCategorySection({
  category,
  items,
  productOptions,
  conversionMap,
  getAvailableStock,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
}: OutflowCategorySectionProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Badge variant="outline">{CATEGORY_LABELS[category]}</Badge>
        </h3>
        <Button type="button" variant="outline" size="sm" onClick={onAddItem}>
          <Plus className="h-3 w-3 mr-1" /> {t.common.addItem}
        </Button>
      </div>

      {items.map((item, index) => (
        <OutflowItemRow
          key={item.id}
          item={item}
          index={index}
          category={category}
          productOptions={productOptions}
          conversionMap={conversionMap}
          availableStock={item.product ? getAvailableStock(item.product) : 0}
          onRemove={() => onRemoveItem(item.id)}
          onUpdate={(field, value) => onUpdateItem(item.id, field, value)}
        />
      ))}

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-2">
          {t.common.clickAddItem}
        </p>
      )}
    </div>
  );
}

interface OutflowItemRowProps {
  item: CategoryItem;
  index: number;
  category: InventoryCategory;
  productOptions: string[];
  conversionMap: ConversionMap;
  availableStock: number;
  onRemove: () => void;
  onUpdate: (field: keyof CategoryItem, value: string) => void;
}

function OutflowItemRow({
  item,
  index,
  category,
  productOptions,
  conversionMap,
  availableStock,
  onRemove,
  onUpdate
}: OutflowItemRowProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  // A product supports kg input when its catalog conversion says it's sold by weight.
  const isKgProduct = category === "egg" && conversionMap[item.product]?.unit === "kg";
  const inputUnit = item.inputUnit || "butir";
  const factor = conversionMap[item.product]?.eggs_per_unit || 0;

  // Quantity in the product's NATIVE stock unit (kg for weight-sold eggs).
  const getQuantityInStock = () => {
    const qty = parseCountInput(item.quantity) ?? 0;
    if (isKgProduct && inputUnit !== "kg" && factor > 0) {
      return Math.round((qty / factor) * 100) / 100; // butir entry -> estimated kg
    }
    return qty;
  };

  const quantityInStock = getQuantityInStock();
  const isOverstock = item.product && quantityInStock > availableStock + 1e-9;
  const stockUnit = category !== "egg" ? "pcs" : isKgProduct ? "kg" : "butir";
  const displayUnit = category === "egg" ? (isKgProduct && inputUnit === "kg" ? "kg" : "butir") : "pcs";

  return (
    <div className="space-y-2 p-3 bg-background rounded border">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t.common.item} {index + 1}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Product Selector */}
        <div className="space-y-1">
          <Label className="text-xs">{t.common.type}</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between h-10 text-sm"
              >
                {item.product || t.common.selectDots}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[250px] p-0 z-50" align="start">
              <Command>
                <CommandInput placeholder={t.common.searchDots} />
                <CommandList>
                  <CommandEmpty>{t.common.noResultsFound}</CommandEmpty>
                  <CommandGroup>
                    {productOptions.map((option) => (
                      <CommandItem
                        key={option}
                        value={option}
                        onSelect={() => {
                          onUpdate("product", option);
                          // Reset to butir when changing to a non-kg product
                          if (conversionMap[option]?.unit !== "kg") {
                            onUpdate("inputUnit", "butir");
                          }
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            item.product === option ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {option}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Quantity */}
        <div className="space-y-1">
          <Label className="text-xs">{t.common.quantity} ({displayUnit})</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={item.quantity}
            onChange={(e) => onUpdate("quantity", e.target.value)}
            placeholder={t.outflow.enterQty}
            className={cn("h-10", isOverstock && "border-destructive focus-visible:ring-destructive")}
          />
        </div>

        {/* Invoice/Supplier */}
        <div className="space-y-1">
          <Label className="text-xs">{t.inflow.invoiceSupplier}</Label>
          <Input
            type="text"
            value={item.invoiceSupplier}
            onChange={(e) => onUpdate("invoiceSupplier", e.target.value)}
            placeholder={t.common.optional}
            className="h-10"
          />
        </div>
      </div>

      {/* Butir/Kg Switch for weight-sold eggs */}
      {isKgProduct && (
        <div className="flex items-center gap-3 pt-1">
          <span className={cn("text-xs font-medium", inputUnit === "butir" && "text-primary")}>
            Butir
          </span>
          <Switch
            checked={inputUnit === "kg"}
            onCheckedChange={(checked) => onUpdate("inputUnit", checked ? "kg" : "butir")}
          />
          <span className={cn("text-xs font-medium", inputUnit === "kg" && "text-primary")}>
            Kg
          </span>
          {item.quantity && (
            <span className="text-xs text-muted-foreground ml-2">
              {inputUnit === "kg"
                ? `≈ ${Math.round((parseCountInput(item.quantity) ?? 0) * factor).toLocaleString()} butir`
                : `≈ ${quantityInStock.toLocaleString()} kg deducted`}
            </span>
          )}
        </div>
      )}

      {item.product && (
        <div className="text-xs text-muted-foreground">
          {t.common.available}: <strong className="text-foreground">{availableStock.toLocaleString()}</strong> {stockUnit}
        </div>
      )}

      {isOverstock && (
        <div className="flex items-center gap-2 p-2 bg-destructive/10 text-destructive rounded text-xs">
          <AlertCircle className="h-3 w-3" />
          <span>{t.outflow.exceedsStock} {(Math.round((quantityInStock - availableStock) * 100) / 100).toLocaleString()} {stockUnit}</span>
        </div>
      )}
    </div>
  );
}
