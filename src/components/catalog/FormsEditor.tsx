// Catalog editor for an egg product's "Bentuk" — the forms a delivery can arrive in.
// Presentational: the parent owns the rows. Until this existed, item_types.forms could
// only be changed by hand SQL against production.
//
// Rows carry raw text, like the box-capacity inputs do, so a half-typed size is not
// thrown away on each keystroke. rowToForm() is the only way a row becomes catalogue
// data, and it returns null rather than guessing.

import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { parseQtyInput, qtyInputText } from "@/lib/stockCount";
import {
  formIdFromName, isEggForm, toNative, type EggForm, type FormUnit,
} from "@/lib/eggForms";

export interface FormRow {
  /** React key only. Never persisted — a new row has no id until it is saved. */
  key: string;
  /** The persisted form id, which `inflows.form` stores. Empty on a new row. */
  id: string;
  name: string;
  unit: FormUnit;
  /** Raw text, so "9," mid-typing survives. */
  size: string;
  unitWord: string;
}

let keySeq = 0;
const newKey = () => `row${++keySeq}`;

export const emptyRow = (): FormRow => ({
  key: newKey(), id: "", name: "", unit: "butir", size: "", unitWord: "",
});

export const formToRow = (f: EggForm): FormRow => ({
  key: newKey(),
  id: f.id,
  name: f.name,
  unit: f.unit,
  size: f.size != null ? qtyInputText(f.size) : "",
  unitWord: f.unitWord ?? "",
});

/** A sized unit needs a size; the other two take theirs from the line. */
export const needsSize = (unit: FormUnit) => unit === "kg" || unit === "butir";

/** The catalogue value for a row, or null when the row is not usable yet. */
export function rowToForm(row: FormRow): EggForm | null {
  const name = row.name.trim();
  if (!name) return null;
  const form: EggForm = { id: row.id, name, unit: row.unit };
  if (needsSize(row.unit)) {
    // parseQtyInput so a decimal comma works here like everywhere else: 9,25.
    const size = parseQtyInput(row.size, "kg");
    if (size == null || size <= 0) return null;
    form.size = size;
  }
  const word = row.unitWord.trim();
  if (word && row.unit !== "native") form.unitWord = word;
  return form;
}

/** An id for a row that has never been saved, unique within the product. Ids are
 *  minted from the name once and then frozen, so a later rename cannot orphan the
 *  `inflows.form` values already pointing at it. */
export function mintId(name: string, taken: readonly string[]): string {
  const base = formIdFromName(name);
  if (!taken.includes(base)) return base;
  for (let i = 2; i <= 99; i++) {
    if (!taken.includes(`${base}${i}`)) return `${base}${i}`;
  }
  return `${base}${Date.now()}`;
}

/** The rows as catalogue data, ids minted for new rows. Returns null when any row is
 *  unusable — the caller blocks the save rather than silently dropping it. */
export function rowsToForms(rows: FormRow[]): EggForm[] | null {
  const taken = rows.map((r) => r.id).filter(Boolean);
  const out: EggForm[] = [];
  for (const row of rows) {
    const form = rowToForm(row);
    if (!form) return null;
    if (!form.id) {
      form.id = mintId(form.name, [...taken, ...out.map((f) => f.id)]);
    }
    if (!isEggForm(form) || out.some((f) => f.id === form.id)) return null;
    out.push(form);
  }
  return out;
}

export interface FormsEditorProps {
  rows: FormRow[];
  nativeUnit: "kg" | "btr";
  /** The product's eggs-per-kg, needed to show what a butir bundle weighs. */
  eggsPerUnit?: number;
  onChange: (rows: FormRow[]) => void;
  /** Overrides, so the same editor serves the arrival list and the count-only list. */
  label?: string;
  help?: string;
  emptyText?: string;
}

