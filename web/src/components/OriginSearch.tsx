import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { Fragment } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { Airport } from "../lib/data";
import { HOME_COUNTRY } from "../lib/data";
import { formatKm } from "../lib/geo";
import type { SearchResult } from "../lib/search";

type Props = {
  search: (q: string) => SearchResult[];
  onPick: (iata: string) => void;
  hasOrigin: boolean;
  /** Put the cursor in the box (after "Change city"), on devices with a mouse/trackpad only. */
  focusOnMount?: boolean;
};

export function OriginSearch({ search, onPick, hasOrigin, focusOnMount = false }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);
  const results = useMemo(() => search(deferred), [search, deferred]);
  const showList = open && query.trim().length > 0;

  const pick = (a: Airport) => {
    onPick(a.iata);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && showList && results[active]) {
      e.preventDefault();
      pick(results[active].airport);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="text-sm font-medium text-slate">
        Flying from
      </label>
      <div className="relative mt-1">
      <input
        ref={inputRef}
        // On phones this would pop the keyboard up unasked, so only where there's a fine pointer.
        autoFocus={focusOnMount && window.matchMedia("(pointer: fine)").matches}
        id={`${id}-input`}
        type="text"
        name="from"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${id}-opt-${results[active].airport.iata}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={hasOrigin ? "Search another city…" : "City, airport or code…"}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-12 w-full rounded-lg border border-rule bg-surface pr-11 pl-3.5 text-base text-ink placeholder:text-slate/80 focus:border-airway focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-airway/25"
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear search"
          // mousedown so it fires before the input's blur
          onMouseDown={(e) => {
            e.preventDefault();
            setQuery("");
            setActive(0);
            inputRef.current?.focus();
          }}
          className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center rounded-r-lg text-slate hover:text-ink"
        >
          <XMarkIcon aria-hidden="true" className="size-5" />
        </button>
      ) : null}
      </div>
      {showList ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Matching airports"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-rule bg-surface py-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3.5 py-3 text-sm text-slate">
              No airport with scheduled flights matches “{query.trim()}”. Try the nearest bigger city.
            </li>
          ) : (
            results.map(({ airport: a, nearby, inCountry }, i) => (
              <Fragment key={a.iata}>
                {inCountry && i === 0 ? (
                  <li role="presentation" className="px-3.5 pt-2 pb-1 text-sm font-medium text-slate">
                    Airports in {inCountry}
                  </li>
                ) : null}
                {nearby && !results[i - 1]?.nearby ? (
                  <li role="presentation" className="mt-1 border-t border-rule px-3.5 pt-2.5 pb-1 text-sm font-medium text-slate">
                    Nearby airports
                  </li>
                ) : null}
                <li
                  id={`${id}-opt-${a.iata}`}
                  role="option"
                  aria-selected={i === active}
                  // mousedown, not click: fires before the input's blur closes the list
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(a);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3.5 py-2 ${i === active ? "bg-airway-soft" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.label}</span>
                    <span className="block truncate text-sm text-slate">
                      {nearby
                        ? `${formatKm(nearby.km)} from ${nearby.of.label}`
                        : a.country === HOME_COUNTRY || inCountry // the heading already names the country
                          ? a.name
                          : `${a.name}, ${a.country_name}`}
                    </span>
                  </span>
                  <span translate="no" className="font-display text-lg font-semibold text-slate">{a.iata}</span>
                </li>
              </Fragment>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
