// Pure rules for the one-time import of October's sheet rows ("Log Pengiriman &
// Retur", main tab) into deliveries / delivery_lines. No I/O; the CLI is
// scripts/import-sheet-lines.mjs.
// Spec: docs/superpowers/specs/2026-11-02-delivery-return-log-phase2-design.md
//   §4.3 reasons + sheet strings, §4.4 sheet code → SKU code and the base-pack
//   rule, §6.2.1 delivery_lines, §6.9 import steps 1–9.

// Same normalisation as deliveries.invoice_ref_norm (src/lib/deliveryFlags.ts).
export const normalizeInvoiceRef = (ref) => String(ref ?? "").trim().toUpperCase();

// §4.4: sheet "Item" (spaces and case ignored) → candidate pack_skus.code. Where a
// code has several candidates the PO's own PO lines decide (resolveSkuCode).
export const SHEET_CODE_CANDIDATES = {
  N10: ["OSVN10B", "N10B"],
  NO10: ["OSVN10O", "N10O"],
  KPO6: ["OSVKP6O"],
  N30: ["N30B", "N30O"],
  N15: ["N15B", "N15O"],
  N6: ["N6B"],
  NO6: ["N6O"],
  N4: ["N4"],
  AMTG: ["BK4AMTG"],
  P25: ["P25"],
  KP6: ["KP6B", "KP6O"],
  KP10: ["KP10B", "KP10O"],
};

export const normalizeSheetCode = (code) => String(code ?? "").replace(/\s+/g, "").toUpperCase();

export function resolveSkuCode(sheetCode, poLineCodes) {
  const candidates = SHEET_CODE_CANDIDATES[normalizeSheetCode(sheetCode)];
  if (!candidates) return { code: null, reason: `unknown sheet code "${sheetCode}"` };
  const onPo = candidates.filter((c) => poLineCodes.includes(c));
  if (onPo.length === 1) return { code: onPo[0], reason: null };
  if (onPo.length === 0) return { code: null, reason: `none of ${candidates.join("/")} on the PO` };
  return { code: null, reason: `several candidates on the PO: ${onPo.join("/")}` };
}

// §4.3. Mirrors NO_PHYSICAL_RETURN in src/lib/deliveryFlags.ts and the partial
// unique index delivery_lines_physical_key.
export const NO_PHYSICAL_RETURN = new Set(["kurang", "lebih", "revisi_po", "cancel", "masih_ditanyakan"]);
export const isPhysicalReason = (reason) => !NO_PHYSICAL_RETURN.has(reason);

const REASON_BY_SHEET_TEXT = {
  pecah: "pecah",
  rusak: "rusak",
  ditolak: "ditolak",
  expired: "expired",
  "tukar guling": "tukar_guling",
  kurang: "kurang",
  lebih: "lebih",
  "revisi po": "revisi_po",
  cancel: "cancel",
  "masih ditanyakan": "masih_ditanyakan",
};

// Unknown (or blank) text → lainnya; the caller keeps the original text in the note.
export function mapReason(text) {
  const key = String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const reason = REASON_BY_SHEET_TEXT[key];
  return reason ? { reason, unknown: false } : { reason: "lainnya", unknown: true };
}

// Box-mode SKU = the three Osave box rows: box_mode + base_pack_code. Their own
// eggs_per_pack (1) and egg_product (empty) are placeholders and never read.
export const isBoxModeSku = (sku) => !!(sku?.box_mode && sku?.base_pack_code);

// §4.4 base-pack rule. pak → base pack's eggs_per_pack (or the SKU's own when it has
// no base); box → base × capacity when box_mode + capacity exist, else own eggs_per_pack.
export function piecesPerUnit(sku, unit, skusByCode, boxCaps) {
  if (!sku) return null;
  const base = sku.base_pack_code ? skusByCode.get(sku.base_pack_code) : null;
  if (isBoxModeSku(sku) && !base) return null;
  const basePieces = base ? base.eggs_per_pack : sku.eggs_per_pack;
  if (unit === "pak") return basePieces > 0 ? basePieces : null;
  const capacity = sku.box_mode && sku.base_pack_code ? boxCaps[sku.box_mode]?.[sku.base_pack_code] : null;
  if (capacity) return basePieces > 0 ? basePieces * capacity : null;
  if (isBoxModeSku(sku)) return null; // never fall back to the placeholder eggs_per_pack
  return sku.eggs_per_pack > 0 ? sku.eggs_per_pack : null;
}

