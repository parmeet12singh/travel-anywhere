# Travel Anywhere: design notes

## Brief

- **Subject:** every place you can fly to, non-stop, from an Indian airport.
- **Audience:** Indian travellers, mostly on phones, who know their home city but not their options. Curious ("where can I go from Indore?") more than transactional.
- **Primary job:** pick a city, then see and browse its destinations: where, how far, which airlines, and whether a route is seasonal or starting soon.

## Concept: the flight chart

Pilots navigate with aeronautical charts: pale paper, a quiet base map, and airways printed in **magenta**. That's the one thing aviation people recognise instantly, and no travel site uses it. The map is the hero; routes are drawn like airways on a chart.

## Tokens

| Token | Hex | Role |
|---|---|---|
| `paper` | `#F4F6F5` | App background, panel surfaces (cool chart paper, not cream) |
| `ink` | `#17212B` | Text, IATA codes, origin marker |
| `airway` | `#B5176F` | Domestic routes, primary actions, selected state |
| `ocean` | `#0E6E80` | International routes |
| `slate` | `#5E6A75` | Secondary text (≥4.5:1 on paper) |
| `rule` | `#D3D9DC` | Borders, dividers |

Domestic and international routes differ by **colour and line style** (international arcs are thinner and arch higher), and every list row says "India" or the country name, so colour is never the only signal.

## Type

**Barlow**, one family with two widths: wide-set airport-signage feel without copying any airport's wayfinding.

- **Barlow Condensed SemiBold** for IATA codes and the selected city: the codes are the most characteristic content in this world, so they're set large, like a gate sign.
- **Barlow** 400/500/600 for everything else. Body 16px, line height 1.5. Scale: 13 / 16 / 20 / 28 / 44.
- Sentence case everywhere. No all-caps labels, no tracked-out eyebrows.

## Layout

Desktop: the map fills the screen; one panel floats on the left.

```
┌───────────────────────────────────────────────────────────┐
│ ┌──────────────┐                                          │
│ │ Flying from  │          map, full-bleed                 │
│ │ [ Delhi    ] │                                          │
│ │ DEL  big     │      arcs from the origin                │
│ │ 143 places   │                                          │
│ │ [All|India|  │                                          │
│ │  Abroad]     │                                          │
│ │ airlines ▾   │                                          │
│ │──────────────│                                          │
│ │ list of      │                                          │
│ │ destinations │                                          │
│ │ (scrolls)    │                                          │
│ └──────────────┘                          attribution     │
└───────────────────────────────────────────────────────────┘
```

Phone (375px): the map takes the top 45% of the screen; the panel becomes a sheet below it and scrolls. Everything is left-aligned.

## Behaviour

- **No city picked:** every airport of the picked country shows as a dot, sized by its number of non-stop destinations (square-root scale) and shaded from light to full colour. Clicking a dot, or searching, picks the city.
- **City picked:** arcs draw outward from the origin, which is the one orchestrated animation (skipped with reduced motion). The panel shows the count, filters and list.
- **Hover a row or arc:** that route is emphasised and the rest dim.
- **Click a destination:** a detail view shows distance, the airlines with seasonal/start/end notes, and a link to the Wikipedia article the data came from.
- **Deep links:** `?from=DEL&to=DXB`, so a view can be shared.
- Search accepts city, airport name, code and old names (Bombay, Madras, Calcutta, Bangalore).

## Principles

1. The map is the content. No marketing hero and no feature cards in the first iteration.
2. Spend boldness on one thing: magenta airways and big IATA codes. Everything else stays quiet.
3. The list is the accessible path. Everything on the map can also be done from the keyboard in the list.
4. Words say exactly what things are: "Flying from", "Non-stop destinations", "Starts 1 Dec".

## Review against the brief (what I changed from my first draft)

- My first draft used sky blue plus orange, which is what `ui-ux-pro-max` returned and what every booking site uses. Replaced with chart magenta and ocean teal, which come from the subject itself.
- I'd planned a stat row ("143 destinations / 97 India / 46 abroad") as three big-number tiles. That's the default "big number + small label" treatment, so it became one sentence under the city code instead.
- I dropped a dark theme from iteration 1. The chart look depends on pale paper; a dark version needed its own palette, so it came later (see below) rather than half-done.

## What changed in v1 (after iteration 1)

Every change below was checked against the design skills (ui-ux-pro-max, frontend-design, web-design-guidelines, dataviz) and screenshotted in both themes.

- **Dark theme added**, as its own "night chart": navy land, darker sea, brighter magenta (`#E5609F`) and teal (`#46B6C8`). The base map is repainted in place, so switching is instant with no reload.
- **Official boundaries:** the base map's borders are hidden and India's official borders (Natural Earth, India point of view) are drawn instead, with the picked country's border and state/province lines highlighted in ink.
- **Country picker:** a pill at the top right with the country's flag (real SVG flags, 4:3, not cropped: circular crops distorted national flags). Name shown on desktop; flag only on phones, where the bottom sheet names the selected country. Opens with `/`.
- **Dots:** colour = side (magenta India, teal abroad), size = number of destinations, shade = how connected. The lightest shade keeps 3:1 contrast on the land in both themes.
- **Route page:** solid chips with local time (24h) and a time-of-day icon at both ends, placed on the outer side of each city so they never overlap; the UTC offset in the panel.
- **Two-country view:** hover a country for an outline and a small label; click for both borders (picker country magenta, other country teal, outlines only, no fills) and one thin even line per airport pair. Only the hovered route or airport goes bold. Labels: all of the other country's airports and the five busiest on this side, each trying eight positions around its dot so close airports (Dubai and Sharjah) both get named. Base-map country names are hidden in this view; state lines stay.
- **Controls share one system:** 44px touch targets, 8px corners (the country pill keeps its round shape by choice), 16px from the screen edges, 16px text. Map zoom buttons restyled to match.
- **Cursor:** a small plane on the whole site; magenta plane on anything clickable.
