import * as SQLite from 'expo-sqlite';
import type { Day, Itinerary, Place, Trip } from './models';

// ─── Connection ───────────────────────────────────────────────────────────────

// The single shared database connection reused across the whole app
let _db: SQLite.SQLiteDatabase | null = null;

// Opens the on-device database file and creates all tables if they don't exist yet.
// Call this once near the top of your app (e.g. in App.tsx or _layout.tsx) before
// using any other function in this file.
export async function initDb(): Promise<void> {
  // Guard: if already initialised in this JS context, do nothing.
  // The background location task may call this in a fresh context after app
  // termination — the guard prevents double-opens when the app is running.
  if (_db) return;
  _db = await SQLite.openDatabaseAsync('travel.db');
  await _createTables(_db);
}

// Returns the open database connection, or throws a helpful error if initDb()
// was never called.
function getDb(): SQLite.SQLiteDatabase {
  if (!_db) {
    throw new Error(
      'Database not initialised — call initDb() once before using any db functions.'
    );
  }
  return _db;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

async function _createTables(db: SQLite.SQLiteDatabase): Promise<void> {
  // WAL (Write-Ahead Logging) makes the database faster and more crash-safe
  await db.execAsync('PRAGMA journal_mode = WAL;');
  // Tell SQLite to enforce foreign key rules (it doesn't do this by default)
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // Stores every saved place the user has added
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS places (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      category   TEXT NOT NULL,
      lat        REAL NOT NULL,
      lng        REAL NOT NULL,
      address    TEXT,
      note       TEXT,
      sourceUrl  TEXT,
      sourceType TEXT NOT NULL,
      savedAt    TEXT NOT NULL
    );
  `);

  // Migration: add address column to existing databases that predate this field
  try {
    await db.execAsync(`ALTER TABLE places ADD COLUMN address TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add visited flag (Bug 13) — 0 = not visited, 1 = visited
  try {
    await db.execAsync(
      `ALTER TABLE places ADD COLUMN visited INTEGER NOT NULL DEFAULT 0`
    );
  } catch {
    // Column already exists — safe to ignore
  }

  // Index on lat and lng so coordinate lookups are fast
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_places_lat_lng ON places (lat, lng);
  `);

  // Tracks when each place last triggered a proximity notification.
  // Used to enforce the 24-hour cooldown so the user isn't spammed.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS notification_log (
      placeId        TEXT PRIMARY KEY,
      lastNotifiedAt TEXT NOT NULL
    );
  `);

  // Stores each trip the user creates
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS trips (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      destination TEXT NOT NULL,
      startDate   TEXT NOT NULL,
      endDate     TEXT NOT NULL
    );
  `);

  // Links places to trips — one place can appear in many trips
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS trip_places (
      tripId  TEXT NOT NULL REFERENCES trips(id)  ON DELETE CASCADE,
      placeId TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      PRIMARY KEY (tripId, placeId)
    );
  `);

  // Stores individual days within a trip
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS days (
      id     TEXT PRIMARY KEY,
      tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      date   TEXT NOT NULL
    );
  `);

  // Links places to days, with a sort order so they stay in the right sequence
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS day_places (
      dayId     TEXT    NOT NULL REFERENCES days(id)   ON DELETE CASCADE,
      placeId   TEXT    NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (dayId, placeId)
    );
  `);

  // Stores itineraries — one itinerary per trip
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS itineraries (
      id     TEXT PRIMARY KEY,
      tripId TEXT NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE
    );
  `);

  // Links days to an itinerary in a specific order
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS itinerary_days (
      itineraryId TEXT    NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
      dayId       TEXT    NOT NULL REFERENCES days(id)        ON DELETE CASCADE,
      sortOrder   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (itineraryId, dayId)
    );
  `);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Generates a unique ID from the current timestamp and a random string.
// Collision-resistant enough for local data on a single device.
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Returns the current moment as an ISO string (e.g. "2026-03-28T10:00:00.000Z")
function now(): string {
  return new Date().toISOString();
}

// The shape of a raw row coming back from the places table
type PlaceRow = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  address: string | null;
  note: string | null;
  sourceUrl: string | null;
  sourceType: 'instagram' | 'maps' | 'manual';
  savedAt: string;
  visited: number;  // SQLite stores booleans as integers: 0 = false, 1 = true
};

// Converts a flat database row into a Place object with a nested coordinates object
function rowToPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    // Lift lat and lng out of the flat row into the nested coordinates shape
    coordinates: { lat: row.lat, lng: row.lng },
    address: row.address,
    note: row.note,
    sourceUrl: row.sourceUrl,
    sourceType: row.sourceType,
    savedAt: row.savedAt,
    // SQLite returns 0/1 integers — convert to a proper boolean
    visited: row.visited === 1,
  };
}

