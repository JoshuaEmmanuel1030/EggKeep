import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { OrderLine, BoxModeType, Buyer } from "@/types/quickOutflow";
import { ConversionMap } from "@/types/inventory";
import { 
  PackSKU,
  calculateLineMaterials,
  isSKUSupportedForBoxMode,
  isLogisticsOnlyMode
} from "@/lib/outflowCalculator";
import { Trash2, ChevronsUpDown, Check, ChevronRight, Tag, Egg, Package, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

interface OrderLineItemProps {
  line: OrderLine;
  index: number;
  boxMode: BoxModeType;
  boxesRequired: boolean;
  selectedBuyer: Buyer | null;
  skus: PackSKU[];
  conversionMap: ConversionMap;
  eggProductNames: string[];
  onUpdate: (updates: Partial<OrderLine>) => void;
  onRemove: () => void;
}

export function OrderLineItem({
  line,
  index,
  boxMode,
  boxesRequired,
  selectedBuyer,
  skus,
  conversionMap,
  eggProductNames,
  onUpdate,
  onRemove,
}: OrderLineItemProps) {
  const { t } = useLanguage();
  const [skuOpen, setSkuOpen] = useState(false);
  const [eggOpen, setEggOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);

  // Calculate materials for this line
  const materials = useMemo(() => {
    return calculateLineMaterials(line, boxMode, boxesRequired, skus, conversionMap);
  }, [line, boxMode, boxesRequired, skus, conversionMap]);

  // Check if current SKU is supported for box mode
  const skuSupported = useMemo(() => {
    if (!line.skuCode) return true;
    return isSKUSupportedForBoxMode(line.skuCode, boxMode);
  }, [line.skuCode, boxMode]);

  // Get available box mode overrides for Osave
  const canOverrideBoxMode = selectedBuyer?.name === "Osave";

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
            <Label className="text-xs">{t.outflow.quantityPacks}</Label>
            <Input
              type="number"
              min="1"
              value={line.packQty || ""}
              onChange={(e) => onUpdate({ packQty: parseInt(e.target.value) || undefined })}
              onWheel={(e) => e.currentTarget.blur()}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                }
              }}
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
              type="number"
              min="1"
              step={line.looseUnit === "kg" ? "0.1" : "1"}
              value={line.looseQty || ""}
              onChange={(e) => onUpdate({ looseQty: parseFloat(e.target.value) || undefined })}
              onWheel={(e) => e.currentTarget.blur()}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                }
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

      {/* Box mode override for Osave */}
      {canOverrideBoxMode && line.lineType === "pack" && (
        <div className="space-y-1">
          <Label className="text-xs">{t.outflow.boxModeOverride}</Label>
          <Select
            value={line.boxModeOverride || boxMode}
            onValueChange={(v) => onUpdate({ boxModeOverride: v as BoxModeType })}
          >
            <SelectTrigger className="h-10 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="box osave">box osave</SelectItem>
              <SelectItem value="box osave polos">box osave polos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Mini calculator display */}
      {materials && (
        <div className="space-y-1 p-3 bg-muted/50 rounded-md text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Egg className="h-3.5 w-3.5" />
            <span>
              → {materials.eggsButir.toLocaleString()} butir {materials.eggProduct}
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
          
          {boxesRequired && !materials.isLogisticsOnly && materials.boxesPcs > 0 && (
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

          {materials.isLogisticsOnly && line.lineType === "pack" && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Box className="h-3.5 w-3.5" />
              <span className="text-xs italic">{t.outflow.logisticsOnly}</span>
            </div>
          )}

          {materials.traysUsed && materials.traysUsed > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Box className="h-3.5 w-3.5" />
              <span className="text-xs italic">~ {materials.traysUsed} {t.outflow.traysNoInventory}</span>
            </div>
          )}
        </div>
      )}

      {/* SKU not supported warning */}
      {line.skuCode && !skuSupported && !isLogisticsOnlyMode(boxMode) && (
        <div className="text-xs text-amber-600 flex items-center gap-1">
          ⚠️ {line.skuCode} {t.outflow.notConfiguredFor} {boxMode}. {t.outflow.considerKeranjang}
        </div>
      )}

      {/* Labels section (paused) */}
      <Collapsible open={labelsOpen} onOpenChange={setLabelsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-start text-xs text-muted-foreground">
            <ChevronRight className={cn("h-3 w-3 mr-1 transition-transform", labelsOpen && "rotate-90")} />
            <Tag className="h-3 w-3 mr-1" />
            {t.outflow.labelsPaused}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="p-3 bg-muted/30 rounded text-xs text-muted-foreground italic">
            {t.outflow.labelsPausedDesc}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
