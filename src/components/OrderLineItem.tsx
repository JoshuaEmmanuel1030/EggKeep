import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OrderLine, Buyer } from "@/types/quickOutflow";
import { ConversionMap } from "@/types/inventory";
import {
  PackSKU,
  BoxCapacityMap,
  LabelsPerPackMap,
  calculateLineMaterials,
} from "@/lib/outflowCalculator";
import { parseCountInput } from "@/lib/stockCount";
import { Trash2, ChevronsUpDown, Check, Tag, Egg, Package, Box, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

interface OrderLineItemProps {
  line: OrderLine;
  index: number;
  selectedBuyer: Buyer | null;
  skus: PackSKU[];
  conversionMap: ConversionMap;
  boxCapacityMap: BoxCapacityMap;
  labelsPerPackMap: LabelsPerPackMap;
  eggProductNames: string[];
  labelNames: string[];
  onUpdate: (updates: Partial<OrderLine>) => void;
  onRemove: () => void;
}

export function OrderLineItem({
  line,
  index,
  selectedBuyer,
  skus,
  conversionMap,
  boxCapacityMap,
  labelsPerPackMap,
  eggProductNames,
  labelNames,
  onUpdate,
  onRemove,
}: OrderLineItemProps) {
  const { t } = useLanguage();
  const [skuOpen, setSkuOpen] = useState(false);
  const [eggOpen, setEggOpen] = useState(false);

  // Raw text buffer for the loose-qty field so it accepts the Indonesian
  // decimal comma (e.g. "52,89") and keeps a trailing separator while typing;
  // the numeric value is parsed up to the parent. Re-syncs if looseQty is
  // changed externally (e.g. a reset) rather than by our own keystroke.
  const [looseQtyRaw, setLooseQtyRaw] = useState(
    line.looseQty != null ? String(line.looseQty) : ""
  );
  useEffect(() => {
    if ((parseCountInput(looseQtyRaw) ?? undefined) !== line.looseQty) {
      setLooseQtyRaw(line.looseQty != null ? String(line.looseQty) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.looseQty]);

  // Calculate materials for this line. No order-level box mode: boxes come only
  // from Box SKUs (same call the builder makes).
  const materials = useMemo(() => {
    return calculateLineMaterials(line, null, true, skus, conversionMap, boxCapacityMap, labelsPerPackMap);
  }, [line, skus, conversionMap, boxCapacityMap, labelsPerPackMap]);

  // Detect if the selected SKU is a Box SKU
  const selectedSku = skus.find((s) => s.code === line.skuCode);
  const isBoxSku = !!selectedSku?.basePackCode;

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-card">
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
                  <CommandList>
                    <CommandEmpty>{t.outflow.noSkuFound}</CommandEmpty>
                    <CommandGroup>
                      {skus.filter(sku => sku.isActive !== false).map((sku) => (
                        <CommandItem
                          key={sku.code}
                          value={`${sku.code} ${sku.displayName}`}
                          onSelect={() => {
                            onUpdate({ skuCode: sku.code });
                            setSkuOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              line.skuCode === sku.code ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="font-mono text-xs mr-2">{sku.code}</span>
                          {sku.displayName}
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
                            onUpdate({ eggProduct: name });
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
              value={looseQtyRaw}
              onChange={(e) => {
                setLooseQtyRaw(e.target.value);
                onUpdate({ looseQty: parseCountInput(e.target.value) ?? undefined });
              }}
              placeholder={t.outflow.enterQty}
              className="h-10"
            />
          </div>

          {/* Unit */}
          <div className="space-y-1">
            <Label className="text-xs">{t.common.unit}</Label>
            <Select
              value={line.looseUnit || "butir"}
              onValueChange={(v) => onUpdate({ looseUnit: v as "butir" | "kg" })}
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
