import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Popover,
  PopoverButton,
  PopoverPanel,
} from "@headlessui/react";
import { CheckIcon, ChevronDownIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import type { Country } from "../lib/data";
import { Flag } from "./Flag";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const normalise = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Everyday names people type for some countries.
const ALIASES: Record<string, string[]> = { AE: ["uae", "emirates"], US: ["usa", "america"], GB: ["uk", "britain", "england"], SA: ["ksa"], CD: ["democratic", "drc"], CI: ["ivory"], CZ: ["czechia"], TR: ["turkiye"] };

function useWide() {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}


/**
 * Country picker on the map, top right. Closed: a pill with the country's flag and name (flag only on phones).
 * Open: a card (bottom sheet on phones) with search, the selected country first, then every country A–Z with its
 * airport count. Headless UI provides the keyboard and screen-reader behaviour; "/" opens it from anywhere.
 */
export function CountryPicker({ countries, value, onChange, airportCount }: {
  countries: Country[];
  value: string;
  onChange: (iso2: string) => void;
  /** Same count as the country's start screen, so the numbers match. */
  airportCount: (iso2: string) => number;
}) {
  const current = countries.find((c) => c.iso2 === value) ?? countries[0];
  const wide = useWide();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || (e.target as HTMLElement).closest("input, select, textarea, [contenteditable]")) return;
      e.preventDefault();
      buttonRef.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Popover className="relative">
      <PopoverButton
        ref={buttonRef}
        data-country-pill
        aria-label={`Country: ${current.name}. Change country`}
        className="group flex h-11 min-w-11 cursor-pointer items-center gap-1.5 rounded-full bg-surface/80 py-1 pr-2.5 pl-2.5 shadow-lg md:gap-2 md:pr-3 ring-1 shadow-ink/10 ring-ink/10 backdrop-blur-md transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-airway data-open:bg-surface dark:shadow-black/40 dark:ring-white/10"
      >
        <Flag country={current} />
        {/* Name on wider screens; on phones the pill is flag-only to save map space (the sheet shows the name). */}
        <span className="hidden max-w-64 truncate text-base font-medium text-ink md:inline">{current.name}</span>
        <ChevronDownIcon aria-hidden="true" className="size-5 text-slate transition-transform group-data-open:rotate-180" />
      </PopoverButton>

      {/* Rendered at the top of the page (portal), so it's never stacked under the panel or map. */}
      <PopoverPanel
        portal
        transition
        anchor={wide ? { to: "bottom end", gap: 8 } : undefined}
        className={
          wide
            ? "z-40 flex w-80 origin-top-right flex-col overflow-hidden rounded-2xl bg-surface/95 shadow-2xl ring-1 shadow-ink/15 ring-ink/10 backdrop-blur-xl transition duration-150 ease-out data-closed:scale-95 data-closed:opacity-0 motion-reduce:transition-none dark:shadow-black/50 dark:ring-white/10"
            : "group/sheet fixed inset-0 z-40 flex flex-col justify-end bg-ink/30 transition-opacity duration-200 data-closed:opacity-0 motion-reduce:transition-none"
        }
      >
        {({ close }) => {
          const list = (
            <CountryList
              countries={countries}
              current={current}
              wide={wide}
              airportCount={airportCount}
              onPick={(iso2) => {
                onChange(iso2);
                close();
              }}
            />
          );
          if (wide) return list;
          // Phone: bottom sheet; tapping the dimmed area above it closes it.
          return (
            <>
              <button type="button" aria-label="Close" className="min-h-0 flex-1 cursor-default" onClick={() => close()} />
              <div className="flex max-h-[80dvh] flex-col overflow-hidden rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-200 ease-out group-data-closed/sheet:translate-y-full motion-reduce:transition-none">
                {list}
              </div>
            </>
          );
        }}
      </PopoverPanel>
    </Popover>
  );
}

function CountryList({ countries, current, wide, onPick, airportCount }: {
  countries: Country[];
  current: Country;
  wide: boolean;
  onPick: (iso2: string) => void;
  airportCount: (iso2: string) => number;
}) {
  const [query, setQuery] = useState("");
  const q = normalise(query);
  const filtered = useMemo(
    () =>
      q
        ? countries.filter(
            (c) =>
              normalise(c.name).split(" ").some((w) => w.startsWith(q)) ||
              normalise(c.name).startsWith(q) ||
              c.iso2.toLowerCase() === q ||
              (ALIASES[c.iso2] ?? []).some((a) => a.startsWith(q)),
          )
        : // The selected country first, so it's in view on opening, then the rest A–Z. On phones the sheet's header
          // already shows it, so the list is simply A–Z.
          wide
          ? [current, ...countries.filter((c) => c.iso2 !== current.iso2)]
          : countries,
    [countries, q, wide, current],
  );
  const pinned = wide && !q;

  return (
    <Combobox value={current} by="iso2" onChange={(c: Country | null) => c && onPick(c.iso2)}>
      {!wide ? (
        <>
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-rule" />
          <div className="flex items-center gap-2.5 px-4 pt-3 pb-1">
            <Flag country={current} />
            <p className="min-w-0 truncate text-base font-semibold text-ink">
              <span className="sr-only">Selected country: </span>
              {current.name}
            </p>
          </div>
        </>
      ) : null}
      <div className="flex items-center gap-2 border-b border-rule px-3.5">
        <MagnifyingGlassIcon aria-hidden="true" className="size-4 shrink-0 text-slate" />
        <ComboboxInput
          autoFocus={wide}
          aria-label="Search countries"
          placeholder="Search countries…"
          autoComplete="off"
          spellCheck={false}
          displayValue={() => query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-12 w-full bg-transparent text-base text-ink placeholder:text-slate/80 focus:outline-none md:text-sm"
        />
        {wide ? (
          <kbd className="rounded border border-rule px-1.5 font-sans text-[11px] text-slate" title="Press Esc to close">
            Esc
          </kbd>
        ) : null}
      </div>


      <ComboboxOptions static className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 md:max-h-[min(55vh,22rem)]">
        {filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-slate">
            No country matches “{query.trim()}”. It may not be covered yet.
          </p>
        ) : (
          filtered.map((c, i) => (
            <Fragment key={c.iso2}>
            <ComboboxOption
              value={c}
              // content-visibility: rows out of view aren't drawn (90+ countries).
              className="group flex [content-visibility:auto] [contain-intrinsic-size:auto_44px] min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 data-focus:bg-airway-soft"
            >
              <CheckIcon aria-hidden="true" className="invisible size-4 shrink-0 stroke-2 text-airway group-data-selected:visible" />
              <span translate="no" className="w-7 shrink-0 font-display text-sm font-semibold text-slate group-data-selected:text-ink">
                {c.iso2}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink group-data-selected:font-semibold">{c.name}</span>
              <span className="shrink-0 text-xs text-slate tabular-nums">
                {plural(airportCount(c.iso2), "airport")}
              </span>
            </ComboboxOption>
            {pinned && i === 0 ? <div aria-hidden="true" className="mx-2.5 my-1.5 border-t border-rule" /> : null}
            </Fragment>
          ))
        )}
      </ComboboxOptions>
    </Combobox>
  );
}
