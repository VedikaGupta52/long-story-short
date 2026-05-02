// Backup as a single JSON file. Photos are inlined as base64 strings under
// `entry.photoBase64`. This stays human-readable and trivially restorable —
// no zip dependency in the browser. Files end up small enough (one photo
// per day, JPEGs) that a year's journal is comfortably a few MB.

import { allEntries, allWeather, putEntry, putWeather } from "./db.js";

const BACKUP_VERSION = 1;

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => {
      const s = r.result;
      // strip "data:<mime>;base64,"
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || "application/octet-stream" });
}

export async function exportBackup() {
  const [entries, weather] = await Promise.all([allEntries(), allWeather()]);
  const out = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    startDate: localStorage.getItem("journal:startDate"),
    entries: [],
    weather,
  };
  for (const e of entries) {
    const o = {
      date: e.date,
      text: e.text || "",
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
    if (e.photoBlob) {
      o.photoMime = e.photoMime || e.photoBlob.type || "image/jpeg";
      o.photoBase64 = await blobToBase64(e.photoBlob);
    }
    out.entries.push(o);
  }
  const json = JSON.stringify(out, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `long-story-short-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== "object") throw new Error("malformed backup");
  if (data.version !== BACKUP_VERSION) throw new Error(`unsupported backup version: ${data.version}`);

  if (data.startDate) {
    const existing = localStorage.getItem("journal:startDate");
    // Earliest start wins so importing into a brand-new device doesn't truncate.
    if (!existing || data.startDate < existing) {
      localStorage.setItem("journal:startDate", data.startDate);
    }
  }

  let entriesCount = 0;
  for (const e of data.entries || []) {
    const entry = {
      date: e.date,
      text: e.text || "",
      photoBlob: null,
      photoMime: null,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
    if (e.photoBase64) {
      entry.photoBlob = base64ToBlob(e.photoBase64, e.photoMime);
      entry.photoMime = e.photoMime;
    }
    await putEntry(entry);
    entriesCount++;
  }

  let weatherCount = 0;
  for (const w of data.weather || []) {
    await putWeather(w);
    weatherCount++;
  }
  return { entries: entriesCount, weather: weatherCount };
}
