# Travel Anywhere: design

## Brief

- **Subject:** every place you can fly to non-stop, from any airport in the world. India is the default country.
- **Audience:** travellers, mostly on phones, who know their home city but not their options. Curious ("where can I go from Indore?") more than transactional.
- **Primary job:** pick a city, then see and browse its destinations: where, how far, which airlines, and whether a route is seasonal or starting soon.

## Concept: the flight chart

Pilots navigate with aeronautical charts: pale paper, a quiet base map, and airways printed in **magenta**. The map is the hero; routes are drawn like airways on a chart.

## Principles

1. The map is the content. No marketing hero, no feature cards.
2. Spend boldness on one thing: magenta airways and big IATA codes. Everything else stays quiet.
3. The list is the accessible path. Everything on the map can also be done from the keyboard in the panel.
4. Words say exactly what things are: "Flying from", "Non-stop destinations", "Starts 1 Dec". Sentence case everywhere.

## Colour

Two themes: a daytime chart and a night chart. All text pairs reach at least 4.5:1.

| Token | Light | Dark | Role |
|---|---|---|---|
| `paper` | `#F4F6F5` | `#0F1A23` | App background |
| `surface` | `#FFFFFF` | `#172530` | Panel cards, inputs, chips |
| `ink` | `#17212B` | `#E4EBEF` | Text, IATA codes, origin marker |
| `airway` | `#B5176F` | `#E5609F` | Routes within the same country, primary actions, selected state |
| `ocean` | `#0E6E80` | `#46B6C8` | Routes abroad, the second country in the two-country view |
| `slate` | `#5E6A75` | `#94A4B0` | Secondary text |
| `rule` | `#D3D9DC` | `#2A3946` | Borders, dividers |

Domestic and international routes differ by colour **and** line weight, and every list row names the destination's country, so colour is never the only signal.

## Type

**Barlow**, one family with two widths.

- **Barlow Condensed SemiBold** for IATA codes, the selected city and map labels: codes are set large, like a gate sign.
- **Barlow** 400/500/600 for everything else. Body 16px, line height 1.5. Scale: 13 / 16 / 20 / 28 / 44.

## Layout

Desktop: the map fills the screen; one 400px panel floats on the left. The country picker sits top right, zoom buttons and map credits bottom right.

Phone: the map takes the top 42% of the screen; the panel is a sheet below it and scrolls. The country picker is flag-only and opens as a bottom sheet.

Controls share one system: 44px touch targets with 8px gaps, 8px corners (the country pill is round), 16px from the screen edges, 16px text. A small plane is the cursor; a magenta plane on anything clickable.

## The map

**Base map:** OpenFreeMap (OpenStreetMap data), restyled as a chart: English names only, no road, town or airport labels, borders hidden and replaced by India's official ones. The dark theme repaints it in place.

**Borders:** India's official boundaries throughout (Natural Earth, India point of view): all of Jammu & Kashmir, Ladakh and Arunachal Pradesh. Every land border is a thin grey line. A border two countries share is one line, used by both countries and by the grey outline, so lines never double up.

**The picked country:**
- Its land is lightly tinted (white on the day chart, `#1F3343` at night), drawn under the base map's water so the coast is exactly the base map's shoreline.
- One solid outline for land borders and coast alike: `#454D55` (day) / `#A9B3BA` (night), 1.6px at every zoom. Coasts come from OpenStreetMap's land, so they match the shoreline.
- Its states and provinces are thin lines inside.

**Airport dots (start screen):** every airport of the picked country. Size = number of non-stop destinations (square-root scale); shade = how connected (the lightest shade still reaches 3:1 against the land). Magenta when we have the country's full route lists, teal otherwise.

**The capital:** a ★ and the capital's name on a chip beside its busiest airport's dot, on whichever side covers the fewest dots and stays clear of the controls. The chip is a link: magenta with the clickable cursor on hover; a click opens that airport, or a list when the capital has several. Capitals without an airport get the star on the city itself.

**Crowded dots:** a click where several dots overlap opens a small card listing those airports (busiest first, 44px rows) beside the click, clear of the panel, picker, zoom buttons and credits. More than eight: the map zooms in on the nearest few instead. Hovering a crowded spot says how many airports are there.

**Routes:** arcs draw outward from the origin when a city is picked (the one orchestrated animation, skipped with reduced motion). Destination names are placed around their dots so close airports both get named. On a route page, solid chips at both ends show the city and its local time.

**Two countries:** hover a country for an outline and a small label with its number of routes; click for every route between the two. The picker's country is magenta, the other teal; a border they share alternates both colours. One thin line per airport pair; only the hovered route or airport goes bold.

## The panel

- **Start screen:** "Flying from" search, the busiest airports as cards, the most connected countries as chips, the airport count and a hint to click a country.
- **Search:** city, airport name, code, older names (Bombay, Madras) or a country. Matches in several countries are grouped by country under a small heading, countries with an exact city name first, then by their total routes; each country's airports busiest first. An exact code comes first on its own.
- **City:** the IATA code large, local time and UTC offset, counts, domestic / abroad filter, airline filter, sort, then the destination list.
- **Route:** distance, local time at both ends, and each airline with its logo (on a white tile, initials when there's none), a link to its website, and seasonal / starts / ends notes.

## Behaviour

- **Deep links** for every view: `?from=DEL&to=DXB`, `?country=AE`, `?pair=CN`. The browser's Back and Escape step back one level.
- **Keyboard:** everything is reachable from the panel; the country picker opens with `/`; lists and cards work with the arrow keys and Escape.
- **Reduced motion:** camera moves and the route animation jump instead of animating.
- **Themes:** light and dark, following the system until the visitor picks one; switching is instant.