// §6.9 step 3, box-mode SKUs only. OK + Pecah not filled (or no Qty Retur) → box, no doubt.
export function resolveUnit({ qtyRetur, ok, pecah, basePieces, boxPieces }) {
  if ((ok == null && pecah == null) || !qtyRetur) return { unit: "box", unitDoubt: false };
  const pieces = (ok ?? 0) + (pecah ?? 0);
  if (pieces === qtyRetur * basePieces) return { unit: "pak", unitDoubt: false };
  if (pieces === qtyRetur * boxPieces) return { unit: "box", unitDoubt: false };
  return { unit: "box", unitDoubt: true };
}

// §6.9 step 5. Qty Retur as typed; blank on a non-physical reason → |PO packQty −
// Qty Diterima| (abs: Lebih receives more than the faktur); otherwise 0.
export function derivedQuantity({ qtyRetur, qtyDiterima, poPackQty, reason }) {
  if (qtyRetur != null) return { quantity: qtyRetur, derived: false };
  if (!isPhysicalReason(reason) && qtyDiterima != null && poPackQty != null) {
    return { quantity: Math.abs(poPackQty - qtyDiterima), derived: true };
  }
  return { quantity: 0, derived: false };
}

const pad = (n) => String(n).padStart(2, "0");

// exceljs gives date cells as Date (UTC midnight); typed text as dd/mm/yyyy.
export function toIsoDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

export const formatDmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

export function toNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!/^\d+([.,]\d+)?$/.test(s)) return null;
  return Number(s.replace(",", "."));
}

// §6.9 step 7. Parts are the sheet's Catatan and any extra flags (unknown reason
// text, unit doubt, status text); then the warehouse figures when any is filled.
export function composeNote({ catatan, ok, pecah, balik, extra = [] }) {
  const parts = [String(catatan ?? "").trim(), ...extra].filter(Boolean);
  const sheet = [
    ok != null ? `OK ${ok}` : null,
    pecah != null ? `Pecah ${pecah}` : null,
    balik ? `balik ${formatDmy(balik)}` : null,
  ].filter(Boolean);
  if (sheet.length) parts.push(`Sheet: ${sheet.join(" · ")}`);
  return parts.length ? parts.join(" | ") : null;
}

