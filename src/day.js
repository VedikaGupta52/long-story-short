// Day editor. Reads ?date=YYYY-MM-DD from the URL, loads the entry (if any),
// renders the day's tile + text + photo, and saves on blur and on ⌘/Ctrl+S.

import { getEntry, putEntry, deleteEntry, getWeather } from "./db.js";
import { ensureWeatherForDate } from "./weather.js";
import { pickTile } from "./tiles.js";
import { longDayLabel, todayKey } from "./dates.js";
import { moonPhaseGlyph, moonPhaseName } from "./moon.js";

function getDateParam() {
  const url = new URL(location.href);
  const d = url.searchParams.get("date");
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return todayKey();
}

function fallbackBucket(dateKey) {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const buckets = ["sunny","partly_cloudy","cloudy","rain","storm","snow","fog","clear_night"];
  return buckets[h % buckets.length];
}

function bucketLabel(b) {
  return ({
    sunny: "sunny", partly_cloudy: "partly cloudy", cloudy: "overcast",
    rain: "rainy", storm: "stormy", snow: "snowy", fog: "foggy",
    clear_night: "clear night",
  })[b] || b;
}

function readBlobAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function showStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

let saveTimer = null;
let currentEntry = null;
let currentDate  = null;

async function save() {
  if (!currentDate) return;
  const text = document.getElementById("text")?.value ?? "";
  const photoBlob = currentEntry?.photoBlob ?? null;
  if (!text.trim() && !photoBlob) {
    if (currentEntry) {
      await deleteEntry(currentDate);
      currentEntry = null;
    }
    showStatus("Empty — not saved");
    return;
  }
  const entry = {
    date: currentDate,
    text,
    photoBlob,
    photoMime: currentEntry?.photoMime ?? null,
    weatherBucket: currentEntry?.weatherBucket ?? null,
    createdAt: currentEntry?.createdAt,
  };
  await putEntry(entry);
  currentEntry = entry;
  showStatus("Saved");
}

function scheduleSave() {
  showStatus("…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save().catch(console.error), 600);
}

async function render() {
  currentDate = getDateParam();
  document.getElementById("day-title").textContent = longDayLabel(currentDate);
  const root = document.getElementById("day");
  root.setAttribute("aria-busy", "true");
  root.replaceChildren();

  // Load weather (cached or fresh for today).
  let weather = await getWeather(currentDate);
  if (!weather && currentDate === todayKey()) {
    try { weather = await ensureWeatherForDate(currentDate); } catch {}
  }
  const bucket = (weather && weather.bucket) || fallbackBucket(currentDate);

  const tile = await pickTile(currentDate, bucket);

  // Hero
  const hero = document.createElement("div");
  hero.className = "day-hero";
  if (tile && tile.file) {
    const img = document.createElement("img");
    img.src = tile.file; img.alt = tile.title || "";
    hero.appendChild(img);
    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "title"; title.textContent = tile.title || "";
    const credit = document.createElement("div");
    credit.className = "credit";
    credit.textContent = [tile.artist, "Wikimedia Commons (public domain)"]
      .filter(Boolean).join(" · ");
    meta.append(title, credit);
    hero.appendChild(meta);
  }
  root.appendChild(hero);

  // Weather/moon strip
  const strip = document.createElement("div");
  strip.className = "day-weather";
  const wp = document.createElement("span");
  wp.className = "pill";
  const tempPart = (weather && weather.tempC != null)
    ? ` · ${Math.round(weather.tempC)}°` : "";
  wp.textContent = `${bucketLabel(bucket)}${tempPart}`;
  strip.appendChild(wp);
  if (bucket === "clear_night") {
    const m = document.createElement("span");
    m.textContent = `${moonPhaseGlyph(new Date(currentDate))} ${moonPhaseName(new Date(currentDate))}`;
    strip.appendChild(m);
  }
  root.appendChild(strip);

  // Load entry
  currentEntry = await getEntry(currentDate);

  // Text
  const ta = document.createElement("textarea");
  ta.className = "day-text";
  ta.id = "text";
  ta.placeholder = "A line or two about your day…";
  ta.value = currentEntry?.text || "";
  ta.addEventListener("input", scheduleSave);
  ta.addEventListener("blur", () => save().catch(console.error));
  root.appendChild(ta);

  // Photo
  const photoWrap = document.createElement("div");
  photoWrap.className = "day-photo";

  const photoImg = document.createElement("img");
  photoImg.id = "photo-preview";
  photoImg.style.display = currentEntry?.photoBlob ? "" : "none";
  if (currentEntry?.photoBlob) {
    photoImg.src = await readBlobAsDataURL(currentEntry.photoBlob);
  }
  photoWrap.appendChild(photoImg);

  const row = document.createElement("div");
  row.className = "photo-row";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    currentEntry = currentEntry || { date: currentDate, text: ta.value };
    currentEntry.photoBlob = f;
    currentEntry.photoMime = f.type;
    photoImg.src = await readBlobAsDataURL(f);
    photoImg.style.display = "";
    await save();
  });

  const addPhoto = document.createElement("button");
  addPhoto.className = "btn subtle";
  addPhoto.textContent = currentEntry?.photoBlob ? "Replace photo" : "Add photo";
  addPhoto.addEventListener("click", () => fileInput.click());
  row.append(addPhoto, fileInput);

  if (currentEntry?.photoBlob) {
    const rm = document.createElement("button");
    rm.className = "btn danger";
    rm.textContent = "Remove photo";
    rm.addEventListener("click", async () => {
      if (!confirm("Remove the photo for this day?")) return;
      if (currentEntry) {
        currentEntry.photoBlob = null;
        currentEntry.photoMime = null;
      }
      photoImg.style.display = "none";
      photoImg.removeAttribute("src");
      await save();
      addPhoto.textContent = "Add photo";
      rm.remove();
    });
    row.appendChild(rm);
  }

  photoWrap.appendChild(row);
  root.appendChild(photoWrap);

  const status = document.createElement("div");
  status.className = "day-status"; status.id = "status";
  root.appendChild(status);

  root.setAttribute("aria-busy", "false");
  ta.focus();
}

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    save().catch(console.error);
  }
});
window.addEventListener("beforeunload", () => {
  // Best-effort flush of any pending debounced save.
  clearTimeout(saveTimer);
  save().catch(() => {});
});

render().catch((e) => {
  console.error(e);
  document.getElementById("day").innerHTML =
    `<p class="loading">Couldn't load: ${e.message}</p>`;
});
