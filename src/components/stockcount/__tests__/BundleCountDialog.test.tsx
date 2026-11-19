// @vitest-environment jsdom
//
// The bundle tally renders, sums, and hands one number back. The totals asserted
// here are built in the component, not from a locale file, so they hold in either
// language.

import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { BundleCountDialog } from "@/components/stockcount/BundleCountDialog";
import type { EggForm } from "@/lib/eggForms";

const IKET15: EggForm = { id: "iket15kg", name: "Iket 15 kg", unit: "kg", size: 15, unitWord: "iket" };
const CURAH: EggForm = { id: "curah", name: "Curah", unit: "native", size: 1 };
const TONASE: EggForm = { id: "tonase", name: "Tonase", unit: "weighed", unitWord: "satuan" };
const OSAVE: EggForm = { id: "iketanosave", name: "Iketan Osave", unit: "butir", size: 150, unitWord: "iket" };

const FORMS = [IKET15, OSAVE, CURAH, TONASE];

function setup(onApply = vi.fn()) {
  render(
    <LanguageProvider>
      <BundleCountDialog
        open
        onOpenChange={() => {}}
        productName="NEGERI BIASA"
        forms={FORMS}
        nativeUnit="kg"
        eggsPerUnit={15.5}
        location="js_warehouse"
        onApply={onApply}
      />
    </LanguageProvider>
  );
  return onApply;
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const applyButton = () => screen.getByRole("button", { name: /Put into|Masukkan ke/ });

afterEach(cleanup);

describe("BundleCountDialog", () => {
  it("offers every countable bundle but not the weighed one", () => {
    setup();
    expect(screen.getByLabelText("Iket 15 kg")).toBeInTheDocument();
    expect(screen.getByLabelText("Iketan Osave")).toBeInTheDocument();
    expect(screen.getByLabelText("Curah")).toBeInTheDocument();
    // Tonase has no fixed bundle size, so it cannot be counted on a shelf.
    expect(screen.queryByLabelText("Tonase")).not.toBeInTheDocument();
  });

  it("sums bundles of different kinds into the native unit", () => {
    setup();
    type("Iket 15 kg", "3");      // 45 kg exactly
    type("Iketan Osave", "5");    // 750 butir / 15,5 = 48,39
    type("Curah", "12,5");        // as typed
    // 45 + 48,39 + 12,5 = 105,89
    expect(screen.getByText("105,89 kg")).toBeInTheDocument();
  });

  it("hands the total back for the chosen location", () => {
    const onApply = setup();
    type("Iket 15 kg", "4");
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith("js_warehouse", 60);
  });

  it("writes to the location picked in the dialog, not the one it opened on", () => {
    const onApply = setup();
    type("Iket 15 kg", "2");
    fireEvent.click(screen.getByRole("button", { name: /^(Muat|Load)$/ }));
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith("loaded", 30);
  });

  // Applying 0 would read as "counted, and there is none", which shows up as a
  // full-stock variance. Nothing counted must mean nothing written.
  it("cannot apply until something is counted", () => {
    const onApply = setup();
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(onApply).not.toHaveBeenCalled();

    type("Iket 15 kg", "1");
    expect(applyButton()).toBeEnabled();
  });

  it("takes a bundle count as a whole number and ignores a stray decimal", () => {
    setup();
    // parseQtyInput in butir mode: integers only, so "2,5 iket" does not count.
    type("Iketan Osave", "2,5");
    expect(screen.getByText("0 kg")).toBeInTheDocument();
  });
});
