// Driver (Supir) name rules for Catalog → Supir. Pure, no React / Supabase.
// The DB dedupes on upper(trim(name)) (drivers_name_key), so the client trims
// and collapses inner whitespace before saving and compares on the same key.
import type { Driver } from "@/types/deliveries";

// "  hendi   s " -> "hendi s" (case is kept as typed; the DB key ignores it).
export const normalizeDriverName = (name: string): string => name.trim().replace(/\s+/g, " ");

// The uniqueness key the drivers_name_key index enforces.
export const driverNameKey = (name: string): string => normalizeDriverName(name).toUpperCase();

export const isValidDriverName = (name: string): boolean => normalizeDriverName(name).length > 0;

// Postgres unique_violation: a driver with this name already exists.
export function isDuplicateDriverError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

// Active drivers first, each group A→Z (locale-aware, case-insensitive).
export function sortDrivers<T extends Pick<Driver, "name" | "isActive">>(drivers: T[]): T[] {
  return [...drivers].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}
