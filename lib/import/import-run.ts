// ─── Import orchestrator ──────────────────────────────────────────────────────
//
// The only module the screens import. It walks the pipeline:
//
//   lines → resolve any short links → search each name → rank the matches
//         → flag duplicates → (user reviews) → one batched write
//
// Everything it calls is either a pure function or a single network call, which
// keeps this file about sequencing rather than logic.

import { getAllPlaces, savePlaces } from '../db';
import type { Place } from '../models';
import { findDuplicate } from './detect-duplicates';
import { pickBestMatch } from './match-picking';
import { parseMapsLink } from './parse-maps-link';
import { resolveAndParseLink } from './resolve-link';
import type { Coords, ImportLine, PlaceCandidate, ReviewRow, RowFlag } from './types';
import { searchPlaces, WorkerError } from './worker-client';

export interface RunProgress {
  done: number;
  total: number;
}

/**
 * Looks every line up and builds the rows for the review screen.
 *
 * Lines are processed one at a time rather than in parallel: it keeps the
 * progress count honest, keeps us from firing twenty simultaneous billed
 * requests, and means a failure part-way through still returns everything found
 * so far instead of losing the lot.
 *
 * Never throws for a single bad line — that line comes back flagged. It only
 * throws when the whole run cannot continue, e.g. the device is offline.
 */
export async function runLookup(
  lines: ImportLine[],
  cityCentre: Coords | null,
  onProgress?: (p: RunProgress) => void
): Promise<ReviewRow[]> {
  // Read the existing library once rather than per line
  const existing = (await getAllPlaces()).map((p) => ({
    id: p.id, name: p.name, coordinates: p.coordinates,
  }));

  const rows: ReviewRow[] = [];
  let done = 0;

  for (const line of lines) {
    rows.push(await lookupOneLine(line, cityCentre, existing));
    done += 1;
    onProgress?.({ done, total: lines.length });
  }

  return rows;
}

async function lookupOneLine(
  line: ImportLine,
  cityCentre: Coords | null,
  existing: { id: string; name: string; coordinates: Coords }[]
): Promise<ReviewRow> {

  // ── A link that failed to parse at split time ────────────────────────────
  if (line.error) {
    return emptyRow(line, [{ type: 'bad-link', message: line.error }]);
  }

  // ── A short link still needs opening ─────────────────────────────────────
  let workingLine = line;
  if (line.kind === 'link' && line.coords === null) {
    const resolved = await resolveAndParseLink(line.query);
    if (!resolved.ok) {
      return emptyRow(line, [{ type: 'bad-link', message: resolved.reason }]);
    }
    workingLine = {
      ...line,
      coords: resolved.coords,
      query: resolved.name ?? line.query,
    };
  }

  // ── A link with coordinates needs no search ──────────────────────────────
  // It already carries everything required, so it costs nothing. The address is
  // left null; the city-folder grouping will treat it as ungrouped until the
  // user edits it, which is better than paying for a lookup they did not ask for.
  if (workingLine.coords) {
    const candidate: PlaceCandidate = {
      placeId:  null as unknown as string,  // replaced below when the link carried one
      name:     workingLine.query,
      address:  null,
      coords:   workingLine.coords,
      category: null,
    };
    const fromLink = parseMapsLink(workingLine.query);
    if (fromLink.ok && fromLink.placeId) candidate.placeId = fromLink.placeId;

    return {
      line: workingLine,
      candidates: [candidate],
      selectedIndex: 0,
      checked: true,
      flags: duplicateFlags(candidate, existing, workingLine),
    };
  }

  // ── A plain name: one billed search ──────────────────────────────────────
  let candidates: PlaceCandidate[] = [];
  try {
    candidates = await searchPlaces(workingLine.query, cityCentre);
  } catch (err) {
    // A rate limit or an offline device stops the whole run — there is no point
    // burning through nineteen more lines that will fail the same way.
    if (err instanceof WorkerError && (err.kind === 'rate-limited' || err.kind === 'offline')) {
      throw err;
    }
    return emptyRow(workingLine, [{ type: 'not-found' }]);
  }

  const picked = pickBestMatch(candidates, workingLine.query, cityCentre);

  if (picked.selectedIndex < 0) {
    return {
      line: workingLine,
      candidates: picked.ordered,
      selectedIndex: -1,
      checked: false,
      flags: [{ type: 'not-found' }],
    };
  }

  const chosen = picked.ordered[picked.selectedIndex];
  const flags  = duplicateFlags(chosen, existing, workingLine);

  return {
    line: workingLine,
    candidates: picked.ordered,
    selectedIndex: picked.selectedIndex,
    checked: true,
    flags,
  };
}

function duplicateFlags(
  candidate: PlaceCandidate,
  existing: { id: string; name: string; coordinates: Coords }[],
  line: ImportLine
): RowFlag[] {
  const flags: RowFlag[] = [];

  if (line.uncertain) flags.push({ type: 'uncertain-read' });

  const dup = findDuplicate(candidate.name, candidate.coords, existing);
  if (dup) {
    flags.push({ type: 'duplicate', existingName: dup.existingName, metres: dup.metres });
  }

  return flags;
}

function emptyRow(line: ImportLine, flags: RowFlag[]): ReviewRow {
  return { line, candidates: [], selectedIndex: -1, checked: false, flags };
}

// ─── Writing ──────────────────────────────────────────────────────────────────

/**
 * Writes every ticked row in one transaction, through the same data layer a
 * manual save uses. An imported place differs from a hand-saved one only in its
 * sourceType.
 *
 * @param rows     Rows from the review screen, with the user's choices applied
 * @param category Category to apply to all of them, from the chosen city/trip
 */
export async function commitImport(
  rows: ReviewRow[],
  category: string
): Promise<Place[]> {
  const toSave = rows
    .filter((r) => r.checked && r.selectedIndex >= 0)
    .map((r) => {
      const c = r.candidates[r.selectedIndex];
      return {
        name:        c.name,
        category,
        coordinates: c.coords,
        address:     c.address,
        note:        null,
        sourceUrl:   r.line.kind === 'link' ? r.line.query : null,
        sourceType:  'maps' as const,
        placeId:     c.placeId ?? null,
      };
    });

  if (toSave.length === 0) return [];
  return savePlaces(toSave);
}

/** How many rows are currently ticked and savable. */
export function checkedCount(rows: ReviewRow[]): number {
  return rows.filter((r) => r.checked && r.selectedIndex >= 0).length;
}
