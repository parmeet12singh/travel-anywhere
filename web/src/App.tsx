import { useEffect, useMemo, useRef, useState } from "react";
import { MapView } from "./components/MapView";
import { OriginSearch } from "./components/OriginSearch";
import { CountryPicker } from "./components/CountryPicker";
import { PairView } from "./components/PairView";
import type { Link } from "./lib/pairs";
import { countryLinks, linkCountsFrom } from "./lib/pairs";
import { AppHeader, BackLink, DestinationDetail, DestinationList, Filters, OriginHeader, Welcome } from "./components/PanelSections";
import type { Dataset } from "./lib/data";
import { HOME_COUNTRY } from "./lib/data";
import { loadDataset } from "./lib/data";
import type { Scope, SortKey } from "./lib/destinations";
import { airlinesFrom, destinationsFrom, filterAndSort } from "./lib/destinations";
import { createOriginSearch } from "./lib/search";
import type { UrlState } from "./lib/url";
import { readUrlState, writeUrlState } from "./lib/url";

const COUNTRY_KEY = "travel-anywhere-country";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

type Selection = { origin: string | null; dest: string | null };

/** Only accept a city/destination from the URL if the data actually has it. */
function selectionFrom(data: Dataset, { from, to }: UrlState): Selection {
  const origin = from && data.routesByOrigin.has(from) ? from : null;
  const dest = origin && to && data.routesByOrigin.get(origin)!.some((r) => r.dest === to) ? to : null;
  return { origin, dest };
}
const scopeFrom = (show: string | null): Scope => (show === "india" || show === "abroad" ? show : "all");

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDataset().then(setData, (e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <main className="grid h-dvh place-items-center p-6">
        <div className="max-w-sm">
          <h1 className="text-xl font-semibold">The route data didn't load</h1>
          <p className="mt-2 text-slate">{error}. Check your connection and reload the page.</p>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="grid h-dvh place-items-center" aria-busy="true">
        <p className="text-slate">Loading routes…</p>
      </main>
    );
  }
  return <Explorer data={data} />;
}

