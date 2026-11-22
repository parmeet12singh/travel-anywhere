import { useEffect, useState } from "react";
import type { Country } from "../lib/data";
import { asset } from "../lib/asset";

/**
 * The current country's flag in its real layout (4:3 artwork, small rounded rectangle). Not cropped to a circle:
 * that cuts parts of national flags off. Decorative: the name beside it is the label. A thin ring keeps
 * mostly-white flags visible on the pill. If the file can't load, the 2-letter code is shown instead.
 */
export function Flag({ country }: { country: Country }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [country.iso2]);
  if (failed) {
    return (
      <span translate="no" className="grid h-[21px] w-7 place-items-center rounded-[3px] bg-ink font-display text-[11px] font-semibold text-paper">
        {country.iso2}
      </span>
    );
  }
  return (
    <img
      src={asset(`flags/${country.iso2.toLowerCase()}.svg`)}
      alt=""
      width={28}
      height={21}
      onError={() => setFailed(true)}
      className="h-[21px] w-7 shrink-0 rounded-[3px] object-cover ring-1 ring-ink/15 dark:ring-white/25"
    />
  );
}