export function FormsEditor({
  rows, nativeUnit, eggsPerUnit, onChange, label, help, emptyText,
}: FormsEditorProps) {
  const { t } = useLanguage();
  const unitLabel = nativeUnit === "kg" ? "kg" : "butir";

  const patch = (key: string, change: Partial<FormRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <div className="space-y-2">
      <Label>{label ?? t.catalog.forms}</Label>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText ?? t.catalog.formsEmpty}</p>
      ) : (
        <div className="space-y-2 rounded-md border p-2">
          {rows.map((row) => (
            <div key={row.key} className="space-y-1.5 rounded-sm bg-muted/40 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Input
                  className="h-9 min-w-0 flex-[2] basis-32"
                  placeholder={t.catalog.formNamePlaceholder}
                  value={row.name}
                  onChange={(e) => patch(row.key, { name: e.target.value })}
                />
                <Select
                  value={row.unit}
                  onValueChange={(v) =>
                    // Dropping a size that no longer applies keeps a stale number from
                    // reappearing if the unit is switched back.
                    patch(row.key, { unit: v as FormUnit, size: needsSize(v as FormUnit) ? row.size : "" })
                  }
                >
                  <SelectTrigger className="h-9 w-[104px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="butir">{t.catalog.formUnitButir}</SelectItem>
                    <SelectItem value="kg">{t.catalog.formUnitKg}</SelectItem>
                    <SelectItem value="native">{t.catalog.formUnitNative}</SelectItem>
                    <SelectItem value="weighed">{t.catalog.formUnitWeighed}</SelectItem>
                  </SelectContent>
                </Select>
                {needsSize(row.unit) && (
                  <Input
                    className="h-9 w-[76px] shrink-0 text-right"
                    inputMode="decimal"
                    placeholder={row.unit === "kg" ? "9,25" : "150"}
                    value={row.size}
                    onChange={(e) => patch(row.key, { size: e.target.value })}
                  />
                )}
                {row.unit !== "native" && (
                  <Input
                    className="h-9 w-[76px] shrink-0"
                    placeholder={t.catalog.formUnitWordPlaceholder}
                    value={row.unitWord}
                    onChange={(e) => patch(row.key, { unitWord: e.target.value })}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`${t.common.delete} ${row.name || t.catalog.forms}`}
                  onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <RowPreview row={row} nativeUnit={nativeUnit} eggsPerUnit={eggsPerUnit} />
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onChange([...rows, emptyRow()])}
      >
        <Plus className="h-3.5 w-3.5" />
        {t.catalog.formsAdd}
      </Button>
      <p className="text-xs text-muted-foreground">
        {(help ?? t.catalog.formsHelp).replace("{unit}", unitLabel)}
      </p>
    </div>
  );
}

/** What one unit of this form will book. The point of the editor: "butir 150" means
 *  nothing until you can see the kilograms it turns into, and which rate did it. */
function RowPreview({
  row, nativeUnit, eggsPerUnit,
}: { row: FormRow; nativeUnit: "kg" | "btr"; eggsPerUnit?: number }) {
  const { t } = useLanguage();
  const stockUnit = nativeUnit === "kg" ? "kg" : "butir";

  if (!row.name.trim()) {
    return <p className="text-xs text-destructive">{t.catalog.formNameRequired}</p>;
  }
  if (row.unit === "native") {
    return <p className="text-xs text-muted-foreground">{t.catalog.formPreviewNative.replace("{unit}", stockUnit)}</p>;
  }
  if (row.unit === "weighed") {
    if (nativeUnit !== "kg") {
      return <p className="text-xs text-destructive">{t.catalog.formWeighedKgOnly}</p>;
    }
    return <p className="text-xs text-muted-foreground">{t.catalog.formPreviewWeighed}</p>;
  }

  const form = rowToForm(row);
  if (!form) {
    return <p className="text-xs text-destructive">{t.catalog.formSizeRequired}</p>;
  }
  if (row.unit === "kg" && nativeUnit !== "kg") {
    return <p className="text-xs text-destructive">{t.catalog.formKgOnly}</p>;
  }

  const word = form.unitWord ?? stockUnit;
  const booked = toNative({ form, count: 1, nativeUnit: nativeUnit === "kg" ? "kg" : "butir", eggsPerUnit });
  if (booked == null) {
    // Only reachable on a kg product with no eggs-per-kg set yet.
    return <p className="text-xs text-destructive">{t.catalog.formNeedsEggsPerKg}</p>;
  }

  const main = `1 ${word} = ${qtyInputText(booked)} ${stockUnit}`;
  // On a kg product a butir bundle is divided by the product's rate. Show the working,
  // so it is obvious the weight moves when that rate is edited.
  const working =
    row.unit === "butir" && nativeUnit === "kg" && eggsPerUnit
      ? ` (${qtyInputText(form.size!)} butir ÷ ${qtyInputText(eggsPerUnit)})`
      : "";

  return (
    <p className="text-xs text-muted-foreground">
      {main}
      {working}
    </p>
  );
}
