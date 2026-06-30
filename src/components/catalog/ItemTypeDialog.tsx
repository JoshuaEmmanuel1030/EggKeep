import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { ItemType } from "@/types/inventory";
import { PackSKU } from "@/types/catalog";
import { BOX_CAPACITIES } from "@/lib/outflowCalculator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export interface ItemTypeSaveData {
  name: string;
  unit?: "kg" | "btr";
  eggsPerUnit?: number;
  boxCapacities?: Record<string, number>;
}

interface ItemTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ItemType | null;
  categoryLabel: string;
  isEgg: boolean;
  isBox?: boolean;
  skus?: PackSKU[];
  onSave: (data: ItemTypeSaveData) => Promise<void>;
  isLoading: boolean;
}

export function ItemTypeDialog({
  open,
  onOpenChange,
  item,
  categoryLabel,
  isEgg,
  isBox = false,
  skus = [],
  onSave,
  isLoading,
}: ItemTypeDialogProps) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<"kg" | "btr">("btr");
  const [eggsPerUnit, setEggsPerUnit] = useState("");
  // Per-SKU packs-per-box, kept as raw strings keyed by SKU code (blank = unset).
  const [caps, setCaps] = useState<Record<string, string>>({});

  // Only active SKUs are configurable.
  const activeSkus = useMemo(() => skus.filter((s) => s.isActive), [skus]);

  useEffect(() => {
    if (open) {
      setName(item?.name || "");
      setUnit(item?.unit || "btr");
      setEggsPerUnit(item?.eggsPerUnit != null ? String(item.eggsPerUnit) : "");

      if (isBox) {
        // Seed each SKU from the box's saved map, falling back to the hardcoded
        // baseline for that box name so existing boxes show their current numbers.
        const baseline = item ? BOX_CAPACITIES[item.name] : undefined;
        const seeded: Record<string, string> = {};
        for (const sku of activeSkus) {
          const v = item?.boxCapacities?.[sku.code] ?? baseline?.[sku.code];
          seeded[sku.code] = v != null ? String(v) : "";
        }
        setCaps(seeded);
      } else {
        setCaps({});
      }
    }
  }, [open, item, isBox, activeSkus]);

  // For eggs sold by kg, a positive factor is required.
  const factorNum = parseFloat(eggsPerUnit);
  const factorInvalid = isEgg && unit === "kg" && (!eggsPerUnit || isNaN(factorNum) || factorNum <= 0);
  const canSave = !!name.trim() && !factorInvalid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (isEgg) {
      // btr eggs are always 1:1; kg eggs carry their factor.
      await onSave({
        name: name.trim(),
        unit,
        eggsPerUnit: unit === "kg" ? factorNum : 1,
      });
    } else if (isBox) {
      // Collect positive-integer entries; blanks are omitted (fall back to baseline).
      const boxCapacities: Record<string, number> = {};
      for (const [code, raw] of Object.entries(caps)) {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n > 0) boxCapacities[code] = n;
      }
      await onSave({ name: name.trim(), boxCapacities });
    } else {
      await onSave({ name: name.trim() });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {item ? t.catalog.editItem : t.catalog.addItem} - {categoryLabel}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t.catalog.name}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Enter ${categoryLabel.toLowerCase()} name`}
              autoFocus
            />
          </div>

          {isEgg && (
            <>
              <div className="space-y-2">
                <Label htmlFor="unit">{t.catalog.unit}</Label>
                <Select value={unit} onValueChange={(v) => setUnit(v as "kg" | "btr")}>
                  <SelectTrigger id="unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="btr">{t.catalog.soldByButir}</SelectItem>
                    <SelectItem value="kg">{t.catalog.soldByKg}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {unit === "kg" && (
                <div className="space-y-2">
                  <Label htmlFor="eggsPerUnit">{t.catalog.eggsPerKg}</Label>
                  <Input
                    id="eggsPerUnit"
                    type="number"
                    step="0.1"
                    min="0"
                    value={eggsPerUnit}
                    onChange={(e) => setEggsPerUnit(e.target.value)}
                    placeholder="e.g. 15.5"
                  />
                  {factorInvalid && (
                    <p className="text-xs text-destructive">{t.catalog.eggsPerKgRequired}</p>
                  )}
                </div>
              )}
            </>
          )}

          {isBox && (
            <div className="space-y-2">
              <Label>{t.catalog.packsPerBox}</Label>
              {activeSkus.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.catalog.noSkusToConfigure}</p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
                  {activeSkus.map((sku) => (
                    <div key={sku.code} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{sku.code}</p>
                        <p className="text-xs text-muted-foreground truncate">{sku.displayName}</p>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        className="w-24"
                        placeholder="—"
                        value={caps[sku.code] ?? ""}
                        onChange={(e) =>
                          setCaps((prev) => ({ ...prev, [sku.code]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t.catalog.packsPerBoxHelp}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={isLoading || !canSave}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t.common.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
