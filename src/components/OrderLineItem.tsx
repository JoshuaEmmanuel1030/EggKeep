import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OrderLine, Buyer, StockShortage } from "@/types/quickOutflow";
import { ConversionMap } from "@/types/inventory";
import {
  PackSKU,
  BoxCapacityMap,
  LabelsPerPackMap,
  calculateLineMaterials,
  isBrokenLooseLine,
} from "@/lib/outflowCalculator";
import { parseQtyInput } from "@/lib/stockCount";
import { groupSkusForBuyer } from "@/lib/buyerProfile";
import { Trash2, ChevronsUpDown, Check, Tag, Egg, Package, Box, AlertTriangle, Calculator, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

// Tablet (6a) small control: 44px, radius 10, amber focus ring.
const TB_CONTROL_SM =
  "h-11 rounded-[10px] border-ek-border bg-card px-3 text-[15px] text-ek-fg md:text-[15px] placeholder:text-[#a89d90] focus-visible:border-amber-600 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_3px_rgba(217,119,6,0.15)]";
const TB_POPOVER = "rounded-[14px] border-ek-border bg-card shadow-[0_14px_36px_rgba(0,0,0,0.16)]";

interface OrderLineItemProps {
  line: OrderLine;
  index: number;
  selectedBuyer: Buyer | null;
  skus: PackSKU[];
  pinnedSkuCodes?: Set<string>;
  conversionMap: ConversionMap;
  boxCapacityMap: BoxCapacityMap;
  labelsPerPackMap: LabelsPerPackMap;
  eggProductNames: string[];
  labelNames: string[];
  onUpdate: (updates: Partial<OrderLine>) => void;
  onRemove: () => void;
  // Tablet (6a) table row. Pack lines only: a loose line (made in portrait)
  // keeps the phone row so it still shows and can be deleted.
  tablet?: boolean;
  shortages?: StockShortage[];
  // Rincian bahan popover, owned by the builder so only one is open at a time.
  materialsOpen?: boolean;
  onMaterialsOpenChange?: (open: boolean) => void;
}

export function OrderLineItem({
  line,
  index,
  selectedBuyer,
  skus,
  pinnedSkuCodes,
  conversionMap,
  boxCapacityMap,
  labelsPerPackMap,
  eggProductNames,
  labelNames,
  onUpdate,
  onRemove,
  tablet,
  shortages = [],
  materialsOpen,
  onMaterialsOpenChange,
}: OrderLineItemProps) {
  const { t } = useLanguage();
  const [skuOpen, setSkuOpen] = useState(false);
  const [eggOpen, setEggOpen] = useState(false);

  // looseQty follows the typed text under the unit it's typed in, so changing
  // the number, the unit or the egg all re-judge it. kg only on a weight-sold egg.
  const updateLoose = (updates: Partial<OrderLine>) => {
    const next = { ...line, ...updates };
    const unit = conversionMap[next.eggProduct]?.unit === "kg" && next.looseUnit === "kg" ? "kg" : "butir";
    onUpdate({ ...updates, looseQty: parseQtyInput(next.looseQtyText ?? "", unit) ?? undefined });
  };
  // Flag the number only once an egg is picked (typing qty first is normal).
  const looseBroken = !!line.eggProduct && isBrokenLooseLine(line);

  // Calculate materials for this line. No order-level box mode: boxes come only
  // from Box SKUs (same call the builder makes).
  const materials = useMemo(() => {
    return calculateLineMaterials(line, null, true, skus, conversionMap, boxCapacityMap, labelsPerPackMap);
  }, [line, skus, conversionMap, boxCapacityMap, labelsPerPackMap]);

  // Detect if the selected SKU is a Box SKU
  const selectedSku = skus.find((s) => s.code === line.skuCode);
  const isBoxSku = !!selectedSku?.basePackCode;

  // SKU options, shared by the phone and tablet pickers.
  const { pinned, others } = groupSkusForBuyer(skus, pinnedSkuCodes ?? new Set());
  const skuItem = (sku: PackSKU) => (
    <CommandItem
      key={sku.code}
      value={`${sku.code} ${sku.displayName}`}
      onSelect={() => {
        onUpdate({ skuCode: sku.code });
        setSkuOpen(false);
      }}
      className={tablet ? "min-h-11 gap-2 rounded-[9px] text-[15px]" : undefined}
    >
      <Check className={cn("mr-2 h-4 w-4", line.skuCode === sku.code ? "opacity-100" : "opacity-0", tablet && "mr-0 text-amber-700")} />
      <span className={tablet ? "font-mono text-[13px] font-bold" : "font-mono text-xs mr-2"}>{sku.code}</span>
      {sku.displayName}
    </CommandItem>
  );
  const skuList = (
    <CommandList>
      <CommandEmpty>{t.outflow.noSkuFound}</CommandEmpty>
      {/* Buyer's pinned SKUs first; nothing hidden. No pins → one group, as before. */}
      {pinned.length > 0 ? (
        <>
          <CommandGroup heading={selectedBuyer?.name}>{pinned.map(skuItem)}</CommandGroup>
          <CommandGroup heading={t.buyerProfile.otherSkus}>{others.map(skuItem)}</CommandGroup>
        </>
      ) : (
        <CommandGroup>{others.map(skuItem)}</CommandGroup>
      )}
    </CommandList>
  );

  if (tablet && line.lineType === "pack") {
    // One row per material, in the summary's order; a row whose item is in the
    // current (queue + form) shortage list goes red with its -n.
    const materialRows = materials
      ? [
          { category: "egg", item: materials.eggProduct, qty: materials.eggsButir, unit: conversionMap[materials.eggProduct]?.unit === "kg" ? "kg" : "butir", Icon: Egg, color: "text-amber-500" },
          { category: "packaging", item: materials.packagingItem, qty: materials.packagingPcs, unit: t.common.pcs, Icon: Package, color: "text-blue-500" },
          { category: "label", item: materials.labelItem, qty: materials.labelPcs, unit: t.common.pcs, Icon: Tag, color: "text-pink-500" },
          { category: "box", item: materials.boxType, qty: materials.boxesPcs, unit: t.common.pcs, Icon: Box, color: "text-green-500" },
        ]
          .filter((r) => r.item && r.qty > 0)
          .map((r) => ({ ...r, short: shortages.find((s) => s.category === r.category && s.item === r.item) }))
      : [];
    const anyShort = materialRows.some((r) => r.short);
    const boxUnresolved = isBoxSku && line.packQty > 0 && !materials;

    return (
      // data-line-id: the builder finds a radial-picked row by it to focus and flash it.
      <div data-line-id={line.id} className="border-b border-ek-border px-3.5 pb-3.5 pt-3 last:border-b-0">
        <div className="grid grid-cols-[44px_minmax(0,1fr)_120px_44px] items-center gap-2">
          <span className="justify-self-start whitespace-nowrap rounded-[7px] border border-ek-border bg-card px-[7px] py-[3px] font-mono text-[13px] font-bold text-ek-mfg">
            #{index + 1}
          </span>

          <Popover open={skuOpen} onOpenChange={setSkuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={skuOpen}
                className="h-auto min-h-11 w-full min-w-0 justify-between rounded-[10px] border-ek-border bg-card px-3 py-[5px] text-left text-ek-fg hover:bg-card hover:text-ek-fg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-amber-600"
              >
                {line.skuCode ? (
                  <span className="min-w-0 leading-[1.2]">
                    <span className="block font-mono text-[13px] font-bold">{line.skuCode}</span>
                    <span className="block truncate text-[13px] font-medium text-ek-nav">{selectedSku?.displayName}</span>
                  </span>
                ) : (
                  <span className="text-[15px] font-normal text-[#a89d90]">{t.outflow.selectSku}</span>
                )}
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-ek-mfg" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className={cn("z-50 w-[320px] p-0 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-ek-mfg", TB_POPOVER)}
              align="start"
              sideOffset={6}
            >
              <Command>
                <CommandInput placeholder={t.outflow.searchSku} />
                {skuList}
              </Command>
            </PopoverContent>
          </Popover>

          {/* Same numeric text input as the phone (no spinners); unit suffix inside. */}
          <div className="relative">
            <Input
              type="text"
              inputMode="numeric"
              aria-label={isBoxSku ? t.outflow.quantityBoxes : t.outflow.quantityPacks}
              value={line.packQty || ""}
              onChange={(e) => onUpdate({ packQty: parseInt(e.target.value) || undefined })}
              // "Masukkan jumlah" doesn't fit beside the unit in 120px; "0" like the Kas Jumlah.
              placeholder="0"
              className={cn(TB_CONTROL_SM, "pr-[52px] font-semibold tabular-nums")}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13.5px] text-ek-mfg">
              {isBoxSku ? t.deliveries.retur.unitBox : t.deliveries.retur.unitPak}
            </span>
          </div>

          <Button
            type="button"
            variant="ghost"
            aria-label={t.activity.removeLine}
            onClick={onRemove}
            className="h-11 w-11 rounded-[11px] p-0 text-red-600 hover:bg-red-50 hover:text-red-600 [&_svg]:size-[18px]"
          >
            <Trash2 />
          </Button>
        </div>

        {(materials || boxUnresolved) && (
          <div className="mx-[52px] mt-1.5 flex items-center gap-3">
            {materials && (
              <Popover open={!!materialsOpen} onOpenChange={onMaterialsOpenChange}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "group inline-flex h-8 items-center gap-[5px] whitespace-nowrap rounded-lg px-2 text-[12.5px] font-semibold text-ek-nav hover:bg-ek-muted",
                      materialsOpen && "bg-ek-muted"
                    )}
                  >
                    <Calculator className="h-3.5 w-3.5" />
                    {t.outflow.materialsButton}
                    <span
                      className={cn(
                        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11.5px]",
                        anyShort ? "bg-red-100 text-red-700" : materialsOpen ? "bg-white" : "bg-ek-muted group-hover:bg-white"
                      )}
                    >
                      {anyShort ? t.outflow.stockShort : materialRows.length}
                    </span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", materialsOpen && "rotate-180")} />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" sideOffset={6} className={cn("w-[300px] px-3.5 py-1.5", TB_POPOVER)}>
                  {materialRows.map(({ category, item, qty, unit, Icon, color, short }) => (
                    <div key={category} className="flex items-center gap-2 border-b border-ek-border py-[9px] text-sm last:border-b-0">
                      <Icon className={cn("h-[15px] w-[15px] shrink-0", color)} />
                      <span className="min-w-0 flex-1 text-ek-nav">{item}</span>
                      <span className={cn("whitespace-nowrap font-semibold tabular-nums", short ? "text-red-700" : "text-ek-fg")}>
                        {qty.toLocaleString()} {unit}
                      </span>
                      {short && (
                        <span className="rounded-full bg-red-600 px-[7px] py-0.5 text-xs font-bold text-white">
                          -{short.shortage.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </PopoverContent>
              </Popover>
            )}
            {boxUnresolved && (
              <div className="flex items-center gap-1 text-xs text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {t.outflow.boxSkuNoCapacity} ({selectedSku.boxMode} × {selectedSku.basePackCode})
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-line-id={line.id} className={cn("space-y-3 p-4 border rounded-lg bg-card", tablet && "m-2")}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">#{index + 1}</Badge>
          <Select
            value={line.lineType}
            onValueChange={(v) => onUpdate({ 
              lineType: v as "pack" | "loose",
              skuCode: undefined,
              packQty: undefined,
              eggProduct: undefined,
              looseQty: undefined,
              looseQtyText: undefined,
              looseUnit: "butir"
            })}
          >
            <SelectTrigger className="w-[130px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pack">{t.outflow.packSku}</SelectItem>
              <SelectItem value="loose">{t.outflow.looseEggs}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {/* Pack line inputs */}
      {line.lineType === "pack" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* SKU selector */}
          <div className="space-y-1">
            <Label className="text-xs">{t.outflow.packSku}</Label>
            <Popover open={skuOpen} onOpenChange={setSkuOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={skuOpen}
                  className="w-full justify-between h-10 text-sm"
                >
                  {line.skuCode 
                    ? skus.find(s => s.code === line.skuCode)?.displayName || line.skuCode
                    : t.outflow.selectSku}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-0 z-50" align="start">
                <Command>
                  <CommandInput placeholder={t.outflow.searchSku} />
                  {skuList}
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Quantity */}
          <div className="space-y-1">
            <Label className="text-xs">{isBoxSku ? t.outflow.quantityBoxes : t.outflow.quantityPacks}</Label>
            <Input
              type="text"
              inputMode="numeric"
              value={line.packQty || ""}
              onChange={(e) => onUpdate({ packQty: parseInt(e.target.value) || undefined })}
              placeholder={t.outflow.enterQty}
              className="h-10"
            />
          </div>
        </div>
      )}

      {/* Loose eggs inputs */}
      {line.lineType === "loose" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Egg product selector */}
          <div className="space-y-1">
            <Label className="text-xs">{t.outflow.eggType}</Label>
            <Popover open={eggOpen} onOpenChange={setEggOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={eggOpen}
                  className="w-full justify-between h-10 text-sm"
                >
                  {line.eggProduct || t.common.selectDots}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[220px] p-0 z-50" align="start">
                <Command>
                  <CommandInput placeholder={t.common.searchDots} />
                  <CommandList>
                    <CommandEmpty>{t.common.noResultsFound}</CommandEmpty>
                    <CommandGroup>
                      {eggProductNames.map((name) => (
                        <CommandItem
                          key={name}
                          value={name}
                          onSelect={() => {
                            updateLoose({ eggProduct: name });
                            setEggOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              line.eggProduct === name ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {name}
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
            <Label className="text-xs">{t.common.quantity}</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={line.looseQtyText ?? ""}
              onChange={(e) => updateLoose({ looseQtyText: e.target.value })}
              aria-invalid={looseBroken || undefined}
              placeholder={t.outflow.enterQty}
              className={cn("h-10", looseBroken && "border-destructive focus-visible:ring-destructive")}
            />
          </div>

          {/* Unit */}
          <div className="space-y-1">
            <Label className="text-xs">{t.common.unit}</Label>
            <Select
              value={line.looseUnit || "butir"}
              onValueChange={(v) => updateLoose({ looseUnit: v as "butir" | "kg" })}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="butir">{t.outflow.butirPcs}</SelectItem>
                <SelectItem value="kg">{t.outflow.kilogram}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Mini calculator display */}
      {materials && (
        <div className="space-y-1 p-3 bg-muted/50 rounded-md text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Egg className="h-3.5 w-3.5" />
            <span>
              → {materials.eggsButir.toLocaleString()}{" "}
              {conversionMap[materials.eggProduct]?.unit === "kg" ? "kg" : "butir"}{" "}
              {materials.eggProduct}
            </span>
          </div>
          
          {materials.packagingPcs > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Package className="h-3.5 w-3.5" />
              <span>
                → {materials.packagingPcs.toLocaleString()} pcs {materials.packagingItem}
              </span>
            </div>
          )}

          {materials.labelItem && materials.labelPcs > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Tag className="h-3.5 w-3.5" />
              <span>
                → {materials.labelPcs.toLocaleString()} pcs {materials.labelItem}
              </span>
            </div>
          )}
          
          {materials.boxesPcs > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Box className="h-3.5 w-3.5" />
              <span>
                → {materials.boxesPcs} pcs {materials.boxType}
                {materials.lastBoxFill && (
                  <span className="text-xs ml-1 text-amber-600">(last: {materials.lastBoxFill})</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Box SKU whose box×pack capacity isn't configured: it would deduct
          nothing, so the builder holds the order — say why. */}
      {isBoxSku && line.packQty > 0 && !materials && (
        <div className="flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            {t.outflow.boxSkuNoCapacity} ({selectedSku.boxMode} × {selectedSku.basePackCode})
          </span>
        </div>
      )}

      {/* Label selector (pack lines) — deducts one label per pack from label inventory */}
      {line.lineType === "pack" && (
        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1">
            <Tag className="h-3 w-3" />
            {t.outflow.label} ({t.common.optional})
          </Label>
          <Select
            value={line.labelSelection || "__none__"}
            onValueChange={(v) => onUpdate({ labelSelection: v === "__none__" ? null : v })}
          >
            <SelectTrigger className="h-10 w-full sm:w-[220px]">
              <SelectValue placeholder={t.outflow.selectLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— {t.outflow.noLabel} —</SelectItem>
              {labelNames.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
