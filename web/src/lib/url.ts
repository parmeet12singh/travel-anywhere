/** Everything you'd want to share lives in the URL: ?from=DEL&to=DXB&show=abroad&airline=IndiGo */
export type UrlState = {
  from: string | null;
  to: string | null;
  show: string | null;
  airline: string | null;
  country?: string | null;
  /** Second country, for the routes between it and the picker's country. */
  pair?: string | null;
};

export function readUrlState(): UrlState {
  const p = new URLSearchParams(window.location.search);
  return {
    from: p.get("from")?.toUpperCase() ?? null,
    to: p.get("to")?.toUpperCase() ?? null,
    show: p.get("show"),
    airline: p.get("airline"),
    country: p.get("country")?.toUpperCase() ?? null,
    pair: p.get("pair")?.toUpperCase() ?? null,
  };
}

/**
 * push=true adds a browser history entry (picking a city or destination), so Back returns to the previous view;
 * filter changes just replace the current entry.
 */
export function writeUrlState(state: UrlState, push = false): void {
  const p = new URLSearchParams();
  if (state.country && state.country !== "IN") p.set("country", state.country);
  if (state.from) {
    p.set("from", state.from);
    if (state.to) p.set("to", state.to);
    if (state.show && state.show !== "all") p.set("show", state.show);
    if (state.airline) p.set("airline", state.airline);
  } else if (state.pair) {
    p.set("pair", state.pair);
  }
  const qs = p.toString();
  const url = qs ? `?${qs}` : window.location.pathname;
  if (`?${qs}` === window.location.search || (!qs && !window.location.search)) return;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}
