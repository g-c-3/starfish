// maptiles.js — map tiles saved with a Home location (Decisions 346, 348). On this phone only, in the app's database.
// A tile is stored only after the person viewed it; it is read back with no network. Not part of a backup (a derived copy of what a
// provider served). Deleted with the location (permanent delete) and by Delete all saved maps. The Vault never stores any.
export const TILE_CAP = 150; // tiles per location and provider slot (a few MB at most)
// Each provider slot keeps its own tiles: slot 1 in location_tiles, slot 2 in location_tiles2. The table name comes from this fixed pair only.
const T = (slot) => (slot === 2 ? 'location_tiles2' : 'location_tiles');

export async function cachedTile(db, entryId, z, x, y, slot = 1) {
  const r = ((await db.query(`SELECT data FROM ${T(slot)} WHERE entry_id=? AND z=? AND x=? AND y=?`, [entryId, z, x, y])).values || [])[0];
  return r ? r.data : null;
}

// True when this location has saved tiles for its current coordinates. Tiles saved for other coordinates (the location was edited) are dropped.
export async function hasTiles(db, entryId, lat, lng, slot = 1) {
  const r = ((await db.query(`SELECT lat, lng FROM ${T(slot)} WHERE entry_id=? LIMIT 1`, [entryId])).values || [])[0];
  if (!r) return false;
  if (Math.abs(r.lat - lat) > 1e-9 || Math.abs(r.lng - lng) > 1e-9) { await db.run(`DELETE FROM ${T(slot)} WHERE entry_id=?`, [entryId]); return false; }
  return true;
}

// Returns true when stored; false when the cap is reached or the write fails (the tile still shows, it just is not kept).
export async function storeTile(db, entryId, lat, lng, z, x, y, dataUrl, slot = 1) {
  try {
    const n = ((await db.query(`SELECT COUNT(*) AS c FROM ${T(slot)} WHERE entry_id=?`, [entryId])).values || [])[0];
    if (n && n.c >= TILE_CAP) return false;
    await db.run(`INSERT OR IGNORE INTO ${T(slot)} (entry_id, z, x, y, lat, lng, data) VALUES (?,?,?,?,?,?,?)`, [entryId, z, x, y, lat, lng, dataUrl]);
    return true;
  } catch { return false; }
}

// Both slots: the location is gone or changed, or the person asked for everything to be deleted.
export async function clearTiles(db, entryId) {
  await db.run(`DELETE FROM location_tiles WHERE entry_id=?`, [entryId]);
  await db.run(`DELETE FROM location_tiles2 WHERE entry_id=?`, [entryId]);
}
export async function clearAllTiles(db) { await db.run(`DELETE FROM location_tiles`); await db.run(`DELETE FROM location_tiles2`); }
export async function countTiles(db) {
  const a = ((await db.query(`SELECT COUNT(*) AS c FROM location_tiles`)).values || [])[0];
  const b = ((await db.query(`SELECT COUNT(*) AS c FROM location_tiles2`)).values || [])[0];
  return (a ? a.c : 0) + (b ? b.c : 0);
}
