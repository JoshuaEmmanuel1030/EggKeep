import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLanguage } from "@/contexts/LanguageContext";
import { Buyer } from "@/types/quickOutflow";
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
import { Loader2 } from "lucide-react";

const buyerSchema = z.object({
  name: z.string().min(1, "Name is required"),
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
    defaultValues: { name: "" },
  });

  useEffect(() => {
    if (open) form.reset({ name: buyer?.name ?? "" });
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
