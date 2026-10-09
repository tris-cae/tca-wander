// Notice Explore — API Worker
//
// Everything that needs an API key runs here, so no key ever ships inside the
// app bundle where anyone can unzip it.
//
//   POST /itinerary         Claude plans a walking route (existing)
//   POST /places/search     Google Places text search for the bulk import
//   POST /screenshots/read  Claude reads place names out of screenshots
//
// Deploy:  wrangler deploy
// Secrets: wrangler secret put ANTHROPIC_API_KEY
//          wrangler secret put GOOGLE_PLACES_API_KEY
//          wrangler secret put APP_TOKEN
// Storage: wrangler kv namespace create RATE_LIMIT   (then paste the id into
//          wrangler.toml — see that file)

export interface Env {
  ANTHROPIC_API_KEY:     string;
  GOOGLE_PLACES_API_KEY: string;
  /** Shared token the app sends. See the honest note in `authorise()`. */
  APP_TOKEN:             string;
  /** KV namespace holding per-device daily counters. */
  RATE_LIMIT:            KVNamespace;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_VIBES = ['relaxed', 'packed', 'food-focused', 'culture-focused'] as const;
const MAX_PLACES  = 30;

const ITINERARY_MODEL  = 'claude-haiku-4-5';
const SCREENSHOT_MODEL = 'claude-haiku-4-5';

/** Most searches one device may run in a rolling day. */
const DAILY_SEARCH_LIMIT = 120;
/** Most screenshot batches one device may read in a rolling day. */
const DAILY_VISION_LIMIT = 10;
/** Most itineraries one device may generate in a rolling day. */
const DAILY_ITINERARY_LIMIT = 30;

/** Most images in one screenshot request. */
const MAX_IMAGES = 5;
/** Largest single base64 image we accept, roughly 5 MB decoded. */
const MAX_IMAGE_CHARS = 7_000_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Id',
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const denied = authorise(request, env);
    if (denied) return denied;

    const path = new URL(request.url).pathname.replace(/\/$/, '');

    try {
      switch (path) {
        case '':
        case '/itinerary':        return await handleItinerary(request, env);
        case '/places/search':    return await handlePlacesSearch(request, env);
        case '/screenshots/read': return await handleScreenshots(request, env);
        default:                  return json({ error: 'Not found' }, 404);
      }
    } catch (err) {
      // Never leak an internal error to the client
      console.error('[worker] unhandled:', err);
      return json({ error: 'Something went wrong. Nothing was saved.' }, 500);
    }
  },
};

// ─── Authentication ───────────────────────────────────────────────────────────

/**
 * Checks the shared app token.
 *
 * BE HONEST ABOUT WHAT THIS BUYS. The token ships inside the app, so anyone
 * willing to unzip the .ipa can read it. What it stops is the easy attack:
 * someone who finds the Worker URL in network logs or a repo and starts
 * hitting it. It does not stop a determined person who has the binary.
 *
 * The per-device daily caps below are what actually bound the damage, and the
 * only real fix is per-user authentication, which needs accounts (Build 3).
 *
 * Returns a Response when the request should be rejected, or null to continue.
 */
function authorise(request: Request, env: Env): Response | null {
  if (!env.APP_TOKEN) {
    // Fail closed: an unset secret must not mean an open endpoint
    console.error('[worker] APP_TOKEN is not configured');
    return json({ error: 'Service unavailable' }, 503);
  }

  const header = request.headers.get('Authorization') ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!timingSafeEqual(token, env.APP_TOKEN)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

/** Constant-time comparison so the token cannot be guessed a character at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

/**
 * Counts one use against a device's daily allowance.
 *
 * Keyed on the X-Device-Id the app generates per install, falling back to the
 * caller's IP when it is missing. KV is eventually consistent, so a burst of
 * simultaneous requests can slip slightly over the limit — acceptable for a
 * cost backstop, and not something to rely on for correctness.
 */
async function withinRateLimit(
  request: Request,
  env: Env,
  bucket: string,
  limit: number
): Promise<boolean> {
  if (!env.RATE_LIMIT) return true;   // namespace not bound yet — do not lock users out

  const device =
    request.headers.get('X-Device-Id') ??
    request.headers.get('CF-Connecting-IP') ??
    'unknown';

  const day = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
  const key = `${bucket}:${day}:${device}`;

  const current = parseInt((await env.RATE_LIMIT.get(key)) ?? '0', 10) || 0;
  if (current >= limit) return false;

  // Expires a little over a day later so yesterday's keys clean themselves up
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 90_000 });
  return true;
}

// ─── Places search ────────────────────────────────────────────────────────────

interface SearchBody {
  query: string;
  bias:  { lat: number; lng: number; radiusM: number } | null;
}

