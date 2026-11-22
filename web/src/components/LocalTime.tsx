import type { Airport } from "../lib/data";
import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import type { DayPeriod } from "../lib/time";
import { localTime, utcOffset } from "../lib/time";

const LABELS: Record<DayPeriod, string> = { morning: "Morning", afternoon: "Afternoon", sunset: "Sunset", night: "Night" };

/**
 * Part-of-day icons. Afternoon and night are Heroicons (sun, moon). Heroicons has no sunrise/sunset, so those two
 * are drawn in the same style: 24px grid, 1.5px stroke, round caps and joins.
 */
export function DayIcon({ period, className = "size-5" }: { period: DayPeriod; className?: string }) {
  const cls = `${className} shrink-0`;
  if (period === "afternoon") return <SunIcon aria-hidden="true" className={cls} />;
  if (period === "night") return <MoonIcon aria-hidden="true" className={cls} />;
  const rising = period === "morning";
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 19.5h18M7.5 19.5a4.5 4.5 0 0 1 9 0M5.636 14.136l1.06 1.06M18.364 14.136l-1.06 1.06" />
      <path d={rising ? "M12 3.75v6.75M9.75 6 12 3.75 14.25 6" : "M12 3.75v6.75M9.75 8.25 12 10.5l2.25-2.25"} />
    </svg>
  );
}

/** "Amritsar  ☀ 14:05 Afternoon": 24-hour local clock with a part-of-day icon. */
export function LocalTime({ airport, now, place }: { airport: Airport; now: Date; place?: string }) {
  const { hhmm, period } = localTime(airport.tz, now);
  const { offset, zoneName } = utcOffset(airport.tz, now);
  return (
    <div className="min-w-0">
      <p className="truncate text-sm text-slate">
        <span className="sr-only">Local time in </span>
        {place ?? airport.label}
      </p>
      <p className="mt-0.5 flex items-center gap-2 text-ink">
        <DayIcon period={period} />
        <time className="font-display text-2xl/7 font-semibold tabular-nums">{hhmm}</time>
        <span className="text-sm text-slate">{LABELS[period]}</span>
      </p>
      <p className="mt-0.5 text-xs text-slate tabular-nums" title={zoneName}>
        {offset}
        <span className="sr-only">, {zoneName}</span>
      </p>
    </div>
  );
}
