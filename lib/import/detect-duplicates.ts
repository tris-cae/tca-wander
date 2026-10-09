// ─── Duplicate detection ──────────────────────────────────────────────────────
//
// Flags an incoming place that looks like one the user already saved, so the
// review screen can mark it. Deliberately never skips anything automatically —
// two genuinely different places can share a name, and silently dropping one
// would be worse than showing a flag the user can ignore.
//
// The rule: same name, within 100 metres of an existing save.
//
// Distance alone is not enough (a street can hold five cafés) and name alone is
// not enough (chains exist in every city). Both together is a strong signal.

import { haversineKm, normaliseName } from './match-picking';
import type { Coords } from './types';

/** How close two same-named places must be to count as the same place. */
export const DUPLICATE_RADIUS_M = 100;

/** The subset of an existing saved place this check needs. */
export interface ExistingPlace {
  id: string;
  name: string;
  coordinates: Coords;
}

export interface DuplicateHit {
  existingId: string;
  existingName: string;
  /** Distance to the existing save, rounded to whole metres. */
  metres: number;
}

/**
 * Returns the matching saved place, or null when this one looks new.
 *
 * @param candidateName   Name of the place about to be imported
 * @param candidateCoords Its coordinates
 * @param existing        Every place already saved (live ones only)
 */
export function findDuplicate(
  candidateName: string,
  candidateCoords: Coords,
  existing: ExistingPlace[]
): DuplicateHit | null {
  const target = normaliseName(candidateName);
  if (target.length === 0) return null;

  let closest: DuplicateHit | null = null;

  for (const place of existing) {
    if (normaliseName(place.name) !== target) continue;

    const metres = haversineKm(candidateCoords, place.coordinates) * 1000;
    if (metres > DUPLICATE_RADIUS_M) continue;

    // Keep the nearest match when several qualify
    if (!closest || metres < closest.metres) {
      closest = {
        existingId:   place.id,
        existingName: place.name,
        metres:       Math.round(metres),
      };
    }
  }

  return closest;
}
