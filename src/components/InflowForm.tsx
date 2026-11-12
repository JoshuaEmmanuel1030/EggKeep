import { useState } from "react";
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
  ConversionMap,
  StockSummary,
} from "@/types/inventory";
import { useItemTypes } from "@/hooks/useItemTypes";
import { convertToButir, getProductUnit, getStockUnit } from "@/lib/inventory";
import { parseQtyInput } from "@/lib/stockCount";
import { Box, Egg, Package, Tag, PackagePlus, Plus, Trash2, ChevronsUpDown, Check, Calculator, type LucideIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { format } from "date-fns";
import { SubtleDateLink } from "./SubtleDateLink";
import { InflowSummaryPanel, type InflowSummaryGroup } from "./InflowSummaryPanel";

interface InflowFormProps {
  onSubmit: (entries: InflowEntry[], userEmail: string) => Promise<boolean>;
  // Tablet (7a) only: the Ringkasan's stock before -> after.
  stockSummary?: StockSummary[];
  tablet?: boolean;
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

const CATEGORY_LOOK: Record<InventoryCategory, { Icon: LucideIcon; color: string }> = {
  egg: { Icon: Egg, color: "text-amber-500" },
  box: { Icon: Box, color: "text-green-500" },
  label: { Icon: Tag, color: "text-pink-500" },
  packaging: { Icon: Package, color: "text-blue-500" },
};

// Tablet (7a): 44px control, radius 10, amber focus ring; one grid for the table's headers and rows.
const TB_CONTROL =
  "h-11 rounded-[10px] border-ek-border bg-card px-3 text-[15px] text-ek-fg md:text-[15px] placeholder:text-[#a89d90] focus-visible:border-amber-600 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_3px_rgba(217,119,6,0.15)]";
const TB_ROW = "grid grid-cols-[28px_minmax(0,1fr)_140px_170px_44px] items-center gap-2";
const BROKEN_INPUT =
  "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/15 focus-visible:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]";

// Jumlah in the product's native unit (kg-native: the number IS the stock quantity).
const parseItemQty = (item: CategoryItem, category: InventoryCategory, conversionMap: ConversionMap) =>
  parseQtyInput(item.quantity, getStockUnit(item.product, category, conversionMap));

// A row counts only if handleSubmit will record it.
const isValidItem = (item: CategoryItem, category: InventoryCategory, conversionMap: ConversionMap) =>
  !!item.product && (parseItemQty(item, category, conversionMap) ?? 0) > 0;

// Typed but won't be recorded (bad number, no product, 0): blocks the submit, so
// it's never dropped silently beside valid rows. The same rule as isBrokenKasLine.
const isBrokenItem = (item: CategoryItem, category: InventoryCategory, conversionMap: ConversionMap) =>
  item.quantity.trim() !== "" && !isValidItem(item, category, conversionMap);

export function InflowForm({ onSubmit, stockSummary = [], tablet = false }: InflowFormProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { getTypesByCategory, conversionMap, eggProductNames } = useItemTypes();
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

  // A switched-off category has no items (toggleCategory clears them).
  const totalItemCount = CATEGORIES.reduce(
    (sum, category) => sum + categoryData[category].items.filter((i) => isValidItem(i, category, conversionMap)).length,
    0
  );
  const brokenItems = CATEGORIES.flatMap((category) =>
    categoryData[category].items.filter((i) => isBrokenItem(i, category, conversionMap))
  );
  // Only a row with a product goes red, so that's the message that talks about red.
  const brokenNote =
    brokenItems.length === 0 ? null : brokenItems.some((i) => i.product) ? t.inflow.invalidQty : t.outflow.pickProductForQty;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (brokenNote) return;

    const entries: InflowEntry[] = [];

    for (const category of CATEGORIES) {
      const data = categoryData[category];
      if (!data.enabled) continue;

      for (const item of data.items) {
        if (!item.product || !item.quantity) continue;

        const quantityNum = parseItemQty(item, category, conversionMap);
        if (quantityNum == null || quantityNum <= 0) continue;

        const unit = category === "egg" ? getProductUnit(item.product, conversionMap) : "pcs";
        // kg-native: stock is stored in the product's own unit. The form already
        // takes input in that unit (kg for weight-sold eggs, butir otherwise),
        // so the entered quantity IS the stock quantity — no conversion.
        const quantityInButir = quantityNum;

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
    setDate(format(new Date(), "yyyy-MM-dd"));

    toast({
      title: t.inflow.stockAdded,
      description: `${entries.length} ${t.inflow.itemsAddedToInventory}`,
    });
  };

  const sectionProps = (category: InventoryCategory) => ({
    category,
    items: categoryData[category].items,
    productOptions: getProductOptions(category),
    conversionMap,
    onAddItem: () => addItemToCategory(category),
    onRemoveItem: (itemId: string) => removeItemFromCategory(category, itemId),
    onUpdateItem: (itemId: string, field: keyof CategoryItem, value: string) => updateItem(category, itemId, field, value),
  });

  if (tablet) {
    const today = format(new Date(), "yyyy-MM-dd");
    // A date cleared in portrait would read "hari ini" here but save blank.
    if (!date) setDate(today);

    const enabled = CATEGORIES.filter((category) => categoryData[category].enabled);
    const groups: InflowSummaryGroup[] = enabled.map((category) => ({
      category,
      ...CATEGORY_LOOK[category],
      lines: categoryData[category].items.filter((item) => isValidItem(item, category, conversionMap)).map((item) => {
        const quantity = parseItemQty(item, category, conversionMap) as number;
        const now = stockSummary.find((s) => s.product === item.product)?.totalStock ?? 0;
        return {
          id: item.id,
          product: item.product,
          invoiceSupplier: item.invoiceSupplier,
          quantity,
          now,
          after: now + quantity,
          unit: getStockUnit(item.product, category, conversionMap),
        };
      }),
    }));

    return (
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 bg-ek-bg">
        <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-7 pt-[22px] text-ek-fg">
          <div className="mb-[18px] flex items-start gap-3">
            <PackagePlus aria-hidden className="mt-0.5 h-7 w-7 shrink-0 text-emerald-600" />
            <div>
              <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em]">{t.inflow.title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[13.5px] font-medium text-ek-mfg">
                <span className="whitespace-nowrap">{t.inflow.subtitle} ·</span>
                <SubtleDateLink value={date !== today ? date : null} onChange={(v) => setDate(v ?? today)} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13.5px] font-semibold text-ek-nav">{t.inflow.selectCategories}</span>
            <div className="grid grid-cols-4 gap-2.5">
              {CATEGORIES.map((category) => {
                const { Icon, color } = CATEGORY_LOOK[category];
                const group = groups.find((g) => g.category === category);
                return (
                  <button
                    key={category}
                    type="button"
                    role="checkbox"
                    aria-checked={!!group}
                    onClick={() => toggleCategory(category)}
                    className={cn(
                      // pr-1, like the prototype: a 152px card only just fits "Kemasan" beside the icon.
                      "flex h-[72px] min-w-0 items-center rounded-[14px] border-2 border-ek-border bg-card py-2.5 pl-3 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      group && "border-emerald-600 bg-[#f0fdf8]"
                    )}
                  >
                    <span
                      className={cn(
                        "mr-2.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2 border-[#cfc5b6] text-white",
                        group && "border-emerald-600 bg-emerald-600"
                      )}
                    >
                      {group && <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15.5px] font-semibold">{t.categories[category]}</span>
                      <span className="mt-0.5 block text-[12.5px] text-ek-mfg">
                        {group ? `${group.lines.length} ${t.common.items}` : t.inflow.off}
                      </span>
                    </span>
                    <Icon aria-hidden className={cn("ml-1.5 h-[22px] w-[22px] shrink-0", color)} />
                  </button>
                );
              })}
            </div>
          </div>

          {enabled.length === 0 ? (
            <div className="mt-4 rounded-[14px] border-2 border-dashed border-ek-border p-[26px] text-center text-[15px] leading-normal text-ek-mfg">
              {t.inflow.selectCategories}
            </div>
          ) : (
            enabled.map((category) => <CategoryTable key={category} {...sectionProps(category)} />)
          )}
        </div>

        <InflowSummaryPanel date={date} groups={groups} submitting={submitting} brokenNote={brokenNote} />
      </form>
    );
  }

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
                    {t.categories[category]}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Category Forms */}
          {CATEGORIES.map((category) =>
            categoryData[category].enabled ? <CategorySection key={category} {...sectionProps(category)} /> : null
          )}

          {brokenNote ? (
            <p role="alert" className="text-sm text-red-600">{brokenNote}</p>
          ) : (
            totalItemCount > 0 && (
              <div className="flex items-center gap-2 p-3 bg-accent/50 rounded-lg">
                <Badge variant="secondary">{totalItemCount} {t.common.items}</Badge>
                <span className="text-sm text-muted-foreground">{t.common.readyToAdd}</span>
              </div>
            )
          )}

          <Button
            type="submit"
            className="w-full h-12 text-base font-medium"
            disabled={submitting || totalItemCount === 0 || !!brokenNote}
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
  conversionMap: ConversionMap;
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, field: keyof CategoryItem, value: string) => void;
}

