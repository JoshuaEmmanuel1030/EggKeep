import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLanguage } from "@/contexts/LanguageContext";
import { useItemTypes } from "@/hooks/useItemTypes";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { PackSKU } from "@/types/catalog";

const skuSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  displayName: z.string().min(1, "Display name is required"),
  eggsPerPack: z.coerce.number().min(1, "Must be at least 1"),
  eggProduct: z.string().min(1, "Egg product is required"),
  packagingItem: z.string().optional(),
  isActive: z.boolean(),
});

type SKUFormData = z.infer<typeof skuSchema>;

interface SKUDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sku: PackSKU | null;
  onSave: (data: SKUFormData) => Promise<void>;
  isLoading: boolean;
}

export function SKUDialog({ open, onOpenChange, sku, onSave, isLoading }: SKUDialogProps) {
  const { t } = useLanguage();
  const { getTypesByCategory } = useItemTypes();

  const eggTypes = getTypesByCategory("egg");
  const packagingTypes = getTypesByCategory("packaging");

  const form = useForm<SKUFormData>({
    resolver: zodResolver(skuSchema),
    defaultValues: {
      code: "",
      displayName: "",
      eggsPerPack: 1,
      eggProduct: "",
      packagingItem: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (open) {
      if (sku) {
        form.reset({
          code: sku.code,
          displayName: sku.displayName,
          eggsPerPack: sku.eggsPerPack,
          eggProduct: sku.eggProduct,
          packagingItem: sku.packagingItem || "",
          isActive: sku.isActive,
        });
      } else {
        form.reset({
          code: "",
          displayName: "",
          eggsPerPack: 1,
          eggProduct: "",
          packagingItem: "",
          isActive: true,
        });
      }
    }
  }, [open, sku, form]);

  const handleSubmit = async (data: SKUFormData) => {
    await onSave(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {sku ? t.catalog.editSku : t.catalog.addSku}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.catalog.code}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="N15B" className="font-mono" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.catalog.displayName}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Negeri 15 Biasa" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="eggsPerPack"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.catalog.eggsPerPack}</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" min={1} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="eggProduct"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.catalog.eggProduct}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t.common.selectDots} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {eggTypes.map((type) => (
                        <SelectItem key={type.id} value={type.name}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="packagingItem"
              render={({ field }) => {
                const handleChange = (value: string) => {
                  field.onChange(value === "__none__" ? "" : value);
                };
                const displayValue = field.value === "" ? "__none__" : field.value;
                return (
                  <FormItem>
                    <FormLabel>{t.catalog.packagingItem} ({t.common.optional})</FormLabel>
                    <Select onValueChange={handleChange} value={displayValue}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t.common.selectDots} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">— {t.catalog.none} —</SelectItem>
                        {packagingTypes.map((type) => (
                          <SelectItem key={type.id} value={type.name}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel className="cursor-pointer">{t.catalog.active}</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t.common.save}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