// Fetches all places linked to a trip (used internally when building a Trip object)
async function _getTripPlaces(
  db: SQLite.SQLiteDatabase,
  tripId: string
): Promise<Place[]> {
  const rows = await db.getAllAsync<PlaceRow>(
    `SELECT p.*
       FROM places p
       JOIN trip_places tp ON tp.placeId = p.id
      WHERE tp.tripId = ?
      ORDER BY p.savedAt DESC`,
    [tripId]
  );
  return rows.map(rowToPlace);
}

// Fetches all places planned for a day, in their intended visit order
async function _getDayPlaces(
  db: SQLite.SQLiteDatabase,
  dayId: string
): Promise<Place[]> {
  const rows = await db.getAllAsync<PlaceRow>(
    `SELECT p.*
       FROM places p
       JOIN day_places dp ON dp.placeId = p.id
      WHERE dp.dayId = ?
      ORDER BY dp.sortOrder ASC`,
    [dayId]
  );
  return rows.map(rowToPlace);
}

// Fetches all days belonging to an itinerary, in order, each with their places
async function _getItineraryDays(
  db: SQLite.SQLiteDatabase,
  itineraryId: string
): Promise<Day[]> {
  const rows = await db.getAllAsync<{ id: string; tripId: string; date: string }>(
    `SELECT d.*
       FROM days d
       JOIN itinerary_days itd ON itd.dayId = d.id
      WHERE itd.itineraryId = ?
      ORDER BY itd.sortOrder ASC`,
    [itineraryId]
  );
  return Promise.all(
    rows.map(async (row) => {
      const places = await _getDayPlaces(db, row.id);
      return { ...row, places };
    })
  );
}

// ─── Places — Save ────────────────────────────────────────────────────────────

// Saves a brand-new place to the database.
// You don't need to provide id, savedAt, or visited — they are set automatically.
// Returns the complete Place object including the generated id and savedAt.
export async function savePlace(
  input: Omit<Place, 'id' | 'savedAt' | 'visited'>
): Promise<Place> {
  const db = getDb();
  // New places always start as unvisited
  const place: Place = { ...input, id: generateId(), savedAt: now(), visited: false };

  await db.runAsync(
    `INSERT INTO places (id, name, category, lat, lng, address, note, sourceUrl, sourceType, savedAt, visited)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      place.id,
      place.name,
      place.category,
      place.coordinates.lat,  // Flatten nested coordinates into separate columns
      place.coordinates.lng,
      place.address,
      place.note,
      place.sourceUrl,
      place.sourceType,
      place.savedAt,
      0,                      // visited = false
    ]
  );

  console.log('[DB] savePlace success:', JSON.stringify(place));
  return place;
}

// ─── Places — Read ────────────────────────────────────────────────────────────

// Fetches a single place by its ID. Returns null if no place with that ID exists.
export async function getPlace(id: string): Promise<Place | null> {
  const db = getDb();
  const row = await db.getFirstAsync<PlaceRow>(
    `SELECT * FROM places WHERE id = ?`,
    [id]
  );
  return row ? rowToPlace(row) : null;
}

// Returns every saved place, most recently saved first.
export async function getAllPlaces(): Promise<Place[]> {
  const db = getDb();
  const rows = await db.getAllAsync<PlaceRow>(
    `SELECT * FROM places ORDER BY savedAt DESC`
  );
  const places = rows.map(rowToPlace);
  console.log(`[DB] getAllPlaces returned ${places.length} row(s)`);
  return places;
}

// Finds a place stored at an exact lat/lng coordinate.
// Useful for deduplication — checking if a pin has already been saved.
// Returns null if nothing matches exactly.
export async function getPlaceByCoordinates(
  lat: number,
  lng: number
): Promise<Place | null> {
  const db = getDb();
  const row = await db.getFirstAsync<PlaceRow>(
    `SELECT * FROM places WHERE lat = ? AND lng = ?`,
    [lat, lng]
  );
  return row ? rowToPlace(row) : null;
}

// Finds all places within a given radius of a coordinate.
// Uses a bounding-box SQL query (fast — hits the lat/lng index) followed by
// a haversine post-filter to trim the square corners down to a true circle.
export async function getPlacesNearCoordinates(
  lat: number,
  lng: number,
  radiusKm: number = 1
): Promise<Place[]> {
  const db = getDb();

  // 1 degree of latitude ≈ 111.32 km
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));

  const rows = await db.getAllAsync<PlaceRow>(
    `SELECT * FROM places
      WHERE lat BETWEEN ? AND ?
        AND lng BETWEEN ? AND ?
      ORDER BY savedAt DESC`,
    [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta]
  );

  // Post-filter: haversine check removes corner candidates that are inside
  // the bounding box but outside the actual circle radius.
  return rows
    .map(rowToPlace)
    .filter((p) => haversineKm(lat, lng, p.coordinates.lat, p.coordinates.lng) <= radiusKm);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ─── Places — Update ──────────────────────────────────────────────────────────

// Updates one or more fields on an existing place.
// Only pass the fields you want to change — everything else stays the same.
export async function updatePlace(
  id: string,
  updates: Partial<Omit<Place, 'id' | 'savedAt'>>
): Promise<void> {
  const db = getDb();

  // Build the SET clause from only the fields that were actually passed in
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.category !== undefined) {
    fields.push('category = ?');
    values.push(updates.category);
  }
  if (updates.coordinates !== undefined) {
    // Coordinates are stored as two separate columns
    fields.push('lat = ?', 'lng = ?');
    values.push(updates.coordinates.lat, updates.coordinates.lng);
  }
  if (updates.address !== undefined) {
    fields.push('address = ?');
    values.push(updates.address);
  }
  if (updates.note !== undefined) {
    fields.push('note = ?');
    values.push(updates.note);
  }
  if (updates.sourceUrl !== undefined) {
    fields.push('sourceUrl = ?');
    values.push(updates.sourceUrl);
  }
  if (updates.sourceType !== undefined) {
    fields.push('sourceType = ?');
    values.push(updates.sourceType);
  }
  if (updates.visited !== undefined) {
    fields.push('visited = ?');
    values.push(updates.visited ? 1 : 0);
  }

  // Nothing to do if no recognised fields were passed
  if (fields.length === 0) return;

  await db.runAsync(
    `UPDATE places SET ${fields.join(', ')} WHERE id = ?`,
    [...values, id]
  );
}

// Toggles the visited flag on a single place without requiring a full updatePlace call.
// Setting visited = true mutes the map pin colour and suppresses proximity notifications.
export async function setPlaceVisited(id: string, visited: boolean): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE places SET visited = ? WHERE id = ?`,
    [visited ? 1 : 0, id]
  );
  console.log(`[DB] setPlaceVisited: place ${id} → visited=${visited}`);
}

