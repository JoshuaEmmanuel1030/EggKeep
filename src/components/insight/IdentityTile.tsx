import type { ReactNode } from "react";
import { initials } from "@/lib/insight";

export const PO_HUE = 62;
export const CASH_HUE = 160;

interface IdentityTileProps {
  name: string;
  hue: number;
  round?: boolean; // Kas Tunai: circle. PO and supplier: rounded square.
  large?: boolean;
  icon?: ReactNode;
}

// Shape and colour are the only source indicator on a row: no "PO" / "Kas Tunai" text.
export function IdentityTile({ name, hue, round, large, icon }: IdentityTileProps) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-display font-semibold tracking-[0.02em] ${
        large ? "h-14 w-14 text-[19px]" : "h-10 w-10 text-sm"
      } ${round ? "rounded-full" : large ? "rounded-[15px]" : "rounded-[11px]"}`}
      style={{
        color: `oklch(.4 .1 ${hue})`,
        background: `linear-gradient(150deg, oklch(.96 .04 ${hue}), oklch(.88 .08 ${hue}))`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,.7), inset 0 -1px 0 oklch(.82 .07 ${hue} / .5), 0 1px 2px rgba(42,38,34,.08)`,
      }}
    >
      {icon ?? initials(name)}
    </span>
  );
}
