// ─── Choosing which match to pre-select ───────────────────────────────────────
//
// A search for "Café Central" biased to Madrid can return the Madrid one, a
// Vienna one, and three unrelated cafés. Google returns them in its own order,
// which is good but not aware of which city the user picked.
//
// This re-ranks the candidates so the row opens on the most plausible one, and
// decides when nothing is good enough to pre-check.
//
// Every candidate is always kept — the user can open the row and pick a
// different one. This only decides what is selected by default.

import type { Coords, PlaceCandidate } from './types';

/** Great-circle distance in kilometres. */
export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Lowercases, strips accents and punctuation so "Café Central" matches "cafe central". */
export function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip accent marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How far outside the chosen city a match can sit before it looks wrong. */
const CITY_RADIUS_KM = 50;

export interface ScoredCandidate {
  candidate: PlaceCandidate;
  score: number;
}

/**
 * Scores one candidate against what the user typed and where they said to look.
 *
 * Higher is better. The two things that matter are whether the name actually
 * matches and whether the place is in the city the user chose — a perfect name
 * match in the wrong country is usually not what they meant.
 */
export function scoreCandidate(
  candidate: PlaceCandidate,
  query: string,
  cityCentre: Coords | null
): number {
  const q = normaliseName(query);
  const n = normaliseName(candidate.name);

  let score = 0;

  // Name agreement
  if (n === q)                          score += 100;
  else if (n.startsWith(q))             score += 70;
  else if (n.includes(q))               score += 55;
  else if (q.includes(n))               score += 40;
  else {
    // Partial credit for shared words, so "Botin" still finds "Sobrino de Botín"
    const qWords = new Set(q.split(' ').filter((w) => w.length > 2));
    const nWords = new Set(n.split(' ').filter((w) => w.length > 2));
    let shared = 0;
    for (const w of qWords) if (nWords.has(w)) shared++;
    if (qWords.size > 0) score += Math.round((shared / qWords.size) * 35);
  }

  // Proximity to the chosen city
  if (cityCentre) {
    const km = haversineKm(cityCentre, candidate.coords);
    if (km <= 5)                        score += 40;
    else if (km <= 20)                  score += 30;
    else if (km <= CITY_RADIUS_KM)      score += 20;
    else if (km <= 200)                 score -= 20;
    else                                score -= 60;   // different region entirely
  }

  // A match with a real address is more useful than one without — the city
  // folders are built from the address, so a place with none lands ungrouped.
  if (candidate.address) score += 5;

  return score;
}

/** Below this, the best match is not good enough to tick by default. */
export const MIN_CONFIDENT_SCORE = 45;

export interface PickResult {
  /** All candidates, best first. Never discarded. */
  ordered: PlaceCandidate[];
  /** Index into `ordered` to pre-select, or -1 when nothing is good enough. */
  selectedIndex: number;
  /** True when the best match clears the confidence bar. */
  confident: boolean;
}

/**
 * Orders the candidates and decides which to pre-select.
 *
 * @param candidates What the search returned
 * @param query      What the user typed for this line
 * @param cityCentre Centre of the chosen city, or null if none was picked
 */
export function pickBestMatch(
  candidates: PlaceCandidate[],
  query: string,
  cityCentre: Coords | null
): PickResult {
  if (candidates.length === 0) {
    return { ordered: [], selectedIndex: -1, confident: false };
  }

  const scored: ScoredCandidate[] = candidates.map((candidate) => ({
    candidate,
    score: scoreCandidate(candidate, query, cityCentre),
  }));

  // Stable sort: equal scores keep Google's original ordering, which already
  // reflects its own relevance signals.
  const ordered = scored
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map((s) => s.candidate);

  const bestScore = Math.max(...scored.map((s) => s.score));
  const confident = bestScore >= MIN_CONFIDENT_SCORE;

  return { ordered, selectedIndex: confident ? 0 : -1, confident };
}
