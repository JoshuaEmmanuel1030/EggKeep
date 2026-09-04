# Activities redesign — measured contrast (WCAG AA)

Ratios computed from the actual theme tokens in `src/index.css` (sRGB, WCAG 2.x
relative luminance). Targets: **text ≥ 4.5:1**, **graphical/UI accents ≥ 3:1**.

Backgrounds used:
- Light `bg-card` = `#ffffff`, `muted` ≈ `#f2efe9`, page `bg-background` ≈ `#f7f4ee`
- Dark `bg-card` ≈ `#28241f`, page `bg-background` ≈ `#1d1a17`

## Before (failing) → After (passing)

### Text accents (need ≥ 4.5:1)
| Element | Old class | Old ratio (light/card) | New class | New ratio (light) | Dark ratio |
|---|---|---|---|---|---|
| Section labels (amber) | `text-amber-600` | 3.19 ❌ | `text-amber-700 dark:text-amber-400` | 5.02 ✅ | 9.26 ✅ |
| Section labels (emerald) | `text-emerald-600` | 3.77 ❌ | `text-emerald-700 dark:text-emerald-400` | 5.48 ✅ | 8.04 ✅ |
| Quick label (primary) | `text-primary` | 2.33 ❌ | `text-amber-700 dark:text-amber-400` | 5.02 ✅ | 9.26 ✅ |
| Inflow qty / badge | `text-emerald-600` | 3.77 ❌ | `text-emerald-700 dark:text-emerald-400` | 5.48 ✅ | 8.04 ✅ |
| Over-max hint | `text-amber-600` | 3.19 ❌ | `text-amber-700 dark:text-amber-400` | 5.02 ✅ | 9.26 ✅ |
| Summary tile numbers/labels | `text-primary` / `text-*-600` | 2.33–3.77 ❌ | `text-amber-700`/`text-emerald-700` (+`dark:*-400`) | 5.02–5.48 ✅ | 8–9 ✅ |

On `muted` background the new text still passes: amber-700 4.44*, emerald-700 4.85.
(*amber-700 on muted is 4.44 — the labels render on the page/card, not muted, where
they are 5.02; noted for completeness.)

### Graphical accents — node dots, rails, card left-borders (need ≥ 3:1)
| Element | Old class | Old ratio (light/card) | New class | New ratio (light card / page) | Dark ratio |
|---|---|---|---|---|---|
| Node dot emerald | `bg-emerald-500` | 2.54 ❌ | `bg-emerald-600 dark:bg-emerald-400` | 3.77 / 3.56 ✅ | 8.04 ✅ |
| Node dot amber/quick | `bg-primary` / `bg-amber-500` | 2.33 / 2.15 ❌ | `bg-amber-600 dark:bg-amber-400` | 3.19 / 3.01 ✅ | 9.26 ✅ |
| Card left border emerald | `border-l-emerald-500/70` | <2.5 ❌ | `border-l-emerald-600 dark:border-l-emerald-400` | 3.77 ✅ | 8.04 ✅ |
| Card left border amber | `border-l-amber-500/70` | <2.2 ❌ | `border-l-amber-600 dark:border-l-amber-400` | 3.19 ✅ | 9.26 ✅ |
| Summary rail (amber/emerald) | `border-l-*-500` | 2.15–2.54 ❌ | `border-l-*-600 dark:*-400` | 3.01–3.77 ✅ | pass ✅ |
| Return line qty border (emerald) | `border-emerald-500` | 2.54 ❌ | `border-emerald-600 dark:border-emerald-400` | 3.77 ✅ | 8.04 ✅ |

amber-600 graphical on the page background is 3.01 — clears 3:1 but only just; the
node dots additionally carry a `ring-4 ring-background` halo, so their effective
adjacent surface is the card, where the margin is 3.19.

Decorative icons paired with a text label (materials Egg/Package/Box, the Store
and dialog title icons) are not required to meet a ratio under WCAG 1.4.11, but
were bumped to the 600/400 scheme anyway for visual consistency.

Reproduce: `node scripts/contrast-check.mjs` (kept in repo).
