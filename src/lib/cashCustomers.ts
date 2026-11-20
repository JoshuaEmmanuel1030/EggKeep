// Kas Tunai customer (Pelanggan Tunai) rules. Pure, no React / Supabase.
// The DB dedupes on upper(btrim(name)) (cash_customers_name_key), so the client
// trims and collapses inner whitespace before saving and compares on that key.
// Nothing fuzzier: "Bu Ani" and "Ibu Ani" stay two customers until someone
// renames one (Insight rule 5). The picker's search is what stops a re-type.

export interface CashCustomer {
  id: string;
  name: string;
  isActive: boolean;
}

// What a Kas Tunai sale carries: a listed customer (id), a name not on the
// list yet (name only), or null = anonymous walk-in ("Umum").
export type CustomerPick = { id?: string; name: string } | null;

// "  bu   rina " -> "bu rina" (case is kept as typed; the DB key ignores it).
export const normalizeCustomerName = (name: string): string => name.trim().replace(/\s+/g, " ");

// The uniqueness key the cash_customers_name_key index enforces.
export const customerNameKey = (name: string): string => normalizeCustomerName(name).toUpperCase();

// Placeholders staff type when there is no name. They mean an anonymous sale,
// never a customer. The backfill in 20261120000000_cash_customers.sql strips
// the same list (sync test).
export const ANONYMOUS_NAMES = ["-", "CUSTOMER", "CUST", "PELANGGAN", "UMUM", "ANONIM", "ANONYMOUS", "TANPA NAMA", "NO NAME"];

export const isAnonymousName = (name: string): boolean => {
  const key = customerNameKey(name);
  return key === "" || ANONYMOUS_NAMES.includes(key);
};

export const findCustomerByName = <T extends Pick<CashCustomer, "name">>(customers: T[], name: string): T | undefined => {
  const key = customerNameKey(name);
  return customers.find((c) => customerNameKey(c.name) === key);
};

// Active customers first, each group A-Z (case-insensitive).
export function sortCustomers<T extends Pick<CashCustomer, "name" | "isActive">>(customers: T[]): T[] {
  return [...customers].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

export interface CustomerOptions<T> {
  matches: T[];
  // The typed name, cleaned, when it can be added as a new customer.
  addName: string | null;
  // Offer "Umum": nothing typed, or a placeholder typed.
  showWalkIn: boolean;
}

// What the picker lists for the typed search: active customers containing it,
// plus an inactive one only on an exact name (so it is reused, not re-added).
export function customerOptions<T extends Pick<CashCustomer, "name" | "isActive">>(customers: T[], search: string): CustomerOptions<T> {
  const typed = normalizeCustomerName(search);
  const key = typed.toUpperCase();
  const exact = findCustomerByName(customers, typed);
  const matches = sortCustomers(customers).filter((c) =>
    c.isActive ? customerNameKey(c.name).includes(key) : c === exact
  );
  const anonymous = isAnonymousName(typed);
  return { matches, addName: !anonymous && !exact ? typed : null, showWalkIn: anonymous };
}

// The customer fields of a sale's metadata. A name typed before its row was
// saved (offline, or the insert still in flight) is matched to the list by
// name; failing that the sale carries the name alone and still reads fine.
export function customerMetadata(pick: CustomerPick, customers: Pick<CashCustomer, "id" | "name">[]): { customerId?: string; customerName?: string } {
  if (!pick || isAnonymousName(pick.name)) return {};
  const listed = pick.id ? customers.find((c) => c.id === pick.id) : findCustomerByName(customers, pick.name);
  const id = pick.id ?? listed?.id;
  return { ...(id ? { customerId: id } : {}), customerName: listed?.name ?? normalizeCustomerName(pick.name) };
}

// Postgres unique_violation: a customer with this name already exists.
export const isDuplicateCustomerError = (error: unknown): boolean => (error as { code?: string } | null)?.code === "23505";
