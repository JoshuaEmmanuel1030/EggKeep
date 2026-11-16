// Masuk "Bentuk": the form an egg line arrived in, its inline picker, and the
// per-load weight control a weighed form (Tonase) needs. Presentational — the
// parent owns the form id, the weight text and which picker is open.
// Design: docs/superpowers/specs/design_handoff_masuk_bentuk/README.md

import { useRef } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { parseQtyInput, qtyInputText } from "@/lib/stockCount";
import {
  TONASE_MAX_KG, TONASE_MIN_KG, TONASE_STEP_KG, formUnitWord, findForm, type EggForm,
} from "@/lib/eggForms";

export interface BentukRowProps {
  forms: EggForm[];
  formId: string | null;
  tonaseKg: string;
  nativeUnit: "kg" | "butir" | "pcs";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeForm: (id: string | null) => void;
  onChangeTonase: (value: string) => void;
}

const inRange = (n: number | null) => n != null && n >= TONASE_MIN_KG && n <= TONASE_MAX_KG;

/** "15 kg per iket", "30 butir per tray", "" for Langsung and Curah. */
function sizeText(form: EggForm | null, nativeUnit: string): string {
  if (!form || form.unit === "native" || form.unit === "weighed" || form.size == null) return "";
  return `${form.size} ${form.unit} per ${formUnitWord(form, nativeUnit)}`;
}

export function BentukRow({
  forms, formId, tonaseKg, nativeUnit, open, onOpenChange, onChangeForm, onChangeTonase,
}: BentukRowProps) {
  const { t } = useLanguage();
  const form = findForm(forms, formId);
  // The weight to fall back to when the field is given something unusable.
  const lastValid = useRef<string>(tonaseKg);
  // The text the field last carried. Not the same as the prop: blur has to judge
  // what was typed, and a controlled input is reset to the prop before it fires.
  const typed = useRef<string>(tonaseKg);
  if (inRange(parseQtyInput(tonaseKg, "kg"))) lastValid.current = tonaseKg;

  if (forms.length === 0) return null;

  const directLabel = t.inflow.formDirect.replace("{unit}", nativeUnit);
  const size = sizeText(form, nativeUnit);

  const emitWeight = (value: string) => {
    typed.current = value;
    onChangeTonase(value);
  };

  const step = (direction: 1 | -1) => {
    const parsed = parseQtyInput(tonaseKg, "kg");
    const from = parsed ?? (direction === 1 ? TONASE_MIN_KG - TONASE_STEP_KG : TONASE_MAX_KG + TONASE_STEP_KG);
    const next = Math.min(TONASE_MAX_KG, Math.max(TONASE_MIN_KG, Math.round((from + direction * TONASE_STEP_KG) * 10) / 10));
    emitWeight(qtyInputText(next));
  };

  const commitWeight = () => {
    if (!inRange(parseQtyInput(typed.current, "kg"))) emitWeight(lastValid.current);
  };

  return (
    <div className="ml-9 mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-ek-mfg">{t.inflow.form}</span>
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className={cn(
            "h-11 gap-2 rounded-[11px] border-ek-border bg-card px-3 text-sm font-semibold text-ek-fg hover:bg-card hover:text-ek-fg [&_svg]:size-3.5",
            open && "border-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.2)]"
          )}
        >
          {form ? form.name : directLabel}
          <ChevronDown aria-hidden />
        </Button>
        {size && <span className="text-[12.5px] text-ek-mfg">{size}</span>}
      </div>

      {open && (
        <div role="group" aria-label={t.inflow.form} className="grid grid-cols-3 gap-1.5">
          <PickerOption
            name={directLabel}
            detail={t.inflow.formDirectHint}
            selected={!form}
            onPick={() => { onChangeForm(null); onOpenChange(false); }}
          />
          {forms.map((f) => (
            <PickerOption
              key={f.id}
              name={f.name}
              detail={sizeText(f, nativeUnit)}
              selected={f.id === formId}
              onPick={() => { onChangeForm(f.id); onOpenChange(false); }}
            />
          ))}
        </div>
      )}

      {form && form.unit === "weighed" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-ek-muted py-1.5 pl-3 pr-2">
          <div className="mr-auto">
            <p className="text-[13.5px] font-semibold text-ek-fg">{t.inflow.tonaseWeightToday}</p>
            <p className="text-[12.5px] text-ek-mfg">
              {t.inflow.tonaseSizeLine.replace("{kg}", tonaseKg || "—")}
            </p>
          </div>
          <div className="flex items-center rounded-xl border border-ek-border bg-card">
            <Button
              type="button" variant="ghost" aria-label="−" onClick={() => step(-1)}
              className="h-11 w-11 rounded-l-xl p-0 text-ek-fg hover:bg-ek-muted [&_svg]:size-4"
            >
              <Minus aria-hidden />
            </Button>
            <Input
              type="text"
              inputMode="decimal"
              value={tonaseKg}
              aria-label={t.inflow.tonaseWeightToday}
              onChange={(e) => emitWeight(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={commitWeight}
              className="h-11 w-[58px] border-0 bg-transparent px-0 text-right font-display text-lg font-semibold tabular-nums focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <span className="px-1 text-[13.5px] text-ek-mfg">kg</span>
            <Button
              type="button" variant="ghost" aria-label="+" onClick={() => step(1)}
              className="h-11 w-11 rounded-r-xl p-0 text-ek-fg hover:bg-ek-muted [&_svg]:size-4"
            >
              <Plus aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PickerOption({
  name, detail, selected, onPick,
}: { name: string; detail: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex min-h-[52px] flex-col justify-center rounded-[10px] bg-ek-muted px-2.5 py-1.5 text-left hover:bg-[#e9e3d8]",
        selected && "bg-ek-accent shadow-[inset_0_0_0_2px_#f59e0b]"
      )}
    >
      <span className="text-sm font-semibold text-ek-fg">{name}</span>
      {detail && <span className="text-xs text-[#5c534a]">{detail}</span>}
    </button>
  );
}
