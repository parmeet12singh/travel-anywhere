import { useState } from "react";
import type { AirlineOnRoute } from "../lib/data";

// Rectangular tiles: most airline logos are wide wordmarks that turn into smudges in a square.
const SIZES = { sm: "h-6 w-14 rounded px-1 py-0.5", md: "h-9 w-20 rounded-md px-1.5 py-1" } as const;

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

/**
 * An airline's logo on a small white tile (logos are designed for white backgrounds, so the tile keeps
 * dark logos readable in the dark theme). Falls back to the airline's initials when there's no logo.
 */
export function AirlineLogo({ airline, logo, size = "md" }: { airline: AirlineOnRoute; logo: string | undefined; size?: keyof typeof SIZES }) {
  const box = `${SIZES[size]} grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-rule`;
  const [failed, setFailed] = useState<string | null>(null); // a logo that didn't load shows initials instead
  if (logo && failed !== logo) {
    return (
      <span className={box}>
        <img src={logo} alt="" loading={size === "md" ? "eager" : "lazy"} decoding="async" width={32} height={32} onError={() => setFailed(logo)} className="h-full min-h-0 w-full min-w-0 object-contain" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${box} font-display text-[11px] font-semibold text-[#5e6a75]`}>
      {initials(airline.airline)}
    </span>
  );
}
