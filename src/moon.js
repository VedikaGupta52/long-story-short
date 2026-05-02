// Moon phase from a date. Pure math, no API. Algorithm: synodic month from
// a known new moon (2000-01-06 18:14 UTC). Good to within a few hours, which
// is more than enough for an 8-bucket phase indicator.

const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0) / 86400000; // in days

export function moonPhase(date) {
  const days = date.getTime() / 86400000 - KNOWN_NEW_MOON;
  const frac = ((days % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC; // 0..1
  return frac;
}

const PHASE_NAMES = [
  "new moon",
  "waxing crescent",
  "first quarter",
  "waxing gibbous",
  "full moon",
  "waning gibbous",
  "last quarter",
  "waning crescent",
];

export function moonPhaseName(date) {
  const f = moonPhase(date);
  // 8 buckets centered on the canonical phases.
  const i = Math.round(f * 8) % 8;
  return PHASE_NAMES[i];
}

// Unicode-ish glyphs for an unobtrusive accent in the tile corner.
const PHASE_GLYPH = ["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"];
export function moonPhaseGlyph(date) {
  const f = moonPhase(date);
  return PHASE_GLYPH[Math.round(f * 8) % 8];
}
