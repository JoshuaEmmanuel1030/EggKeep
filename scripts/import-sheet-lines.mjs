// One-time import of October's store-side rows from the sheet "Log Pengiriman &
// Retur" (main tab, downloaded as .xlsx) into deliveries / delivery_lines.
// Spec: docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md §6.9
// Rules: scripts/lib/sheetImportRules.mjs. NEVER writes `returns` or anything stock-side.
//
// Usage (Node 20.6+):
//   node --env-file=.env scripts/import-sheet-lines.mjs --xlsx <path> [--dry-run] [--report <path>]
// Env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, IMPORT_EMAIL, IMPORT_PASSWORD.
// Rollback: delete from delivery_lines where source = 'sheet_import'; then the
// deliveries ids the report lists as created (only those with no other line).
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import {
  buildSheetLine,
  customerMatchesBuyer,
  isNonPoCustomer,
  isPhysicalReason,
  mergeLines,
  normalizeInvoiceRef,
  toIsoDate,
  toNumber,
} from "./lib/sheetImportRules.mjs";

const LIVE_REF = "lgtixzpjbkzapecirbfj";
const SHEET_TAB = "Pengiriman & Retur";

const { values: args } = parseArgs({
  options: {
    xlsx: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    report: { type: "string", default: "docs/sheet-import-2026-10.md" },
  },
});
const dryRun = args["dry-run"];
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (!args.xlsx) die("Usage: node --env-file=.env scripts/import-sheet-lines.mjs --xlsx <path> [--dry-run] [--report <path>]");

const url = process.env.VITE_SUPABASE_URL ?? "";
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
if (!url.includes(LIVE_REF)) die(`Refusing: VITE_SUPABASE_URL does not name project ${LIVE_REF}.`);
if (!key) die("VITE_SUPABASE_PUBLISHABLE_KEY is not set.");
if (!process.env.IMPORT_EMAIL || !process.env.IMPORT_PASSWORD) die("IMPORT_EMAIL / IMPORT_PASSWORD are not set.");

// ── sheet ────────────────────────────────────────────────────────────────────
// Header text → field. Matched with case, whitespace and punctuation ignored.
const COLUMNS = {
  pic: "PIC",
  tglKirim: "Tgl Kirim",
  faktur: "No. Faktur / PO",
  customer: "Customer",
  supir: "Supir",
  statusKirim: "Status Kirim",
  tglFakturBalik: "Tgl Faktur Balik",
  parafAdmin: "Paraf Admin",
  item: "Item",
  qtyDiterima: "Qty Diterima (pack)",
  qtyRetur: "Qty Retur (pack)",
  full: "Full",
  alasan: "Alasan Retur",
  catatan: "Catatan Kondisi",
  tglBalik: "Tgl Barang Balik",
  tglExpired: "Tgl Expired",
  ok: "Butir OK (ke stok)",
  pecah: "Butir Pecah",
  parafGudang: "Paraf Gudang",
  noRetur: "No. Retur ARYO",
  statusTagihan: "Status Tagihan",
};
const headerKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date || typeof v !== "object") return typeof v === "string" ? v.trim() || null : v;
  if ("result" in v) return cellValue(v.result); // formula
  if ("richText" in v) return v.richText.map((t) => t.text).join("").trim() || null;
  if ("text" in v) return String(v.text).trim() || null; // hyperlink
  return null;
}

