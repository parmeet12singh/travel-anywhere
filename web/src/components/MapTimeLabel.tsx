import type { Airport } from "../lib/data";
import { localTime } from "../lib/time";
import { DayIcon } from "./LocalTime";

// Solid chips so the two ends of the route stand out from the (deliberately quiet) base map:
// the departure city in ink, the destination in its route colour (magenta in India, teal abroad).
const TONES = {
  ink: "bg-ink text-paper",
  airway: "bg-airway text-on-airway",
  ocean: "bg-ocean text-on-airway",
} as const;

/** Route-page map label: city, code, part-of-day icon and local time on a solid chip. */
export function MapTimeLabel({ airport, tone, now }: { airport: Airport; tone: keyof typeof TONES; now: Date }) {
  const { hhmm, period } = localTime(airport.tz, now);
  return (
    <div
      className={`flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1 font-display text-lg/6 font-semibold shadow-md shadow-ink/20 ${TONES[tone]}`}
    >
      <span>
        {airport.label}&nbsp;&nbsp;{airport.iata.length === 3 ? airport.iata : ""}
      </span>
      <span aria-hidden="true" className="h-4 w-px bg-current opacity-40" />
      <DayIcon period={period} className="size-[18px]" />
      <time className="tabular-nums">{hhmm}</time>
    </div>
  );
}
