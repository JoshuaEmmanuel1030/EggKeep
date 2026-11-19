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

const FORM_UNITS: readonly FormUnit[] = ["kg", "butir", "native", "weighed"];

/** Whether a value is a usable form. JSONB holds no shape for us, and the column can
 *  still be written by hand, so a wrong shape is an expected failure, not an edge case. */
export function isEggForm(value: unknown): value is EggForm {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const f = value as Partial<EggForm>;
  if (typeof f.id !== "string" || f.id.trim() === "") return false;
  if (typeof f.name !== "string" || f.name.trim() === "") return false;
  if (!FORM_UNITS.includes(f.unit as FormUnit)) return false;
  // kg and butir are sized bundles. native takes the amount as typed and weighed
  // takes the line's own scale reading, so neither carries a size.
  if ((f.unit === "kg" || f.unit === "butir") &&
      (typeof f.size !== "number" || !Number.isFinite(f.size) || f.size <= 0)) return false;
  if (f.unitWord != null && typeof f.unitWord !== "string") return false;
  return true;
}

/** Usable forms only, in order, first of any duplicated id winning. Guards the
 *  container AND the elements: `[{}, null, "x"]` would otherwise reach the picker
 *  and render a garbled option. */
export function sanitizeForms(value: unknown): EggForm[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: EggForm[] = [];
  for (const el of value) {
    if (!isEggForm(el) || seen.has(el.id)) continue;
    seen.add(el.id);
    out.push(el);
  }
  return out;
}

/** A form id from its name. Ids are what `inflows.form` stores, so they are minted
 *  once and never change when a form is renamed — history keeps resolving. */
export function formIdFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40) || "bentuk";
}

/** The forms configured for an egg product, in catalogue order. Arrivals only —
 *  this is what Masuk offers. */
export function formsFor(product: string, itemTypes: ItemType[]): EggForm[] {
  const type = itemTypes.find((t) => t.name === product && t.category === "egg");
  return sanitizeForms(type?.forms);
}

/** Every bundle that can be standing in the warehouse at a physical count: the
 *  arrival forms plus the count-only ones (the previous day's packed stock). Stok
 *  Fisik reads this; Masuk never does, so a count-only entry can never offer a
 *  receipt that never happens. An arrival form shadows a count form of the same id,
 *  because sanitizeForms keeps the first of a duplicated id. */
export function countFormsFor(product: string, itemTypes: ItemType[]): EggForm[] {
  const type = itemTypes.find((t) => t.name === product && t.category === "egg");
  return sanitizeForms([
    ...sanitizeForms(type?.forms),
    ...sanitizeForms(type?.countForms),
  ]);
}

/** The native-unit total for a set of counted bundles. Keyed by form id; a value
 *  that will not parse, or a form that cannot convert, contributes nothing. Returns
 *  the sum rounded to 2 dp and how many lines actually counted. */
export function sumCountedBundles(args: {
  forms: EggForm[];
  counts: Record<string, number | null>;
  nativeUnit: "kg" | "butir" | "pcs";
  eggsPerUnit?: number;
}): { total: number; lines: number } {
  const { forms, counts, nativeUnit, eggsPerUnit } = args;
  let total = 0;
  let lines = 0;
  for (const form of forms) {
    const count = counts[form.id];
    if (count == null || count <= 0) continue;
    // No tonaseKg is passed, and none could be: a weighed form's size is one
    // delivery's scale reading, not a property of a bundle on a shelf. toNative
    // therefore returns null for it, which the next line drops — so there is no
    // separate guard here. The dialog also hides those rows.
    const native = toNative({ form, count, nativeUnit, eggsPerUnit });
    if (native == null) continue;
    total += native;
    lines += 1;
  }
  return { total: round2(total), lines };
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
    // The bounds are enforced here, not just by the stepper: a pasted weight never
    // blurs, so this is the only check every path goes through.
    if (tonaseKg == null || tonaseKg < TONASE_MIN_KG || tonaseKg > TONASE_MAX_KG) return null;
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