async function readSheet(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === SHEET_TAB.toLowerCase());
  if (!ws) die(`Tab "${SHEET_TAB}" not found (tabs: ${wb.worksheets.map((w) => w.name).join(", ")}).`);

  const colByKey = new Map();
  ws.getRow(2).eachCell((cell, col) => colByKey.set(headerKey(cellValue(cell.value)), col));
  const cols = {};
  const missing = [];
  for (const [field, header] of Object.entries(COLUMNS)) {
    const col = colByKey.get(headerKey(header));
    if (col) cols[field] = col;
    else missing.push(header);
  }
  for (const req of ["faktur", "customer", "item", "qtyRetur", "alasan"]) {
    if (!cols[req]) die(`Required column "${COLUMNS[req]}" not found in row 2.`);
  }
  if (missing.length) console.warn(`Columns not found (left blank): ${missing.join(", ")}`);

  const rows = [];
  ws.eachRow((r, n) => {
    if (n <= 2) return;
    const get = (f) => (cols[f] ? cellValue(r.getCell(cols[f]).value) : null);
    const faktur = normalizeInvoiceRef(get("faktur"));
    if (!faktur) return;
    rows.push({
      sheetRow: n,
      faktur,
      fakturRaw: String(get("faktur")).trim(),
      pic: get("pic"),
      customer: get("customer") ? String(get("customer")) : "",
      supir: get("supir"),
      statusKirim: get("statusKirim") ? String(get("statusKirim")) : null,
      tglFakturBalik: toIsoDate(get("tglFakturBalik")),
      parafAdmin: get("parafAdmin"),
      item: get("item") ? String(get("item")) : null,
      qtyDiterima: toNumber(get("qtyDiterima")),
      qtyRetur: toNumber(get("qtyRetur")),
      alasan: get("alasan") ? String(get("alasan")) : null,
      catatan: get("catatan") ? String(get("catatan")) : null,
      tglBalik: toIsoDate(get("tglBalik")),
      tglExpired: toIsoDate(get("tglExpired")),
      ok: toNumber(get("ok")),
      pecah: toNumber(get("pecah")),
      noRetur: get("noRetur"),
    });
  });
  return rows;
}

