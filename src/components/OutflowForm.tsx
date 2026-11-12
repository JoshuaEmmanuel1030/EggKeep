import { useEffect, useRef, useState, useMemo } from "react";
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
  ConversionMap,
} from "@/types/inventory";
import { useItemTypes } from "@/hooks/useItemTypes";
import { eggRingItems, isBrokenKasLine, isValidKasLine, kasStockQty, type KasLine } from "@/lib/kasTunai";
import { PHONE_HOLD_MS } from "@/lib/radial";
import { RadialAddButton, revealPickedRow, type RadialItem } from "./RadialAddButton";
import { PackageMinus, Plus, Trash2, ChevronsUpDown, Check, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { format } from "date-fns";

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

// A row follows Kas Tunai's rules: kg typed only on a weight-sold egg, whole
// counts otherwise. The conversion map is keyed by name alone, so box, label and
// packaging rows rely on none of them sharing a kg egg's exact name (none does).
const kasLine = (item: CategoryItem): KasLine => ({
  id: item.id,
  product: item.product,
  qty: item.quantity,
  inputUnit: item.inputUnit || "butir",
});

export function OutflowForm({ inflows, onSubmit }: OutflowFormProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { getTypesByCategory, conversionMap, eggProductNames, itemTypes } = useItemTypes();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
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

  const radialEggs = useMemo(() => eggRingItems(eggProductNames, itemTypes), [eggProductNames, itemTypes]);

  // Radial pick: fills the first egg row with no product, else appends one,
  // applying what the row's product combobox applies. The effect below reveals it.
  const pickedItemId = useRef<string | null>(null);
  const pickEgg = ({ key: product }: RadialItem) => {
    const patch: Partial<CategoryItem> = conversionMap[product]?.unit !== "kg" ? { product, inputUnit: "butir" } : { product };
    const empty = categoryData.egg.items.find((i) => !i.product);
    const item = empty ?? createEmptyItem();
    pickedItemId.current = item.id;
    setCategoryData((prev) => ({
      ...prev,
      egg: {
        ...prev.egg,
        items: empty
          ? prev.egg.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i))
          : [...prev.egg.items, { ...item, ...patch }],
      },
    }));
  };
  useEffect(() => {
    const id = pickedItemId.current;
    pickedItemId.current = null;
    const row = id && document.querySelector<HTMLElement>(`[data-line-id="${id}"]`);
    if (row) revealPickedRow(row); // the row's first input: Quantity (the invoice input comes second)
  }, [categoryData]);

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

  // A switched-off category has no items (toggleCategory clears them).
  const allItems = CATEGORIES.flatMap((category) => categoryData[category].items);
  const totalItemCount = allItems.filter((i) => isValidKasLine(kasLine(i), conversionMap)).length;
  // Typed but won't be recorded: blocks the submit, so it's never dropped beside valid rows.
  const brokenItems = allItems.filter((i) => isBrokenKasLine(kasLine(i), conversionMap));

  const hasOverstock = useMemo(() => {
    for (const category of CATEGORIES) {
      const data = categoryData[category];
      if (!data.enabled) continue;

      for (const item of data.items) {
        if (!item.product || !item.quantity) continue;
        // Compare in the product's native stock unit (kg for weight-sold eggs).
        const qty = kasStockQty(kasLine(item), conversionMap);
        const available = getAvailableStock(category, item.product);
        if (qty > available + 1e-9) return true;
      }
    }
    return false;
  }, [categoryData, inflows, conversionMap]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (brokenItems.length > 0) return; // Enter in a field gets here past the disabled button

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
        const line = kasLine(item);
        if (!isValidKasLine(line, conversionMap)) continue;

        entries.push({
          id: crypto.randomUUID(),
          date,
          product: item.product,
          quantityInButir: kasStockQty(line, conversionMap), // the product's native stock unit
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
                    {t.categories[category]}
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
                eggRing={radialEggs}
                onPickEgg={pickEgg}
              />
            );
          })}

          {brokenItems.length > 0 ? (
            <p role="alert" className="text-sm text-red-600">
              {brokenItems.some((i) => i.product) ? t.inflow.invalidQty : t.outflow.pickProductForQty}
            </p>
          ) : (
            totalItemCount > 0 && (
              <div className="flex items-center gap-2 p-3 bg-accent/50 rounded-lg">
                <Badge variant="secondary">{totalItemCount} {t.common.items}</Badge>
                <span className="text-sm text-muted-foreground">{t.common.readyToRemove}</span>
              </div>
            )
          )}

          <Button
            type="submit"
            variant="destructive"
            className="w-full h-12 text-base font-medium"
            disabled={submitting || totalItemCount === 0 || hasOverstock || brokenItems.length > 0}
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
  // The egg section adds through the radial ring instead of the header button.
  eggRing: RadialItem[];
  onPickEgg: (item: RadialItem) => void;
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
  eggRing,
  onPickEgg,
}: OutflowCategorySectionProps) {
  const { t } = useLanguage();
  const isEgg = category === "egg";

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Badge variant="outline">{t.categories[category]}</Badge>
        </h3>
        {!isEgg && (
          <Button type="button" variant="outline" size="sm" onClick={onAddItem}>
            <Plus className="h-3 w-3 mr-1" /> {t.common.addItem}
          </Button>
        )}
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

      {!isEgg && items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-2">
          {t.common.clickAddItem}
        </p>
      )}

      {/* Wrapped: space-y-3 would zero the trigger's margin-bottom, where its caption sits. */}
      {isEgg && (
        <div>
          <RadialAddButton
            caption={t.kas.addEgg}
            items={eggRing}
            banner={{ text: t.radial.pickEgg }}
            centerVerb={t.radial.add}
            holdMs={PHONE_HOLD_MS}
            onTap={onAddItem}
            onPick={onPickEgg}
          />
        </div>
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
  const quantityInStock = kasStockQty(kasLine(item), conversionMap);
  const isOverstock = item.product && quantityInStock > availableStock + 1e-9;
  // Flag the number only once a product is picked (typing qty first is normal).
  const broken = !!item.product && isBrokenKasLine(kasLine(item), conversionMap);
  const stockUnit = category !== "egg" ? "pcs" : isKgProduct ? "kg" : "butir";
  const displayUnit = category === "egg" ? (isKgProduct && inputUnit === "kg" ? "kg" : "butir") : "pcs";

  return (
    // data-line-id: the form finds a radial-picked row by it to focus and flash it.
    <div data-line-id={item.id} className="space-y-2 p-3 bg-background rounded border">
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
            aria-invalid={broken || undefined}
            placeholder={t.outflow.enterQty}
            className={cn("h-10", (isOverstock || broken) && "border-destructive focus-visible:ring-destructive")}
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
          {item.quantity && !broken && (
            <span className="text-xs text-muted-foreground ml-2">
              {inputUnit === "kg"
                ? `≈ ${Math.round(quantityInStock * factor).toLocaleString()} butir`
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
