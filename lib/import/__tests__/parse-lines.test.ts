import { describe, expect, it } from 'vitest';
import { billableLineCount, parseLines } from '../parse-lines';

const REAL_RESOLVED =
  'https://www.google.com/maps/place/Ralph+Lauren+Madrid/@40.4313948,-3.7162698,4867m/' +
  'data=!3m1!1e3!4m6!3m5!1s0xd422996dc1d54c9:0x1537953b3ce098d5!8m2!3d40.4240774!4d-3.6873632' +
  '!16s%2Fg%2F11k_4cyqyn?entry=tts';

describe('parseLines', () => {
  it('splits plain names one per line', () => {
    const r = parseLines('Café Central\nSobrino de Botín\nMercado de San Miguel');
    expect(r.lines).toHaveLength(3);
    expect(r.lines.map((l) => l.query)).toEqual([
      'Café Central', 'Sobrino de Botín', 'Mercado de San Miguel',
    ]);
    expect(r.lines.every((l) => l.kind === 'name')).toBe(true);
  });

  it('ignores blank lines without calling them errors', () => {
    const r = parseLines('Café Central\n\n\n   \nSobrino de Botín');
    expect(r.lines).toHaveLength(2);
    expect(r.skipped).toHaveLength(0);
  });

  it('handles Windows and old-Mac line endings', () => {
    expect(parseLines('A\r\nB\rC').lines).toHaveLength(3);
  });

  it('strips list markers people paste in', () => {
    const r = parseLines('1. Café Central\n- Sobrino de Botín\n• Mercado\n* Bar Cock\n2) Casa Lucio');
    expect(r.lines.map((l) => l.query)).toEqual([
      'Café Central', 'Sobrino de Botín', 'Mercado', 'Bar Cock', 'Casa Lucio',
    ]);
  });

  it('strips wrapping quotes, including smart quotes', () => {
    const r = parseLines('"Café Central"\n“Sobrino de Botín”');
    expect(r.lines.map((l) => l.query)).toEqual(['Café Central', 'Sobrino de Botín']);
  });

  it('removes a line repeated in the same paste', () => {
    const r = parseLines('Café Central\ncafé central\nCafé Central');
    expect(r.lines).toHaveLength(1);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toMatch(/more than once/i);
  });

  it('detects a Maps link and reads its pin coordinates', () => {
    const r = parseLines(`Café Central\n${REAL_RESOLVED}`);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1].kind).toBe('link');
    expect(r.lines[1].coords).toEqual({ lat: 40.4240774, lng: -3.6873632 });
    expect(r.lines[1].error).toBeNull();
  });

  it('keeps an unreadable link as a visible error rather than dropping it', () => {
    const r = parseLines('https://www.google.com/maps/@40.43,-3.71,15z');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].kind).toBe('link');
    expect(r.lines[0].coords).toBeNull();
    expect(r.lines[0].error).toBe("Couldn't read this link");
  });

  it('marks a short link for resolving instead of erroring', () => {
    const r = parseLines('https://maps.app.goo.gl/L3kofaJrFhsH2Wf29');
    expect(r.lines[0].kind).toBe('link');
    expect(r.lines[0].error).toBeNull();
    expect(r.lines[0].coords).toBeNull();
  });

  it('skips a non-Maps URL', () => {
    const r = parseLines('https://example.com/somewhere');
    expect(r.lines).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/not a google maps link/i);
  });

  it('skips an absurdly long line', () => {
    const r = parseLines('x'.repeat(400));
    expect(r.lines).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/too long/i);
  });

  it('caps at the limit and reports truncation', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Place ${i}`).join('\n');
    const r = parseLines(text, 20);
    expect(r.lines).toHaveLength(20);
    expect(r.truncated).toBe(true);
  });

  it('does not report truncation when the input fits', () => {
    expect(parseLines('A\nB\nC', 20).truncated).toBe(false);
  });

  it('returns nothing for empty input without throwing', () => {
    expect(parseLines('').lines).toHaveLength(0);
    expect(parseLines('   \n  \n').lines).toHaveLength(0);
  });

  it('numbers lines in the order given', () => {
    const r = parseLines('A\nB\nC');
    expect(r.lines.map((l) => l.index)).toEqual([0, 1, 2]);
  });
});

describe('billableLineCount', () => {
  it('counts names, which each need a paid search', () => {
    const r = parseLines('Café Central\nSobrino de Botín');
    expect(billableLineCount(r.lines)).toBe(2);
  });

  it('does not charge for a link that already carries coordinates', () => {
    const r = parseLines(`Café Central\n${REAL_RESOLVED}`);
    expect(billableLineCount(r.lines)).toBe(1);
  });

  it('does not charge for a link that failed to parse', () => {
    const r = parseLines('https://www.google.com/maps/@40.43,-3.71,15z');
    expect(billableLineCount(r.lines)).toBe(0);
  });
});