// ── database ─────────────────────────────────────────────────────────────────
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function selectAll(table, columns, build = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(supabase.from(table).select(columns)).range(from, from + 999);
    if (error) die(`Reading ${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const first = (rows, f) => rows.map((r) => r[f]).find((v) => v != null && v !== "") ?? null;

async function main() {
  const sheetRows = await readSheet(args.xlsx);

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: process.env.IMPORT_EMAIL,
    password: process.env.IMPORT_PASSWORD,
  });
  if (authError) die(`Sign-in failed: ${authError.message}`);

  const pos = await selectAll("purchase_orders", "invoice_ref, buyer_name, dc_name, outflow_date, order_lines");
  const skus = await selectAll("pack_skus", "code, eggs_per_pack, egg_product, base_pack_code, box_mode, unit_label", (q) => q.is("deleted_at", null));
  const boxes = await selectAll("item_types", "name, box_capacities", (q) => q.eq("category", "box").is("deleted_at", null));
  const drivers = await selectAll("drivers", "id, name");
  const deliveries = await selectAll("deliveries", "id, invoice_ref_norm");

  const boxCaps = Object.fromEntries(boxes.filter((b) => b.box_capacities).map((b) => [b.name, b.box_capacities]));
  for (const code of ["N10B", "N10O", "KP6O"]) {
    if (!(boxCaps["box osave"]?.[code] > 0)) die(`item_types "box osave" has no box_capacities.${code}; the script has no fallback.`);
  }
  const skusByCode = new Map(skus.map((s) => [s.code, s]));
  const posByRef = new Map();
  for (const po of pos) {
    const norm = normalizeInvoiceRef(po.invoice_ref);
    if (norm) posByRef.set(norm, [...(posByRef.get(norm) ?? []), po]);
  }
  const deliveryByRef = new Map(deliveries.map((d) => [d.invoice_ref_norm, d.id]));
  const driverByName = new Map(drivers.map((d) => [d.name.trim().toUpperCase(), d]));

  const rep = {
    unmatched: [], shared: [], nonPo: [], mismatch: [], unresolved: [], unitDoubt: [], unknownReason: [],
    derived: [], merges: [], dropped: [], existing: [], collisions: [], unknownDrivers: [], statuses: [],
    created: [], inserted: [], errors: [],
  };

  const byFaktur = new Map();
  for (const r of sheetRows) byFaktur.set(r.faktur, [...(byFaktur.get(r.faktur) ?? []), r]);

  const plans = [];
  for (const [faktur, rows] of byFaktur) {
    const customer = first(rows, "customer") ?? "";
    const matches = posByRef.get(faktur) ?? [];
    if (matches.length === 0) {
      (isNonPoCustomer(customer) ? rep.nonPo : rep.unmatched).push(`${faktur} · ${customer} (rows ${rows.map((r) => r.sheetRow).join(", ")})`);
      continue;
    }
    if (matches.length > 1) {
      rep.shared.push(`${faktur} · ${customer} · ${matches.map((p) => `${p.buyer_name} ${p.outflow_date}`).join(" / ")}`);
      continue;
    }
    const po = matches[0];
    if (!customerMatchesBuyer(customer, po.buyer_name)) {
      rep.mismatch.push(`${faktur} · sheet "${customer}" vs PO buyer "${po.buyer_name}"`);
      continue;
    }

    const status = first(rows, "statusKirim");
    const terkirim = status && status.trim().toLowerCase() === "terkirim";
    if (status && !terkirim) rep.statuses.push(`${faktur} · "${status}"`);
    const supir = first(rows, "supir");
    const driver = supir ? driverByName.get(String(supir).trim().toUpperCase()) : null;
    if (supir && !driver) rep.unknownDrivers.push(`${faktur} · "${supir}"`);

    const poLines = Array.isArray(po.order_lines) ? po.order_lines : [];
    const built = [];
    for (const r of rows) {
      if (!r.alasan && r.qtyRetur == null) continue; // delivered, nothing returned: no line
      const statusNote = status && !terkirim && built.length === 0 ? [`Status Kirim: ${status}`] : [];
      const res = buildSheetLine({ row: r, poLines, skusByCode, boxCaps, extraNote: statusNote });
      if (res.error) {
        rep.unresolved.push(`${faktur} row ${r.sheetRow} · "${r.item ?? ""}" · ${res.error}`);
        continue;
      }
      const { line, flags } = res;
      if (flags.unitDoubt) rep.unitDoubt.push(`${faktur} row ${r.sheetRow} · ${line.skuCode} ${r.qtyRetur} · OK ${r.ok ?? "-"} + Pecah ${r.pecah ?? "-"} → box (doubt)`);
      if (flags.unknownReason) rep.unknownReason.push(`${faktur} row ${r.sheetRow} · "${r.alasan ?? ""}" → lainnya`);
      if (flags.derived) rep.derived.push(`${faktur} row ${r.sheetRow} · ${line.skuCode} ${line.reason} · PO ${flags.poPackQty} − diterima ${r.qtyDiterima} = ${line.quantity}`);
      built.push(line);
    }
    const { lines, merges, dropped } = mergeLines(built);
    for (const m of merges) rep.merges.push(`${m.faktur} · ${m.skuCode} ${m.reason} · rows ${m.rows.join(", ")} → ${m.quantity}`);
    for (const d of dropped) rep.dropped.push(`${d.line.faktur} rows ${d.line.sheetRows.join(", ")} · ${d.line.skuCode} ${d.line.reason} · ${d.why}`);

    plans.push({
      faktur,
      po,
      lines,
      delivery: {
        invoice_ref: po.invoice_ref,
        buyer_name: po.buyer_name,
        dc_name: po.dc_name,
        delivery_date: po.outflow_date,
        pic: first(rows, "pic"),
        invoice_checked_by: first(rows, "parafAdmin"),
        driver_id: driver?.id ?? null,
        driver_name: driver?.name ?? (supir ? String(supir) : null),
        ...(terkirim ? { status: "terkirim" } : {}),
        invoice_returned_at: first(rows, "tglFakturBalik"),
        notes: status && !terkirim && lines.length === 0 ? `Status Kirim: ${status}` : null,
      },
    });
  }

  if (!dryRun) {
    for (const plan of plans) {
      let deliveryId = deliveryByRef.get(plan.faktur);
      if (deliveryId) {
        rep.existing.push(`${plan.faktur} · ${deliveryId}`);
      } else {
        const { data, error } = await supabase.from("deliveries").insert(plan.delivery).select("id").single();
        if (error) {
          rep.errors.push(`${plan.faktur} · deliveries insert: ${error.message}`);
          continue;
        }
        deliveryId = data.id;
        rep.created.push(`${plan.faktur} · ${deliveryId}`);
      }

      const { data: existing, error: readErr } = await supabase.from("delivery_lines").select("sku_code, reason").eq("delivery_id", deliveryId);
      if (readErr) {
        rep.errors.push(`${plan.faktur} · reading delivery_lines: ${readErr.message}`);
        continue;
      }
      const have = [...existing];
      for (const line of plan.lines) {
        const sameKey = have.find((h) => h.sku_code === line.skuCode && h.reason === line.reason);
        const samePhysical = isPhysicalReason(line.reason) && have.find((h) => h.sku_code === line.skuCode && isPhysicalReason(h.reason));
        if (sameKey || samePhysical) {
          const h = sameKey || samePhysical;
          rep.collisions.push(`${plan.faktur} · ${line.skuCode} ${line.reason} · existing ${h.sku_code} ${h.reason}`);
          continue;
        }
        const { error } = await supabase.from("delivery_lines").insert({
          id: randomUUID(),
          delivery_id: deliveryId,
          sku_code: line.skuCode,
          unit_label: line.unitLabel,
          pieces_per_unit: line.piecesPerUnit,
          quantity: line.quantity,
          reason: line.reason,
          note: line.note,
          claim_ref: line.claimRef,
          expected_expiry: line.expectedExpiry,
          source: "sheet_import",
        });
        if (error) {
          (error.code === "23505" ? rep.collisions : rep.errors).push(`${plan.faktur} · ${line.skuCode} ${line.reason} · ${error.message}`);
          continue;
        }
        have.push({ sku_code: line.skuCode, reason: line.reason });
        rep.inserted.push(`${plan.faktur} · ${line.skuCode} ${line.reason}`);
      }
    }
  } else {
    for (const plan of plans) if (deliveryByRef.has(plan.faktur)) rep.existing.push(`${plan.faktur} · ${deliveryByRef.get(plan.faktur)}`);
  }

  writeFileSync(args.report, renderReport(sheetRows, byFaktur, plans, rep));
  console.log(`${dryRun ? "DRY RUN, nothing written to the database. " : ""}Report: ${args.report}`);
  console.log(`Sheet fakturs ${byFaktur.size} · matched ${plans.length} · lines ${plans.reduce((s, p) => s + p.lines.length, 0)}` +
    (dryRun ? "" : ` · deliveries created ${rep.created.length} · lines inserted ${rep.inserted.length} · collisions ${rep.collisions.length} · errors ${rep.errors.length}`));
  if (rep.errors.length) process.exitCode = 1;
}

function renderReport(sheetRows, byFaktur, plans, rep) {
  const list = (title, items) => `## ${title} (${items.length})\n\n${items.length ? items.map((i) => `- ${i}`).join("\n") : "_none_"}\n`;
  const lineCount = plans.reduce((s, p) => s + p.lines.length, 0);
  const out = [
    `# Sheet import, October 2026${dryRun ? " (DRY RUN)" : ""}`,
    "",
    `Run ${new Date().toISOString()} · file \`${args.xlsx}\` · ${sheetRows.length} sheet rows · ${byFaktur.size} fakturs · ${plans.length} matched one PO · ${lineCount} delivery lines planned.`,
    dryRun ? "Dry run: nothing was written to the database." : `Live run: ${rep.created.length} deliveries created, ${rep.inserted.length} delivery lines inserted. No \`returns\` row was written.`,
    "",
    list("Deliveries rows created (rollback reads these ids)", rep.created),
    list("Unmatched fakturs (no PO)", rep.unmatched),
    list("Shared invoice ref (2+ POs)", rep.shared),
    list("Non-PO customers", rep.nonPo),
    list("Customer mismatch (skipped)", rep.mismatch),
    list("Unresolved items (skipped)", rep.unresolved),
    list("Unit doubt", rep.unitDoubt),
    list("Unknown reasons → lainnya", rep.unknownReason),
    list("Derived quantities", rep.derived),
    list("Merged rows", rep.merges),
    list("Rows not merged / second physical reason (skipped)", rep.dropped),
    list("Existing deliveries rows (untouched)", rep.existing),
    list("Collisions (existing line kept)", rep.collisions),
    list("Unknown drivers (driver_name as typed)", rep.unknownDrivers),
    list("Status Kirim other than Terkirim (left at default)", rep.statuses),
    list("Errors", rep.errors),
    "## Lines per faktur\n",
    ...plans.map((p) =>
      `- **${p.faktur}** · ${p.po.buyer_name}${p.po.dc_name ? ` ${p.po.dc_name}` : ""} · ${p.po.outflow_date}` +
      (p.lines.length
        ? "\n" + p.lines.map((l) => `  - ${l.skuCode} · ${l.quantity} ${l.unitLabel} × ${l.piecesPerUnit} · ${l.reason}${l.claimRef ? ` · ${l.claimRef}` : ""}${l.expectedExpiry ? ` · exp ${l.expectedExpiry}` : ""}${l.note ? ` · ${l.note}` : ""}`).join("\n")
        : " · no lines"),
    ),
    "",
  ];
  return out.join("\n");
}

main().catch((e) => die(e?.stack ?? String(e)));
