import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLanguage } from "@/contexts/LanguageContext";
import { Buyer, BoxModeType } from "@/types/quickOutflow";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

const BOX_MODES: BoxModeType[] = [
  "box kecil",
  "box osave",
  "box osave polos",
  "keranjang",
  "tray",
  "plastic",
];

const buyerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  defaultBoxMode: z.string().min(1, "Box mode is required"),
});

type BuyerFormData = z.infer<typeof buyerSchema>;

interface BuyerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buyer: Buyer | null;
  onSave: (data: BuyerFormData) => Promise<void>;
  isLoading: boolean;
}

export function BuyerDialog({
  open,
  onOpenChange,
  buyer,
  onSave,
  isLoading,
}: BuyerDialogProps) {
  const { t } = useLanguage();

  const form = useForm<BuyerFormData>({
    resolver: zodResolver(buyerSchema),
    defaultValues: {
      name: "",
      defaultBoxMode: "box kecil",
    },
  });

  useEffect(() => {
    if (open) {
      if (buyer) {
        form.reset({
          name: buyer.name,
          defaultBoxMode: buyer.defaultBoxMode,
        });
      } else {
        form.reset({
          name: "",
          defaultBoxMode: "box kecil",
        });
      }
    }
  }, [open, buyer, form]);

  const handleSubmit = async (data: BuyerFormData) => {
    await onSave(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {buyer ? t.catalog.editBuyer : t.catalog.addBuyer}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.catalog.name}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Enter buyer name" autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultBoxMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.catalog.defaultBoxMode}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t.common.selectDots} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BOX_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {mode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
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
