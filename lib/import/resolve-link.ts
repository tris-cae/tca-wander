// ─── Resolving short Google Maps links ────────────────────────────────────────
//
// A maps.app.goo.gl link carries no place data of its own — it is a redirect to
// a full google.com/maps URL that does. Following that redirect is an ordinary
// HTTP request with no API key and no cost, so the app does it directly rather
// than going through the Worker.
//
// React Native's fetch follows redirects and reports the final address on
// `response.url`, which is the piece we actually want.

import { parseMapsLink, type ParsedMapsLink } from './parse-maps-link';

/** Give up on a redirect after this long rather than hanging the import. */
const TIMEOUT_MS = 8000;

/**
 * Follows a short Maps link and parses whatever it lands on.
 *
 * Never throws: a failure comes back as ok:false with a reason the review
 * screen can show, so one dead link cannot take down a whole import.
 */
export async function resolveAndParseLink(shortUrl: string): Promise<ParsedMapsLink> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(shortUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Google serves different markup to different clients; a normal mobile
        // user agent gets the ordinary redirect we are after.
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ' +
          'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148',
      },
    });

    const finalUrl = response.url;
    if (!finalUrl || finalUrl === shortUrl) {
      return { ok: false, reason: "Couldn't read this link" };
    }

    return parseMapsLink(finalUrl);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, reason: 'That link took too long to open' };
    }
    return { ok: false, reason: "Couldn't open this link" };
  } finally {
    clearTimeout(timer);
  }
}
