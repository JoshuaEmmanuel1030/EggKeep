import { describe, it, expect } from "vitest";
import {
  itemToLogRows,
  deliveryLogRowToCells,
  buildDeliveryLogCsv,
  buildClaimCsv,
  claimCsvFilename,
  CLAIM_CSV_HEADERS,
} from "@/lib/deliveryExport";
import { buildDeliveryItems } from "@/lib/deliveryFlags";
import { delivery, po, line, ret, KG } from "./deliveryLines.fixtures";

const REF = { osave: true, "family mart": true };
const cellsOf = (...args: Parameters<typeof buildDeliveryItems>) =>
  itemToLogRows(buildDeliveryItems(...args).items[0]).map(deliveryLogRowToCells);

describe("21-column log, one row per delivery line", () => {
  it("warehouse columns fill on the physical line and stay blank on the Kurang line of the same SKU", () => {
    const rows = cellsOf(
      [po()],
      [delivery()],
      [line({ reason: "pecah" }), line({ reason: "kurang", quantity: 2, note: "kurang 2" })],
      [ret(), ret({ disposition: "retakan", quantity: 11.1 })],
      REF,
      KG
    );
    expect(rows).toHaveLength(2);
    const [kurang, pecah] = rows; // sorted by sku, reason
    expect(pecah[8]).toBe("OSVN10B");
    expect(pecah[9]).toBe("86"); // Qty Diterima = PO packQty for a physical reason
    expect(pecah[10]).toBe("7");
    expect(pecah[11]).toBe("Tidak");
    expect(pecah[12]).toBe("Pecah");
    expect(pecah.slice(14, 21)).toEqual(["20/10/2026", "19/11/2026", "1088", "172", "dila@js.id", "OSV-2610037", ""]);
    expect(kurang[9]).toBe("84"); // 86 - 2
    expect(kurang[12]).toBe("Kurang");
    expect(kurang[13]).toBe("kurang 2");
    expect([kurang[14], kurang[16], kurang[17], kurang[18]]).toEqual(["", "", "", ""]);
  });

  it("Qty Diterima: 787 for Kurang (PO 910, line 123), PO + qty for Lebih, in the line's unit", () => {
    const astro = po({ buyerName: "Astro", orderLines: [{ skuCode: "BK4AMTG", packQty: 910 }] });
    const k = cellsOf([astro], [delivery()], [line({ skuCode: "BK4AMTG", unitLabel: "pak", piecesPerUnit: 4, quantity: 123, reason: "kurang" })], [], {}, {});
    expect(k[0][9]).toBe("787");
    const l = cellsOf([astro], [delivery()], [line({ skuCode: "BK4AMTG", unitLabel: "pak", piecesPerUnit: 4, quantity: 10, reason: "lebih" })], [], {}, {});
    expect(l[0][9]).toBe("920");
    // A box SKU typed in pak: the PO's 86 boxes are 860 pak.
    const egg = { OSVN10B: { eggProduct: "NEGERI BIASA", piecesPerPak: 10, piecesPerBox: 180, basePackCode: "N10B", isBoxMode: true } };
    const p = cellsOf([po()], [delivery()], [line({ unitLabel: "pak", piecesPerUnit: 10, quantity: 55 })], [], {}, {}, egg);
    expect(p[0][9]).toBe("1548");
  });

  it("Full is Ya on a Terkirim faktur with no lines, Tidak with a line of quantity 7", () => {
    expect(cellsOf([po()], [delivery()], [], [], {}, {})[0][11]).toBe("Ya");
    expect(cellsOf([po()], [delivery()], [line()], [], {}, {})[0][11]).toBe("Tidak");
  });

  it("summary row after one blank row: Total selisih kurang = 492 for 2610574 (123 x 4), 0 without Kurang", () => {
    const items = buildDeliveryItems(
      [po({ buyerName: "Astro", orderLines: [{ skuCode: "BK4AMTG", packQty: 910 }] })],
      [delivery()],
      [line({ skuCode: "BK4AMTG", unitLabel: "pak", piecesPerUnit: 4, quantity: 123, reason: "kurang" })]
    ).items;
    const lines = buildDeliveryLogCsv(items, "2026-10-01", "2026-10-31").split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe(Array(21).fill('""').join(";"));
    const summary = lines[3].split(";");
    expect(summary[0]).toBe('"Total selisih kurang (butir)"');
    expect(summary[1]).toBe('"01/10/2026–31/10/2026"');
    expect(summary[10]).toBe('"492"');
    const none = buildDeliveryLogCsv(buildDeliveryItems([po()], [delivery()]).items, "2026-10-01", "2026-10-31").split("\n");
    expect(none[none.length - 1].split(";")[10]).toBe('"0"');
  });
});

describe("claim CSV", () => {
  it("physical lines of flagged buyers only, newest first, ten headers, no summary row", () => {
    const { items } = buildDeliveryItems(
      [
        po({ invoiceRef: "A", outflowDate: "2026-10-19" }),
        po({ invoiceRef: "B", outflowDate: "2026-10-25", buyerName: "Family Mart", dcName: null }),
        po({ invoiceRef: "C", outflowDate: "2026-10-26", buyerName: "Astro" }),
      ],
      [
        delivery({ id: "da", invoiceRef: "A", invoiceRefNorm: "A" }),
        delivery({ id: "db", invoiceRef: "B", invoiceRefNorm: "B", buyerName: "Family Mart" }),
        delivery({ id: "dc", invoiceRef: "C", invoiceRefNorm: "C", buyerName: "Astro" }),
      ],
      [
        line({ deliveryId: "da" }),
        line({ deliveryId: "da", reason: "kurang" }),
        line({ deliveryId: "db", claimRef: "FMI-2610005" }),
        line({ deliveryId: "dc" }),
      ],
      [ret(), ret({ disposition: "retakan", quantity: 11.1 })],
      REF,
      KG
    );
    const rows = buildClaimCsv(items).slice(1).split("\n");
    expect(rows[0]).toBe(CLAIM_CSV_HEADERS.map((h) => `"${h}"`).join(";"));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('"B"');
    expect(rows[1]).toContain('"FMI-2610005"');
    expect(rows[2].split(";")).toEqual([
      '"19/10/2026"', '"A"', '"Osave DPK"', '"OSVN10B"', '"7"', '"Pecah"', '"19/11/2026"', '"172"', '"OSV-2610037"', '""',
    ]);
    expect(claimCsvFilename("2026-10-01", "2026-10-31")).toBe("klaim-retur-2026-10-01_2026-10-31.csv");
  });
});
