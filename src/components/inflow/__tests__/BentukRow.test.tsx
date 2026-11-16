// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { BentukRow } from "@/components/inflow/BentukRow";
import type { EggForm } from "@/lib/eggForms";

const FORMS: EggForm[] = [
  { id: "iket15kg", name: "Iket 15 kg", size: 15, unit: "kg", unitWord: "iket" },
  { id: "tray30", name: "Tray 30", size: 30, unit: "butir", unitWord: "tray" },
  { id: "curah", name: "Curah", size: 1, unit: "native" },
  { id: "tonase", name: "Tonase", unit: "weighed", unitWord: "satuan" },
];

function setup(overrides: Partial<React.ComponentProps<typeof BentukRow>> = {}) {
  const props = {
    forms: FORMS,
    formId: null as string | null,
    tonaseKg: "",
    nativeUnit: "kg" as const,
    open: false,
    onOpenChange: vi.fn(),
    onChangeForm: vi.fn(),
    onChangeTonase: vi.fn(),
    ...overrides,
  };
  render(
    <LanguageProvider>
      <BentukRow {...props} />
    </LanguageProvider>
  );
  return props;
}

beforeEach(() => localStorage.setItem("js-online-language", "id"));
afterEach(cleanup);

describe("BentukRow", () => {
  it("renders nothing when the product has no forms", () => {
    const { container } = render(
      <LanguageProvider>
        <BentukRow
          forms={[]} formId={null} tonaseKg="" nativeUnit="kg" open={false}
          onOpenChange={vi.fn()} onChangeForm={vi.fn()} onChangeTonase={vi.fn()}
        />
      </LanguageProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Langsung with the native unit when no form is chosen", () => {
    setup();
    expect(screen.getByRole("button", { name: /Langsung \(kg\)/ })).toBeInTheDocument();
  });

  it("shows the chosen form's name and size", () => {
    setup({ formId: "iket15kg" });
    expect(screen.getByRole("button", { name: /Iket 15 kg/ })).toBeInTheDocument();
    expect(screen.getByText(/15 kg per iket/)).toBeInTheDocument();
  });

  it("asks the parent to open the picker when the button is tapped", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Langsung/ }));
    expect(props.onOpenChange).toHaveBeenCalledWith(true);
  });

  it("lists Langsung first, then the catalogue order", () => {
    setup({ open: true });
    // Query inside the picker only: the trigger button also reads "Langsung (kg)",
    // so a document-wide button list would not tell the two apart.
    const picker = screen.getByRole("group", { name: "Bentuk" });
    const options = within(picker).getAllByRole("button").map((b) => b.textContent ?? "");
    const langsung = options.findIndex((t) => t.includes("Langsung"));
    const iket = options.findIndex((t) => t.includes("Iket 15 kg"));
    const tray = options.findIndex((t) => t.includes("Tray 30"));
    expect(langsung).toBe(0);
    expect(langsung).toBeLessThan(iket);
    expect(iket).toBeLessThan(tray);
    // Every configured form, exactly once, in catalogue order, after Langsung.
    expect(options).toHaveLength(FORMS.length + 1);
    expect(options[0]).toContain("Langsung (kg)");
    FORMS.forEach((f, i) => expect(options[i + 1]).toContain(f.name));
  });

  it("reports the picked form and closes the picker", () => {
    const props = setup({ open: true });
    fireEvent.click(screen.getByRole("button", { name: /Tray 30/ }));
    expect(props.onChangeForm).toHaveBeenCalledWith("tray30");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reports null when Langsung is picked", () => {
    const props = setup({ open: true, formId: "tray30" });
    fireEvent.click(screen.getByRole("button", { name: /Langsung/ }));
    expect(props.onChangeForm).toHaveBeenCalledWith(null);
  });

  it("shows no weight control unless the form is weighed", () => {
    setup({ formId: "tray30" });
    expect(screen.queryByLabelText(/Berat per satuan/)).not.toBeInTheDocument();
  });

  it("shows the weight control for Tonase", () => {
    setup({ formId: "tonase", tonaseKg: "16,8" });
    expect(screen.getByLabelText(/Berat per satuan/)).toHaveValue("16,8");
  });

  it("steps the weight by 0,1 kg", () => {
    const props = setup({ formId: "tonase", tonaseKg: "16,8" });
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    expect(props.onChangeTonase).toHaveBeenCalledWith("16,9");
    fireEvent.click(screen.getByRole("button", { name: /−|-/ }));
    expect(props.onChangeTonase).toHaveBeenCalledWith("16,7");
  });

  it("starts stepping from the range floor when the weight is empty", () => {
    const props = setup({ formId: "tonase", tonaseKg: "" });
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    expect(props.onChangeTonase).toHaveBeenCalledWith("5");
  });

  it("does not step past the range", () => {
    const props = setup({ formId: "tonase", tonaseKg: "30" });
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    expect(props.onChangeTonase).toHaveBeenCalledWith("30");
  });

  it("restores the last valid weight when given something out of range", () => {
    const props = setup({ formId: "tonase", tonaseKg: "16,8" });
    const field = screen.getByLabelText(/Berat per satuan/);
    fireEvent.change(field, { target: { value: "168" } });
    fireEvent.blur(field);
    expect(props.onChangeTonase).toHaveBeenLastCalledWith("16,8");
  });

  it("keeps a valid typed weight on blur", () => {
    const props = setup({ formId: "tonase", tonaseKg: "16,8" });
    const field = screen.getByLabelText(/Berat per satuan/);
    fireEvent.change(field, { target: { value: "17,25" } });
    fireEvent.blur(field);
    expect(props.onChangeTonase).toHaveBeenLastCalledWith("17,25");
  });
});
