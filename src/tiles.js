// Tile picker. Loads the manifest once, then deterministically chooses a
// tile per (date, weather bucket) so the same day always shows the same
// painting on reload — but different days with the same weather get
// different paintings.

let manifestPromise = null;

export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch("assets/tiles/manifest.json").then((r) => {
      if (!r.ok) throw new Error("missing tiles manifest");
      return r.json();
    });
  }
  return manifestPromise;
}

// FNV-1a 32-bit hash — small, fast, no deps. Good enough for picking an
// index from a small array.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export async function pickTile(dateKey, bucket) {
  const manifest = await loadManifest();
  const entries = manifest[bucket] || manifest.partly_cloudy || [];
  if (entries.length === 0) return null;
  const idx = hash32(`${dateKey}|${bucket}`) % entries.length;
  return entries[idx];
}

// For pages that need many tiles at once (the timeline). Resolves an array of
// { date, bucket, tile } objects in one go.
export async function pickTilesForDates(items) {
  const manifest = await loadManifest();
  return items.map(({ date, bucket }) => {
    const entries = manifest[bucket] || manifest.partly_cloudy || [];
    if (entries.length === 0) return { date, bucket, tile: null };
    const idx = hash32(`${date}|${bucket}`) % entries.length;
    return { date, bucket, tile: entries[idx] };
  });
}
