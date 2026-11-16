// The forms an egg delivery can arrive in ("Bentuk"), and the arithmetic that turns
// a count of them into the product's native unit. Catalogue data lives on
// item_types.forms; this module only reads it. No I/O, no React.
// Spec: docs/superpowers/specs/2026-11-16-masuk-bentuk-tonase-design.md

import type { ItemType } from "@/types/inventory";

/** kg: a weight per bundle. butir: an egg count per bundle. native: the amount as
 *  typed (Curah). weighed: the size is the line's own scale reading (Tonase). */
export type FormUnit = "kg" | "butir" | "native" | "weighed";

export interface EggForm {
  id: string;
  name: string;
  /** Absent for `weighed`, whose size is the line's weight. */
  size?: number;
  unit: FormUnit;
  /** The word shown inside the Jumlah field ("iket", "tray", "satuan"). Absent for
   *  `native`, which uses the product's own unit. */
  unitWord?: string;
}

/** A sanity range, not a band the scale has to sit in: wide enough for any real
 *  load, tight enough to catch a mistyped 168 or 1,6. */
export const TONASE_MIN_KG = 5;
export const TONASE_MAX_KG = 30;
export const TONASE_STEP_KG = 0.1;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The forms configured for an egg product, in catalogue order. */
export function formsFor(product: string, itemTypes: ItemType[]): EggForm[] {
  const type = itemTypes.find((t) => t.name === product && t.category === "egg");
  return type?.forms ?? [];
}

/** The form an id refers to. Null means Langsung: no form, the amount as typed. */
export function findForm(forms: EggForm[], id: string | null | undefined): EggForm | null {
  if (!id) return null;
  return forms.find((f) => f.id === id) ?? null;
}

/** Which unit the typed Jumlah is in, for parseQtyInput. A bundled form is counted,
 *  so it takes whole numbers — which is what the "butir" mode of parseQtyInput gives
 *  (integers, with a dot reading as thousands). Langsung and Curah are native. */
export function entryUnit(
  form: EggForm | null,
  nativeUnit: "kg" | "butir" | "pcs"
): "kg" | "butir" | "pcs" {
  if (!form || form.unit === "native") return nativeUnit;
  return "butir";
}

/** The native-unit quantity a line will record, or null when it cannot be worked
 *  out yet (no count, no Tonase weight, no conversion configured). */
export function toNative(args: {
  form: EggForm | null;
  count: number | null;
  nativeUnit: "kg" | "butir" | "pcs";
  eggsPerUnit?: number;
  tonaseKg?: number | null;
}): number | null {
  const { form, count, nativeUnit, eggsPerUnit, tonaseKg } = args;
  if (count == null || count <= 0) return null;

  // Langsung and Curah: the number is already native.
  if (!form || form.unit === "native") return count;

  if (form.unit === "weighed") {
    // Tonase is a weight per satuan, so it only makes sense on a kg product.
    if (nativeUnit !== "kg") return null;
    if (tonaseKg == null || tonaseKg <= 0) return null;
    return round2(count * tonaseKg);
  }

  if (form.size == null || form.size <= 0) return null;
  if (form.unit === "kg") {
    // A weight per bundle only makes sense on a kg product.
    if (nativeUnit !== "kg") return null;
    return round2(count * form.size);
  }

  // butir-sized bundle
  if (nativeUnit === "kg") {
    if (!eggsPerUnit || eggsPerUnit <= 0) return null;
    return round2((count * form.size) / eggsPerUnit);
  }
  return count * form.size;
}

/** The word shown inside the Jumlah field for this form. */
export function formUnitWord(form: EggForm | null, nativeUnit: string): string {
  if (!form || form.unit === "native") return nativeUnit;
  return form.unitWord ?? nativeUnit;
}
