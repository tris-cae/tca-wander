import { describe, expect, it } from 'vitest';
import { MIN_CONFIDENT_SCORE, normaliseName, pickBestMatch, scoreCandidate } from '../match-picking';
import { findDuplicate } from '../detect-duplicates';
import type { PlaceCandidate } from '../types';

const MADRID  = { lat: 40.4168, lng: -3.7038 };
const VIENNA  = { lat: 48.2082, lng: 16.3738 };

function candidate(name: string, lat: number, lng: number, address: string | null = 'Some street'): PlaceCandidate {
  return { placeId: `id-${name}-${lat}`, name, address, coords: { lat, lng }, category: null };
}

describe('normaliseName', () => {
  it('strips accents so cafe matches café', () => {
    expect(normaliseName('Café Central')).toBe('cafe central');
  });
  it('strips punctuation and collapses spacing', () => {
    expect(normaliseName("Sobrino  de   Botín!!")).toBe('sobrino de botin');
  });
  it('is case insensitive', () => {
    expect(normaliseName('MERCADO')).toBe(normaliseName('mercado'));
  });
});

describe('scoreCandidate', () => {
  it('scores an exact name in the right city highest', () => {
    const exact  = scoreCandidate(candidate('Café Central', 40.417, -3.704), 'Café Central', MADRID);
    const partial = scoreCandidate(candidate('Café Centralito', 40.417, -3.704), 'Café Central', MADRID);
    expect(exact).toBeGreaterThan(partial);
  });

  it('prefers the chosen city over an identical name elsewhere', () => {
    const inMadrid = scoreCandidate(candidate('Café Central', 40.417, -3.704), 'Café Central', MADRID);
    const inVienna = scoreCandidate(candidate('Café Central', VIENNA.lat, VIENNA.lng), 'Café Central', MADRID);
    expect(inMadrid).toBeGreaterThan(inVienna);
  });

  it('gives partial credit for a distinctive shared word', () => {
    const score = scoreCandidate(candidate('Sobrino de Botín', 40.414, -3.708), 'Botín', MADRID);
    expect(score).toBeGreaterThan(0);
  });

  it('ignores distance when no city was chosen', () => {
    const a = scoreCandidate(candidate('Café Central', 40.417, -3.704), 'Café Central', null);
    const b = scoreCandidate(candidate('Café Central', VIENNA.lat, VIENNA.lng), 'Café Central', null);
    expect(a).toBe(b);
  });

  it('rewards having an address, since city folders depend on it', () => {
    const withAddr = scoreCandidate(candidate('X', 40.417, -3.704, 'Calle Mayor 1'), 'X', MADRID);
    const without  = scoreCandidate(candidate('X', 40.417, -3.704, null), 'X', MADRID);
    expect(withAddr).toBeGreaterThan(without);
  });
});

describe('pickBestMatch', () => {
  it('puts the in-city branch first when a chain appears in several cities', () => {
    const r = pickBestMatch(
      [
        candidate('Café Central', VIENNA.lat, VIENNA.lng),
        candidate('Café Central', 40.417, -3.704),
      ],
      'Café Central',
      MADRID
    );
    expect(r.ordered[0].coords.lat).toBeCloseTo(40.417, 2);
    expect(r.selectedIndex).toBe(0);
    expect(r.confident).toBe(true);
  });

  it('keeps every candidate so the user can choose another', () => {
    const r = pickBestMatch(
      [
        candidate('Café Central', VIENNA.lat, VIENNA.lng),
        candidate('Café Central', 40.417, -3.704),
        candidate('Café Centrale', 41.0, -3.9),
      ],
      'Café Central',
      MADRID
    );
    expect(r.ordered).toHaveLength(3);
  });

  it('returns no selection when the search found nothing', () => {
    const r = pickBestMatch([], 'Nowhere At All', MADRID);
    expect(r.selectedIndex).toBe(-1);
    expect(r.confident).toBe(false);
    expect(r.ordered).toHaveLength(0);
  });

  it('declines to pre-select when the only match is unrelated and far away', () => {
    const r = pickBestMatch([candidate('Totally Different Shop', VIENNA.lat, VIENNA.lng)], 'Café Central', MADRID);
    expect(r.confident).toBe(false);
    expect(r.selectedIndex).toBe(-1);
    // but the candidate is still there to look at
    expect(r.ordered).toHaveLength(1);
  });

  it('keeps Google ordering when scores tie', () => {
    const r = pickBestMatch(
      [candidate('Same Name', 40.417, -3.704), candidate('Same Name', 40.418, -3.705)],
      'Same Name',
      MADRID
    );
    expect(r.ordered[0].placeId).toContain('40.417');
  });

  it('uses a confidence bar that an exact in-city match clears', () => {
    const r = pickBestMatch([candidate('Café Central', 40.417, -3.704)], 'Café Central', MADRID);
    expect(scoreCandidate(r.ordered[0], 'Café Central', MADRID)).toBeGreaterThanOrEqual(MIN_CONFIDENT_SCORE);
  });
});

describe('findDuplicate', () => {
  const existing = [
    { id: 'a', name: 'Café Central', coordinates: { lat: 40.4170, lng: -3.7040 } },
    { id: 'b', name: 'Mercado de San Miguel', coordinates: { lat: 40.4153, lng: -3.7090 } },
  ];

  it('flags the same name within 100 m', () => {
    // ~30 m away
    const hit = findDuplicate('Café Central', { lat: 40.41727, lng: -3.70400 }, existing);
    expect(hit).not.toBeNull();
    expect(hit!.existingId).toBe('a');
    expect(hit!.metres).toBeLessThanOrEqual(100);
  });

  it('ignores the same name far away — a different branch of a chain', () => {
    expect(findDuplicate('Café Central', VIENNA, existing)).toBeNull();
  });

  it('ignores a different name at the same spot — neighbours on one street', () => {
    expect(findDuplicate('Bar Cock', { lat: 40.4170, lng: -3.7040 }, existing)).toBeNull();
  });

  it('matches regardless of accents and case', () => {
    expect(findDuplicate('cafe central', { lat: 40.41705, lng: -3.70405 }, existing)).not.toBeNull();
  });

  it('returns the nearest when several same-named saves qualify', () => {
    const many = [
      { id: 'far',  name: 'Dup', coordinates: { lat: 40.41760, lng: -3.70400 } },
      { id: 'near', name: 'Dup', coordinates: { lat: 40.41702, lng: -3.70400 } },
    ];
    const hit = findDuplicate('Dup', { lat: 40.41700, lng: -3.70400 }, many);
    expect(hit!.existingId).toBe('near');
  });

  it('returns null against an empty library', () => {
    expect(findDuplicate('Anything', MADRID, [])).toBeNull();
  });

  it('ignores a blank name rather than matching everything', () => {
    expect(findDuplicate('   ', MADRID, existing)).toBeNull();
  });
});
