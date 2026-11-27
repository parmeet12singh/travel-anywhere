/** Countries whose names take "the" in a sentence ("flights to the Maldives"). Lists and headings use the bare name. */
const WITH_THE = new Set(["AE", "BQ", "BS", "CC", "CF", "CG", "CK", "CZ", "DO", "FK", "FO", "GB", "GM", "IM", "KM", "KY", "MH", "MP", "MV", "NL", "PH", "SB", "SC", "TC", "US", "VG", "VI"]);

export const inSentence = (c: { iso2: string; name: string }) =>
  WITH_THE.has(c.iso2) && !/^the /i.test(c.name) ? `the ${c.name}` : c.name;
