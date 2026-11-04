// Pure geometry + timing behind the radial quick-add (RadialAddButton):
// press the + trigger, drag toward an item, release to pick it. Values are the
// design handoff's (docs/superpowers/specs/design_handoff_radial_outflow).
// No React / DOM, so it stays unit-tested.

export const HOLD_MS = 90; // a press held this long opens the ring...
export const MOVE_TOL = 8; // ...or one that moves more than this (px)
export const DEAD_ZONE = 40; // release within this radius of the press point = cancel
export const SUPPRESS_MS = 350; // swallow the click that trails a ring session
export const CLOSE_MS = 180; // shrink-into-the-trigger animation
export const ABSORB_MS = 420; // trigger bounce after the close
export const FLASH_MS = 1200; // new-row highlight

// Put on the row a pick just added (and remove it after FLASH_MS): a #fdf0dc
// background fading over 1.2 s. Styled in src/index.css.
export const RADIAL_FLASH_CLASS = "ek-rad-new";

export const BUBBLE_COLORS = ["#fbbf24", "#f59e0b", "#fde68a", "#fdf0dc", "#d97706"];
const BUBBLE_COUNT = 14;

export interface Point {
  x: number;
  y: number;
}

export interface Bubble extends Point {
  size: number;
  color: string;
  delay: number; // ms
}

// Item ring radius. The disc is R + 52 (CSS), the screen clamp pad R + 56.
export const ringRadius = (n: number): number => (n <= 7 ? 112 : 128);

// The ring opens on the press point, pulled in so the whole disc stays on
// screen. A viewport too small for the disc centres it instead.
export function clampCentre(x: number, y: number, R: number, width: number, height: number): Point {
  const pad = R + 56;
  const clamp = (v: number, max: number) => (max <= 2 * pad ? max / 2 : Math.min(Math.max(v, pad), max - pad));
  return { x: clamp(x, width), y: clamp(y, height) };
}

// Item i sits at -90° + i·360/n: item 0 at the top, then clockwise (screen y
// grows downward).
export function itemOffset(i: number, n: number, R: number): Point {
  const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
  return { x: Math.cos(a) * R, y: Math.sin(a) * R };
}

// Highlighted item for a pointer at (dx, dy) from the ORIGINAL PRESS POINT,
// not the (possibly clamped) ring centre, so a ring pulled away from a screen
// edge never pre-selects and releasing without dragging always cancels.
// -1 = nothing (inside the dead zone, or no items).
export function highlightIndex(dx: number, dy: number, n: number): number {
  if (n <= 0 || Math.hypot(dx, dy) <= DEAD_ZONE) return -1;
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
  return Math.round(angle / (360 / n)) % n;
}

// The pointer dot follows the drag from the ring centre, held inside R + 40.
export function pointerDotOffset(dx: number, dy: number, R: number): Point {
  const d = Math.hypot(dx, dy);
  const f = d ? Math.min(d, R + 40) / d : 0;
  return { x: dx * f, y: dy * f };
}

// The open "sparkle": 14 dots drifting out to 0.75–1.5 R, 4–11 px, each with
// up to 90 ms delay. Generated once per open; `random` is injectable for tests.
export function makeBubbles(R: number, random: () => number = Math.random): Bubble[] {
  return Array.from({ length: BUBBLE_COUNT }, (_, i) => {
    const a = (i / BUBBLE_COUNT) * Math.PI * 2 + random() * 0.4;
    const d = R * (0.75 + random() * 0.75);
    const size = 4 + random() * 7;
    const delay = random() * 90;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, size, color: BUBBLE_COLORS[i % BUBBLE_COLORS.length], delay };
  });
}
