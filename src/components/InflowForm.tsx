import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  InflowEntry, 
  InventoryCategory, 
  CATEGORY_LABELS, 
  CONVERSION_DICT,
  PRODUCT_NAMES,
} from "@/types/inventory";
import { useItemTypes } from "@/hooks/useItemTypes";
import { convertToButir, getProductUnit } from "@/lib/inventory";
import { PackagePlus, Plus, Trash2, ChevronsUpDown, Check, Calculator } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";

interface InflowFormProps {
  onSubmit: (entries: InflowEntry[], userEmail: string) => Promise<boolean>;
}

interface CategoryItem {
  id: string;
  product: string;
  quantity: string;
  invoiceSupplier: string;
}

interface CategoryData {
  enabled: boolean;
  items: CategoryItem[];
}

const CATEGORIES: InventoryCategory[] = ["egg", "box", "label", "packaging"];

export function InflowForm({ onSubmit }: InflowFormProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { getTypesByCategory } = useItemTypes();
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
      return PRODUCT_NAMES;
    }
    return getTypesByCategory(category).map((t) => t.name);
  };

  const totalItemCount = useMemo(() => {
    return Object.values(categoryData).reduce(
      (sum, cat) => sum + (cat.enabled ? cat.items.filter((i) => i.product && i.quantity).length : 0),
      0
    );
  }, [categoryData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const entries: InflowEntry[] = [];

    for (const category of CATEGORIES) {
      const data = categoryData[category];
      if (!data.enabled) continue;

      for (const item of data.items) {
        if (!item.product || !item.quantity) continue;

        const quantityNum = parseFloat(item.quantity);
        if (quantityNum <= 0) continue;

        const unit = category === "egg" ? getProductUnit(item.product) : "pcs";
        const quantityInButir = category === "egg" 
          ? convertToButir(item.product, quantityNum) 
          : quantityNum;

        entries.push({
          id: crypto.randomUUID(),
          date,
          product: item.product,
          quantity: quantityNum,
          unit,
          quantityInButir,
          remainingButir: quantityInButir,
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
        description: t.inflow.inflowNotSaved,
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
      title: t.inflow.stockAdded,
      description: `${entries.length} ${t.inflow.itemsAddedToInventory}`,
    });
  };

  return (
    <Card className="shadow-soft animate-fade-in">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <PackagePlus className="h-5 w-5 text-primary" />
          {t.inflow.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="inflow-date">{t.common.date}</Label>
            <Input
              id="inflow-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-12"
            />
          </div>

          {/* Category Selection */}
          <div className="space-y-3">
            <Label>{t.inflow.selectCategories}</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <div key={category} className="flex items-center space-x-2">
                  <Checkbox
                    id={`cat-${category}`}
                    checked={categoryData[category].enabled}
                    onCheckedChange={() => toggleCategory(category)}
                  />
                  <label
                    htmlFor={`cat-${category}`}
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
              <CategorySection
                key={category}
                category={category}
                items={data.items}
                productOptions={getProductOptions(category)}
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
              <span className="text-sm text-muted-foreground">{t.common.readyToAdd}</span>
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-12 text-base font-medium"
            disabled={submitting || totalItemCount === 0}
          >
            <PackagePlus className="h-4 w-4 mr-2" />
            {submitting ? t.common.saving : t.inflow.addToInventory}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface CategorySectionProps {
  category: InventoryCategory;
  items: CategoryItem[];
  productOptions: string[];
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, field: keyof CategoryItem, value: string) => void;
}

function CategorySection({
  category,
  items,
  productOptions,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
}: CategorySectionProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Badge variant="outline">
            {CATEGORY_LABELS[category]}
          </Badge>
        </h3>
      </div>

      {items.map((item, index) => (
        <ItemRow
          key={item.id}
          item={item}
          index={index}
          category={category}
          productOptions={productOptions}
          onRemove={() => onRemoveItem(item.id)}
          onUpdate={(field, value) => onUpdateItem(item.id, field, value)}
        />
      ))}

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-2">
          {t.common.clickAddItem}
        </p>
      )}

      <Button type="button" variant="outline" size="sm" onClick={onAddItem} className="w-full">
        <Plus className="h-3 w-3 mr-1" /> {t.common.addItem}
      </Button>
    </div>
  );
}

interface ItemRowProps {
  item: CategoryItem;
  index: number;
  category: InventoryCategory;
  productOptions: string[];
  onRemove: () => void;
  onUpdate: (field: keyof CategoryItem, value: string) => void;
}

function ItemRow({ item, index, category, productOptions, onRemove, onUpdate }: ItemRowProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const quantityNum = parseFloat(item.quantity) || 0;
  const showConversion = category === "egg" && item.product && quantityNum > 0;
  const convertedButir = showConversion ? convertToButir(item.product, quantityNum) : 0;
  const unit = category === "egg" && item.product ? getProductUnit(item.product) : "pcs";

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
          <Label className="text-xs">{t.common.quantity} {unit && `(${unit})`}</Label>
          <Input
            type="number"
            step={unit === "kg" ? "0.01" : "1"}
            min="0"
            value={item.quantity}
            onChange={(e) => onUpdate("quantity", e.target.value)}
            placeholder={t.outflow.enterQty}
            className="h-10"
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

      {showConversion && (
        <div className="flex items-center gap-2 p-2 bg-accent/50 rounded text-xs">
          <Calculator className="h-3 w-3 text-primary" />
          <span>
            <strong>{quantityNum}</strong> {unit} ={" "}
            <strong className="text-primary">{convertedButir.toLocaleString()}</strong> butir
            {unit === "kg" && (
              <span className="text-muted-foreground ml-1">
                (× {CONVERSION_DICT[item.product].eggs_per_unit} eggs/kg)
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
