import { useEffect, useState } from "react";

export type DayPeriod = "morning" | "afternoon" | "sunset" | "night";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local time at an airport as "HH:MM" (24-hour), plus which part of the day it is there. */
export function localTime(timeZone: string, now: Date): { hhmm: string; period: DayPeriod } {
  const parts = formatter(timeZone).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  // Morning 05:00–11:59, afternoon 12:00–16:59, sunset 17:00–19:59, night 20:00–04:59.
  const period: DayPeriod = hour >= 20 || hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "sunset";
  return { hhmm: `${String(hour).padStart(2, "0")}:${minute}`, period };
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const nameFormatters = new Map<string, Intl.DateTimeFormat>();

function part(map: Map<string, Intl.DateTimeFormat>, timeZone: string, style: "shortOffset" | "long", now: Date) {
  let f = map.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: style });
    map.set(timeZone, f);
  }
  return f.formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
}

/**
 * The airport's UTC offset right now, e.g. "UTC+5:30" or "UTC+0" (daylight saving included), and the zone's
 * full name for tooltips and screen readers ("India Standard Time"). No abbreviations: "IST" is ambiguous.
 */
export function utcOffset(timeZone: string, now: Date): { offset: string; zoneName: string } {
  const gmt = part(offsetFormatters, timeZone, "shortOffset", now); // "GMT+5:30", "GMT"
  // Typographic minus (U+2212), not a hyphen: "UTC−5".
  const offset = gmt === "GMT" ? "UTC+0" : gmt.replace("GMT", "UTC").replace("-", "\u2212");
  return { offset, zoneName: part(nameFormatters, timeZone, "long", now) };
}

/** The current time, updated on each new minute (not every second: the display only shows minutes). */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60_000 - (Date.now() % 60_000) + 50);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}
