import type { AirlineInfo, Airport, Country } from "../lib/data";
import { Flag } from "./Flag";
import { HOME_COUNTRY } from "../lib/data";
import { toggleTheme, useTheme } from "../lib/theme";
import { ArrowTopRightOnSquareIcon, ChevronLeftIcon, MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { AirlineLogo } from "./AirlineLogo";
import { LocalTime } from "./LocalTime";
import { localTime, useMinuteClock, utcOffset } from "../lib/time";
import { DayIcon } from "./LocalTime";
import type { Destination, Scope, SortKey } from "../lib/destinations";
import { airlineNotes, routeNotes } from "../lib/destinations";
import { formatKm } from "../lib/geo";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------- header */

/** App name (goes back to the start) and the light/dark switch. */
export function AppHeader({ onHome }: { onHome: () => void }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <div className="flex items-center justify-between gap-3">
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          onHome();
        }}
        className="-ml-1 flex min-h-11 items-center gap-2 rounded-md pr-2 font-semibold text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 32 32" className="size-7">
          <path d="M7 24 C11 10, 21 8, 26 9" fill="none" className="stroke-airway" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="7" cy="24" r="3.2" className="fill-ink" />
          <circle cx="26" cy="9" r="2.4" className="fill-airway" />
        </svg>
        Travel Anywhere
      </a>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={`Switch to ${next} theme`}
        title={`Switch to ${next} theme`}
        className="grid size-11 cursor-pointer place-items-center rounded-lg text-slate transition-colors hover:bg-surface hover:text-ink"
      >
        {theme === "dark" ? (
          <SunIcon aria-hidden="true" className="size-5" />
        ) : (
          <MoonIcon aria-hidden="true" className="size-5" />
        )}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- back link */

/** "‹ Label": one level up. Same look wherever it appears. */
export function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 flex min-h-11 w-fit cursor-pointer items-center gap-1 rounded-md pr-2 font-medium text-slate transition-colors hover:text-ink"
    >
      <ChevronLeftIcon aria-hidden="true" className="size-5" />
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ welcome */

