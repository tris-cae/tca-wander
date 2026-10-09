// ─── Google Maps link parsing ─────────────────────────────────────────────────
//
// Pulls a place name and its coordinates out of a Google Maps URL.
//
// THE IMPORTANT RULE: coordinates come only from the !3d / !4d fields, never
// from the /@lat,lng segment. The /@ value is where the map *camera* was
// pointing when the link was made, which can be kilometres from the place
// itself — on a real test link the two were 2.58 km apart. Reading /@ would put
// every imported pin in roughly the right neighbourhood and silently wrong.
//
// A short maps.app.goo.gl link has to be followed to its destination before it
// can be parsed; that happens in resolve-link.ts, which then calls this.

import type { Coords } from './types';

export type ParsedMapsLink =
  | { ok: true;  name: string | null; coords: Coords; placeId: string | null }
  | { ok: false; reason: string };

/** True when the text looks like a Google Maps URL of any form. */
export function isMapsLink(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  return /(^|\/\/|\.)(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(t);
}

/** True when the link is a short form that must be resolved before parsing. */
export function isShortMapsLink(text: string): boolean {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(text.trim());
}

/**
 * Parses a fully-resolved Google Maps URL.
 *
 * Returns ok:false with a plain-language reason when the URL carries no usable
 * coordinates — the review screen shows that to the user rather than dropping
 * the line.
 */
export function parseMapsLink(url: string): ParsedMapsLink {
  if (!isMapsLink(url)) {
    return { ok: false, reason: 'That does not look like a Google Maps link' };
  }

  if (isShortMapsLink(url)) {
    return { ok: false, reason: 'Short link was not opened before reading' };
  }

  // !3d<lat>!4d<lng> — the actual pin. Deliberately NOT /@lat,lng.
  const pin = url.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (!pin) {
    return { ok: false, reason: "Couldn't read this link" };
  }

  const lat = parseFloat(pin[1]);
  const lng = parseFloat(pin[2]);

  if (!isFinite(lat) || !isFinite(lng)) {
    return { ok: false, reason: "Couldn't read this link" };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: "Couldn't read this link" };
  }
  // Google's exports occasionally carry 0,0 — a spot in the ocean off West
  // Africa that is never what anyone meant to save.
  if (lat === 0 && lng === 0) {
    return { ok: false, reason: "Couldn't read this link" };
  }

  return { ok: true, name: nameFromUrl(url), coords: { lat, lng }, placeId: placeIdFromUrl(url) };
}

/** Pulls the human-readable name out of the /place/<Name>/ segment. */
function nameFromUrl(url: string): string | null {
  const m = url.match(/\/maps\/place\/([^/@?]+)/);
  if (!m) return null;
  try {
    const decoded = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    // Malformed percent-encoding — fall back to the raw segment
    return m[1].replace(/\+/g, ' ').trim() || null;
  }
}

/**
 * Pulls Google's place id out of the !16s/g/xxxx segment when present.
 *
 * Note this is the "/g/..." feature id form rather than the "ChIJ..." form the
 * Places API returns. Both identify the place; we store whichever we have.
 */
function placeIdFromUrl(url: string): string | null {
  const m = url.match(/!16s(?:%2F|\/)g(?:%2F|\/)([A-Za-z0-9_]+)/);
  return m ? `/g/${m[1]}` : null;
}
