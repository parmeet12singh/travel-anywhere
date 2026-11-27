import { useState } from "react";
import type { AirlineInfo, Country } from "../lib/data";
import { inSentence } from "../lib/names";
import type { Link } from "../lib/pairs";
import { linkSummary } from "../lib/pairs";
import { formatKm } from "../lib/geo";
import { AirlineLogo } from "./AirlineLogo";
import { Flag } from "./Flag";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SHOWN = 8;
export const linkKey = (l: Link) => `${l.from.iata}-${l.to.iata}`;

/**
 * Routes between the country in the picker (source) and another country (target): a compact summary, the airlines,
 * and the busiest airport pairs. Each pair opens the usual route page.
 */
export function PairView({ source, target, covered, links, airlines, emphasised, onHover, onPick }: {
  source: Country;
  target: Country;
  /** At least one side has full route lists, so "no routes" really means none. Otherwise it may mean "not collected". */
  covered: boolean;
  links: Link[];
  airlines: Map<string, AirlineInfo>;
  emphasised: string | null;
  onHover: (key: string | null) => void;
  onPick: (link: Link) => void;
}) {
  const [all, setAll] = useState(false);
  const sum = linkSummary(links);
  const shown = all ? links : links.slice(0, SHOWN);
  const logoOf = (wiki: string | null | undefined) => (wiki ? airlines.get(wiki)?.logo : undefined);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[1.75rem]/tight font-semibold">
          <span className="flex items-center gap-2"><Flag country={source} />{source.name}</span>
          <span aria-label="and" className="text-slate">⇄</span>
          <span className="flex items-center gap-2"><Flag country={target} />{target.name}</span>
        </h1>
        {links.length > 0 ? (
          <p className="mt-2 text-slate">
            {plural(sum.routes, "non-stop route")} between {plural(sum.fromAirports, "airport")} in {inSentence(source)} and{" "}
            {plural(sum.toAirports, "airport")} in {inSentence(target)}.
          </p>
        ) : null}
      </div>

      {links.length === 0 ? (
        <div className="rounded-lg border border-rule bg-surface p-4">
          <p className="font-medium">{covered ? `No non-stop routes between ${inSentence(source)} and ${inSentence(target)}.` : `No routes between ${inSentence(source)} and ${inSentence(target)} in our data yet.`}</p>
          {!covered ? (
            <p className="mt-1 text-sm text-slate">We only have routes to and from the countries covered so far.</p>
          ) : null}
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-sm font-medium text-slate">{plural(sum.airlines.length, "airline")}</h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {sum.airlines.map(({ airline, count }) => (
                <li key={airline.airline_wiki ?? airline.airline} title={`${airline.airline}: ${plural(count, "route")}`}>
                  <AirlineLogo airline={airline} logo={logoOf(airline.airline_wiki)} size="sm" />
                  <span className="sr-only">{airline.airline}, {plural(count, "route")}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-medium text-slate">Busiest links</h2>
            <ul id="destinations" className="-mx-2 mt-1" aria-label={`Routes between ${source.name} and ${target.name}`}>
              {shown.map((l) => {
                const key = linkKey(l);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => onPick(l)}
                      onMouseEnter={() => onHover(key)}
                      onMouseLeave={() => onHover(null)}
                      onFocus={() => onHover(key)}
                      onBlur={() => onHover(null)}
                      className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${emphasised === key ? "bg-surface" : "hover:bg-surface"}`}
                    >
                      {/* Same layout as the destination list: names, then codes and distance, then airline logos. */}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {l.from.label} <span aria-label="and" className="text-slate">⇄</span> {l.to.label}
                        </span>
                        <span className="block text-sm text-slate">
                          <span translate="no">{l.from.iata} ⇄ {l.to.iata}</span>, {formatKm(l.km)}
                        </span>
                        <span className="mt-1.5 flex items-center gap-1" aria-hidden="true">
                          {l.airlines.slice(0, 4).map((a) => (
                            <AirlineLogo key={a.airline_wiki ?? a.airline} airline={a} logo={logoOf(a.airline_wiki)} size="sm" />
                          ))}
                          {l.airlines.length > 4 ? <span className="text-xs text-slate">+{l.airlines.length - 4}</span> : null}
                        </span>
                      </span>
                      <span className="shrink-0 self-start pt-0.5 text-xs text-slate">{plural(l.airlines.length, "airline")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {links.length > SHOWN ? (
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="mt-1 min-h-11 cursor-pointer font-medium text-airway underline-offset-4 hover:underline"
              >
                {all ? "Show fewer" : `See all ${links.length} routes`}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
