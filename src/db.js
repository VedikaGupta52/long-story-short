// Tiny IndexedDB wrapper. Two stores:
//   entries   keyed by "YYYY-MM-DD" — { date, text, photoBlob?, photoMime?,
//                                        weatherCode?, season?, moonPhase?,
//                                        createdAt, updatedAt }
//   weather   keyed by "YYYY-MM-DD" — { date, code, tempC, condition, fetchedAt,
//                                        lat, lon }
// Single-user, no migrations beyond v1.

const DB_NAME = "journal";
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("entries")) {
        db.createObjectStore("entries", { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains("weather")) {
        db.createObjectStore("weather", { keyPath: "date" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode = "readonly") {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function asPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getEntry(date) {
  const store = await tx("entries");
  return asPromise(store.get(date));
}

export async function putEntry(entry) {
  const now = new Date().toISOString();
  entry.updatedAt = now;
  if (!entry.createdAt) entry.createdAt = now;
  const store = await tx("entries", "readwrite");
  return asPromise(store.put(entry));
}

export async function deleteEntry(date) {
  const store = await tx("entries", "readwrite");
  return asPromise(store.delete(date));
}

export async function allEntries() {
  const store = await tx("entries");
  return asPromise(store.getAll());
}

export async function getWeather(date) {
  const store = await tx("weather");
  return asPromise(store.get(date));
}

export async function putWeather(record) {
  const store = await tx("weather", "readwrite");
  return asPromise(store.put(record));
}

export async function allWeather() {
  const store = await tx("weather");
  return asPromise(store.getAll());
}
