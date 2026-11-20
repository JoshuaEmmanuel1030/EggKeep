import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ANONYMOUS_NAMES,
  customerMetadata,
  customerNameKey,
  customerOptions,
  findCustomerByName,
  isAnonymousName,
  isDuplicateCustomerError,
  normalizeCustomerName,
  sortCustomers,
} from "@/lib/cashCustomers";

const list = [
  { id: "1", name: "Bu Rina", isActive: true },
  { id: "2", name: "Pa Joko", isActive: true },
  { id: "3", name: "Hendra Joko", isActive: true },
  { id: "4", name: "Bu Lama", isActive: false },
];

describe("customer name normalization", () => {
  it("trims and collapses inner whitespace, keeps the typed case", () => {
    expect(normalizeCustomerName("  Bu   Rina ")).toBe("Bu Rina");
    expect(normalizeCustomerName("\tpa joko\n")).toBe("pa joko");
  });
  it("dedupes on the same key as cash_customers_name_key", () => {
    expect(customerNameKey(" bu  rina ")).toBe("BU RINA");
    expect(findCustomerByName(list, "BU RINA")?.id).toBe("1");
    expect(findCustomerByName(list, "Rina")).toBeUndefined();
  });
  it("does nothing fuzzier: a different honorific is a different customer", () => {
    expect(customerNameKey("Ibu Rina")).not.toBe(customerNameKey("Bu Rina"));
  });
  it("recognises the unique_violation the index raises", () => {
    expect(isDuplicateCustomerError({ code: "23505" })).toBe(true);
    expect(isDuplicateCustomerError(null)).toBe(false);
  });
});

describe("anonymous walk-in", () => {
  it("treats blanks and placeholders as no customer", () => {
    for (const n of ["", "   ", "-", "Customer", "customer ", "UMUM", "Tanpa  Nama", "anonim"]) expect(isAnonymousName(n)).toBe(true);
  });
  it("leaves real names alone, including ones that contain a placeholder", () => {
    for (const n of ["Bu Rina", "Toko Umum Jaya", "Customer Care"]) expect(isAnonymousName(n)).toBe(false);
  });
  it("the migration strips the same placeholders from past sales", () => {
    const sql = readFileSync("supabase/migrations/20261120000000_cash_customers.sql", "utf8");
    const inList = /in \(('',[^)]*)\);/.exec(sql)?.[1] ?? "";
    const fromSql = [...inList.matchAll(/'([^']*)'/g)].map((m) => m[1]).filter(Boolean).sort();
    expect(fromSql).toEqual([...ANONYMOUS_NAMES].sort());
  });
});

describe("customerOptions", () => {
  it("nothing typed: every active customer A-Z, plus the walk-in choice, no add", () => {
    const o = customerOptions(list, "");
    expect(o.matches.map((c) => c.name)).toEqual(["Bu Rina", "Hendra Joko", "Pa Joko"]);
    expect(o).toMatchObject({ showWalkIn: true, addName: null });
  });
  it("a partial name shows everyone it could be, and still offers to add it", () => {
    const o = customerOptions(list, "joko");
    expect(o.matches.map((c) => c.name)).toEqual(["Hendra Joko", "Pa Joko"]);
    expect(o).toMatchObject({ showWalkIn: false, addName: "joko" });
  });
  it("an exact name, any casing or spacing, is never offered as new", () => {
    expect(customerOptions(list, " pa  JOKO ")).toMatchObject({ addName: null });
  });
  it("an inactive customer shows only on its exact name, so it is reused", () => {
    expect(customerOptions(list, "bu").matches.map((c) => c.name)).toEqual(["Bu Rina"]);
    const o = customerOptions(list, "bu lama");
    expect(o.matches.map((c) => c.name)).toEqual(["Bu Lama"]);
    expect(o.addName).toBeNull();
  });
  it("a placeholder is offered as the walk-in, never as a new customer", () => {
    expect(customerOptions(list, "Customer")).toMatchObject({ showWalkIn: true, addName: null, matches: [] });
  });
});

describe("customerMetadata", () => {
  it("anonymous writes neither field", () => {
    expect(customerMetadata(null, list)).toEqual({});
    expect(customerMetadata({ name: " customer " }, list)).toEqual({});
  });
  it("a listed customer writes id and the list's spelling", () => {
    expect(customerMetadata({ id: "1", name: "bu rina" }, list)).toEqual({ customerId: "1", customerName: "Bu Rina" });
  });
  it("a name-only pick is matched to the list by name", () => {
    expect(customerMetadata({ name: "pa  joko" }, list)).toEqual({ customerId: "2", customerName: "Pa Joko" });
  });
  it("an unlisted name goes on the sale alone, cleaned", () => {
    expect(customerMetadata({ name: "  Bu   Sari " }, list)).toEqual({ customerName: "Bu Sari" });
  });
  it("keeps an id the list hasn't loaded yet", () => {
    expect(customerMetadata({ id: "9", name: "Bu Sari" }, [])).toEqual({ customerId: "9", customerName: "Bu Sari" });
  });
});

describe("sortCustomers", () => {
  it("lists active first, each group A-Z ignoring case", () => {
    expect(sortCustomers(list).map((c) => c.name)).toEqual(["Bu Rina", "Hendra Joko", "Pa Joko", "Bu Lama"]);
  });
});
