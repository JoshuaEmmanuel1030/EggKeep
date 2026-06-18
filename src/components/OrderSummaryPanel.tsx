import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AggregatedMaterials, StockShortage, BoxModeType } from "@/types/quickOutflow";
import { isLogisticsOnlyMode } from "@/lib/outflowCalculator";
import { AlertCircle, CheckCircle2, Egg, Package, Box, Truck } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface OrderSummaryPanelProps {
  aggregates: AggregatedMaterials;
  shortages: StockShortage[];
  boxMode: BoxModeType;
}

export function OrderSummaryPanel({ aggregates, shortages, boxMode }: OrderSummaryPanelProps) {
  const { t } = useLanguage();
  
  const hasContent = 
    aggregates.eggsByProduct.size > 0 || 
    aggregates.packagingByItem.size > 0 || 
    aggregates.boxesByType.size > 0;

  const hasShortages = shortages.length > 0;

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

            {/* Logistics section */}
            {(aggregates.logistics.keranjang || aggregates.logistics.traysUsed > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Truck className="h-4 w-4 text-purple-500" />
                  {t.outflow.logistics}
                </div>
                <div className="space-y-1 pl-6 text-sm text-muted-foreground">
                  {aggregates.logistics.keranjang && (
                    <div>{t.outflow.keranjangNoInventory}</div>
                  )}
                  {aggregates.logistics.traysUsed > 0 && (
                    <div>~{aggregates.logistics.traysUsed} {t.outflow.traysNoInventory}</div>
                  )}
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
                  {shortages.map((shortage, i) => (
                    <div key={i} className="text-xs text-destructive">
                      {shortage.item}: {t.outflow.need} {shortage.required.toLocaleString()}, {t.outflow.have} {shortage.available.toLocaleString()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