// ─── Places — Delete ──────────────────────────────────────────────────────────

// Permanently deletes a place. It is automatically removed from any trips or
// days it was linked to (the database cascades the deletion).
export async function deletePlace(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync(`DELETE FROM places WHERE id = ?`, [id]);
}

// ─── Notification log ─────────────────────────────────────────────────────────

// Returns the last time a proximity notification was sent for this place,
// or null if one has never been sent.
export async function getLastNotifiedAt(placeId: string): Promise<Date | null> {
  const db  = getDb();
  const row = await db.getFirstAsync<{ lastNotifiedAt: string }>(
    `SELECT lastNotifiedAt FROM notification_log WHERE placeId = ?`,
    [placeId]
  );
  return row ? new Date(row.lastNotifiedAt) : null;
}

// Records that a proximity notification just fired for this place.
// Uses INSERT OR REPLACE so subsequent calls simply update the timestamp.
export async function recordNotification(placeId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO notification_log (placeId, lastNotifiedAt)
     VALUES (?, ?)`,
    [placeId, new Date().toISOString()]
  );
}

// ─── Trips — Save ─────────────────────────────────────────────────────────────

// Creates a new trip. Optionally pass an array of existing place IDs to link
// them to the trip straight away.
// Returns the full Trip including its generated id and its places array.
export async function saveTrip(
  input: Omit<Trip, 'id' | 'places'>,
  placeIds: string[] = []
): Promise<Trip> {
  const db = getDb();
  const id = generateId();

  await db.runAsync(
    `INSERT INTO trips (id, name, destination, startDate, endDate)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.name, input.destination, input.startDate, input.endDate]
  );

  // Link any places that were passed in upfront
  for (const placeId of placeIds) {
    await db.runAsync(
      `INSERT OR IGNORE INTO trip_places (tripId, placeId) VALUES (?, ?)`,
      [id, placeId]
    );
  }

  const places = await _getTripPlaces(db, id);
  return { id, ...input, places };
}

// ─── Trips — Read ─────────────────────────────────────────────────────────────

