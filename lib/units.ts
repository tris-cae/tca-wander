// ─── Distance formatting ──────────────────────────────────────────────────────
//
// One place that turns a raw metre value into display text, so every surface
// in the app (notifications, cards, map callouts) phrases distances the same
// way and honours the same feet/metres preference.
//
// The stored unit is ALWAYS metres. Feet only ever exist at display time.

/** Metres in one foot. */
export const M_PER_FOOT = 0.3048;

export function metresToFeet(m: number): number { return m / M_PER_FOOT; }
export function feetToMetres(ft: number): number { return ft * M_PER_FOOT; }

/**
 * Formats a distance for display, e.g. "250 ft", "0.4 mi", "300 m", "1.2 km".
 *
 * Rounds to the nearest 10 units below the mile/kilometre threshold — GPS is not
 * accurate enough to justify "247 ft", and a round number reads faster in a
 * notification banner.
 *
 * @param metres  Distance in metres (the canonical stored unit)
 * @param useFeet The user's preference, from getUseFeet() in settings.ts
 */
export function formatDistance(metres: number, useFeet: boolean): string {
  if (useFeet) {
    const ft = metresToFeet(metres);
    // Switch to miles at 1/4 mile — beyond that, "1,320 ft" means nothing to anyone
    if (ft >= 1320) return `${(ft / 5280).toFixed(1)} mi`;
    return `${Math.round(ft / 10) * 10} ft`;
  }

  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres / 10) * 10} m`;
}
