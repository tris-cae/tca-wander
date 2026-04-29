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

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

// ─── JSON Schema ──────────────────────────────────────────────────────────────

// Formal JSON Schema (draft-07) for the array Claude must return.
// Embedding the schema verbatim in the prompt gives the model a machine-readable
// contract — more precise than prose alone and harder to misinterpret.
// `additionalProperties: false` tells Claude not to invent extra fields.
const STOP_SCHEMA = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["placeId", "name", "category", "coordinates", "suggestedMinutes", "reason"],
    "additionalProperties": false,
    "properties": {
      "placeId": {
        "type": "string",
        "description": "Exact value of the id field from the input place — never invented"
      },
      "name": {
        "type": "string",
        "description": "Exact value of the name field from the input place"
      },
      "category": {
        "type": "string",
        "description": "Exact value of the category field from the input place"
      },
      "coordinates": {
        "type": "object",
        "required": ["lat", "lng"],
        "additionalProperties": false,
        "properties": {
          "lat": { "type": "number" },
          "lng": { "type": "number" }
        },
        "description": "Exact coordinates from the input place — copy verbatim"
      },
      "suggestedMinutes": {
        "type": "integer",
        "minimum": 1,
        "description": "Whole number of minutes to spend here, not counting walking time between stops"
      },
      "reason": {
        "type": "string",
        "description": "Exactly one sentence explaining why this place suits the chosen vibe"
      }
    }
  }
}`;

// ─── System prompt ────────────────────────────────────────────────────────────

// Tells Claude its role, what its output must look like (via the schema above),
// and what it must NOT do (reorder stops — that is handled in code using exact
// GPS distances, which a language model cannot reliably compute).
// Kept outside the function so it isn't re-created on every call.
const SYSTEM_PROMPT = `\
You are a walking itinerary planner. The user has saved places they want to visit.
Given their location, available time, and vibe, choose the best subset of their
saved places and assign each a visit duration and a one-sentence reason.

YOUR ONLY JOB IS SELECTION AND TIMING.
Do NOT reorder stops — the calling code will sort them into an optimal walking
route using exact GPS distances. Return stops in whatever order you like.

Rules:
- Only include places from the list provided — never invent new ones.
- Copy placeId, name, category, and coordinates exactly from the input.
- The sum of all suggestedMinutes must not exceed the user's available minutes.
  Budget roughly 10 minutes of walking time between each pair of stops.
- relaxed:         fewer stops (2–4), longer visits, prefer cafés and parks.
- packed:          maximise the number of stops within the time budget.
- food-focused:    prioritise restaurants, cafés, markets, and bars.
- culture-focused: prioritise museums, galleries, landmarks, and churches.

Output format — return ONLY a valid JSON array conforming to the schema below.
No introduction, no explanation, no markdown fences, no trailing text.

JSON Schema:
${STOP_SCHEMA}

Minimal valid example (one stop):
[{"placeId":"abc123","name":"Le Café","category":"Café","coordinates":{"lat":48.857,"lng":2.352},"suggestedMinutes":45,"reason":"Perfect spot to start a relaxed morning with great coffee and people-watching."}]`;

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

  // ── 1. Check API key ───────────────────────────────────────────────────────

  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Anthropic API key not found. Add EXPO_PUBLIC_ANTHROPIC_API_KEY to your .env file.'
    );
  }

  // ── 2. Fetch nearby places from the database ───────────────────────────────

  const nearbyPlaces = await getPlacesNearCoordinates(
    coordinates.lat,
    coordinates.lng,
    WALKING_RADIUS_KM
  );

  // Nothing nearby — return empty without spending an API call
  if (nearbyPlaces.length === 0) {
    return [];
  }

  // ── 3. Build the prompt ────────────────────────────────────────────────────

  const userMessage = buildUserMessage(coordinates, hours, vibe, nearbyPlaces);

  // ── 4. Call the Anthropic API ──────────────────────────────────────────────

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      // Stable API version — update this if Anthropic releases a newer one
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  // Surface rate-limit errors before trying to read the body
  if (response.status === 429) {
    throw new Error(
      'API rate limit reached. Please wait a moment and try again.'
    );
  }

  if (!response.ok) {
    // Capture the error body so the caller can see what went wrong
    const errorBody = await response.text();
    throw new Error(
      `Anthropic API returned ${response.status}: ${errorBody}`
    );
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
    // 'max_tokens' means the model ran out of token budget mid-response,
    // producing a truncated (and therefore unparseable) JSON string
    stop_reason?: string;
  };

  // A truncated response almost always produces broken JSON — fail fast
  if (data.stop_reason === 'max_tokens') {
    throw new Error(
      'The response was cut short (max_tokens reached). ' +
      'Try reducing the number of hours or saving fewer nearby places.'
    );
  }

  const rawText = data.content?.[0]?.text ?? '';

  // Guard against an unexpectedly empty body before attempting to parse
  if (!rawText) {
    throw new Error('The API returned an empty response.');
  }

  // ── 5. Parse and validate Claude's selection ───────────────────────────────

  const stops = parseResponse(rawText, nearbyPlaces);

  // ── 6. Sort into a minimum-distance walking route ──────────────────────────
  // Claude chose which places to visit and how long to spend at each.
  // We now apply a greedy nearest-neighbour algorithm starting from the user's
  // current position so the physical route involves the least possible walking.

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

// Builds the user-turn message that describes this specific request.
// Includes all nearby places as compact JSON so Claude can reference them.
function buildUserMessage(
  coordinates: { lat: number; lng: number },
  hours: number,
  vibe: Vibe,
  places: Place[]
): string {
  const totalMinutes = Math.round(hours * 60);

  // Give Claude only the fields it needs — keeps the prompt concise
  const placesSummary = places
    .map((p) =>
      JSON.stringify({
        id: p.id,
        name: p.name,
        category: p.category,
        coordinates: p.coordinates,
        // Include the user's personal note if they wrote one — it helps Claude
        // understand why the place was saved in the first place
        note: p.note ?? undefined,
      })
    )
    .join('\n');

  return `\
Current location: lat ${coordinates.lat}, lng ${coordinates.lng}
Available time:   ${totalMinutes} minutes
Vibe:             ${vibe}

Saved places within walking distance:
${placesSummary}

Return your JSON array now. Select and time the stops only — do not reorder them.`;
}

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