export function Welcome({ busiest, airportCount, country, onPick, connections, onPickCountry }: {
  busiest: { airport: Airport; count: number }[];
  airportCount: number;
  country: { iso2: string; name: string };
  onPick: (iata: string) => void;
  /** Countries with the most routes to/from this one: open the routes between the two. */
  connections: { country: Country; count: number }[];
  onPickCountry: (iso2: string) => void;
}) {
  const home = country.iso2 === HOME_COUNTRY;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[1.75rem]/tight font-semibold text-balance">
          {home ? "Where can you fly non-stop?" : `Flights between ${country.name} and India`}
        </h1>
        <p className="mt-2 text-slate">
          {home
            ? "Pick a city to see every place it has direct flights to, in India and abroad. Or click a dot on the map."
            : `Pick an airport to see the Indian cities it has non-stop flights to. Only routes to and from India are covered.`}
        </p>
      </div>
      <div>
        <h2 className="text-sm font-medium text-slate">{home ? "Busiest airports" : `Airports in ${country.name}`}</h2>
        <ul className="mt-2 grid grid-cols-2 gap-2">
          {busiest.map(({ airport, count }) => (
            <li key={airport.iata}>
              <button
                type="button"
                onClick={() => onPick(airport.iata)}
                className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-rule bg-surface px-3 py-2 text-left transition-colors hover:border-airway"
              >
                <span>
                  <span className="block font-medium">{airport.label}</span>
                  <span className="block text-sm text-slate">
                    {home ? plural(count, "destination") : plural(count, "Indian city", "Indian cities")}
                  </span>
                </span>
                {/* Same colour as the map dots: magenta for India, teal abroad. */}
                <span translate="no" className={`font-display text-lg font-semibold ${home ? "text-airway" : "text-ocean"}`}>
                  {airport.iata}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {connections.length > 0 ? (
        <div>
          <h2 className="text-sm font-medium text-slate">Most connected countries</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {connections.map(({ country: c, count }) => (
              <li key={c.iso2}>
                <button
                  type="button"
                  onClick={() => onPickCountry(c.iso2)}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-rule bg-surface py-1.5 pr-3 pl-2 text-sm transition-colors hover:border-ocean"
                >
                  <Flag country={c} />
                  <span className="font-medium">{c.name}</span>
                  <span className="text-slate tabular-nums">{count}</span>
                  <span className="sr-only">routes</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-sm text-slate">
        {home
          ? `${airportCount} Indian airports with scheduled flights.`
          : `${plural(airportCount, "airport")} in ${country.name} with flights to India.`}{" "}
        Bigger dots on the map have more non-stop destinations. Click a country on the map to see its routes with{" "}
        {country.name}.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ origin header */

export function OriginHeader({ origin, total, domestic }: { origin: Airport; total: number; domestic: number }) {
  const now = useMinuteClock();
  const { hhmm, period } = localTime(origin.tz, now);
  const { offset, zoneName } = utcOffset(origin.tz, now);
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <p translate="no" className="font-display text-code font-semibold tracking-tight text-ink" aria-hidden="true">
          {origin.iata}
        </p>
        {/* Local time: beside the code, smaller, so it adds information without competing with it. */}
        <div className="text-right">
          <p className="flex items-center justify-end gap-1.5 text-ink">
            <span className="sr-only">Local time in {origin.label}: </span>
            <DayIcon period={period} className="size-[18px]" />
            <time className="font-display text-xl/6 font-semibold tabular-nums">{hhmm}</time>
            <span className="text-sm text-slate">{period[0].toUpperCase() + period.slice(1)}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate tabular-nums" title={zoneName}>
            {offset}
            <span className="sr-only">, {zoneName}</span>
          </p>
        </div>
      </div>
      <h1 className="mt-1 text-xl font-semibold text-balance">
        {origin.label}
        <span className="sr-only"> ({origin.iata})</span>
      </h1>
      <p className="text-sm text-slate">{origin.name}</p>
      {origin.country === HOME_COUNTRY ? (
        <p className="mt-3">
          {plural(total, "non-stop destination")}: {domestic} in India and {total - domestic} abroad.
        </p>
      ) : (
        <p className="mt-3">
          {plural(total, "Indian city", "Indian cities")} {total === 1 ? "has" : "have"} non-stop flights to {origin.label},{" "}
          {origin.country_name}. Only routes to and from India are covered.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ filters */

const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "india", label: "India" },
  { value: "abroad", label: "Abroad" },
];

export function Filters(props: {
  showScope: boolean;
  scope: Scope;
  counts: Record<Scope, number>;
  onScope: (s: Scope) => void;
  airline: string | null;
  airlines: { name: string; count: number }[];
  onAirline: (a: string | null) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {props.showScope ? (
      <fieldset>
        <legend className="sr-only">Show destinations</legend>
        <div className="grid grid-cols-3 rounded-lg border border-rule bg-surface p-1">
          {SCOPES.map((s) => (
            <label
              key={s.value}
              className="relative flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-medium text-slate transition-colors hover:text-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:outline-2 has-focus-visible:outline-airway"
            >
              <input
                type="radio"
                name="scope"
                value={s.value}
                checked={props.scope === s.value}
                onChange={() => props.onScope(s.value)}
                className="sr-only"
              />
              {s.label}
              <span className="tabular-nums opacity-75">{props.counts[s.value]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate">
          Airline
          <select
            value={props.airline ?? ""}
            onChange={(e) => props.onAirline(e.target.value || null)}
            className="h-10 w-full min-w-0 cursor-pointer rounded-lg border border-rule bg-surface px-2.5 text-base font-normal text-ink"
          >
            <option value="">All airlines</option>
            {props.airlines.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.count})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate">
          Sort
          <select
            value={props.sort}
            onChange={(e) => props.onSort(e.target.value as SortKey)}
            className="h-10 w-full min-w-0 cursor-pointer rounded-lg border border-rule bg-surface px-2.5 text-base font-normal text-ink"
          >
            <option value="name">A to Z</option>
            <option value="airlines">Most airlines</option>
            <option value="nearest">Nearest</option>
            <option value="farthest">Farthest</option>
          </select>
        </label>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- destination list */

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {notes.map((n) => (
        <span key={n} className="rounded border border-rule px-1.5 text-xs/5 text-slate">
          {n}
        </span>
      ))}
    </span>
  );
}

export function DestinationList({ items, airlines, emphasised, onHover, onPick, onReset }: {
  items: Destination[];
  airlines: Map<string, AirlineInfo>;
  emphasised: string | null;
  onHover: (iata: string | null) => void;
  onPick: (iata: string) => void;
  onReset: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="py-6">
        <p>No destinations match these filters.</p>
        <button type="button" onClick={onReset} className="mt-2 cursor-pointer font-medium text-airway underline underline-offset-4">
          Show all destinations
        </button>
      </div>
    );
  }
  return (
    <ul id="destinations" className="-mx-2" aria-label="Destinations">
      {items.map((d) => {
        const on = d.airport.iata === emphasised;
        return (
          <li key={d.airport.iata} className="[content-visibility:auto] [contain-intrinsic-size:auto_64px]">
            <button
              type="button"
              onClick={() => onPick(d.airport.iata)}
              onMouseEnter={() => onHover(d.airport.iata)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(d.airport.iata)}
              onBlur={() => onHover(null)}
              className={`flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${on ? "bg-surface" : "hover:bg-surface"}`}
            >
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-full ${d.route.domestic ? "bg-airway" : "bg-ocean"}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.airport.label}</span>
                <span className="block truncate text-sm text-slate">
                  {d.route.domestic ? "India" : d.airport.country_name}, {formatKm(d.km)}
                </span>
                <Notes notes={routeNotes(d.route)} />
                <span className="mt-1.5 flex items-center gap-1" aria-hidden="true">
                  {d.route.airlines.slice(0, 4).map((a) => (
                    <AirlineLogo key={`${a.airline}-${a.category}`} airline={a} logo={a.airline_wiki ? airlines.get(a.airline_wiki)?.logo : undefined} size="sm" />
                  ))}
                  {d.route.airlines.length > 4 ? <span className="text-xs text-slate">+{d.route.airlines.length - 4}</span> : null}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span translate="no" className="block font-display text-lg/6 font-semibold text-slate">{d.airport.iata}</span>
                <span className="block text-xs text-slate">{plural(d.route.airlines.length, "airline")}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------- destination detail */

export function DestinationDetail({ origin, dest, airlines, onBack }: {
  origin: Airport;
  airlines: Map<string, AirlineInfo>;
  dest: Destination;
  onBack: () => void;
}) {
  const { airport, route, km } = dest;
  const colour = route.domestic ? "text-airway" : "text-ocean";
  const now = useMinuteClock();
  return (
    <div className="flex flex-col gap-5">
      <BackLink onClick={onBack}>All destinations</BackLink>

      <div>
        <p translate="no" className="flex items-center gap-3 font-display text-code font-semibold tracking-tight" aria-hidden="true">
          <span>{origin.iata.slice(0, 4)}</span>
          <svg viewBox="0 0 64 24" className={`h-6 w-16 ${colour}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M3 20 C 18 2, 46 2, 61 20" />
          </svg>
          <span className={colour}>{airport.iata.slice(0, 4)}</span>
        </p>
        <h2 className="mt-2 text-xl font-semibold text-balance">
          {origin.label} to {airport.label}
        </h2>
        <p className="text-sm text-slate">{airport.name}</p>
        <p className="mt-3">
          {route.domestic ? "Domestic" : `International, ${airport.country_name}`}. {formatKm(km)} in a straight line.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate">Local time</h3>
        {/* Same clock at both ends (always within India): one time, not two identical ones. */}
        {localTime(origin.tz, now).hhmm === localTime(airport.tz, now).hhmm ? (
          <div className="mt-2 rounded-lg border border-rule bg-surface px-3 py-3">
            <LocalTime airport={origin} now={now} place={`${origin.label} and ${airport.label}, same time zone`} />
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3 rounded-lg border border-rule bg-surface px-3 py-3">
            <LocalTime airport={origin} now={now} />
            <LocalTime airport={airport} now={now} />
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate">{plural(route.airlines.length, "airline")} {route.airlines.length === 1 ? "flies" : "fly"} this route</h3>
        <ul className="mt-2 divide-y divide-rule rounded-lg border border-rule bg-surface">
          {route.airlines.map((a) => {
            const info = a.airline_wiki ? airlines.get(a.airline_wiki) : undefined;
            const identity = (
              <>
                <AirlineLogo airline={a} logo={info?.logo} />
                <span className="truncate font-medium">{a.airline}</span>
              </>
            );
            return (
              <li key={`${a.airline}-${a.category}`} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
                {info?.website ? (
                  <a
                    href={info.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex min-w-0 items-center gap-3 rounded-md hover:text-airway"
                  >
                    {identity}
                    <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-4 shrink-0 text-slate group-hover:text-airway" />
                    <span className="sr-only">(website, opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="flex min-w-0 items-center gap-3">{identity}</span>
                )}
                <Notes notes={airlineNotes(a)} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
