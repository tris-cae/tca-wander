import { describe, expect, it } from 'vitest';
import { isMapsLink, isShortMapsLink, parseMapsLink } from '../parse-maps-link';

// Real link from Tristan's own account, resolved from maps.app.goo.gl/L3kofaJrFhsH2Wf29.
// Camera (@40.4313948,-3.7162698) and pin (!3d40.4240774!4d-3.6873632) are 2.58 km apart,
// which is exactly the mistake these tests exist to prevent.
const REAL_RESOLVED =
  'https://www.google.com/maps/place/Ralph+Lauren+Madrid/@40.4313948,-3.7162698,4867m/' +
  'data=!3m1!1e3!4m6!3m5!1s0xd422996dc1d54c9:0x1537953b3ce098d5!8m2!3d40.4240774!4d-3.6873632' +
  '!16s%2Fg%2F11k_4cyqyn?entry=tts';

describe('isMapsLink', () => {
  it('recognises google.com/maps links', () => {
    expect(isMapsLink(REAL_RESOLVED)).toBe(true);
  });
  it('recognises short share links', () => {
    expect(isMapsLink('https://maps.app.goo.gl/L3kofaJrFhsH2Wf29')).toBe(true);
  });
  it('recognises country domains', () => {
    expect(isMapsLink('https://www.google.co.uk/maps/place/Foo/@1,2/data=!3d1!4d2')).toBe(true);
  });
  it('rejects a plain place name', () => {
    expect(isMapsLink('Café Central')).toBe(false);
  });
  it('rejects a non-Maps URL', () => {
    expect(isMapsLink('https://example.com/maps')).toBe(false);
  });
  it('rejects a name that merely contains the word maps', () => {
    expect(isMapsLink('Maps Coffee House')).toBe(false);
  });
});

describe('isShortMapsLink', () => {
  it('flags maps.app.goo.gl', () => {
    expect(isShortMapsLink('https://maps.app.goo.gl/abc123')).toBe(true);
  });
  it('does not flag an already-resolved link', () => {
    expect(isShortMapsLink(REAL_RESOLVED)).toBe(false);
  });
});

describe('parseMapsLink', () => {
  it('reads coordinates from !3d/!4d, NOT the @ camera position', () => {
    const r = parseMapsLink(REAL_RESOLVED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coords.lat).toBe(40.4240774);
    expect(r.coords.lng).toBe(-3.6873632);
    // The camera values must never appear
    expect(r.coords.lat).not.toBe(40.4313948);
    expect(r.coords.lng).not.toBe(-3.7162698);
  });

  it('reads the place name', () => {
    const r = parseMapsLink(REAL_RESOLVED);
    expect(r.ok && r.name).toBe('Ralph Lauren Madrid');
  });

  it('reads the google feature id', () => {
    const r = parseMapsLink(REAL_RESOLVED);
    expect(r.ok && r.placeId).toBe('/g/11k_4cyqyn');
  });

  it('fails clearly when the link has only a camera position', () => {
    const r = parseMapsLink('https://www.google.com/maps/@40.4313948,-3.7162698,15z');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("Couldn't read this link");
  });

  it('fails on a shared-list link, which carries no place data', () => {
    const r = parseMapsLink('https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2sn2dps8G5xpCCztxhek0ffw!3e3');
    expect(r.ok).toBe(false);
  });

  it('refuses an unresolved short link rather than guessing', () => {
    const r = parseMapsLink('https://maps.app.goo.gl/L3kofaJrFhsH2Wf29');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/short link/i);
  });

  it('rejects 0,0, which is Google export noise rather than a real place', () => {
    const r = parseMapsLink('https://www.google.com/maps/place/Nowhere/@1,1,15z/data=!8m2!3d0!4d0');
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    const r = parseMapsLink('https://www.google.com/maps/place/Bad/@1,1,15z/data=!8m2!3d99.5!4d-3.6');
    expect(r.ok).toBe(false);
  });

  it('handles a place name with percent-encoding and accents', () => {
    const r = parseMapsLink(
      'https://www.google.com/maps/place/Caf%C3%A9+Central/@1,1,15z/data=!8m2!3d40.42!4d-3.70'
    );
    expect(r.ok && r.name).toBe('Café Central');
  });

  it('handles a link with no name segment', () => {
    const r = parseMapsLink('https://www.google.com/maps/@1,1,15z/data=!8m2!3d40.42!4d-3.70');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBeNull();
    expect(r.coords.lat).toBe(40.42);
  });

  it('handles negative coordinates in both fields', () => {
    const r = parseMapsLink('https://www.google.com/maps/place/X/@1,1,15z/data=!8m2!3d-33.8688!4d-151.2093');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coords).toEqual({ lat: -33.8688, lng: -151.2093 });
  });
});
