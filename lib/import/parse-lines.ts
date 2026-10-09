// ─── Turning a block of text into import lines ────────────────────────────────
//
// Splits what the user typed (or what was read from screenshots) into one entry
// per line, works out whether each line is a place name or a pasted Maps link,
// and drops the noise people paste without meaning to — blank lines, bullet
// characters, "1." numbering.
//
// Deliberately forgiving about input and strict about output: anything that
// survives is something we are willing to spend a paid search on.

import { isMapsLink, isShortMapsLink, parseMapsLink } from './parse-maps-link';
import type { ImportLine } from './types';

/** Most lines the user may import in one go. */
export const MAX_LINES = 20;

/** Leading list markers people paste in: "1. ", "- ", "• ", "* ". */
const LIST_MARKER = /^\s*(?:[-–—*•·]|\d{1,3}[.)])\s+/;

/** Longest a single line may be; anything past this is almost certainly a paste error. */
const MAX_LINE_LENGTH = 300;

export interface ParseLinesResult {
  lines: ImportLine[];
  /** Lines that were dropped before searching, and why — shown as a summary. */
  skipped: { raw: string; reason: string }[];
  /** True when the input had more usable lines than MAX_LINES allows. */
  truncated: boolean;
}

/**
 * Parses a block of text into import lines.
 *
 * @param text  Raw contents of the text box, or names joined from screenshots
 * @param limit Maximum lines to keep (defaults to MAX_LINES)
 */
export function parseLines(text: string, limit: number = MAX_LINES): ParseLinesResult {
  const skipped: { raw: string; reason: string }[] = [];
  const lines: ImportLine[] = [];

  // Split on any newline style, then clean each line up
  const rawLines = (text ?? '').split(/\r\n|\r|\n/);

  // Remembers lowercase queries already accepted so the same place typed twice
  // is not searched (and charged for) twice.
  const seen = new Set<string>();

  let truncated = false;

  for (const original of rawLines) {
    let line = original.replace(LIST_MARKER, '').trim();

    // Strip wrapping quotes people get from copying out of a document
    line = line.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

    if (line.length === 0) continue;               // blank lines are not an error

    if (line.length > MAX_LINE_LENGTH) {
      skipped.push({ raw: original, reason: 'Too long to be a place name' });
      continue;
    }

    if (lines.length >= limit) { truncated = true; continue; }

    if (isMapsLink(line)) {
      // A short link has to be opened before its coordinates can be read; the
      // orchestrator does that and re-parses. Mark it so it isn't treated as a
      // name to search for.
      if (isShortMapsLink(line)) {
        lines.push({
          index: lines.length, raw: original, kind: 'link',
          query: line, coords: null, error: null,
        });
        continue;
      }

      const parsed = parseMapsLink(line);
      lines.push({
        index:  lines.length,
        raw:    original,
        kind:   'link',
        query:  parsed.ok ? (parsed.name ?? line) : line,
        coords: parsed.ok ? parsed.coords : null,
        error:  parsed.ok ? null : parsed.reason,
      });
      continue;
    }

    // A bare URL that is not a Maps link is never a place name
    if (/^https?:\/\//i.test(line)) {
      skipped.push({ raw: original, reason: 'Not a Google Maps link' });
      continue;
    }

    const key = line.toLowerCase();
    if (seen.has(key)) {
      skipped.push({ raw: original, reason: 'Listed more than once' });
      continue;
    }
    seen.add(key);

    lines.push({
      index: lines.length, raw: original, kind: 'name',
      query: line, coords: null, error: null,
    });
  }

  return { lines, skipped, truncated };
}

/**
 * How many of these lines will cost a paid search.
 *
 * A link that already carries its coordinates needs no search, so it is free —
 * which matters for the estimate shown before the user commits.
 */
export function billableLineCount(lines: ImportLine[]): number {
  return lines.filter((l) => l.coords === null && l.error === null).length;
}
