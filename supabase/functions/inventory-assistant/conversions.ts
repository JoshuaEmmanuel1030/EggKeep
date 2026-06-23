// Authoritative unit-conversion table for the inventory assistant (Deno/Edge runtime).
//
// This is a deliberate, runtime-isolated copy of CONVERSION_DICT from
// src/types/inventory.ts. The Edge Function deploys separately from the Vite app
// and cannot import out of src/, so the values live here too. A drift-guard test
// (src/lib/__tests__/conversionSync.test.ts) asserts these stay byte-for-byte in
// sync with the app's copy — if you change a factor, change it in BOTH files or CI fails.
//
// Keep this file import-free so plain Node (the test) and Deno (the function) can both load it.

export interface ProductConfig {
  unit: "kg" | "btr";
  eggs_per_unit: number;
}

export const CONVERSION_DICT: Record<string, ProductConfig> = {
  "NEGERI BIASA": { unit: "kg", eggs_per_unit: 15.5 },
  "NEGERI OMEGA": { unit: "kg", eggs_per_unit: 15.5 },
  "KAMPUNG BIASA": { unit: "btr", eggs_per_unit: 1 },
  "KAMPUNG MERAH": { unit: "btr", eggs_per_unit: 1 },
  "BEBEK TAWAR": { unit: "btr", eggs_per_unit: 1 },
  "ASIN MATENG": { unit: "btr", eggs_per_unit: 1 },
  "ASIN MENTAH": { unit: "btr", eggs_per_unit: 1 },
  "PUYUH": { unit: "btr", eggs_per_unit: 1 },
  "KUNING MANIK": { unit: "btr", eggs_per_unit: 1 },
};

export const EGGS_PER_TRAY = 30;