function Explorer({ data }: { data: Dataset }) {
  const [initial] = useState(readUrlState);
  const [selection, setSelection] = useState<Selection>(() => selectionFrom(data, initial));
  const [scope, setScope] = useState<Scope>(() => scopeFrom(initial.show));
  const [airline, setAirline] = useState<string | null>(() => (selection.origin ? initial.airline : null));
  const [sort, setSort] = useState<SortKey>("name");
  const [hovered, setHovered] = useState<string | null>(null);

  // The country at the top right: link first, then the visitor's last choice, then India.
  const [countryCode, setCountryCode] = useState<string>(() => {
    const valid = (c: string | null | undefined) => (c && data.countries.some((x) => x.iso2 === c) ? c : null);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(COUNTRY_KEY);
    } catch {
      /* private mode */
    }
    return valid(initial.country) ?? valid(saved) ?? HOME_COUNTRY;
  });
  const country = data.countries.find((c) => c.iso2 === countryCode) ?? data.countries[0];
  // Second country (map click or "Most connected countries"): routes between it and the picker's country.
  const validPair = (p: string | null | undefined, src: string) => (p && p !== src && data.countries.some((c) => c.iso2 === p) ? p : null);
  const [pairCode, setPairCode] = useState<string | null>(() => (selection.origin ? null : validPair(initial.pair, countryCode)));
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const pairCountry = pairCode ? data.countries.find((c) => c.iso2 === pairCode) ?? null : null;
  const links = useMemo(() => (pairCode ? countryLinks(data, country.iso2, pairCode) : []), [data, country.iso2, pairCode]);
  const linkCounts = useMemo(() => linkCountsFrom(data, country.iso2), [data, country.iso2]);
  const connections = useMemo(
    () =>
      [...linkCounts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .flatMap(([iso2, count]) => {
          const c = data.countries.find((x) => x.iso2 === iso2);
          return c ? [{ country: c, count }] : [];
        }),
    [data, linkCounts],
  );
  // Start-screen airports: India's own, or the picked country's airports with flights to India.
  const homeAirports = useMemo(
    () => (country.iso2 === HOME_COUNTRY ? data.origins : data.searchable.filter((a) => a.country === country.iso2)),
    [data, country.iso2],
  );

  const search = useMemo(
    () => createOriginSearch(data.searchable, (iata) => data.routesByOrigin.get(iata)?.length ?? 0),
    [data],
  );
  const origin = selection.origin ? data.airports.get(selection.origin) ?? null : null;

  const all = useMemo(() => (origin ? destinationsFrom(data, origin) : []), [data, origin]);
  const airlines = useMemo(() => airlinesFrom(all), [all]);
  // Outside India every destination is an Indian city, so the India/Abroad filter doesn't apply.
  const effectiveScope: Scope = origin && origin.country !== HOME_COUNTRY ? "all" : scope;
  const visible = useMemo(() => filterAndSort(all, effectiveScope, airline, sort), [all, effectiveScope, airline, sort]);
  const domesticCount = all.filter((d) => d.route.domestic).length;
  const byAirline = airline ? all.filter((d) => d.route.airlines.some((a) => a.airline === airline)) : all;
  const counts: Record<Scope, number> = {
    all: byAirline.length,
    india: byAirline.filter((d) => d.route.domestic).length,
    abroad: byAirline.filter((d) => !d.route.domestic).length,
  };
  const dest = selection.dest ? all.find((d) => d.airport.iata === selection.dest) ?? null : null;

  const dotWeights = useMemo(
    () => new Map([...data.routesByOrigin].map(([iata, routes]) => [iata, routes.length])),
    [data],
  );
  // Airports per country, counted the same way as each country's start screen (India: airports with their own
  // route lists; elsewhere: airports with flights to India).
  const airportCounts = useMemo(() => {
    const m = new Map<string, number>([[HOME_COUNTRY, data.origins.length]]);
    for (const a of data.searchable) if (a.country !== HOME_COUNTRY) m.set(a.country, (m.get(a.country) ?? 0) + 1);
    return m;
  }, [data]);
  const airportCount = (iso2: string) => airportCounts.get(iso2) ?? 0;
  const busiest = useMemo(
    () =>
      homeAirports
        .map((airport) => ({ airport, count: data.routesByOrigin.get(airport.iata)!.length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
    [data, homeAirports],
  );

  const select = (originIata: string | null, destIata: string | null) => {
    setSelection({ origin: originIata, dest: destIata });
    setHovered(null);
  };
  const pickOrigin = (iata: string) => {
    if (iata !== selection.origin) {
      setScope("all");
      setAirline(null);
    }
    select(iata, null);
  };
  const pickDestination = (iata: string) => select(selection.origin, iata);
  const pickCountry = (iso2: string) => {
    setHoveredLink(null);
    setPairCode(iso2 === country.iso2 ? null : iso2);
  };
  // A link opens the usual route page, from the side whose route list has it.
  const pickLink = (l: Link) => {
    const has = (a: string, b: string) => data.routesByOrigin.get(a)?.some((r) => r.dest === b);
    const [o, d] = has(l.from.iata, l.to.iata) ? [l.from.iata, l.to.iata] : has(l.to.iata, l.from.iata) ? [l.to.iata, l.from.iata] : [null, null];
    if (!o || !d) return;
    setPairCode(null);
    setHoveredLink(null);
    setScope("all");
    setAirline(null);
    select(o, d);
  };
  const [focusSearch, setFocusSearch] = useState(false);
  const goHome = () => {
    setFocusSearch(true);
    setPairCode(null);
    setScope("all");
    setAirline(null);
    select(null, null);
  };
  const changeCountry = (iso2: string) => {
    try {
      localStorage.setItem(COUNTRY_KEY, iso2);
    } catch {
      /* private mode: just not remembered */
    }
    setCountryCode(iso2);
    setPairCode(null);
    setScope("all");
    setAirline(null);
    select(null, null);
  };

  // Keep the URL in step with what's on screen, so any view can be shared. Picking a city or destination
  // adds a history entry, so the browser's Back button steps back through views (and finally to the start).
  const written = useRef({ ...selection, country: countryCode, pair: pairCode });
  useEffect(() => {
    const w = written.current;
    const push = w.origin !== selection.origin || w.dest !== selection.dest || w.country !== countryCode || w.pair !== pairCode;
    written.current = { ...selection, country: countryCode, pair: pairCode };
    writeUrlState({ from: selection.origin, to: selection.dest, show: scope, airline, country: countryCode, pair: pairCode }, push);
  }, [selection, scope, airline, countryCode, pairCode]);

  useEffect(() => {
    const onPop = () => {
      const url = readUrlState();
      const next = selectionFrom(data, url);
      const nextCountry = url.country && data.countries.some((c) => c.iso2 === url.country) ? url.country : HOME_COUNTRY;
      const nextPair = next.origin ? null : validPair(url.pair, nextCountry);
      written.current = { ...next, country: nextCountry, pair: nextPair };
      setCountryCode(nextCountry);
      setPairCode(nextPair);
      setHoveredLink(null);
      setSelection(next);
      setScope(scopeFrom(url.show));
      setAirline(next.origin ? url.airline : null);
      setHovered(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [data]);

  // Escape goes up one level: route → city → start, or pair → start (but not while typing in a field).
  useEffect(() => {
    if (!selection.origin && !pairCode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement).closest("input, select, textarea")) return;
      if (!selection.origin) setPairCode(null);
      else if (selection.dest) select(selection.origin, null);
      else goHome();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex h-dvh flex-col md:relative md:block">
      <a
        href="#destinations"
        className="absolute top-2 left-2 z-30 -translate-y-20 rounded-md bg-ink px-3 py-2 text-paper focus:translate-y-0"
      >
        Skip to destinations
      </a>
      <div className="relative h-[42dvh] shrink-0 md:absolute md:inset-0 md:h-auto">
        <MapView
          origins={homeAirports}
          country={country}
          dotWeights={dotWeights}
          origin={origin}
          destinations={dest ? [dest] : visible}
          allDestinations={all}
          frameKey={`${scope}|${airline ?? ""}|${dest?.airport.iata ?? ""}`}
          routeTimes={origin && dest ? { origin, dest: dest.airport, domestic: dest.route.domestic } : null}
          emphasised={hovered ?? selection.dest}
          onPickOrigin={pickOrigin}
          onPickDestination={pickDestination}
          onHover={setHovered}
          countries={data.countries}
          linkCounts={linkCounts}
          pair={!origin && pairCountry ? { target: pairCountry, links } : null}
          emphasisedLink={hoveredLink}
          onPickCountry={pickCountry}
          onPickLink={pickLink}
          onHoverLink={setHoveredLink}
        />
        <div className="absolute top-3 right-3 z-10 md:top-4 md:right-4">
          <CountryPicker countries={data.countries} value={country.iso2} onChange={changeCountry} airportCount={airportCount} />
        </div>
      </div>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-rule bg-paper md:absolute md:overflow-hidden md:top-4 md:bottom-4 md:left-4 md:w-[400px] md:rounded-xl md:border md:shadow-xl md:shadow-ink/10 dark:md:shadow-black/40">
        <div className="flex flex-col gap-5 border-b border-rule p-5">
          <AppHeader onHome={goHome} />
          {/* Search only on the start screen; once a city is picked, a back link replaces it. */}
          {!origin && !pairCountry ? <OriginSearch search={search} onPick={pickOrigin} hasOrigin={false} focusOnMount={focusSearch} /> : null}
          {!origin && pairCountry ? <BackLink onClick={() => setPairCode(null)}>{`All of ${country.name}`}</BackLink> : null}
          {origin && !dest ? (
            <>
              <BackLink onClick={goHome}>Change city</BackLink>
              <OriginHeader origin={origin} total={all.length} domestic={domesticCount} />
              <Filters
                showScope={origin.country === HOME_COUNTRY}
                scope={scope}
                counts={counts}
                onScope={setScope}
                airline={airline}
                airlines={airlines}
                onAirline={setAirline}
                sort={sort}
                onSort={setSort}
              />
            </>
          ) : null}
        </div>

        <div className="flex-1 p-5 md:min-h-0 md:overflow-y-auto md:overscroll-contain">
          {!origin && pairCountry ? (
            <PairView
              key={pairCountry.iso2}
              source={country}
              target={pairCountry}
              links={links}
              airlines={data.airlines}
              emphasised={hoveredLink}
              onHover={setHoveredLink}
              onPick={pickLink}
            />
          ) : !origin ? (
            <Welcome
              busiest={busiest}
              airportCount={homeAirports.length}
              country={country}
              onPick={pickOrigin}
              connections={connections}
              onPickCountry={pickCountry}
            />
          ) : dest ? (
            <DestinationDetail
              origin={origin}
              dest={dest}
              airlines={data.airlines}
              onBack={() => select(origin.iata, null)}
            />
          ) : (
            <DestinationList
              items={visible}
              airlines={data.airlines}
              emphasised={hovered}
              onHover={setHovered}
              onPick={pickDestination}
              onReset={() => {
                setScope("all");
                setAirline(null);
              }}
            />
          )}
        </div>

        <footer className="border-t border-rule px-5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[11px]/4 text-slate">
          Route data:{" "}
          <a href="https://en.wikipedia.org/" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
            Wikipedia
          </a>
          ,{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
            CC BY-SA
          </a>
          . Updated {dateFmt.format(new Date(`${data.asOf}T00:00:00`))}.
        </footer>
      </main>
    </div>
  );
}
