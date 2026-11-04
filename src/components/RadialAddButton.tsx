// The round + trigger behind Tambah Baris / Tambah telur on the tablet Pesanan,
// with a one-gesture radial quick-add: press, drag toward an item, release.
// A plain tap (or Enter / Space) still calls onTap. The ring is portalled over
// the whole viewport, aria-hidden and pointer-events:none; geometry and timing
// live in src/lib/radial.ts, the look in src/index.css (.ek-rad-*).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ABSORB_MS,
  CLOSE_MS,
  HOLD_MS,
  MOVE_TOL,
  SUPPRESS_MS,
  clampCentre,
  highlightIndex,
  itemOffset,
  makeBubbles,
  pointerDotOffset,
  ringRadius,
  type Bubble,
} from "@/lib/radial";

export interface RadialItem {
  key: string;
  label: string;
  sub?: string;
  pinned?: boolean;
}

export interface RadialBanner {
  text: string;
  muted?: string;
}

export interface RadialAddButtonProps {
  caption: string; // visible caption under the circle; it is the button's accessible name
  items: RadialItem[]; // clockwise from the top; [] => press/hold acts as a tap
  banner?: RadialBanner;
  centerVerb: string; // t.radial.add
  onTap: () => void; // click, keyboard, or a short tap
  onPick: (item: RadialItem) => void;
  className?: string;
}

interface Ring {
  key: number;
  items: RadialItem[];
  banner?: RadialBanner;
  cx: number;
  cy: number;
  R: number;
  tx: number; // trigger centre relative to the ring centre (the close target)
  ty: number;
  bubbles: Bubble[];
}

// pending: pressed, not yet open · open: ring up · held: Esc closed the ring
// but the pointer is still down (its release must not become a tap).
type Phase = "idle" | "pending" | "open" | "held";

const vars = (v: Record<string, string>) => v as CSSProperties;

