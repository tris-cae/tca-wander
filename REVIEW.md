# Code Review — Wander

**Reviewed:** 2026-08-08 · **Commit:** `b58e3df` · **Reviewer:** Leonard Aziz

The app was read end to end (~5,400 lines across 30 files) and run in the iOS
simulator. Every finding below was reproduced or confirmed against the current
code — each one names the file and line so you can go straight to it.

Overall: the architecture is sound and the hard parts are done well. The data
layer, the theme system, and the split of work in the itinerary generator
(Claude chooses the stops, your code orders them by real distance) are all
solid decisions. Most of what follows is finishing work, not rework.

---

## At a glance

| # | Finding | Where | Severity |
|---|---|---|---|
| 1 | Anthropic API key ships inside the app | `lib/itinerary.ts:138` | 🚦 Blocks release |
| 2 | App is still named `MyFirstApp` / `com.anonymous.*` | `app.json:3-15` | 🚦 Blocks release |
| 3 | Debug notification button is in the shipping UI | `map.tsx:260` | 🚦 Blocks release |
| 4 | Profile tab can break permanently | `profile.tsx:35` | 🐞 Bug |
| 5 | "Generate with AI" deletes stops you added by hand | `route.tsx:89` | 🐞 Bug |
| 6 | App can render before the database is ready | `_layout.tsx:61` | 🐞 Bug |
| 7 | Location tracking can start twice and leak | `map.tsx:106` | 🐞 Bug |
| 8 | One of the four vibes can't be selected | `route.tsx:25` | 🐞 Bug |
| 9 | "Nearby" searches a square, not a circle | `db.ts:300` | 🐞 Bug |
| 10 | Map centres once, with no way to get back | `map.tsx:144` | 🐞 Bug |
| 11 | Instagram / Maps import doesn't exist | `save.tsx:205` | 👻 Promised, absent |
| 12 | Proximity alerts only fire with the app open | `app.json:12` | 👻 Promised, absent |
| 13 | README recommends a command that hides the app | `README.md` | 📄 Docs |

---

## 🚦 Blocks release

These three prevent an App Store submission or create real risk once one
happens. Everything else can ship and be fixed later.

### 1. The Anthropic API key ships inside the app

`lib/itinerary.ts:138` reads the key from `EXPO_PUBLIC_ANTHROPIC_API_KEY` and
calls Anthropic directly from the phone (`:164-178`).

The `EXPO_PUBLIC_` prefix isn't a naming convention — it's Expo's instruction to
**paste the value into the JavaScript bundle at build time**. The key ships to
every install, and there are two easy ways to read it back out:

- An `.ipa` is a zip file. Unzip it and `main.jsbundle` is plain text —
  `strings main.jsbundle | grep sk-ant`. App Store encryption covers the
  compiled binary, not resource files like the JS bundle, and TestFlight builds
  aren't encrypted at all.
- Simpler: run the app through a proxy (Proxyman, mitmproxy), tap the itinerary
  button, and read the key straight off the request header. No reverse
  engineering, about five minutes.

This matters more than a typical leaked credential because **Anthropic keys have
no scopes.** There's no read-only mode and no per-feature restriction — a leaked
key is full access to the workspace with no spending ceiling of its own.

**The fix:** move the Claude call behind a small server-side endpoint that holds
the key. The app sends `{coordinates, hours, vibe, places}`; the server owns the
prompt and model and returns the finished stops. A Cloudflare Worker or a Lambda
does this in about 40 lines, free at this scale. The route ordering stays on the
phone — it's pure maths with no secret involved.

Two things worth knowing when you build it:

- **The caller must control data, never instructions.** An endpoint that accepts
  `{prompt}` and forwards it is a free Claude account for anyone who finds the
  URL. Validate `vibe` against the four known values and cap the size of the
  `places` array, or the endpoint stays narrow in function but becomes
  arbitrarily expensive per call.
- **Hiding the key and capping the bill are separate jobs.** Set a spend limit on
  the Anthropic workspace regardless — it's two minutes in the console and it's
  the only hard ceiling that exists.

`EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` (`save.tsx:41`) is bundled the same way, but
it's a much lower risk: Google keys can be restricted to a single API and given a
hard daily quota. Do that rather than moving it. (Note the app uses the Places
*web service* endpoints, where bundle-ID restrictions are weak — the API
restriction and quota cap are what actually protect you.)

### 2. The app was never given a name

```
package.json:2   "name": "myfirstapp"
app.json:3       "name": "MyFirstApp",  "slug": "MyFirstApp"
app.json:15      "bundleIdentifier": "com.anonymous.MyFirstApp"
```

**A `com.anonymous.*` bundle identifier cannot be submitted to the App Store.**

Worth deciding early rather than at submission time: the bundle ID is the app's
permanent identity. Changing it after any TestFlight build means a new App Store
record — new app entry, testers re-invited, review history gone. It also
namespaces the Keychain, `UserDefaults`, and the push token, so a late change
orphans anything already saved on a tester's device.

Five minutes now, genuinely painful later.

### 3. The debug notification button is in the shipping UI

`map.tsx:260-294` adds a button that finds the nearest saved place and fires a
proximity notification with all the normal guards bypassed. It's visible in the
top-left of the map (it reads `🔕 no places` when nothing is saved).

Invaluable for development — you can't walk around Paris from your desk. But it
shouldn't reach users, and App Review will see it. Gate it behind `if (__DEV__)`
so it compiles out of release builds automatically.

---

## 🐞 Bugs

### 4. The Profile tab can break permanently

`profile.tsx:35` loads the saved settings:

```js
Promise.all([getNotificationsEnabled(), getNotificationRadius()])
  .then(([enabled, radius]) => { ...; setLoaded(true); });
```

There's no `.catch`. If either read fails, `setLoaded(true)` never runs — and the
screen returns `null` until `loaded` is true. The tab renders as a blank white
screen, and because the same read fails on every launch, **it stays blank
forever.** Reinstalling is the only recovery.

The `null`-until-loaded pattern is right (it prevents a flash of default values);
it just needs a failure path. Add a `.catch` that logs the error and calls
`setLoaded(true)` so the screen renders with defaults.

### 5. "Generate with AI" deletes stops you added by hand

`route.tsx:89` is `setStops(result)` — a straight replacement of the whole list.