// Fetches a single trip by ID, including all of its linked places.
// Returns null if no trip with that ID exists.
export async function getTrip(id: string): Promise<Trip | null> {
  const db = getDb();
  const row = await db.getFirstAsync<Omit<Trip, 'places'>>(
    `SELECT * FROM trips WHERE id = ?`,
    [id]
  );
  if (!row) return null;

  const places = await _getTripPlaces(db, id);
  return { ...row, places };
}

// Returns all trips, each with their places, ordered by start date (soonest first).
export async function getAllTrips(): Promise<Trip[]> {
  const db = getDb();
  const rows = await db.getAllAsync<Omit<Trip, 'places'>>(
    `SELECT * FROM trips ORDER BY startDate ASC`
  );
  return Promise.all(
    rows.map(async (row) => {
      const places = await _getTripPlaces(db, row.id);
      return { ...row, places };
    })
  );
}

// ─── Trips — Update ───────────────────────────────────────────────────────────

// Updates one or more text fields on a trip.
// Only pass the fields you want to change.
export async function updateTrip(
  id: string,
  updates: Partial<Omit<Trip, 'id' | 'places'>>
): Promise<void> {
  const db = getDb();
  const fields: string[] = [];
  const values: string[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.destination !== undefined) {
    fields.push('destination = ?');
    values.push(updates.destination);
  }
  if (updates.startDate !== undefined) {
    fields.push('startDate = ?');
    values.push(updates.startDate);
  }
  if (updates.endDate !== undefined) {
    fields.push('endDate = ?');
    values.push(updates.endDate);
  }

  if (fields.length === 0) return;

  await db.runAsync(
    `UPDATE trips SET ${fields.join(', ')} WHERE id = ?`,
    [...values, id]
  );
}