// §6.9 step 6. Same (faktur, SKU, reason, unit) → one line, quantities summed,
// notes joined. Then at most one physical-return line per (faktur, SKU): keep the first.
export function mergeLines(lines) {
  const byKey = new Map();
  const merges = [];
  const dropped = [];
  for (const line of lines) {
    const key = `${line.faktur}|${line.skuCode}|${line.reason}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...line, sheetRows: [...(line.sheetRows ?? [])] });
      continue;
    }
    if (prev.unitLabel !== line.unitLabel || prev.piecesPerUnit !== line.piecesPerUnit) {
      dropped.push({ line, why: `same SKU and reason as row(s) ${prev.sheetRows.join(", ")} but a different unit` });
      continue;
    }
    prev.quantity += line.quantity;
    prev.note = [prev.note, line.note].filter(Boolean).join(" | ") || null;
    prev.claimRef = prev.claimRef || line.claimRef;
    prev.expectedExpiry = prev.expectedExpiry || line.expectedExpiry;
    prev.sheetRows.push(...(line.sheetRows ?? []));
    merges.push({ faktur: line.faktur, skuCode: line.skuCode, reason: line.reason, rows: [...prev.sheetRows], quantity: prev.quantity });
  }
  const physical = new Map();
  const out = [];
  for (const line of byKey.values()) {
    if (isPhysicalReason(line.reason)) {
      const k = `${line.faktur}|${line.skuCode}`;
      const first = physical.get(k);
      if (first) {
        dropped.push({ line, why: `second physical reason on ${line.skuCode} (kept ${first.reason})` });
        continue;
      }
      physical.set(k, line);
    }
    out.push(line);
  }
  return { lines: out, merges, dropped };
}

// §6.9 step 1. First word of the sheet's Customer → EggKeep buyer; others by
// name, case- and space-insensitive.
const BUYER_BY_FIRST_WORD = { osv: "Osave", familymart: "Family Mart", sushitoku: "SUSHI TOKU", circle: "CircleK" };
const squash = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

export function customerMatchesBuyer(customer, buyerName) {
  const first = String(customer ?? "").trim().split(/\s+/)[0] ?? "";
  const expected = BUYER_BY_FIRST_WORD[first.toLowerCase()] ?? first;
  return !!first && squash(expected) === squash(buyerName);
}

// TST (incl. "TST Sayurbox"), bu linda, Cash / Tunai: not buyer POs.
export function isNonPoCustomer(customer) {
  const c = String(customer ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return /^(tst\b|bu linda\b|cash\b|tunai\b)/.test(c);
}

// §6.9 steps 2–5 and 7 for one sheet item row against its matched PO.
// row: { sheetRow, faktur, item, qtyDiterima, qtyRetur, alasan, catatan, tglBalik,
//        tglExpired, ok, pecah, noRetur } (numbers / ISO dates already parsed).
// poLines: purchase_orders.order_lines. Returns { line, flags } or { error }.
export function buildSheetLine({ row, poLines, skusByCode, boxCaps, extraNote = [] }) {
  const poLineCodes = poLines.filter((l) => l.skuCode).map((l) => l.skuCode);
  const { code, reason: unresolved } = resolveSkuCode(row.item, poLineCodes);
  if (!code) return { error: unresolved };
  const sku = skusByCode.get(code);
  if (!sku) return { error: `${code} is not in pack_skus` };

  const { reason, unknown } = mapReason(row.alasan);
  const poPackQty = poLines.filter((l) => l.skuCode === code).reduce((s, l) => s + (Number(l.packQty) || 0), 0);
  const { quantity, derived } = derivedQuantity({ qtyRetur: row.qtyRetur, qtyDiterima: row.qtyDiterima, poPackQty, reason });

  let unit = sku.unit_label === "box" ? "box" : "pak";
  let unitDoubt = false;
  if (isBoxModeSku(sku)) {
    ({ unit, unitDoubt } = resolveUnit({
      qtyRetur: row.qtyRetur,
      ok: row.ok,
      pecah: row.pecah,
      basePieces: piecesPerUnit(sku, "pak", skusByCode, boxCaps),
      boxPieces: piecesPerUnit(sku, "box", skusByCode, boxCaps),
    }));
  }
  const pieces = piecesPerUnit(sku, unit, skusByCode, boxCaps);
  if (!pieces) return { error: `no pieces per ${unit} for ${code} (base pack / box capacity missing)` };

  const extra = [unknown ? String(row.alasan ?? "").trim() || "(alasan kosong)" : null, unitDoubt ? "Satuan ragu: box atau pak?" : null, ...extraNote];
  return {
    line: {
      faktur: row.faktur,
      skuCode: code,
      reason,
      unitLabel: unit,
      piecesPerUnit: pieces,
      quantity,
      note: composeNote({ catatan: row.catatan, ok: row.ok, pecah: row.pecah, balik: row.tglBalik, extra: extra.filter(Boolean) }),
      claimRef: String(row.noRetur ?? "").trim() || null,
      expectedExpiry: row.tglExpired ?? null,
      sheetRows: [row.sheetRow],
    },
    flags: { unknownReason: unknown, unitDoubt, derived, poPackQty },
  };
}