function CategorySection({
  category,
  items,
  productOptions,
  conversionMap,
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
            {t.categories[category]}
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
          conversionMap={conversionMap}
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

// Tablet (7a): one white table card per enabled category.
function CategoryTable({
  category,
  items,
  productOptions,
  conversionMap,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
}: CategorySectionProps) {
  const { t } = useLanguage();
  const { Icon } = CATEGORY_LOOK[category];

  return (
    <div className="mt-4 rounded-2xl border border-ek-border bg-card pb-1">
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-ek-border bg-card px-[9px] py-1 text-[13.5px] font-semibold">
          <Icon aria-hidden className="h-3.5 w-3.5" />
          {t.categories[category]}
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={onAddItem}
          className="ml-auto h-10 gap-2 rounded-[10px] border-ek-border bg-card px-3 text-sm font-semibold text-ek-fg hover:border-[#d9cfbf] hover:bg-card hover:text-ek-fg [&_svg]:size-3.5"
        >
          <Plus aria-hidden />
          {t.common.addItem}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="px-1.5 py-3 text-center text-sm text-ek-mfg">{t.common.clickAddItem}</p>
      ) : (
        <>
          <div className={cn(TB_ROW, "px-3.5 pb-1.5 text-[12.5px] font-semibold text-ek-mfg")}>
            <span>#</span>
            <span>{t.common.type}</span>
            <span>{t.common.quantity}</span>
            <span>{t.inflow.invoiceSupplier}</span>
            <span />
          </div>
          {items.map((item, index) => (
            <TableItemRow
              key={item.id}
              item={item}
              index={index}
              category={category}
              productOptions={productOptions}
              conversionMap={conversionMap}
              onRemove={() => onRemoveItem(item.id)}
              onUpdate={(field, value) => onUpdateItem(item.id, field, value)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function TableItemRow({ item, index, category, productOptions, conversionMap, onRemove, onUpdate }: ItemRowProps) {
  const { t, language } = useLanguage();
  const locale = language === "id" ? "id-ID" : "en-US";
  const nf = (n: number) => n.toLocaleString(locale);
  const [open, setOpen] = useState(false);

  const quantityNum = parseItemQty(item, category, conversionMap) ?? 0;
  // Flag the number only once a product is picked (typing qty first is normal).
  const broken = !!item.product && isBrokenItem(item, category, conversionMap);
  const unit = getStockUnit(item.product, category, conversionMap);

  return (
    <div className="flex flex-col gap-2 border-t border-ek-border px-3.5 py-2.5">
      <div className={TB_ROW}>
        <span className="justify-self-start whitespace-nowrap rounded-[7px] border border-ek-border bg-card px-[7px] py-[3px] font-mono text-[13px] font-bold text-ek-mfg">
          {index + 1}
        </span>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={t.common.type}
              className={cn(
                TB_CONTROL,
                "w-full min-w-0 justify-between gap-2 font-semibold hover:bg-card hover:text-ek-fg",
                !item.product && "font-normal text-[#a89d90] hover:text-[#a89d90]"
              )}
            >
              <span className="min-w-0 truncate">{item.product || t.common.selectDots}</span>
              <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-ek-mfg" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[270px] overflow-hidden rounded-[14px] border-ek-border p-0 shadow-[0_14px_36px_rgba(0,0,0,.16)]"
            align="start"
          >
            <Command>
              <CommandInput placeholder={t.common.searchDots} className="text-[15px]" />
              <CommandList className="max-h-[264px] p-1.5">
                <CommandEmpty>{t.common.noResultsFound}</CommandEmpty>
                <CommandGroup className="p-0">
                  {productOptions.map((option) => (
                    <CommandItem
                      key={option}
                      value={option}
                      onSelect={() => {
                        onUpdate("product", option);
                        setOpen(false);
                      }}
                      className="min-h-[44px] gap-2 rounded-[9px] px-2.5 text-[15px]"
                    >
                      <Check
                        aria-hidden
                        className={cn("h-4 w-4 shrink-0 text-amber-700", item.product === option ? "opacity-100" : "opacity-0")}
                      />
                      {option}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <span className="relative">
          <Input
            type="text"
            inputMode="decimal"
            value={item.quantity}
            onChange={(e) => onUpdate("quantity", e.target.value)}
            aria-label={`${t.common.quantity} (${unit})`}
            aria-invalid={broken || undefined}
            placeholder={t.outflow.enterQty}
            className={cn(TB_CONTROL, "pr-[52px] font-semibold tabular-nums placeholder:font-normal", broken && BROKEN_INPUT)}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13.5px] text-ek-mfg">{unit}</span>
        </span>

        <Input
          type="text"
          value={item.invoiceSupplier}
          onChange={(e) => onUpdate("invoiceSupplier", e.target.value)}
          aria-label={t.inflow.invoiceSupplier}
          placeholder={t.common.optional}
          className={TB_CONTROL}
        />

        <Button
          type="button"
          variant="ghost"
          aria-label={t.activity.removeLine}
          onClick={onRemove}
          className="h-11 w-11 rounded-[11px] p-0 text-red-600 hover:bg-red-50 hover:text-red-600 [&_svg]:size-[18px]"
        >
          <Trash2 aria-hidden />
        </Button>
      </div>

      {category === "egg" && item.product && !conversionMap[item.product] && (
        <div className="ml-9 mr-[52px] flex items-center gap-2 rounded-[9px] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <Calculator aria-hidden className="h-[15px] w-[15px] shrink-0" />
          <span>{t.inflow.noConversion.replace("{product}", item.product)}</span>
        </div>
      )}

      {/* kg eggs only: a butir egg is 1:1, so its line would just repeat the number. */}
      {unit === "kg" && quantityNum > 0 && (
        <div className="ml-9 mr-[52px] flex items-center gap-2 rounded-[9px] bg-emerald-50 px-3 py-2 text-sm">
          <Calculator aria-hidden className="h-[15px] w-[15px] shrink-0 text-emerald-600" />
          <span>
            <b className="font-bold">{nf(quantityNum)}</b> kg ={" "}
            <b className="font-bold text-emerald-700">{nf(convertToButir(item.product, quantityNum, conversionMap))}</b> butir{" "}
            <span className="text-ek-mfg">(× {nf(conversionMap[item.product].eggs_per_unit)} butir/kg)</span>
          </span>
        </div>
      )}
    </div>
  );
}

interface ItemRowProps {
  item: CategoryItem;
  index: number;
  category: InventoryCategory;
  productOptions: string[];
  conversionMap: ConversionMap;
  onRemove: () => void;
  onUpdate: (field: keyof CategoryItem, value: string) => void;
}

function ItemRow({ item, index, category, productOptions, conversionMap, onRemove, onUpdate }: ItemRowProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const quantityNum = parseItemQty(item, category, conversionMap) ?? 0;
  // Flag the number only once a product is picked (typing qty first is normal).
  const broken = !!item.product && isBrokenItem(item, category, conversionMap);
  const showConversion = category === "egg" && item.product && quantityNum > 0;
  const convertedButir = showConversion ? convertToButir(item.product, quantityNum, conversionMap) : 0;
  const unit = category === "egg" && item.product ? getProductUnit(item.product, conversionMap) : "pcs";

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
            type="text"
            inputMode="decimal"
            value={item.quantity}
            onChange={(e) => onUpdate("quantity", e.target.value)}
            aria-invalid={broken || undefined}
            placeholder={t.outflow.enterQty}
            className={cn("h-10", broken && BROKEN_INPUT)}
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

      {category === "egg" && item.product && !conversionMap[item.product] && (
        <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 rounded text-xs">
          <Calculator className="h-3 w-3 shrink-0" />
          <span>
            No unit conversion configured for <strong>{item.product}</strong> — the
            quantity will be recorded as butir 1:1. Set its unit in the Catalog if it
            is sold by kg.
          </span>
        </div>
      )}

      {showConversion && (
        <div className="flex items-center gap-2 p-2 bg-accent/50 rounded text-xs">
          <Calculator className="h-3 w-3 text-primary" />
          <span>
            <strong>{quantityNum}</strong> {unit} ={" "}
            <strong className="text-primary">{convertedButir.toLocaleString()}</strong> butir
            {unit === "kg" && conversionMap[item.product] && (
              <span className="text-muted-foreground ml-1">
                (× {conversionMap[item.product].eggs_per_unit} eggs/kg)
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
