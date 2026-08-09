// ─── Background Location Task ──────────────────────────────────────────────────
//
// This file MUST be imported at the app's entry point (_layout.tsx) so the task
// is registered with TaskManager before any navigation happens.
// TaskManager requires that defineTask() is called synchronously at module level —
// if it runs inside a React component or hook it won't be ready in time.
//
// The task fires whenever the device moves (foreground, background, or after the
// app is terminated by iOS) and runs the same proximity check as the foreground
// GPS watcher in map.tsx.  The 24-hour cooldown inside scheduleProximityAlert
// prevents duplicate notifications from both paths.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { initDb, getAllPlaces } from './db';
import { scheduleProximityAlert } from './notifications';

// ── Task name ─────────────────────────────────────────────────────────────────
// Exported so map.tsx can reference the same string when calling
// startLocationUpdatesAsync / hasStartedLocationUpdatesAsync.

export const BACKGROUND_LOCATION_TASK = 'notice-explore-background-location';

// ── Haversine distance ────────────────────────────────────────────────────────
// Duplicated from map.tsx rather than imported, because TaskManager loads this
// module independently of the React component tree and we want zero coupling.

function haversineDistanceKm(
  from: { latitude: number; longitude: number },
  to:   { lat: number; lng: number }
): number {
  const R    = 6371;
  const dLat = ((to.lat - from.latitude)  * Math.PI) / 180;
  const dLng = ((to.lng - from.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.latitude  * Math.PI) / 180) *
    Math.cos((to.lat         * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Task definition ───────────────────────────────────────────────────────────
// This runs at module-load time. Do NOT move it inside a component or hook.

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[BackgroundLocation] task error:', error.message);
    return;
  }
  if (!data) {
    console.warn('[BackgroundLocation] task fired with no data — skipping');
    return;
  }

  // The task may run in a completely fresh JS context when iOS relaunches the
  // app after it was terminated.  Always ensure the DB connection is open.
  try {
    await initDb();
  } catch (err) {
    console.error('[BackgroundLocation] failed to open DB:', err);
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  const latest = locations[locations.length - 1];
  if (!latest) return;

  const coords = {
    latitude:  latest.coords.latitude,
    longitude: latest.coords.longitude,
  };

  console.log(
    `[BackgroundLocation] update — ` +
    `(${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)})`
  );

  try {
    const places = await getAllPlaces();
    console.log(`[BackgroundLocation] checking ${places.length} place(s)`);

    for (const place of places) {
      if (place.visited) {
        // Visited places are excluded from all proximity checks
        continue;
      }
      const distKm = haversineDistanceKm(coords, place.coordinates);
      const fired  = await scheduleProximityAlert(place, distKm);
      if (fired) {
        console.log(
          `[BackgroundLocation] notification fired for "${place.name}" ` +
          `(${(distKm * 1000).toFixed(0)} m away)`
        );
      }
    }
  } catch (err) {
    console.error('[BackgroundLocation] proximity check failed:', err);
  }
});
