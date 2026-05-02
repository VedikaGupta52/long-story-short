// Timeline grid view. Renders months from the journal start date (first time
// the app was opened) up to today. Each tile is deterministic per (date,
// weather bucket); past weather is cached, today's is fetched on demand.

import { allEntries, allWeather } from "./db.js";
import { todayKey, fromKey, toKey } from "./dates.js";
import { pickTilesForDates } from "./tiles.js";
import { ensureWeatherForDate } from "./weather.js";
import { moonPhaseGlyph } from "./moon.js";
import { exportBackup, importBackup } from "./export.js";

const START_KEY = "journal:startDate";

function getStartKey() {
  let s = localStorage.getItem(START_KEY);
  if (!s) {
    s = todayKey();
    localStorage.setItem(START_KEY, s);
  }
  return s;
}

// Bucket fallback for past days we never recorded weather for: deterministic
// from date so the timeline is visually varied from day 1, but stable.
function fallbackBucket(dateKey) {
  // FNV-ish small hash → bucket index.
  let h = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const buckets = ["sunny","partly_cloudy","cloudy","rain","storm","snow","fog","clear_night"];
  return buckets[h % buckets.length];
}

function* iterateDates(startKey, endKey) {
  let d = fromKey(startKey);
  const end = fromKey(endKey);
  while (d <= end) {
    yield toKey(d);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
}

// Group day items into months keyed by "YYYY-MM".
function groupByMonth(items) {
  const months = new Map();
  for (const item of items) {
    const ym = item.date.slice(0, 7);
    if (!months.has(ym)) months.set(ym, []);
    months.get(ym).push(item);
  }
  return months;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

function renderMonth(ym, days, todayK) {
  const [y, m] = ym.split("-").map(Number);
  const monthEl = document.createElement("section");
  monthEl.className = "month";

  const label = document.createElement("h2");
  label.className = "month-label";
  label.textContent = `${MONTH_NAMES[m - 1]} ${y}`;
  monthEl.appendChild(label);

  const wkRow = document.createElement("div");
  wkRow.className = "weekday-row";
  for (const w of WEEKDAYS) {
    const s = document.createElement("span");
    s.textContent = w;
    wkRow.appendChild(s);
  }
  monthEl.appendChild(wkRow);

  // Pad leading empty cells so day-of-week aligns.
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();

  let row = document.createElement("div");
  row.className = "day-row";
  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("span");
    blank.className = "tile empty";
    row.appendChild(blank);
  }

  let col = firstWeekday;
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (let dn = 1; dn <= daysInMonth; dn++) {
    if (col === 7) {
      monthEl.appendChild(row);
      row = document.createElement("div");
      row.className = "day-row";
      col = 0;
    }
    const dateKey = `${y}-${String(m).padStart(2, "0")}-${String(dn).padStart(2, "0")}`;
    const item = byDate.get(dateKey);
    const tileEl = item
      ? renderTile(item, dateKey, todayK)
      : renderFutureTile(dateKey);
    row.appendChild(tileEl);
    col++;
  }
  // Trailing blanks to fill the row.
  while (col > 0 && col < 7) {
    const blank = document.createElement("span");
    blank.className = "tile empty";
    row.appendChild(blank);
    col++;
  }
  monthEl.appendChild(row);
  return monthEl;
}

function renderTile(item, dateKey, todayK) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = `day.html?date=${dateKey}`;
  if (dateKey === todayK) a.classList.add("today");

  if (item.tile && item.tile.file) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = item.tile.file;
    img.alt = item.tile.title || "";
    a.appendChild(img);
  } else {
    a.classList.add("empty");
  }

  if (item.hasEntry) {
    const dot = document.createElement("span");
    dot.className = "has-entry-dot";
    a.appendChild(dot);
  }

  if (item.bucket === "clear_night") {
    const moon = document.createElement("span");
    moon.className = "moon";
    moon.textContent = moonPhaseGlyph(fromKey(dateKey));
    a.appendChild(moon);
  }

  const num = document.createElement("span");
  num.className = "day-num";
  num.textContent = String(parseInt(dateKey.slice(-2), 10));
  a.appendChild(num);
  return a;
}

function renderFutureTile(dateKey) {
  const a = document.createElement("a");
  a.className = "tile future empty";
  a.setAttribute("aria-hidden", "true");
  const num = document.createElement("span");
  num.className = "day-num";
  num.textContent = String(parseInt(dateKey.slice(-2), 10));
  a.appendChild(num);
  return a;
}

async function render() {
  const root = document.getElementById("timeline");
  root.setAttribute("aria-busy", "true");
  root.replaceChildren();

  const startKey = getStartKey();
  const todayK = todayKey();

  const dates = [...iterateDates(startKey, todayK)];

  const [entries, weather] = await Promise.all([allEntries(), allWeather()]);
  const entryByDate = new Map(entries.map((e) => [e.date, e]));
  const weatherByDate = new Map(weather.map((w) => [w.date, w]));

  // Lazily fetch today's weather if we don't have it.
  if (!weatherByDate.has(todayK)) {
    try {
      const w = await ensureWeatherForDate(todayK);
      weatherByDate.set(todayK, w);
    } catch {}
  }

  const items = dates.map((date) => {
    const w = weatherByDate.get(date);
    const bucket = (w && w.bucket) || fallbackBucket(date);
    const hasEntry = entryByDate.has(date);
    return { date, bucket, hasEntry };
  });

  const tiled = await pickTilesForDates(items);
  const merged = items.map((it, i) => ({ ...it, tile: tiled[i].tile }));

  // Render newest months first.
  const months = groupByMonth(merged);
  const sortedYms = [...months.keys()].sort().reverse();
  for (const ym of sortedYms) {
    const monthDays = months.get(ym);
    root.appendChild(renderMonth(ym, monthDays, todayK));
  }
  root.setAttribute("aria-busy", "false");
}

function wireExportImport() {
  document.getElementById("export-btn")?.addEventListener("click", () => {
    exportBackup().catch((e) => alert("Export failed: " + e.message));
  });
  const importBtn = document.getElementById("import-btn");
  const fileInput = document.getElementById("import-file");
  importBtn?.addEventListener("click", () => fileInput.click());
  fileInput?.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (!confirm("Import will overwrite existing entries with the same dates. Continue?")) {
      fileInput.value = ""; return;
    }
    try {
      const summary = await importBackup(f);
      alert(`Imported ${summary.entries} entries, ${summary.weather} weather records.`);
      render();
    } catch (e) {
      alert("Import failed: " + e.message);
    } finally {
      fileInput.value = "";
    }
  });
}

wireExportImport();
render().catch((e) => {
  console.error(e);
  document.getElementById("timeline").innerHTML =
    `<p class="loading">Couldn't load: ${e.message}</p>`;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
