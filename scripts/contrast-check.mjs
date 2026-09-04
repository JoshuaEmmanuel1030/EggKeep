// WCAG AA contrast check for the Activities redesign accents.
// Run: node scripts/contrast-check.mjs
function hslToRgb(h, s, l) { s /= 100; l /= 100; const k = n => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); return [255 * f(0), 255 * f(8), 255 * f(4)]; }
function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function L(rgb) { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function ratio(a, b) { const l1 = L(a), l2 = L(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); }
const T = { 'amber-700': [180,83,9], 'amber-600': [217,119,6], 'amber-400': [251,191,36], 'emerald-700': [4,120,87], 'emerald-600': [5,150,105], 'emerald-400': [52,211,153] };
const bg = { 'card-light': hslToRgb(0,0,100), 'card-dark': hslToRgb(30,12,14), 'page-light': hslToRgb(40,33,97), 'page-dark': hslToRgb(30,15,10), 'muted-light': hslToRgb(40,20,94) };
function row(name, fg, b, min) { const r = ratio(fg, b); console.log(`${name.padEnd(46)} ${r.toFixed(2)}:1  ${r >= min ? 'PASS' : 'FAIL'} (>=${min})`); }
console.log('TEXT (>=4.5)');
row('amber-700 label on card', T['amber-700'], bg['card-light'], 4.5);
row('emerald-700 qty on card', T['emerald-700'], bg['card-light'], 4.5);
row('amber-400 label on dark card', T['amber-400'], bg['card-dark'], 4.5);
row('emerald-400 qty on dark card', T['emerald-400'], bg['card-dark'], 4.5);
console.log('GRAPHICAL (>=3.0)');
row('emerald-600 dot on card', T['emerald-600'], bg['card-light'], 3.0);
row('amber-600 dot on card', T['amber-600'], bg['card-light'], 3.0);
row('amber-600 dot on page', T['amber-600'], bg['page-light'], 3.0);
row('emerald-400 dot on dark card', T['emerald-400'], bg['card-dark'], 3.0);
row('amber-400 dot on dark card', T['amber-400'], bg['card-dark'], 3.0);
