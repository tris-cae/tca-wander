// ─── Route Store ──────────────────────────────────────────────────────────────
//
// A lightweight in-memory store for manually-added route stops.
//
// Why a module-level store rather than React context?
//   • It survives tab switches — React state would reset when the Route tab
//     unmounts, losing any places the user added from the Map tab.
//   • No Provider setup needed; any file can import and call directly.
//   • The Route screen subscribes and re-renders only when stops change.
//
// Usage:
//   import { routeStore, placeToStop } from '../../../lib/route-store';
//   routeStore.add(placeToStop(place));    // from Map tab
//   routeStore.subscribe(fn);             // from Route tab

import type { ItineraryStop } from './itinerary';
import type { Place } from './models';

// ── Private module state ──────────────────────────────────────────────────────

let _stops: ItineraryStop[] = [];
const _listeners = new Set<() => void>();

function _notify(): void {
  _listeners.forEach((cb) => cb());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a saved Place into an ItineraryStop so it can slot into the route
 * list alongside AI-generated stops. Uses sensible defaults for fields that
 * only the AI normally fills in.
 */
export function placeToStop(place: Place): ItineraryStop {
  return {
    placeId:          place.id,
    name:             place.name,
    category:         place.category,
    coordinates:      place.coordinates,
    suggestedMinutes: 60,
    reason:           'Manually added to route.',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export const routeStore = {

  /**
   * Add a stop. Silently deduplicates by placeId — calling add() twice for
   * the same place is safe and results in exactly one entry.
   */
  add(stop: ItineraryStop): void {
    if (_stops.some((s) => s.placeId === stop.placeId)) return;
    _stops = [..._stops, stop];
    _notify();
  },

  /** Returns a snapshot of the current stops (immutable copy). */
  getAll(): ItineraryStop[] {
    return _stops;
  },

  /** Remove a stop by placeId (e.g. when the user drags it away). */
  remove(placeId: string): void {
    _stops = _stops.filter((s) => s.placeId !== placeId);
    _notify();
  },

  /** Clear all manually-added stops (e.g. when the user starts a new day). */
  clear(): void {
    _stops = [];
    _notify();
  },

  /**
   * Subscribe to store changes. Returns an unsubscribe function — call it in
   * your useEffect cleanup to avoid memory leaks.
   *
   *   useEffect(() => routeStore.subscribe(() => { ... }), []);
   */
  subscribe(callback: () => void): () => void {
    _listeners.add(callback);
    return () => _listeners.delete(callback);
  },
};
