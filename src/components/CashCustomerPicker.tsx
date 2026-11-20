import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { customerNameKey, customerOptions, type CashCustomer, type CustomerPick } from "@/lib/cashCustomers";

interface CashCustomerPickerProps {
  customers: CashCustomer[];
  value: CustomerPick; // null = anonymous walk-in ("Umum")
  onChange: (pick: CustomerPick) => void;
  // A name not on the list: the caller selects it and saves the row.
  onAddNew: (name: string) => void;
  className?: string;
}

const ITEM = "min-h-[44px] gap-2 rounded-[9px] px-2.5 text-[15px]";

// Kas Tunai's customer field: search the saved customers, fall back to "Umum"
// (no name), or add the typed name. Searching the list first is what keeps one
// person from being saved under two spellings.
export function CashCustomerPicker({ customers, value, onChange, onAddNew, className }: CashCustomerPickerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { matches, addName, showWalkIn } = useMemo(() => customerOptions(customers, search), [customers, search]);

  const close = () => {
    setOpen(false);
    setSearch("");
  };
  const isPicked = (c: CashCustomer) => !!value && (value.id ? value.id === c.id : customerNameKey(value.name) === customerNameKey(c.name));

  return (
    <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t.kas.customerName}
          className={cn(className, "w-full justify-between gap-2 font-semibold text-ek-fg hover:bg-card", !value && "font-normal text-ek-mfg")}
        >
          <span className="min-w-0 truncate">{value?.name ?? t.kas.walkIn}</span>
          <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-ek-mfg" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[320px] overflow-hidden rounded-[14px] border-ek-border p-0 shadow-[0_14px_36px_rgba(0,0,0,.16)]"
        align="start"
      >
        {/* Filtering is customerOptions' job, so "add" and "Umum" never get filtered away. */}
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={t.kas.customerSearch} className="text-[15px]" />
          <CommandList className="max-h-[264px] p-1.5">
            <CommandEmpty>{t.common.noResultsFound}</CommandEmpty>
            <CommandGroup className="p-0">
              {showWalkIn && (
                <CommandItem
                  value="__walk_in__"
                  onSelect={() => {
                    onChange(null);
                    close();
                  }}
                  className={ITEM}
                >
                  <Check aria-hidden className={cn("h-4 w-4 shrink-0 text-amber-700", value ? "opacity-0" : "opacity-100")} />
                  {t.kas.walkIn}
                </CommandItem>
              )}
              {matches.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange({ id: c.id, name: c.name });
                    close();
                  }}
                  className={ITEM}
                >
                  <Check aria-hidden className={cn("h-4 w-4 shrink-0 text-amber-700", isPicked(c) ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 truncate">{c.name}</span>
                </CommandItem>
              ))}
              {addName && (
                <CommandItem
                  value="__add_new__"
                  onSelect={() => {
                    onAddNew(addName);
                    close();
                  }}
                  className={cn(ITEM, "text-amber-700")}
                >
                  <UserPlus aria-hidden className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{t.kas.addCustomer.replace("{name}", addName)}</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
