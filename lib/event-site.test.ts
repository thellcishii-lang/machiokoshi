import { describe, expect, it } from 'vitest';
import {
  MAX_GOURMET_DEFINITION_LENGTH,
  MAX_SITE_DESCRIPTION_LENGTH,
  MAX_SITE_NOTES,
  normalizeGourmetDefinition,
  normalizeHeroImageUrl,
  normalizeSiteDescription,
  normalizeSiteIconUrl,
  normalizeSiteNotes,
  normalizeThemeColor,
  parseGourmetDefinition,
  parseHeroImageUrl,
  parseSiteIconUrl,
  parseSiteNotes,
  parseThemeColor,
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

describe('normalizeSiteIconUrl / parseSiteIconUrl', () => {
  it('未指定・空は null、https 以外は保存時に例外・読み取り時は null', () => {
    expect(normalizeSiteIconUrl(undefined)).toBeNull();
    expect(normalizeSiteIconUrl(null)).toBeNull();
    expect(normalizeSiteIconUrl('  ')).toBeNull();
    expect(normalizeSiteIconUrl('https://example.com/icon.png')).toBe(
      'https://example.com/icon.png',
    );
    expect(() => normalizeSiteIconUrl('http://example.com/icon.png')).toThrow();
    expect(() => normalizeSiteIconUrl(123)).toThrow();
    expect(parseSiteIconUrl(undefined)).toBeNull();
    expect(parseSiteIconUrl('http://example.com/icon.png')).toBeNull();
    expect(parseSiteIconUrl('https://example.com/icon.png')).toBe(
      'https://example.com/icon.png',
    );
  });
});

describe('normalizeGourmetDefinition / parseGourmetDefinition', () => {
  it('改行を保持し、前後の空白だけ落とす', () => {
    expect(
      normalizeGourmetDefinition('  地元産野菜を使うこと。\n味噌ベースのルー。  '),
    ).toBe('地元産野菜を使うこと。\n味噌ベースのルー。');
  });

  it('未指定・空白のみは空文字', () => {
    expect(normalizeGourmetDefinition(undefined)).toBe('');
    expect(normalizeGourmetDefinition(null)).toBe('');
    expect(normalizeGourmetDefinition('   ')).toBe('');
    expect(parseGourmetDefinition(undefined)).toBe('');
    expect(parseGourmetDefinition(42)).toBe('');
  });

  it('1000文字は通り、1001文字は保存時に例外・読み取り時は切り詰める', () => {
    const at1000 = 'あ'.repeat(MAX_GOURMET_DEFINITION_LENGTH);
    expect(normalizeGourmetDefinition(at1000)).toHaveLength(
      MAX_GOURMET_DEFINITION_LENGTH,
    );
    expect(() =>
      normalizeGourmetDefinition('あ'.repeat(MAX_GOURMET_DEFINITION_LENGTH + 1)),
    ).toThrow();
    expect(() => normalizeGourmetDefinition(42)).toThrow();
    expect(
      parseGourmetDefinition('あ'.repeat(MAX_GOURMET_DEFINITION_LENGTH + 100)),
    ).toHaveLength(MAX_GOURMET_DEFINITION_LENGTH);
  });
});

describe('normalizeThemeColor / parseThemeColor', () => {
  it('未指定・空は null（サイト既定）', () => {
    expect(normalizeThemeColor(undefined)).toBeNull();
    expect(normalizeThemeColor(null)).toBeNull();
    expect(normalizeThemeColor('   ')).toBeNull();
    expect(parseThemeColor(undefined)).toBeNull();
    expect(parseThemeColor('')).toBeNull();
  });

  it('#RRGGBB を小文字に正規化する', () => {
    expect(normalizeThemeColor('#8B5E34')).toBe('#8b5e34');
    expect(normalizeThemeColor(' #DD5E22 ')).toBe('#dd5e22');
    expect(parseThemeColor('#C73E2C')).toBe('#c73e2c');
  });

  it('形式が違うものは保存時に例外・読み取り時は null', () => {
    expect(() => normalizeThemeColor('8b5e34')).toThrow();
    expect(() => normalizeThemeColor('#8b5e3')).toThrow();
    expect(() => normalizeThemeColor('#8b5e345')).toThrow();
    expect(() => normalizeThemeColor('#gggggg')).toThrow();
    expect(() => normalizeThemeColor(123)).toThrow();
    expect(parseThemeColor('red')).toBeNull();
    expect(parseThemeColor('#12345')).toBeNull();
    expect(parseThemeColor(42)).toBeNull();
  });
});

describe('parseSiteSettings', () => {
  it('falls back to defaults when fields are absent (pre-feature projects)', () => {
    expect(parseSiteSettings(undefined)).toEqual({
      siteDescription: '',
      gourmetDefinition: '',
      heroImageUrl: null,
      siteIconUrl: null,
      themeColor: null,
      siteNotes: [],
    });
    expect(parseSiteSettings({})).toEqual({
      siteDescription: '',
      gourmetDefinition: '',
      heroImageUrl: null,
      siteIconUrl: null,
      themeColor: null,
      siteNotes: [],
    });
  });

  it('reads stored values', () => {
    expect(
      parseSiteSettings({
        siteDescription: '紹介文',
        gourmetDefinition: '地元産野菜を使うこと。\n味噌ベースのルー。',
        heroImageUrl: 'https://example.com/hero.jpg',
        siteIconUrl: 'https://example.com/icon.png',
        themeColor: '#DD5E22',
        siteNotes: [{ title: '題', body: '本文' }],
      }),
    ).toEqual({
      siteDescription: '紹介文',
      gourmetDefinition: '地元産野菜を使うこと。\n味噌ベースのルー。',
      heroImageUrl: 'https://example.com/hero.jpg',
      siteIconUrl: 'https://example.com/icon.png',
      themeColor: '#dd5e22',
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
