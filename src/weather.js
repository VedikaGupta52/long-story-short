// Weather lookup via Open-Meteo (no key, free). Resolves to one of our 8
// weather buckets. Uses geolocation; falls back to a stored "last known"
// location, then to "unknown".

import { getWeather, putWeather } from "./db.js";

const FALLBACK_KEY = "journal:lastLocation";

// Map Open-Meteo WMO weather codes -> our 8 buckets.
// Reference: https://open-meteo.com/en/docs (weathercode table).
function bucketFromCode(code, isDay) {
  if (code === 0) return isDay ? "sunny" : "clear_night";
  if (code === 1 || code === 2) return "partly_cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "rain";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "storm";
  return "partly_cloudy";
}

function getCachedLocation() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setCachedLocation(loc) {
  try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(loc)); } catch {}
}

function getCurrentLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(getCachedLocation());
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = {
          lat: +pos.coords.latitude.toFixed(3),
          lon: +pos.coords.longitude.toFixed(3),
        };
        setCachedLocation(loc);
        resolve(loc);
      },
      () => resolve(getCachedLocation()),
      { maximumAge: 60 * 60 * 1000, timeout: 8000 }
    );
  });
}

async function fetchOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast` +
              `?latitude=${lat}&longitude=${lon}` +
              `&current=weather_code,temperature_2m,is_day` +
              `&timezone=auto`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`weather fetch: ${resp.status}`);
  return resp.json();
}

// Returns a bucket string, possibly using a cached value if we already
// looked up this date. We never auto-update once cached — the day's tile
// should be stable.
export async function ensureWeatherForDate(dateKey) {
  const cached = await getWeather(dateKey);
  if (cached) return cached;

  const loc = await getCurrentLocation();
  if (!loc) {
    const record = { date: dateKey, code: null, bucket: "partly_cloudy",
                     tempC: null, lat: null, lon: null,
                     fetchedAt: new Date().toISOString(), source: "fallback" };
    await putWeather(record);
    return record;
  }

  try {
    const data = await fetchOpenMeteo(loc.lat, loc.lon);
    const cur = data.current || {};
    const bucket = bucketFromCode(cur.weather_code, !!cur.is_day);
    const record = {
      date: dateKey,
      code: cur.weather_code ?? null,
      bucket,
      tempC: cur.temperature_2m ?? null,
      isDay: !!cur.is_day,
      lat: loc.lat,
      lon: loc.lon,
      fetchedAt: new Date().toISOString(),
      source: "open-meteo",
    };
    await putWeather(record);
    return record;
  } catch (e) {
    console.warn("weather fetch failed:", e);
    const record = { date: dateKey, code: null, bucket: "partly_cloudy",
                     tempC: null, lat: loc.lat, lon: loc.lon,
                     fetchedAt: new Date().toISOString(), source: "error" };
    await putWeather(record);
    return record;
  }
}
