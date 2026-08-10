# Notice Explore

A personal travel memory app for iOS. Notice Explore is where you log, revisit, and rediscover the places that matter to you — not a pin on a map, but a curated record of your own discoveries.

---

## Vision

Most map apps treat saved places as bookmarks. Notice Explore treats them as memories.

The problem with Google Maps, Apple Maps, and similar tools is that they're built for navigation, not for the traveller who wants to remember *why* they saved a place, find it again years later in a different city, or have the app quietly tap them on the shoulder when they're walking past something they once wanted to visit.

**Notice Explore does three things well:**
1. **Save beautifully** — name, category, your own note, exact coordinates, and address in one quick flow
2. **Remember passively** — proximity notifications alert you when you're near a saved place, even when the app is closed
3. **Rediscover intelligently** — AI-powered route building and natural language search let you find and plan around your own history

The target user is someone who travels — domestically or internationally — and wants a private, personal record of places they've been or want to go, organized the way their memory actually works (by city, by trip, by type of place).

---

## Current Feature Status

| Feature | Status |
|---|---|
| Save places (name, category, note, address, coords) | ✅ Shipped |
| Google Places address + establishment autocomplete | ✅ Shipped |
| Map with pins, long-press to drop, tap to view | ✅ Shipped |
| GPS user location dot + re-centre button | ✅ Shipped |
| Map opens on last known device location | ✅ Shipped |
| Background proximity notifications (Always Allow) | ✅ Shipped |
| List tab with city folders (auto-grouped by address) | ✅ Shipped |
| Swipe to edit / delete from list | ✅ Shipped |
| Tap card → Edit or Add to Route | ✅ Shipped |
| Route tab (manual stop ordering) | ✅ Shipped |
| Profile: notification radius slider (ft / m) | ✅ Shipped |
| AI route intelligence (Claude via Cloudflare Worker) | ✅ Worker deployed, wired up |
| TestFlight distribution (EAS build + submit) | ✅ Build 1 uploaded |
| AI natural language place search (Claude) | 🔜 Planned |
| Editable city folder names | 🔜 Planned |
| Cloud sync / multi-device | 🔜 Planned (requires backend) |
| User accounts + auth | 🔜 Planned (requires backend) |
| Instagram import | 🔜 Planned |
| App Store release | 🔜 Planned |

---

## Tech Stack

### Mobile (current)
- **React Native** via **Expo SDK 55** (canary)
- **Expo Router v4** — file-based routing
- **SQLite** (`expo-sqlite`) — local-first storage, no backend required yet
- **expo-location** — foreground GPS + background location task
- **expo-notifications** — local proximity alerts with 24-hour cooldown
- **expo-task-manager** — background location task (`notice-explore-background-location`)
- **react-native-maps** — MapKit on iOS
- **react-native-google-places-autocomplete** — address + establishment search
- **Google Places API** + **Google Geocoding API** — address resolution
- **AsyncStorage** — user preferences (notification radius, ft/m unit, cooldowns)
- **TypeScript** throughout

### Design
- **Libre Baskerville** — place names only (serif, warmth)
- **DM Sans** — all other UI text (clean, readable)
- Colour palette: forest `#2D5A30`, sage `#6B8F6E`, mist `#F0F4EF`, ink `#0F1A0F`

### Backend (in progress — Cloudflare)
The app is currently local-first. The backend layer is being introduced incrementally starting with the AI proxy:

- **Cloudflare Workers** — serverless functions at the edge (generous free tier, global, zero cold-start)
- **Anthropic Claude API** — called from the Worker, **never from the client** (see Security below)
- **Cloudflare D1** — SQLite-compatible edge database (planned, for cloud sync)
- **Cloudflare R2** — object storage for any media / assets (planned)

Cloudflare is chosen for its free tier generosity, zero cold-starts, and global edge deployment. AWS remains an option for future scale if Cloudflare's limits become a constraint.

