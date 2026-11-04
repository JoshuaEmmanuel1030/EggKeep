// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { RadialAddButton, type RadialItem } from "@/components/RadialAddButton";
import { CLOSE_MS, HOLD_MS, SUPPRESS_MS } from "@/lib/radial";

// 4 items: top, right, bottom, left.
const ITEMS: RadialItem[] = [
  { key: "a", label: "N15" },
  { key: "b", label: "KP10B", pinned: true },
  { key: "c", label: "PY20" },
  { key: "d", label: "B10" },
];

const setup = (items = ITEMS) => {
  const onTap = vi.fn();
  const onPick = vi.fn();
  const view = render(
    <RadialAddButton
      caption="Tambah Baris"
      items={items}
      banner={{ text: "Sering dipesan · OSAVE BKS", muted: "8 minggu terakhir" }}
      centerVerb="Tambah"
      onTap={onTap}
      onPick={onPick}
    />
  );
  return { onTap, onPick, btn: screen.getByRole("button", { name: "Tambah Baris" }), ...view };
};

const ptr = (x: number, y: number) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
const ring = () => document.querySelector(".ek-rad");
const hold = () => act(() => void vi.advanceTimersByTime(HOLD_MS));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RadialAddButton", () => {
  it("a short tap calls onTap once and opens nothing", () => {
    const { onTap, onPick, btn } = setup();
    fireEvent.pointerDown(btn, ptr(500, 400));
    fireEvent.pointerUp(window, ptr(500, 400));
    fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    expect(ring()).toBeNull();
  });

  it("press + drag toward an item + release picks it, and the trailing click adds nothing", () => {
    const { onTap, onPick, btn } = setup();
    fireEvent.pointerDown(btn, ptr(500, 400));
    fireEvent.pointerMove(window, ptr(570, 400)); // > 8 px: opens; 70 px to the right
    expect(ring()).not.toBeNull();
    expect(document.querySelector(".ek-rad-on")).toHaveTextContent("KP10B");
    expect(document.querySelector(".ek-rad-c")).toHaveTextContent("TambahKP10B");
    expect(document.querySelector(".ek-rad-hd")).toHaveTextContent("Sering dipesan · OSAVE BKS8 minggu terakhir");
    expect(document.documentElement).toHaveClass("ek-rad-hold");

    fireEvent.pointerUp(window, ptr(570, 400));
    fireEvent.click(btn);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(ITEMS[1]);
    expect(onTap).not.toHaveBeenCalled();
    expect(document.documentElement).not.toHaveClass("ek-rad-hold");

    // Shrinks out, then the trigger bounces.
    act(() => void vi.advanceTimersByTime(CLOSE_MS + 10));
    expect(ring()).toBeNull();
    expect(btn).toHaveClass("ek-rad-absorb");
  });

  it("opens on a 90 ms hold; releasing in the dead zone cancels and swallows the click", () => {
    const { onTap, onPick, btn } = setup();
    fireEvent.pointerDown(btn, ptr(500, 400));
    expect(ring()).toBeNull();
    hold();
    expect(ring()).not.toBeNull();
    fireEvent.pointerMove(window, ptr(520, 410)); // ~22 px: still the dead zone
    expect(document.querySelector(".ek-rad-on")).toBeNull();
    fireEvent.pointerUp(window, ptr(520, 410));
    fireEvent.click(btn);
    expect(onPick).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();

    // Only the one trailing click is swallowed.
    fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("swallows a trailing click that lands on a common ancestor, only within the window", () => {
    const { onTap, btn } = setup();
    const bodyClick = vi.fn();
    document.body.addEventListener("click", bodyClick);
    fireEvent.pointerDown(btn, ptr(500, 400));
    hold();
    fireEvent.pointerUp(window, ptr(800, 600));
    fireEvent.click(document.body);
    expect(bodyClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(btn, ptr(500, 400));
    hold();
    fireEvent.pointerUp(window, ptr(500, 400));
    act(() => void vi.advanceTimersByTime(SUPPRESS_MS));
    fireEvent.click(btn); // too late to be the trailing click
    expect(onTap).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("click", bodyClick);
  });

  it("any new press ends the window: a touch pick sends no trailing click, so the next tap is real", () => {
    const { onPick, btn } = setup();
    const other = vi.fn();
    const otherBtn = document.createElement("button");
    otherBtn.addEventListener("click", other);
    document.body.appendChild(otherBtn);
    fireEvent.pointerDown(btn, ptr(500, 400));
    fireEvent.pointerMove(window, ptr(570, 400));
    fireEvent.pointerUp(window, ptr(570, 400)); // touch drag: no click follows
    expect(onPick).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(100)); // still inside SUPPRESS_MS
    fireEvent.pointerDown(otherBtn, ptr(10, 10));
    fireEvent.pointerUp(otherBtn, ptr(10, 10));
    fireEvent.click(otherBtn);
    expect(other).toHaveBeenCalledTimes(1);
    otherBtn.remove();
  });

  it("the wedge fades out on the item it was on, not the last item's sector", () => {
    const { btn } = setup();
    fireEvent.pointerDown(btn, ptr(500, 400));
    fireEvent.pointerMove(window, ptr(570, 400)); // item 1 (right), span 90
    const arc = document.querySelector(".ek-rad-arc") as HTMLElement;
    expect(arc.style.getPropertyValue("--from")).toBe("45deg");
    fireEvent.pointerMove(window, ptr(505, 400)); // back into the dead zone
    expect(arc.style.opacity).toBe("0");
    expect(arc.style.getPropertyValue("--from")).toBe("45deg");
    fireEvent.pointerCancel(window, ptr(505, 400));
  });

  it("measures the dead zone from the press point when the ring is clamped off an edge", () => {
    const { onPick, btn } = setup();
    fireEvent.pointerDown(btn, ptr(5, 5));
    hold();
    const el = ring() as HTMLElement;
    expect(el.style.left).toBe("168px"); // pad R + 56
    expect(el.style.top).toBe("168px");
    fireEvent.pointerMove(window, ptr(5, 35)); // 30 px from the press, far from the centre
    expect(document.querySelector(".ek-rad-on")).toBeNull();
    fireEvent.pointerUp(window, ptr(5, 35));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Esc cancels: no pick on release, no tap from the click", () => {
    const { onTap, onPick, btn } = setup();
    fireEvent.pointerDown(btn, ptr(500, 400));
    fireEvent.pointerMove(window, ptr(500, 330));
    expect(document.querySelector(".ek-rad-on")).toHaveTextContent("N15");
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => void vi.advanceTimersByTime(SUPPRESS_MS + 50)); // a slow release after Esc
    fireEvent.pointerUp(window, ptr(500, 330));
    fireEvent.click(btn);
    expect(onPick).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it("pointercancel closes without picking", () => {
    const { onPick, btn } = setup();
    fireEvent.pointerDown(btn, ptr(500, 400));
    fireEvent.pointerMove(window, ptr(500, 330));
    fireEvent.pointerCancel(window, ptr(500, 330));
    expect(onPick).not.toHaveBeenCalled();
    expect(document.querySelector(".ek-rad-out")).not.toBeNull();
  });

  it("with no items a press, hold or drag acts as a plain tap", () => {
    const { onTap, onPick, btn } = setup([]);
    fireEvent.pointerDown(btn, ptr(500, 400));
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.pointerMove(window, ptr(600, 400));
    fireEvent.pointerUp(window, ptr(600, 400));
    fireEvent.click(btn);
    expect(ring()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("Enter / Space (a keyboard click) still taps", () => {
    const { onTap, btn } = setup();
    fireEvent.click(btn, { detail: 0 });
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("unmounting mid-gesture leaves no ring, root class or listener behind", () => {
    const { onPick, btn, unmount } = setup();
    fireEvent.pointerDown(btn, ptr(500, 400));
    fireEvent.pointerMove(window, ptr(570, 400));
    unmount();
    expect(ring()).toBeNull();
    expect(document.documentElement).not.toHaveClass("ek-rad-hold");
    fireEvent.pointerUp(window, ptr(570, 400));
    act(() => void vi.advanceTimersByTime(1000));
    expect(onPick).not.toHaveBeenCalled();
  });
});