// Adds an existing place to a trip. Does nothing if the place is already there.
export async function addPlaceToTrip(tripId: string, placeId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO trip_places (tripId, placeId) VALUES (?, ?)`,
    [tripId, placeId]
  );
}

// Removes a place from a trip. The place itself is not deleted — just unlinked.
export async function removePlaceFromTrip(tripId: string, placeId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `DELETE FROM trip_places WHERE tripId = ? AND placeId = ?`,
    [tripId, placeId]
  );
}

// ─── Trips — Delete ───────────────────────────────────────────────────────────

// Permanently deletes a trip. All days and itineraries that belong to it are
// deleted automatically by the database cascade rules.
export async function deleteTrip(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync(`DELETE FROM trips WHERE id = ?`, [id]);
}

// ─── Days — Save ──────────────────────────────────────────────────────────────

// Creates a new day within a trip. Optionally pass an ordered array of place IDs
// to schedule them for that day straight away.
// Returns the full Day including its generated id and its ordered places array.
export async function saveDay(
  input: Omit<Day, 'id' | 'places'>,
  placeIds: string[] = []
): Promise<Day> {
  const db = getDb();
  const id = generateId();

  await db.runAsync(
    `INSERT INTO days (id, tripId, date) VALUES (?, ?, ?)`,
    [id, input.tripId, input.date]
  );

  // Link places in the exact order they were passed — index becomes the sort order
  for (let i = 0; i < placeIds.length; i++) {
    await db.runAsync(
      `INSERT OR IGNORE INTO day_places (dayId, placeId, sortOrder) VALUES (?, ?, ?)`,
      [id, placeIds[i], i]
    );
  }

  const places = await _getDayPlaces(db, id);
  return { id, ...input, places };
}

// ─── Days — Read ──────────────────────────────────────────────────────────────

// Fetches a single day by ID, including its places in visit order.
// Returns null if no day with that ID exists.
export async function getDay(id: string): Promise<Day | null> {
  const db = getDb();
  const row = await db.getFirstAsync<Omit<Day, 'places'>>(
    `SELECT * FROM days WHERE id = ?`,
    [id]
  );
  if (!row) return null;

  const places = await _getDayPlaces(db, id);
  return { ...row, places };
}

// Returns all days for a given trip, each with their places, ordered by date.
export async function getDaysByTrip(tripId: string): Promise<Day[]> {
  const db = getDb();
  const rows = await db.getAllAsync<Omit<Day, 'places'>>(
    `SELECT * FROM days WHERE tripId = ? ORDER BY date ASC`,
    [tripId]
  );
  return Promise.all(
    rows.map(async (row) => {
      const places = await _getDayPlaces(db, row.id);
      return { ...row, places };
    })
  );
}

// ─── Days — Update ────────────────────────────────────────────────────────────

// Changes the date of an existing day.
export async function updateDay(
  id: string,
  updates: Partial<Pick<Day, 'date'>>
): Promise<void> {
  const db = getDb();
  if (updates.date === undefined) return;
  await db.runAsync(`UPDATE days SET date = ? WHERE id = ?`, [updates.date, id]);
}

// Appends a place to the end of a day's schedule.
export async function addPlaceToDay(dayId: string, placeId: string): Promise<void> {
  const db = getDb();
  // Find the highest existing sort order so we know where to append
  const result = await db.getFirstAsync<{ maxOrder: number | null }>(
    `SELECT MAX(sortOrder) AS maxOrder FROM day_places WHERE dayId = ?`,
    [dayId]
  );
  const nextOrder = (result?.maxOrder ?? -1) + 1;
  await db.runAsync(
    `INSERT OR IGNORE INTO day_places (dayId, placeId, sortOrder) VALUES (?, ?, ?)`,
    [dayId, placeId, nextOrder]
  );
}

// Removes a place from a day's schedule. The place itself is not deleted.
export async function removePlaceFromDay(dayId: string, placeId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `DELETE FROM day_places WHERE dayId = ? AND placeId = ?`,
    [dayId, placeId]
  );
}

// ─── Days — Delete ────────────────────────────────────────────────────────────

// Permanently deletes a day and removes it from any itinerary it belonged to.
// The places themselves are not deleted.
export async function deleteDay(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync(`DELETE FROM days WHERE id = ?`, [id]);
}

// ─── Itineraries — Save ───────────────────────────────────────────────────────

// Creates a new itinerary for a trip. Optionally pass an ordered array of day IDs.
// Each trip can only have one itinerary — creating a second will throw a database error.
// Returns the full Itinerary including its generated id and its ordered days.
export async function saveItinerary(
  input: Omit<Itinerary, 'id' | 'days'>,
  dayIds: string[] = []
): Promise<Itinerary> {
  const db = getDb();
  const id = generateId();

  await db.runAsync(
    `INSERT INTO itineraries (id, tripId) VALUES (?, ?)`,
    [id, input.tripId]
  );

  // Link days in the exact order they were passed
  for (let i = 0; i < dayIds.length; i++) {
    await db.runAsync(
      `INSERT OR IGNORE INTO itinerary_days (itineraryId, dayId, sortOrder) VALUES (?, ?, ?)`,
      [id, dayIds[i], i]
    );
  }

  const days = await _getItineraryDays(db, id);
  return { id, ...input, days };
}

// ─── Itineraries — Read ───────────────────────────────────────────────────────

// Fetches an itinerary by ID, including all its days and each day's places.
// Returns null if no itinerary with that ID exists.
export async function getItinerary(id: string): Promise<Itinerary | null> {
  const db = getDb();
  const row = await db.getFirstAsync<Omit<Itinerary, 'days'>>(
    `SELECT * FROM itineraries WHERE id = ?`,
    [id]
  );
  if (!row) return null;

  const days = await _getItineraryDays(db, id);
  return { ...row, days };
}

// Fetches the itinerary for a given trip. Returns null if one hasn't been created yet.
export async function getItineraryByTrip(tripId: string): Promise<Itinerary | null> {
  const db = getDb();
  const row = await db.getFirstAsync<Omit<Itinerary, 'days'>>(
    `SELECT * FROM itineraries WHERE tripId = ?`,
    [tripId]
  );
  if (!row) return null;

  const days = await _getItineraryDays(db, row.id);
  return { ...row, days };
}

// ─── Itineraries — Update ─────────────────────────────────────────────────────

// Appends a day to the end of an itinerary.
export async function addDayToItinerary(
  itineraryId: string,
  dayId: string
): Promise<void> {
  const db = getDb();
  const result = await db.getFirstAsync<{ maxOrder: number | null }>(
    `SELECT MAX(sortOrder) AS maxOrder FROM itinerary_days WHERE itineraryId = ?`,
    [itineraryId]
  );
  const nextOrder = (result?.maxOrder ?? -1) + 1;
  await db.runAsync(
    `INSERT OR IGNORE INTO itinerary_days (itineraryId, dayId, sortOrder) VALUES (?, ?, ?)`,
    [itineraryId, dayId, nextOrder]
  );
}

// Removes a day from an itinerary. The day itself is not deleted.
export async function removeDayFromItinerary(
  itineraryId: string,
  dayId: string
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `DELETE FROM itinerary_days WHERE itineraryId = ? AND dayId = ?`,
    [itineraryId, dayId]
  );
}

// ─── Itineraries — Delete ─────────────────────────────────────────────────────

// Permanently deletes an itinerary. The trip, days, and places are not deleted.
export async function deleteItinerary(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync(`DELETE FROM itineraries WHERE id = ?`, [id]);
}