export function RadialAddButton({ caption, items, banner, centerVerb, onTap, onPick, className }: RadialAddButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  // Window listeners outlive a render; they read the latest props from here.
  const latest = useRef({ items, banner, onPick });
  latest.current = { items, banner, onPick };
  // Mutable gesture session (no re-render per pointermove).
  const s = useRef({
    phase: "idle" as Phase,
    id: 0, // pointerId
    x: 0, // press point (viewport px)
    y: 0,
    items: [] as RadialItem[], // snapshot at open, so indexes stay stable
    R: 0,
    hi: -1,
    lastHi: 0, // last highlighted index: the wedge fades out where it was
    key: 0,
    holdTimer: 0,
    closeTimer: 0,
    absorbTimer: 0,
    suppressTimer: 0,
    detach: null as null | (() => void), // gesture listeners
    unsuppress: null as null | (() => void), // trailing-click swallower
  });
  const [ring, setRing] = useState<Ring | null>(null);
  const [show, setShow] = useState(false);
  const [out, setOut] = useState(false);
  const [hi, setHi] = useState(-1);

  // Flush the ring's initial (collapsed) styles, then add the open class, so
  // the explode transitions actually run on a fresh mount.
  const ringKey = ring?.key;
  useLayoutEffect(() => {
    if (ringKey === undefined) return;
    ringRef.current?.getBoundingClientRect();
    setShow(true);
  }, [ringKey]);

  // Unmount: no listener, timer or root class left behind.
  useEffect(() => {
    const st = s.current;
    return () => {
      st.detach?.();
      st.unsuppress?.();
      [st.holdTimer, st.closeTimer, st.absorbTimer, st.suppressTimer].forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const st = s.current;

  const endSuppress = () => {
    window.clearTimeout(st.suppressTimer);
    st.unsuppress?.();
    st.unsuppress = null;
  };

  // After a ring session the browser still dispatches a click, on the trigger
  // or on whatever ancestor is common to press and release. Swallow it at the
  // document, in capture, so cancelling never adds a row. Any new press ends
  // the window: a touch drag sends no trailing click, so the next tap is real.
  const startSuppress = () => {
    endSuppress();
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      endSuppress();
    };
    document.addEventListener("click", swallow, true);
    document.addEventListener("pointerdown", endSuppress, true);
    st.unsuppress = () => {
      document.removeEventListener("click", swallow, true);
      document.removeEventListener("pointerdown", endSuppress, true);
    };
    st.suppressTimer = window.setTimeout(endSuppress, SUPPRESS_MS);
  };

  const end = () => {
    window.clearTimeout(st.holdTimer);
    btnRef.current?.removeAttribute("data-pending");
    st.detach?.();
    st.detach = null;
    st.phase = "idle";
  };

  const absorb = () => {
    const b = btnRef.current;
    if (!b) return;
    b.classList.remove("ek-rad-absorb");
    void b.offsetWidth; // restart the animation
    b.classList.add("ek-rad-absorb");
    window.clearTimeout(st.absorbTimer);
    st.absorbTimer = window.setTimeout(() => b.classList.remove("ek-rad-absorb"), ABSORB_MS);
  };

  // Shrink the ring into the trigger, then bounce the trigger.
  const close = () => {
    setOut(true);
    window.clearTimeout(st.closeTimer);
    st.closeTimer = window.setTimeout(() => {
      st.closeTimer = 0;
      setRing(null);
      absorb();
    }, CLOSE_MS + 5);
  };

  const open = () => {
    const list = latest.current.items;
    const b = btnRef.current;
    if (!list.length || !b) return; // stays pending: the release is a tap
    window.clearTimeout(st.holdTimer);
    b.removeAttribute("data-pending");
    // Re-press during the close: drop the closing ring, open a fresh one.
    window.clearTimeout(st.closeTimer);
    st.closeTimer = 0;
    b.classList.remove("ek-rad-absorb");

    const R = ringRadius(list.length);
    const c = clampCentre(st.x, st.y, R, window.innerWidth, window.innerHeight);
    const r = b.getBoundingClientRect();
    st.phase = "open";
    st.items = list;
    st.R = R;
    st.hi = -1;
    st.key += 1;
    setHi(-1);
    setShow(false);
    setOut(false);
    setRing({
      key: st.key,
      items: list,
      banner: latest.current.banner,
      cx: c.x,
      cy: c.y,
      R,
      tx: r.left + r.width / 2 - c.x,
      ty: r.top + r.height / 2 - c.y,
      bubbles: makeBubbles(R),
    });
    try {
      navigator.vibrate?.(10);
    } catch {
      /* no haptics */
    }
  };

  const move = (e: PointerEvent) => {
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    const d = pointerDotOffset(dx, dy, st.R);
    if (dotRef.current) dotRef.current.style.transform = `translate(${d.x}px,${d.y}px)`;
    const h = highlightIndex(dx, dy, st.items.length);
    if (h !== st.hi) {
      st.hi = h;
      if (h >= 0) st.lastHi = h;
      setHi(h);
    }
  };

  // Pointer released (or cancelled) for the session's pointer.
  const release = (cancelled: boolean) => {
    const phase = st.phase;
    const picked = phase === "open" && !cancelled && st.hi >= 0 ? st.items[st.hi] : null;
    end();
    if (phase === "pending") return; // a tap: the native click calls onTap
    if (phase === "open") close();
    startSuppress();
    if (picked) latest.current.onPick(picked);
  };

  const attach = () => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== st.id) return;
      if (st.phase === "pending" && Math.hypot(e.clientX - st.x, e.clientY - st.y) > MOVE_TOL) open();
      if (st.phase === "open") move(e);
    };
    const onUp = (e: PointerEvent) => e.pointerId === st.id && release(false);
    const onCancel = (e: PointerEvent) => e.pointerId === st.id && release(true);
    // Capture on window, ahead of drawers / dialogs that also close on Esc.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || st.phase !== "open") return;
      e.preventDefault();
      e.stopPropagation();
      close();
      st.phase = "held";
    };
    const block = (e: Event) => e.preventDefault(); // no context menu, no page scroll
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("contextmenu", block);
    document.addEventListener("touchmove", block, { passive: false });
    document.documentElement.classList.add("ek-rad-hold");
    st.detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("touchmove", block);
      document.documentElement.classList.remove("ek-rad-hold");
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || e.isPrimary === false) return;
    // A primary pointer can't go down twice: a live session here lost its
    // release (e.g. a mouse let go outside the window). End it, don't get stuck.
    if (st.phase !== "idle") release(true);
    endSuppress();
    if (!latest.current.items.length) return; // no ring: behaves as a tap
    st.phase = "pending";
    st.id = e.pointerId;
    st.x = e.clientX;
    st.y = e.clientY;
    attach();
    e.currentTarget.setAttribute("data-pending", "");
    st.holdTimer = window.setTimeout(open, HOLD_MS);
  };

  const span = ring ? 360 / ring.items.length : 0;
  const active = ring && hi >= 0 ? ring.items[hi] : null;

  return (
    <>
      <button ref={btnRef} type="button" onPointerDown={onPointerDown} onClick={() => onTap()} className={cn("ek-rad-trigger", className)}>
        <Plus aria-hidden />
        <span className="ek-rad-cap">{caption}</span>
      </button>
      {ring &&
        createPortal(
          <div aria-hidden className={cn("ek-rad-ov", show && "ek-rad-show", out && "ek-rad-out")}>
            <div className="ek-rad-dim" />
            <div
              key={ring.key}
              ref={ringRef}
              className="ek-rad"
              style={{ left: ring.cx, top: ring.cy, ...vars({ "--R": `${ring.R}px`, "--tx": `${ring.tx}px`, "--ty": `${ring.ty}px` }) }}
            >
              <div className="ek-rad-wave" />
              <div className="ek-rad-disc" />
              <div
                className="ek-rad-arc"
                style={{ opacity: active ? 1 : 0, ...vars({ "--from": `${st.lastHi * span - span / 2}deg`, "--span": `${span}deg` }) }}
              />
              <div className="ek-rad-div" style={vars({ "--span": `${span}deg` })} />
              {ring.bubbles.map((b, i) => (
                <i
                  key={i}
                  className="ek-rad-bub"
                  style={vars({ "--bx": `${b.x}px`, "--by": `${b.y}px`, "--s": `${b.size}px`, "--c": b.color, "--t": `${b.delay}ms` })}
                />
              ))}
              {ring.items.map((it, i) => {
                const p = itemOffset(i, ring.items.length, ring.R);
                return (
                  <div
                    key={it.key}
                    className={cn("ek-rad-it", it.pinned && "ek-rad-pin", i === hi && "ek-rad-on")}
                    style={vars({ "--x": `${p.x}px`, "--y": `${p.y}px`, "--d": `${i * 12}ms` })}
                  >
                    <b>{it.label}</b>
                    {it.sub && <small>{it.sub}</small>}
                  </div>
                );
              })}
              {ring.banner && (
                <div className="ek-rad-hd">
                  {ring.banner.text}
                  {ring.banner.muted && <span>{ring.banner.muted}</span>}
                </div>
              )}
              <div className={cn("ek-rad-c", active && "ek-rad-act")}>
                {active ? (
                  <>
                    <span className="ek-rad-ct">{centerVerb}</span>
                    <b>{active.label}</b>
                  </>
                ) : (
                  <span className="ek-rad-cx">
                    <X size={24} strokeWidth={2.4} />
                  </span>
                )}
              </div>
              <div ref={dotRef} className="ek-rad-pt" />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
