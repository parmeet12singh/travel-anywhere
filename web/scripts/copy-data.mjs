// Copies the pipeline output (../data) into public/data so Vite serves it as static files.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "..", "data");
const out = join(root, "public", "data");
rmSync(out, { recursive: true, force: true }); // start clean, so nothing from an earlier run lingers
mkdirSync(out, { recursive: true });
for (const f of ["airports.json", "routes.json", "meta.json", "borders.geojson", "country-areas.geojson", "countries.json"]) copyFileSync(join(src, f), join(out, f));
cpSync(join(src, "countries"), join(out, "countries"), { recursive: true });
// Airline logos are optional: data/logos/ isn't in the public repo (about half are non-free trademarks), so a
// fresh checkout or the live build has none. Only logos whose file exists are listed; the rest show initials.
if (existsSync(join(src, "airlines.json"))) {
  const airlines = JSON.parse(readFileSync(join(src, "airlines.json"), "utf8"));
  let kept = 0;
  for (const a of Object.values(airlines)) {
    if (a.logo && existsSync(join(src, a.logo))) kept++;
    else delete a.logo;
  }
  writeFileSync(join(out, "airlines.json"), JSON.stringify(airlines));
  if (existsSync(join(src, "logos"))) cpSync(join(src, "logos"), join(out, "logos"), { recursive: true });
  console.log(`airline logos: ${kept} found${kept ? "" : " (data/logos/ missing: initials are shown instead)"}`);
}
// Flags from flag-icons (MIT), standard 4:3 versions (the square ones are redrawn adaptations that misplace
// elements, e.g. Bangladesh's disc and Australia's Union Jack). Only the countries the site offers.
const flagsOut = join(root, "public", "flags");
mkdirSync(flagsOut, { recursive: true });
for (const { iso2 } of JSON.parse(readFileSync(join(src, "countries.json"), "utf8"))) {
  const code = iso2.toLowerCase();
  copyFileSync(join(root, "node_modules", "flag-icons", "flags", "4x3", `${code}.svg`), join(flagsOut, `${code}.svg`));
}
console.log(`copied route data to ${out}`);
