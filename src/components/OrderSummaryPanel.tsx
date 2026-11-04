import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AggregatedMaterials, StockShortage } from "@/types/quickOutflow";
import { ConversionMap } from "@/types/inventory";
import { AlertCircle, CheckCircle2, Egg, Package, Box, Tag } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface OrderSummaryPanelProps {
  aggregates: AggregatedMaterials;
  shortages: StockShortage[];
  conversionMap?: ConversionMap;
  // "panel": the tablet right-panel body (no Card/sticky chrome, 6a sizes).
  variant?: "card" | "panel";
}

export function OrderSummaryPanel({ aggregates, shortages, conversionMap = {}, variant = "card" }: OrderSummaryPanelProps) {
  const { t } = useLanguage();
  const eggUnit = (product: string) =>
    conversionMap[product]?.unit === "kg" ? " kg" : "";
  
  const hasContent =
    aggregates.eggsByProduct.size > 0 ||
    aggregates.packagingByItem.size > 0 ||
    aggregates.labelsByItem.size > 0 ||
    aggregates.boxesByType.size > 0;

  const hasShortages = shortages.length > 0;

  if (variant === "panel") {
    const groups = [
      { category: "egg", label: t.outflow.eggs, Icon: Egg, color: "text-amber-500", items: aggregates.eggsByProduct },
      { category: "packaging", label: t.outflow.packaging, Icon: Package, color: "text-blue-500", items: aggregates.packagingByItem },
      { category: "label", label: t.outflow.labels, Icon: Tag, color: "text-pink-500", items: aggregates.labelsByItem },
      { category: "box", label: t.common.boxes, Icon: Box, color: "text-green-500", items: aggregates.boxesByType },
    ];
    return (
      <div className="text-ek-fg">
        <h3 className="mb-2 font-display text-lg font-semibold">{t.outflow.orderSummary}</h3>
        {!hasContent ? (
          <p className="my-1.5 text-[14.5px] text-ek-mfg">{t.outflow.addLinesToSeeSummary}</p>
        ) : (
          <>
            {groups.filter((g) => g.items.size > 0).map(({ category, label, Icon, color, items }) => (
              <div key={category} className="mt-3">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <Icon className={cn("h-4 w-4", color)} />
                  {label}
                </div>
                {Array.from(items).map(([item, qty]) => {
                  const shortage = shortages.find((s) => s.category === category && s.item === item);
                  const unit = category === "egg" ? eggUnit(item) : "";
                  return (
                    <div key={item} className="flex items-center justify-between gap-2 py-1.5 pl-6 text-sm">
                      <span className="min-w-0 truncate text-ek-mfg">{item}</span>
                      <span className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
                        <span className="font-semibold">{qty.toLocaleString()}{unit}</span>
                        {shortage && (
                          <span className="rounded-full bg-red-600 px-[7px] py-0.5 text-xs font-bold text-white">
                            -{shortage.shortage.toLocaleString()}{unit}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="mb-3 mt-3.5 h-px bg-ek-border" />

            <div className={cn("flex items-center gap-2 text-[14.5px] font-semibold", hasShortages ? "text-red-600" : "text-green-600")}>
              {hasShortages ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {hasShortages ? t.outflow.stockWarning : t.outflow.allItemsOk}
            </div>
            {hasShortages && (
              <div className="pl-6 pt-1 text-[13px] leading-[1.6] text-red-600">
                {shortages.map((shortage, i) => {
                  const unit = shortage.category === "egg" ? eggUnit(shortage.item) : "";
                  return (
                    <div key={i}>
                      {shortage.item}: {t.outflow.need} {shortage.required.toLocaleString()}{unit}, {t.outflow.have} {shortage.available.toLocaleString()}{unit}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <Card className="sticky top-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t.outflow.orderSummary}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasContent ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t.outflow.addLinesToSeeSummary}
          </p>
        ) : (
          <>
            {/* Eggs section */}
            {aggregates.eggsByProduct.size > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Egg className="h-4 w-4 text-amber-500" />
                  {t.outflow.eggs}
                </div>
                <div className="space-y-1 pl-6">
                  {Array.from(aggregates.eggsByProduct).map(([product, qty]) => {
                    const shortage = shortages.find(s => s.category === "egg" && s.item === product);
                    return (
                      <div key={product} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{product}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{qty.toLocaleString()}{eggUnit(product)}</span>
                          {shortage && (
                            <Badge variant="destructive" className="text-xs">
                              -{shortage.shortage.toLocaleString()}{eggUnit(product)}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Packaging section */}
            {aggregates.packagingByItem.size > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Package className="h-4 w-4 text-blue-500" />
                  {t.outflow.packaging}
                </div>
                <div className="space-y-1 pl-6">
                  {Array.from(aggregates.packagingByItem).map(([item, qty]) => {
                    const shortage = shortages.find(s => s.category === "packaging" && s.item === item);
                    return (
                      <div key={item} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{item}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{qty.toLocaleString()}</span>
                          {shortage && (
                            <Badge variant="destructive" className="text-xs">
                              -{shortage.shortage.toLocaleString()}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Labels section */}
            {aggregates.labelsByItem.size > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Tag className="h-4 w-4 text-pink-500" />
                  {t.outflow.labels}
                </div>
                <div className="space-y-1 pl-6">
                  {Array.from(aggregates.labelsByItem).map(([item, qty]) => {
                    const shortage = shortages.find(s => s.category === "label" && s.item === item);
                    return (
                      <div key={item} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{item}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{qty.toLocaleString()}</span>
                          {shortage && (
                            <Badge variant="destructive" className="text-xs">
                              -{shortage.shortage.toLocaleString()}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Boxes section */}
            {aggregates.boxesByType.size > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Box className="h-4 w-4 text-green-500" />
                  {t.common.boxes}
                </div>
                <div className="space-y-1 pl-6">
                  {Array.from(aggregates.boxesByType).map(([boxType, qty]) => {
                    const shortage = shortages.find(s => s.category === "box" && s.item === boxType);
                    return (
                      <div key={boxType} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{boxType}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{qty.toLocaleString()}</span>
                          {shortage && (
                            <Badge variant="destructive" className="text-xs">
                              -{shortage.shortage.toLocaleString()}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <Separator />

            {/* Stock check */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                {hasShortages ? (
                  <>
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-destructive">{t.outflow.stockWarning}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-green-600">{t.outflow.allItemsOk}</span>
                  </>
                )}
              </div>
              
              {hasShortages && (
                <div className="space-y-1 pl-6">
                  {shortages.map((shortage, i) => {
                    const unit = shortage.category === "egg" ? eggUnit(shortage.item) : "";
                    return (
                      <div key={i} className="text-xs text-destructive">
                        {shortage.item}: {t.outflow.need} {shortage.required.toLocaleString()}{unit}, {t.outflow.have} {shortage.available.toLocaleString()}{unit}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
