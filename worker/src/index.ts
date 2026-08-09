// Notice Explore — Itinerary Worker
//
// Receives place data + user preferences from the app, calls the Anthropic API,
// and returns Claude's stop selection. The Anthropic API key is stored as a
// Worker secret and never reaches the client.
//
// Deploy: wrangler deploy
// Set key: wrangler secret put ANTHROPIC_API_KEY

export interface Env {
  ANTHROPIC_API_KEY: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlaceInput {
  id:          string;
  name:        string;
  category:    string;
  coordinates: { lat: number; lng: number };
  note?:       string;
}

interface ItineraryRequest {
  places: PlaceInput[];
  hours:  number;
  vibe:   string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_VIBES = ['relaxed', 'packed', 'food-focused', 'culture-focused'] as const;
const MAX_PLACES  = 30;
const MODEL       = 'claude-haiku-4-5-20251001';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Prompt ───────────────────────────────────────────────────────────────────

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

const SYSTEM_PROMPT = `\
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

// ─── Handler ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // ── Parse body ────────────────────────────────────────────────────────────

    let body: ItineraryRequest;
    try {
      body = await request.json() as ItineraryRequest;
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    // ── Validate inputs ───────────────────────────────────────────────────────

    if (!VALID_VIBES.includes(body.vibe as typeof VALID_VIBES[number])) {
      return json({ error: `vibe must be one of: ${VALID_VIBES.join(', ')}` }, 400);
    }

    if (!Array.isArray(body.places) || body.places.length === 0) {
      return json({ error: 'places must be a non-empty array' }, 400);
    }

    const hours  = Math.min(Math.max(Number(body.hours) || 1, 0.5), 12);
    const places = body.places.slice(0, MAX_PLACES);

    // ── Build user message ────────────────────────────────────────────────────

    const totalMinutes = Math.round(hours * 60);
    const placesSummary = places
      .map((p) => JSON.stringify({
        id:          p.id,
        name:        p.name,
        category:    p.category,
        coordinates: p.coordinates,
        ...(p.note ? { note: p.note } : {}),
      }))
      .join('\n');

    const userMessage = `Available time: ${totalMinutes} minutes\nVibe: ${body.vibe}\n\nSaved places:\n${placesSummary}\n\nReturn your JSON array now.`;

    // ── Call Anthropic ────────────────────────────────────────────────────────

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 2048,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (anthropicResponse.status === 429) {
      return json({ error: 'Rate limit reached. Please try again in a moment.' }, 429);
    }

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error('Anthropic error:', anthropicResponse.status, errText);
      return json({ error: 'Failed to generate itinerary. Please try again.' }, 502);
    }

    const data = await anthropicResponse.json() as {
      content?:     Array<{ type: string; text?: string }>;
      stop_reason?: string;
    };

    if (data.stop_reason === 'max_tokens') {
      return json({ error: 'Response was cut short. Try fewer hours or places.' }, 502);
    }

    const rawText = data.content?.[0]?.text ?? '';
    if (!rawText) {
      return json({ error: 'Empty response from AI.' }, 502);
    }

    // ── Return Claude's selection to the app ──────────────────────────────────
    // The app handles JSON parsing, validation, and route ordering.

    return new Response(JSON.stringify({ stops: rawText }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
