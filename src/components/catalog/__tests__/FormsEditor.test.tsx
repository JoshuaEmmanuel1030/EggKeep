// @vitest-environment jsdom
//
// The forms editor renders, and its preview line shows what one unit will book.
// That preview is the whole point of the editor: "butir 150" means nothing to the
// owner until the kilograms it turns into are on screen, next to the rate that did it.
//
// The preview string is built in the component rather than from a locale file, so
// these assertions hold in either language.

import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { FormsEditor, formToRow, type FormRow } from "@/components/catalog/FormsEditor";
import type { EggForm } from "@/lib/eggForms";

const OSAVE: EggForm = { id: "iketanosave", name: "Iketan Osave", unit: "butir", size: 150, unitWord: "iket" };

// `noRate` rather than `eggsPerUnit={undefined}`: an explicit undefined still hits a
// default parameter, so the latter silently tested the 15,5 path instead.
function Harness({ initial, nativeUnit = "kg", eggsPerUnit = 15.5, noRate = false }: {
  initial: EggForm[];
  nativeUnit?: "kg" | "btr";
  eggsPerUnit?: number;
  noRate?: boolean;
}) {
  const [rows, setRows] = useState<FormRow[]>(initial.map(formToRow));
  return (
    <LanguageProvider>
      <FormsEditor
        rows={rows}
        nativeUnit={nativeUnit}
        eggsPerUnit={noRate ? undefined : eggsPerUnit}
        onChange={setRows}
      />
    </LanguageProvider>
  );
}

const sizeBox = () => screen.getByDisplayValue("150") as HTMLInputElement;

// No setupFiles in this repo, so auto-cleanup is not wired up.
afterEach(cleanup);

describe("FormsEditor", () => {
  it("shows what one bundle books, and the rate that produced it", () => {
    render(<Harness initial={[OSAVE]} />);
    // 150 butir at the product's 15,5 per kg.
    expect(screen.getByText("1 iket = 9,68 kg (150 butir ÷ 15,5)")).toBeInTheDocument();
  });

  it("follows the size as it is typed, decimal comma included", () => {
    render(<Harness initial={[OSAVE]} />);
    fireEvent.change(sizeBox(), { target: { value: "300" } });
    expect(screen.getByText("1 iket = 19,35 kg (300 butir ÷ 15,5)")).toBeInTheDocument();
  });

  it("drops the division once the bundle is declared in kg", () => {
    render(<Harness initial={[{ ...OSAVE, unit: "kg", size: 9.25 }]} />);
    // The fix for the Osave tray: a weight per bundle, exact, no rate involved.
    expect(screen.getByText("1 iket = 9,25 kg")).toBeInTheDocument();
    expect(screen.queryByText(/÷/)).not.toBeInTheDocument();
  });

  it("asks for a name before showing any weight", () => {
    render(<Harness initial={[{ ...OSAVE, name: "x" }]} />);
    fireEvent.change(screen.getByDisplayValue("x"), { target: { value: "  " } });
    expect(screen.queryByText(/=/)).not.toBeInTheDocument();
  });

  it("reports a missing eggs-per-kg instead of a wrong weight", () => {
    render(<Harness initial={[OSAVE]} noRate />);
    expect(screen.queryByText(/=/)).not.toBeInTheDocument();
  });

  it("counts a butir bundle in butir on a count-sold product", () => {
    render(<Harness initial={[{ ...OSAVE, name: "Iket 300", size: 300, unitWord: "ikat" }]} nativeUnit="btr" />);
    expect(screen.getByText("1 ikat = 300 butir")).toBeInTheDocument();
  });

  it("adds and removes rows", () => {
    render(<Harness initial={[OSAVE]} />);
    expect(screen.getAllByPlaceholderText(/Iketan Osave|cth\./)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Add form|Tambah bentuk/ }));
    expect(screen.getAllByPlaceholderText(/Iketan Osave|cth\./)).toHaveLength(2);

    // The delete button is labelled with the row's name.
    fireEvent.click(screen.getByRole("button", { name: /Iketan Osave/ }));
    expect(screen.queryByText(/÷/)).not.toBeInTheDocument();
  });

  it("renders nothing breakable when a product has no forms", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByRole("button", { name: /Add form|Tambah bentuk/ })).toBeInTheDocument();
  });
});
