import { describe, expect, it } from 'vitest';
import {
  MAX_SITE_DESCRIPTION_LENGTH,
  MAX_SITE_NOTES,
  normalizeHeroImageUrl,
  normalizeSiteDescription,
  normalizeSiteNotes,
  parseHeroImageUrl,
  parseSiteNotes,
  parseSiteSettings,
  siteImageStoragePath,
} from './event-site';

describe('normalizeSiteDescription', () => {
  it('trims and returns the text', () => {
    expect(normalizeSiteDescription('  飯能カレーの祭典です  ')).toBe(
      '飯能カレーの祭典です',
    );
  });

  it('treats missing or blank as empty', () => {
    expect(normalizeSiteDescription(undefined)).toBe('');
    expect(normalizeSiteDescription(null)).toBe('');
    expect(normalizeSiteDescription('   ')).toBe('');
  });

  it('rejects non-strings and overlong text', () => {
    expect(() => normalizeSiteDescription(42)).toThrow();
    expect(() =>
      normalizeSiteDescription('あ'.repeat(MAX_SITE_DESCRIPTION_LENGTH + 1)),
    ).toThrow();
    expect(
      normalizeSiteDescription('あ'.repeat(MAX_SITE_DESCRIPTION_LENGTH)),
    ).toHaveLength(MAX_SITE_DESCRIPTION_LENGTH);
  });
});

describe('normalizeHeroImageUrl', () => {
  it('treats missing or blank as null', () => {
    expect(normalizeHeroImageUrl(undefined)).toBeNull();
    expect(normalizeHeroImageUrl(null)).toBeNull();
    expect(normalizeHeroImageUrl('  ')).toBeNull();
  });

  it('accepts https URLs and rejects others', () => {
    expect(normalizeHeroImageUrl('https://example.com/hero.jpg')).toBe(
      'https://example.com/hero.jpg',
    );
    expect(() => normalizeHeroImageUrl('http://example.com/hero.jpg')).toThrow();
    expect(() => normalizeHeroImageUrl(123)).toThrow();
  });
});

describe('parseHeroImageUrl', () => {
  it('returns null for anything that is not an https string', () => {
    expect(parseHeroImageUrl(undefined)).toBeNull();
    expect(parseHeroImageUrl('http://example.com/x.jpg')).toBeNull();
    expect(parseHeroImageUrl('https://example.com/x.jpg')).toBe(
      'https://example.com/x.jpg',
    );
  });
});

describe('normalizeSiteNotes', () => {
  it('keeps complete rows and drops fully empty rows', () => {
    expect(
      normalizeSiteNotes([
        { title: ' 開催日 ', body: ' 12月7日 ' },
        { title: '', body: '' },
        { title: '会場', body: '中央公園' },
      ]),
    ).toEqual([
      { title: '開催日', body: '12月7日' },
      { title: '会場', body: '中央公園' },
    ]);
  });

  it('treats missing as an empty list', () => {
    expect(normalizeSiteNotes(undefined)).toEqual([]);
    expect(normalizeSiteNotes(null)).toEqual([]);
  });

  it('rejects half-filled rows', () => {
    expect(() => normalizeSiteNotes([{ title: 'タイトルだけ', body: '' }])).toThrow();
    expect(() => normalizeSiteNotes([{ title: '', body: '本文だけ' }])).toThrow();
  });

  it('rejects overlong title and body', () => {
    expect(() =>
      normalizeSiteNotes([{ title: 'あ'.repeat(51), body: '本文' }]),
    ).toThrow();
    expect(() =>
      normalizeSiteNotes([{ title: '題', body: 'あ'.repeat(501) }]),
    ).toThrow();
  });

  it('rejects more than the maximum number of notes', () => {
    const rows = Array.from({ length: MAX_SITE_NOTES + 1 }, (_, i) => ({
      title: `題${i}`,
      body: `本文${i}`,
    }));
    expect(() => normalizeSiteNotes(rows)).toThrow();
  });

  it('rejects non-array input and non-object rows', () => {
    expect(() => normalizeSiteNotes('x')).toThrow();
    expect(() => normalizeSiteNotes(['x'])).toThrow();
    expect(() => normalizeSiteNotes([{ title: 1, body: '本文' }])).toThrow();
  });
});

describe('parseSiteNotes', () => {
  it('drops invalid rows and caps the list', () => {
    const rows = [
      { title: '題0', body: '本文0' },
      { title: '', body: '本文だけ' },
      'garbage',
      ...Array.from({ length: 6 }, (_, i) => ({
        title: `題${i + 1}`,
        body: `本文${i + 1}`,
      })),
    ];
    const parsed = parseSiteNotes(rows);
    expect(parsed).toHaveLength(MAX_SITE_NOTES);
    expect(parsed[0]).toEqual({ title: '題0', body: '本文0' });
  });

  it('returns an empty list for non-arrays', () => {
    expect(parseSiteNotes(undefined)).toEqual([]);
    expect(parseSiteNotes({})).toEqual([]);
  });
});

describe('parseSiteSettings', () => {
  it('falls back to defaults when fields are absent (pre-feature projects)', () => {
    expect(parseSiteSettings(undefined)).toEqual({
      siteDescription: '',
      heroImageUrl: null,
      siteNotes: [],
    });
    expect(parseSiteSettings({})).toEqual({
      siteDescription: '',
      heroImageUrl: null,
      siteNotes: [],
    });
  });

  it('reads stored values', () => {
    expect(
      parseSiteSettings({
        siteDescription: '紹介文',
        heroImageUrl: 'https://example.com/hero.jpg',
        siteNotes: [{ title: '題', body: '本文' }],
      }),
    ).toEqual({
      siteDescription: '紹介文',
      heroImageUrl: 'https://example.com/hero.jpg',
      siteNotes: [{ title: '題', body: '本文' }],
    });
  });
});

describe('siteImageStoragePath', () => {
  it('stores under events/{eventId}/site-images/', () => {
    expect(siteImageStoragePath('ev-1', 'abc.jpg')).toBe(
      'events/ev-1/site-images/abc.jpg',
    );
  });
});
