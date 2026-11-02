import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONVERSION_DICT } from "@/types/inventory";
import { FLAG_FAKTUR_GANDA, RECON_FLAGS, RECON_JENIS } from "@/lib/reconExport";

// Drift guard (spec §11.8), in the spirit of conversionSync.test.ts: the
// Export Rekonsiliasi views live in SQL and the tab builders in TypeScript.
// The §7 product map, the movement kinds and the §8 flag tokens must agree
// between the two or the export silently mislabels rows. The SQL is parsed
// from the migration files, so the migrations stay the single source of truth:
// v_recon_products from 20261029000000, v_recon_ledger as restated by Phase 2.
const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${name}`, import.meta.url)), "utf8");
const sql = read("20261029000000_recon_views.sql");
const phase2 = read("20261103000000_delivery_lines_void_return.sql");
const ledgerSql = phase2.slice(phase2.indexOf("create or replace view public.v_recon_ledger"));

const labels = [...sql.matchAll(/\('([A-Z ]+)',\s*'([^']+)',\s*(\d+)\)/g)].map((m) => ({
  product: m[1], item: m[2], order: Number(m[3]),
}));

describe("recon views <-> app (drift guard)", () => {
  it("every app egg product has exactly one sheet label in v_recon_products, and no label points elsewhere", () => {
    expect(labels.map((l) => l.product).sort()).toEqual(Object.keys(CONVERSION_DICT).sort());
    expect(new Set(labels.map((l) => l.item)).size).toBe(labels.length);
    expect(labels.map((l) => l.order).sort((a, b) => a - b)).toEqual(labels.map((_, i) => i + 1));
  });

  it("the views split units the same way the app does (kg vs everything else)", () => {
    expect(sql).toContain("case when t.unit = 'kg' then 'kg' else 'butir' end");
    for (const cfg of Object.values(CONVERSION_DICT)) expect(["kg", "btr"]).toContain(cfg.unit);
  });

  it("the ledger's jenis values are exactly the ones the builders know", () => {
    const literal = RECON_JENIS.filter((j) => j !== "return_restock" && j !== "return_writeoff");
    for (const j of literal) expect(ledgerSql).toContain(`'${j}'`);
    expect(ledgerSql).toContain("'return_' || r.disposition");
    expect(ledgerSql).toContain("r.disposition in ('restock', 'writeoff')");
    const found = [...ledgerSql.matchAll(/'(inflow|outflow_[a-z]+|return_[a-z]+|retur_batal|stock_count)'/g)].map((m) => m[1]);
    for (const j of found) expect(RECON_JENIS).toContain(j);
  });

  it("the §8 flag tokens match, with faktur-ganda the only client-side one", () => {
    const block = ledgerSql.slice(ledgerSql.indexOf("array_remove(array["), ledgerSql.indexOf("]::text[], null)"));
    const inSql = new Set([...block.matchAll(/then '([a-z-]+)' end/g)].map((m) => m[1]));
    expect([...inSql].sort()).toEqual(RECON_FLAGS.filter((f) => f !== FLAG_FAKTUR_GANDA).sort());
    expect(inSql.has("retur-batal") && inSql.has("retur-dibatalkan")).toBe(true);
  });
});