So: add three places from the map, tap **Generate with AI**, and those three
disappear without warning or any way to undo. The stops came from a different
place (`routeStore`, populated by the map's "Add to today's route"), so from the
user's side this reads as the app throwing away their work.

**Fix:** merge instead of replace, de-duplicating on `placeId` — or ask first if
replacing is genuinely the intent. Silent deletion is the part to remove either
way.

### 6. The app can render before the database is ready

`_layout.tsx:61` hides the splash screen when the fonts are ready:

```js
if (fontsLoaded || fontError) SplashScreen.hideAsync();
```

`dbReady` isn't part of that condition, even though it's tracked a few lines
above. Fonts are usually slower, so this normally works — but on a cold start
with a warm font cache, SQLite can lose the race and the app reveals itself
before any data can be read. The user sees an empty map or list for a moment.

**Fix:** `if ((fontsLoaded || fontError) && dbReady)`. The DB init already has a
`.catch` that sets `dbReady` on failure, so this can't hang the splash.

### 7. Location tracking can start twice and leak

`map.tsx:106` guards against duplicate subscriptions:

```js
if (watchingRef.current) return;                              // :108
const { status } = await Location.requestForegroundPermissions…  // :111
...
watchingRef.current = true;                                   // :127
```

The flag is set *after* the `await`, which leaves a window between the check and
the set. On iOS the permission dialog briefly backgrounds the app, and the
`AppState` listener (`:162`) calls `startWatching(false)` when it returns — while
the first call is still waiting on the dialog and the flag is still `false`.

Both calls pass the guard, two subscriptions are created, and
`locationSubRef.current` is overwritten by the second. The first is never
removed: GPS keeps running with no reference to stop it, draining battery until
the app is killed.

**Fix:** set `watchingRef.current = true` immediately after the guard, before the
`await`, and reset it on the failure paths.

### 8. One of the four vibes can't be selected

`lib/itinerary.ts:7` defines four vibes. `route.tsx:25` lists three:

```js
const VIBES = [
  { key: 'relaxed', … }, { key: 'packed', … }, { key: 'food-focused', … },
];   // 'culture-focused' is missing
```

The itinerary prompt has full handling for `culture-focused` — prioritise
museums, galleries, landmarks, churches — and no user can ever reach it. For a
Paris app this is probably the vibe people want most.

**Fix:** add the fourth entry. One line.

### 9. "Nearby" searches a square, not a circle

`db.ts:300`, `getPlacesNearCoordinates`, converts the radius into latitude and
longitude deltas and queries a bounding box. That's a fast, index-friendly
approach — but a box isn't a circle, so places in the corners are included even
though they're farther away than asked. Worst case is about 1.41× the radius:
with the 1.5 km walking radius, something 2.1 km away can be treated as
walkable.

The comment at `:298` documents the approximation, so this looks deliberate.
Flagging it because the itinerary generator's walking-time assumptions rest on
it. **Fix:** keep the bounding box as a fast pre-filter (that part is the right
design), then drop anything outside the true radius using the `haversineKm`
function that already exists in `lib/itinerary.ts:278`.

### 10. The map centres once, with no way to get back

`map.tsx:144` moves the camera to the user's position on the first GPS fix only,
then latches a flag. There's no recenter-on-me control anywhere — the map has
zoom `+`/`−` (`:200`) and the save button, and nothing else.

So once you pan away from where you are, the only way back is to quit and reopen
the app. Centring once is a reasonable choice on its own — yanking the camera
while someone is panning would be worse — but it needs the manual escape hatch to
go with it. Every map app has this control, and its absence reads as broken.

**Fix:** a locate button that calls `animateToRegion(userCoords)`.

Related: `map.tsx:335` hardcodes the initial region to Paris, which the first GPS
fix immediately overrides. Anyone outside Paris sees the map show Paris and then
jump. Harmless, but worth knowing it's there.

---

## 👻 Features the interface promises but the code doesn't implement

These are the findings hardest to catch from the outside, because the app *looks*
like it does these things.

### 11. Instagram / Maps import doesn't exist

`Place.sourceType` is typed as `'instagram' | 'maps' | 'manual'`
(`lib/models.ts:35`). The database has the column, `updatePlace` can write it,
and **both the map card (`map.tsx:507`) and the list rows render an "Added from
Instagram / Maps" label.**

But the only place in the entire codebase that sets the field is `save.tsx:205`,
which hardcodes `'manual'`. There's no share extension, no URL parser, no import
path of any kind. Those two labels are branches no data can reach.

This looks like the app's most interesting idea — saving a café from a reel and
finding it when you're actually there is a real problem, and it's what would
distinguish this from a Google Maps list. Right now it's designed but not built.

**Confirmed as planned work**, so the data model is a head start rather than dead
weight. Two things to do in the meantime: hide the "Added from…" labels until
something can actually set the field, and treat `sourceType` as the contract the
import writes to when it lands.

Same shape as the `trips`, `days`, and `itineraries` tables in `db.ts`: six
tables and roughly fourteen functions that nothing calls.

### 12. Proximity alerts only fire while the app is open

`lib/notifications.ts` is well built — the radius check, the enable toggle, and a
24-hour cooldown stored in SQLite so you don't get pinged repeatedly for the same
place. The Profile tab exposes all of it.

But `app.json:12` declares only `NSLocationWhenInUseUsageDescription`, and
Android gets `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` with no background
permission. **The app can only check your location while it's open and in the
foreground** — which is exactly when you don't need to be told you're near a
saved place.

Making this work as the settings screen implies means requesting **Always**
location permission and moving to real geofences registered with the OS.

**Battery is not the blocker.** It's worth being precise here, because the
instinct is to assume constant location polling. Registered regions are monitored
by the *operating system*, not by your app — your code isn't running. iOS climbs
a cheap-to-expensive ladder it's already climbing anyway: cell-tower transitions
first, then Wi-Fi fingerprinting, and GPS only when those suggest you're near a
boundary. Your app is woken only when one is actually crossed, and the whole
mechanism is shared with every other app using region monitoring.

| Approach | Battery cost |
|---|---|
| Continuous background GPS at best accuracy | ~10–25% **per hour** |
| Region monitoring (20 geofences) | negligible — low single-digit % **per day** |
| Significant-location-change monitoring | similar to region monitoring |

Roughly two orders of magnitude between the first row and the others, and 20
regions costs about what 1 does — you're paying for the monitoring service, not
per-region polling. The thing that *would* drain the battery is
`allowsBackgroundLocationUpdates` with continuous high-accuracy GPS; that's the
trap to avoid, and it's what most "this app kills my battery" complaints
actually are.

**The real constraint is the 20-region cap and re-registration.** iOS monitors at
most 20 regions per app. A user with 200 saved places needs the *nearest* 20 —
but once they move across the city those are the wrong 20, and the app isn't
running to notice. The standard pattern is to spend one slot on a large
**escape-hatch region** around the user covering the area the other 19 occupy;
crossing it wakes the app to recompute and re-register. **Significant-location-
change** monitoring complements this — it wakes the app roughly every 500m–1km
using cell/Wi-Fi only, costs almost nothing, and doesn't consume a region slot.

Verify the Expo surface early: `expo-location` exposes geofencing via
`startGeofencingAsync` (same 20-region cap), but significant-location-change may
need a small native module. Worth prototyping before committing to the design.

**The bigger risk is a product one, not a technical one.** Always permission
triggers a recurring iOS prompt that shows the user a map of everywhere the app
checked their location and asks whether to keep allowing it. Users revoke at that
screen frequently — it's the main attrition point for background-location
features. If this gets built, ask for Always *after* someone has saved places and
seen the value, never on first launch. App Review will also ask you to justify
the permission.

Worth deciding deliberately, because the alternative — removing the settings that
promise it — is much cheaper and is a legitimate answer.

---

## 📄 Documentation

### 13. The README recommends a command that hides the app

`README.md` is the unmodified `create-expo-app` template — "Welcome to your Expo
app 👋", generic Expo links, nothing about this project.

More urgently, it tells the reader to run `npm run reset-project`. That script is
real (`scripts/reset-project.js:53-77`): it moves the app directories into
`app-example/` and creates an empty `app/` in their place. `app-example` is
listed in `.gitignore:40`, so the moved code lands in an untracked folder.

It's recoverable through git, but anyone following the project's own README will
watch the app disappear. **Deleting that section is a two-minute fix and worth
doing today.**

There's also no `.env.example`, which means a new developer can't run the app and
gets no hint why — place search silently returns nothing and itinerary generation
throws. One has been added in this branch documenting both variables and what
breaks without each.

---

## Questions only you can answer

These are product decisions, not defects. Each one changes what the fixes above
should look like, so they're worth settling before the work starts.

1. ~~**Instagram / Maps import — build it or remove it?**~~ **Decided: building
   it.** The labels stay hidden until the import path exists.

2. **Proximity alerts — commit to Always permission, or scope down?** Foreground
   alerts aren't useful, so the honest options are "build real geofencing" or
   "remove the settings." Leaving it as-is means the Profile tab promises
   something that never happens.

3. **The `trips` / `days` / `itineraries` tables — planned, or leftovers?** Six
   tables and ~14 functions with no callers. If there's a multi-day trip feature
   coming they're a head start; if not, they're weight that makes the data layer
   harder to read.

4. **What is the app called?** Needed for finding #2, and it blocks submission.

---

## Appendix — running the app

```bash
brew install cocoapods          # required for the native build
npm install
cp .env.example .env            # then fill in both keys
npx expo run:ios                # first build takes 10–15 minutes
```

Expo Go won't work — the project is pinned to a canary Expo SDK 55 build, so it
needs a native build.

**Set the simulator to Paris before launching**, or the map opens wherever the
simulator thinks it is:

```bash
xcrun simctl location booted set 48.8566,2.3522
```

Note that changing the location while the app is running moves the location dot
but not the camera (finding #10) — restart the app after setting it.
