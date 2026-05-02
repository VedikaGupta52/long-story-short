// Date helpers. Everything in the app keys off "YYYY-MM-DD" in the user's
// local timezone — using ISO date arithmetic in UTC would shift days at
// midnight in unhelpful ways for a journal.

export function todayKey() {
  return toKey(new Date());
}

export function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function daysBetween(a, b) {
  const ms = fromKey(b) - fromKey(a);
  return Math.round(ms / 86400000);
}

const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

export function monthLabel(year, month0) {
  return `${MONTH_NAMES[month0]} ${year}`;
}

export function shortDayLabel(key) {
  const d = fromKey(key);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function longDayLabel(key) {
  const d = fromKey(key);
  return d.toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
}

// Northern-hemisphere meteorological seasons. Used as a tile-picking accent.
export function season(key) {
  const m = fromKey(key).getMonth() + 1;
  if (m === 12 || m <= 2) return "winter";
  if (m <= 5)             return "spring";
  if (m <= 8)             return "summer";
  return "autumn";
}