async function handlePlacesSearch(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_PLACES_API_KEY) {
    return json({ error: 'Search is not configured' }, 503);
  }
  if (!(await withinRateLimit(request, env, 'search', DAILY_SEARCH_LIMIT))) {
    return json(
      { error: 'That is as many lookups as this device can do today. They reset tomorrow.' },
      429
    );
  }

  let body: SearchBody;
  try { body = await request.json() as SearchBody; }
  catch { return json({ error: 'Invalid request' }, 400); }

  const query = (body.query ?? '').trim();
  if (query.length === 0)   return json({ error: 'Nothing to search for' }, 400);
  if (query.length > 300)   return json({ error: 'That search is too long' }, 400);

  // Text Search (New). The field mask is what sets the billing tier: these four
  // fields are the Pro tier, which returns name, address and coordinates in one
  // call. Adding ratings or opening hours would push it to Enterprise and cost
  // more, so the mask is deliberately minimal.
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.types',
  ].join(',');

  const payload: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 10,
  };

  if (body.bias && isFiniteNumber(body.bias.lat) && isFiniteNumber(body.bias.lng)) {
    payload.locationBias = {
      circle: {
        center: { latitude: body.bias.lat, longitude: body.bias.lng },
        // Google caps the bias radius at 50 km
        radius: Math.min(Math.max(body.bias.radiusM ?? 50_000, 1), 50_000),
      },
    };
  }

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[worker] places search failed:', response.status, text);
    return json({ error: 'The lookup did not finish.' }, 502);
  }

  const data = await response.json() as {
    places?: {
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      types?: string[];
    }[];
  };

  const candidates = (data.places ?? [])
    .filter((p) => p.location && isFiniteNumber(p.location.latitude) && isFiniteNumber(p.location.longitude))
    .map((p) => ({
      placeId:  p.id ?? null,
      name:     p.displayName?.text ?? '',
      address:  p.formattedAddress ?? null,
      coords:   { lat: p.location!.latitude!, lng: p.location!.longitude! },
      category: firstMeaningfulType(p.types),
    }))
    .filter((c) => c.name.length > 0);

  return json({ candidates });
}

/** Google's types array leads with generic entries; take the first useful one. */
function firstMeaningfulType(types: string[] | undefined): string | null {
  const generic = new Set([
    'point_of_interest', 'establishment', 'food', 'premise', 'geocode', 'political',
  ]);
  const useful = (types ?? []).find((t) => !generic.has(t));
  if (!useful) return null;
  const words = useful.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ─── Screenshot reading ───────────────────────────────────────────────────────

const SCREENSHOT_PROMPT = `\
You are reading screenshots a person saved because they contain places they want to visit.
The screenshots may be Instagram posts, TikTok captions, notes apps, articles or messages.

List every place name you can see that is a real, findable venue — a restaurant,
bar, cafe, shop, museum, park, hotel or landmark.

Rules:
- Return the place name only, not surrounding words. "dinner at Sobrino de Botin" is "Sobrino de Botin".
- Include a city only when the screenshot clearly states one for that place.
- Skip hashtags, usernames, generic words ("brunch", "cute cafe") and anything that is not a specific named venue.
- If the same place appears more than once, list it once.
- Set "uncertain" to true when the text was blurry, cut off, or you are guessing at the spelling.
- If you cannot see any place names, return an empty array.

Return ONLY a JSON array, no markdown fences and no commentary:
[{"name": "Sobrino de Botin", "city": "Madrid", "uncertain": false}]`;

async function handleScreenshots(request: Request, env: Env): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Reading screenshots is not configured' }, 503);
  }
  if (!(await withinRateLimit(request, env, 'vision', DAILY_VISION_LIMIT))) {
    return json(
      { error: 'That is as many screenshot batches as this device can read today.' },
      429
    );
  }

  let body: { images?: string[] };
  try { body = await request.json() as { images?: string[] }; }
  catch { return json({ error: 'Invalid request' }, 400); }

  const images = (body.images ?? []).filter((i) => typeof i === 'string' && i.length > 0);

  if (images.length === 0)          return json({ error: 'No images were sent' }, 400);
  if (images.length > MAX_IMAGES)   return json({ error: `Up to ${MAX_IMAGES} images at a time` }, 400);
  if (images.some((i) => i.length > MAX_IMAGE_CHARS)) {
    return json({ error: 'One of those images is too large' }, 413);
  }

  const content = [
    ...images.map((data) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
    })),
    { type: 'text' as const, text: SCREENSHOT_PROMPT },
  ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      SCREENSHOT_MODEL,
      max_tokens: 2048,
      messages:   [{ role: 'user', content }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[worker] screenshot read failed:', response.status, text);
    return json({ error: 'Those screenshots could not be read.' }, 502);
  }

  const data = await response.json() as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
  };

  const raw = data.content?.find((c) => c.type === 'text')?.text ?? '';
  const names = parseNames(raw);

  return json({ names });
}

