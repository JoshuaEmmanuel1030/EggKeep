import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NO_PHYSICAL_RETURN } from "@/lib/deliveryFlags";
import { RETURN_REASONS } from "@/types/deliveries";

// Drift guard (pattern: reconViewsSync.test.ts): the partial unique index
// delivery_lines_physical_key repeats NO_PHYSICAL_RETURN in SQL.
const sql = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/20261103000000_delivery_lines_void_return.sql", import.meta.url)),
  "utf8"
);

describe("delivery_lines physical-line index <-> NO_PHYSICAL_RETURN", () => {
  it("the index's reason list equals NO_PHYSICAL_RETURN", () => {
    const m = /delivery_lines_physical_key[\s\S]*?where reason not in \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(inSql).toEqual([...NO_PHYSICAL_RETURN].sort());
  });
  it("every non-physical reason is a known reason code", () => {
    for (const r of NO_PHYSICAL_RETURN) expect(RETURN_REASONS).toContain(r);
  });
});