### AI Integration (planned)

Two Claude-powered features are planned. Both must be called via the backend — the API key must never be in the app bundle.

**1. Route Intelligence**
- User selects saved places and asks Claude to build an itinerary
- Claude returns an ordered list with suggested time at each stop, walking/transit segments, and a brief rationale per stop
- Input: list of place names + coordinates + user's available hours
- Model: `claude-sonnet-5` (fast, cost-effective for structured output)

**2. Natural Language Place Search**
- User types something like *"that café in Paris with the good coffee"* or *"museums I saved in Japan"*
- Claude searches across the user's saved place names, notes, categories, and addresses
- Returns ranked matches with a short explanation of why each matches
- Input: query string + serialised place list (or embeddings for large collections)
- Model: `claude-haiku-4-5` (cheapest, low latency — search needs to feel instant)

---

## Security

**The Anthropic API key must never be shipped inside the app bundle.**

`EXPO_PUBLIC_` environment variables are baked into the JavaScript bundle at build time. Anyone who downloads the `.ipa`, unzips it, and reads the bundle can find them. The key currently lives in `.env` — it must move to the backend before any Claude features go live or before the app is distributed publicly.

**Correct architecture (now in place for AI features):**
```
App  →  Cloudflare Worker (holds ANTHROPIC_API_KEY as a secret)  →  Claude API
```

The Worker:
- Holds the API key as a Cloudflare secret — it never touches the app bundle
- Validates inputs (vibe, places count, hours) before forwarding to Claude
- Returns only Claude's selection to the app — the raw key is never returned

The Anthropic key has been removed from `.env`. The old key should be revoked at console.anthropic.com → API Keys.

---

## Repository

- **Repo**: `tris-cae/tca-wander` (GitHub)
- **Bundle ID**: `com.tristanandrews.noticeexplore`
- **Expo project**: `@andrewsinc/noticeexplore`
- **App Store Connect ID**: `6799788158`
- **Privacy policy**: https://tris-cae.github.io/tca-wander/privacy.html (GitHub Pages, `docs/`)
- **Default branch**: `main`

### Local build & install on device
```bash
LANG=en_US.UTF-8 npx expo run:ios --device "Tristan's iPhone" --configuration Release
```
After install, trust the profile at **Settings → General → VPN & Device Management** if prompted.

### Cloud build & ship to TestFlight
Build config lives in `eas.json` — build profiles and submit settings are
committed, not configured by hand in a dashboard.
```bash
eas build  --platform ios --profile production
eas submit --platform ios --profile production
```

### Cloudflare Worker (AI itinerary proxy)
Config lives in `worker/wrangler.toml`. The Anthropic key is a Wrangler
secret and is never in the repo or the app bundle.
```bash
cd worker
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY   # only when rotating the key
```

### Environment variables (`.env` — not committed)
```
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=...       # Google Places + Geocoding API
EXPO_PUBLIC_ITINERARY_WORKER_URL=...        # Cloudflare Worker URL (from wrangler deploy)
```
For EAS cloud builds these are stored as EAS secrets rather than read from
`.env` — see `eas secret:list`.

---

## Design Principles

1. **Local-first** — the app works fully offline. Backend is an enhancement, not a dependency.
2. **Calm** — no feeds, no engagement loops, no gamification. The app surfaces information when it's useful and stays quiet otherwise.
3. **Personal** — all data belongs to the user. No algorithmic recommendations from strangers.
4. **Fast to save** — the save flow should take under 30 seconds from opening the screen to tapping Save.

---

## Roadmap Priority Order

1. ~~Move Anthropic key to a server-side proxy~~ ✅ Done (Cloudflare Worker)
2. AI route intelligence (ties into existing Route tab)
3. AI natural language place search
4. Editable city folder names
5. Instagram import (parse saved posts for place names)
6. Cloud sync + user accounts (Cloudflare D1 + auth)
7. App Store submission
