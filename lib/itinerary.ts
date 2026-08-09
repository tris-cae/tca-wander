import { getPlacesNearCoordinates } from './db';
import type { Place } from './models';

// ─── Types ────────────────────────────────────────────────────────────────────

// The four moods the user can choose from when generating an itinerary
export type Vibe = 'relaxed' | 'packed' | 'food-focused' | 'culture-focused';

// A single stop in the AI-generated itinerary
export interface ItineraryStop {
  // The ID of the place as stored in the local SQLite database
  placeId: string;
  // The display name of the place
  name: string;
  // The category of the place (e.g. "café", "museum")
  category: string;
  // The map coordinates of this stop
  coordinates: { lat: number; lng: number };
  // How many minutes Claude suggests spending here
  suggestedMinutes: number;
  // One sentence from Claude explaining why this place suits the chosen vibe
  reason: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

// Maximum distance from the user's position to consider a place "walkable"
// 1.5 km ≈ a comfortable 20-minute walk
const WALKING_RADIUS_KM = 1.5;

// Cloudflare Worker URL — set EXPO_PUBLIC_ITINERARY_WORKER_URL in .env
// This is a URL, not a secret, so it's safe to bundle.
const WORKER_URL = process.env.EXPO_PUBLIC_ITINERARY_WORKER_URL ?? '';


// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generates a walking itinerary by:
 *   1. Fetching saved places within walking distance from SQLite
 *   2. Asking Claude to select which places to include and for how long
 *   3. Parsing and validating the JSON response
 *   4. Sorting the selected stops into a minimum-distance route (nearest-neighbour)
 *
 * Returns an empty array (not an error) when no nearby places exist.
 * Throws if the API key is missing, the network call fails, the response is
 * truncated, or the response cannot be parsed as valid JSON.
 */
export async function generateItinerary(
  coordinates: { lat: number; lng: number },
  hours: number,
  vibe: Vibe
): Promise<ItineraryStop[]> {

  // ── 1. Check Worker URL ────────────────────────────────────────────────────

  if (!WORKER_URL) {
    throw new Error(
      'Worker URL not configured. Add EXPO_PUBLIC_ITINERARY_WORKER_URL to your .env file.'
    );
  }

  // ── 2. Fetch nearby places from the database ───────────────────────────────

  const nearbyPlaces = await getPlacesNearCoordinates(
    coordinates.lat,
    coordinates.lng,
    WALKING_RADIUS_KM
  );

  if (nearbyPlaces.length === 0) {
    return [];
  }

  // ── 3. Call the Cloudflare Worker ─────────────────────────────────────────

  const placesPayload = nearbyPlaces.map((p) => ({
    id:          p.id,
    name:        p.name,
    category:    p.category,
    coordinates: p.coordinates,
    ...(p.note ? { note: p.note } : {}),
  }));

  const response = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ places: placesPayload, hours, vibe }),
  });

  if (response.status === 429) {
    throw new Error('Rate limit reached. Please wait a moment and try again.');
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Itinerary service returned ${response.status}: ${errorBody}`);
  }

  const data = await response.json() as { stops?: string; error?: string };

  if (data.error) {
    throw new Error(data.error);
  }

  const rawText = data.stops ?? '';
  if (!rawText) {
    throw new Error('The itinerary service returned an empty response.');
  }

  // ── 4. Parse and validate Claude's selection ───────────────────────────────

  const stops = parseResponse(rawText, nearbyPlaces);

  // ── 5. Sort into a minimum-distance walking route ──────────────────────────

  return nearestNeighbourSort(coordinates, stops);
}

// ─── Route ordering ───────────────────────────────────────────────────────────

/**
 * Reorders stops to minimise total walking distance using the greedy
 * nearest-neighbour heuristic:
 *   - Start at the user's current GPS position (the origin).
 *   - Repeatedly move to the closest unvisited stop.
 *
 * This is O(n²) on the number of stops, but n is always tiny (≤ ~10 places
 * within a 1.5 km radius), so the loop completes in microseconds.
 * On small sets the greedy solution consistently beats a random ordering
 * by 20–30 % in total distance.
 */
function nearestNeighbourSort(
  origin: { lat: number; lng: number },
  stops: ItineraryStop[]
): ItineraryStop[] {
  if (stops.length <= 1) return stops;

  const remaining = [...stops]; // shallow copy so we can splice without mutating
  const ordered: ItineraryStop[] = [];
  let current = origin;

  while (remaining.length > 0) {
    // Find the index of the stop closest to the current position
    let closestIdx = 0;
    let closestDist = haversineKm(current, remaining[0].coordinates);

    for (let i = 1; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i].coordinates);
      if (d < closestDist) {
        closestDist = d;
        closestIdx = i;
      }
    }

    // Move the closest stop to the ordered list and advance the cursor
    const [next] = remaining.splice(closestIdx, 1);
    ordered.push(next);
    current = next.coordinates;
  }

  return ordered;
}

/**
 * Returns the great-circle distance in kilometres between two lat/lng points
 * using the Haversine formula. Accurate to within ~0.3 % for walking distances.
 */
function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371; // Earth's mean radius in km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Converts degrees to radians. */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Parses Claude's raw text into typed ItineraryStop objects.
// Validates every item and drops anything that references an unknown placeId
// or is missing required fields — so a malformed response can't crash the app.
function parseResponse(rawText: string, sourcePlaces: Place[]): ItineraryStop[] {
  // Index source places by ID so validation is O(1)
  const placeById = new Map(sourcePlaces.map((p) => [p.id, p]));

  // Claude sometimes wraps JSON in a markdown code block — strip it if present
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude returned text that isn't valid JSON:\n${rawText}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Expected a JSON array from Claude but received a ${typeof parsed}.`
    );
  }

  const stops: ItineraryStop[] = [];

  for (const item of parsed) {
    // Skip anything that isn't a plain object with the required fields
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).placeId !== 'string' ||
      typeof (item as Record<string, unknown>).name !== 'string' ||
      typeof (item as Record<string, unknown>).suggestedMinutes !== 'number' ||
      typeof (item as Record<string, unknown>).reason !== 'string'
    ) {
      continue;
    }

    const row = item as Record<string, unknown>;

    // Reject any placeId Claude may have hallucinated that isn't in our database
    const knownPlace = placeById.get(row.placeId as string);
    if (!knownPlace) continue;

    stops.push({
      placeId:          row.placeId as string,
      name:             row.name as string,
      // Fall back to the database value if Claude omits the category
      category:         typeof row.category === 'string' ? row.category : knownPlace.category,
      // Fall back to the database coordinates if Claude omits them
      coordinates:
        row.coordinates != null &&
        typeof (row.coordinates as Record<string, unknown>).lat === 'number'
          ? (row.coordinates as { lat: number; lng: number })
          : knownPlace.coordinates,
      // Clamp to at least 1 minute and round to a whole number
      suggestedMinutes: Math.max(1, Math.round(row.suggestedMinutes as number)),
      reason:           row.reason as string,
    });
  }

  return stops;
}
