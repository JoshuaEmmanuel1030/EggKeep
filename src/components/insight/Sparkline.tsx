import { useId } from "react";

interface SparklineProps {
  values: (number | null)[]; // null = no data for that week: left out, never drawn as 0
  width?: number;
  height?: number;
  color: string;
  area?: boolean;
  label?: string;
}

const UP = "#16a34a";
const DOWN = "#dc2626";
const FLAT = "#a89d90";

// trend > 0 is green unless rising is the bad direction (pecah, loss).
export const trendColor = (trend: number | null, risingIsBad = false) => {
  if (!trend) return FLAT;
  return trend > 0 !== risingIsBad ? UP : DOWN;
};

export function Sparkline({ values, width = 64, height = 22, color, area, label }: SparklineProps) {
  const gradient = useId();
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <span className="block" style={{ width, height }} role={label ? "img" : undefined} aria-label={label} />;
  const max = Math.max(...known);
  const min = Math.min(...known);
  const range = max - min || 1;
  const step = width / (known.length - 1);
  const points = known.map((v, i) => [i * step, height - 3 - ((v - min) / range) * (height - 8)]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block overflow-visible" role={label ? "img" : undefined} aria-label={label}>
      {area && (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".22" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${gradient})`} />
        </>
      )}
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {area && <circle cx={lastX - 1.5} cy={lastY} r="2.4" fill={color} />}
    </svg>
  );
}