/**
 * Parses the model's reply into names, tolerating the markdown fence it
 * sometimes adds and discarding anything malformed rather than throwing.
 */
function parseNames(raw: string): { name: string; city: string | null; uncertain: boolean }[] {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch { return []; }

  if (!Array.isArray(parsed)) return [];

  const out: { name: string; city: string | null; uncertain: boolean }[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name.length === 0 || name.length > 200) continue;
    out.push({
      name,
      city:      typeof row.city === 'string' && row.city.trim() ? row.city.trim() : null,
      uncertain: row.uncertain === true,
    });
  }
  return out;
}

// ─── Itinerary (existing) ─────────────────────────────────────────────────────

interface PlaceInput {
  id: string; name: string; category: string;
  coordinates: { lat: number; lng: number }; note?: string;
}
interface ItineraryRequest { places: PlaceInput[]; hours: number; vibe: string; }

const STOP_SCHEMA = `{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["placeId", "name", "category", "coordinates", "suggestedMinutes", "reason"],
    "additionalProperties": false,
    "properties": {
      "placeId":          { "type": "string" },
      "name":             { "type": "string" },
      "category":         { "type": "string" },
      "coordinates":      { "type": "object", "properties": { "lat": { "type": "number" }, "lng": { "type": "number" } } },
      "suggestedMinutes": { "type": "integer", "minimum": 1 },
      "reason":           { "type": "string" }
    }
  }
}`;

const ITINERARY_PROMPT = `\
You are a walking itinerary planner. Given a list of saved places, available time, and a vibe, choose the best subset and assign each a visit duration and a one-sentence reason.

YOUR ONLY JOB IS SELECTION AND TIMING. Do NOT reorder stops — the app sorts them by GPS distance.

Rules:
- Only include places from the provided list. Never invent places.
- Copy placeId, name, category, and coordinates exactly from the input.
- The sum of suggestedMinutes must not exceed the user's available minutes. Budget ~10 min walking between stops.
- relaxed:         2–4 stops, longer visits, prefer cafés and parks.
- packed:          maximise stops within the time budget.
- food-focused:    prioritise restaurants, cafés, markets, bars.
- culture-focused: prioritise museums, galleries, landmarks, churches.

Return ONLY a valid JSON array matching this schema. No markdown, no explanation, no extra text.
${STOP_SCHEMA}`;

async function handleItinerary(request: Request, env: Env): Promise<Response> {
  if (!(await withinRateLimit(request, env, 'itinerary', DAILY_ITINERARY_LIMIT))) {
    return json({ error: 'That is as many routes as this device can generate today.' }, 429);
  }

  let body: ItineraryRequest;
  try { body = await request.json() as ItineraryRequest; }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  if (!VALID_VIBES.includes(body.vibe as typeof VALID_VIBES[number])) {
    return json({ error: `vibe must be one of: ${VALID_VIBES.join(', ')}` }, 400);
  }
  if (!Array.isArray(body.places) || body.places.length === 0) {
    return json({ error: 'places must be a non-empty array' }, 400);
  }

  const hours  = Math.min(Math.max(Number(body.hours) || 1, 0.5), 12);
  const places = body.places.slice(0, MAX_PLACES);

  const totalMinutes = Math.round(hours * 60);
  const placesSummary = places
    .map((p) => JSON.stringify({
      id: p.id, name: p.name, category: p.category,
      coordinates: p.coordinates, ...(p.note ? { note: p.note } : {}),
    }))
    .join('\n');

  const userMessage =
    `Available time: ${totalMinutes} minutes\nVibe: ${body.vibe}\n\n` +
    `Saved places:\n${placesSummary}\n\nReturn your JSON array now.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      ITINERARY_MODEL,
      max_tokens: 2048,
      system:     ITINERARY_PROMPT,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });

  if (response.status === 429) {
    return json({ error: 'Rate limit reached. Please try again in a moment.' }, 429);
  }
  if (!response.ok) {
    console.error('[worker] anthropic error:', response.status, await response.text());
    return json({ error: 'Failed to generate itinerary. Please try again.' }, 502);
  }

  const data = await response.json() as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
  };

  if (data.stop_reason === 'max_tokens') {
    return json({ error: 'Response was cut short. Try fewer hours or places.' }, 502);
  }

  const rawText = data.content?.[0]?.text ?? '';
  if (!rawText) return json({ error: 'Empty response from AI.' }, 502);

  return json({ stops: rawText });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
