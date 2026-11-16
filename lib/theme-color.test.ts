// lib/theme-color.test.ts
// テーマカラーから画面用パレットを導出するヘルパーの検証。
// 未設定・不正な値は既定パレット（現在のベージュ／茶系）に倒れ、
// 設定時は基準色から濃淡が作られることを確認する。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PALETTE,
  mixHex,
  themeCssVars,
  themePalette,
} from './theme-color';

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

describe('themePalette', () => {
  it('未設定・不正な値は既定パレットそのもの', () => {
    expect(themePalette(null)).toEqual(DEFAULT_THEME_PALETTE);
    expect(themePalette(undefined)).toEqual(DEFAULT_THEME_PALETTE);
    expect(themePalette('')).toEqual(DEFAULT_THEME_PALETTE);
    expect(themePalette('red')).toEqual(DEFAULT_THEME_PALETTE);
    expect(themePalette('#12345')).toEqual(DEFAULT_THEME_PALETTE);
  });

  it('基準色が accent になり、大文字は小文字に正規化される', () => {
    const palette = themePalette('#DD5E22');
    expect(palette.accent).toBe('#dd5e22');
  });

  it('濃淡が基準色から導出される（暗色は暗く、淡色は明るく）', () => {
    const palette = themePalette('#dd5e22');
    for (const value of Object.values(palette)) {
      expect(value).toMatch(HEX_PATTERN);
    }
    expect(luminance(palette.accentDark)).toBeLessThan(
      luminance(palette.accent),
    );
    expect(luminance(palette.accentBright)).toBeGreaterThan(
      luminance(palette.accent),
    );
    expect(luminance(palette.heroFrom)).toBeGreaterThan(
      luminance(palette.heroTo),
    );
    expect(luminance(palette.cardFrom)).toBeGreaterThan(
      luminance(palette.heroFrom),
    );
  });
});

describe('mixHex', () => {
  it('両端と中間の混色', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('themeCssVars', () => {
  it('--theme-* のカスタムプロパティ一式を返す', () => {
    const vars = themeCssVars('#6f7d3c');
    expect(Object.keys(vars).sort()).toEqual([
      '--theme-accent',
      '--theme-accent-bright',
      '--theme-accent-dark',
      '--theme-border',
      '--theme-card-from',
      '--theme-card-to',
      '--theme-hero-from',
      '--theme-hero-to',
      '--theme-page-bg',
    ]);
    expect(vars['--theme-accent']).toBe('#6f7d3c');
  });

  it('未設定なら既定パレットの値になる', () => {
    const vars = themeCssVars(null);
    expect(vars['--theme-accent']).toBe('#8B5E34');
    expect(vars['--theme-accent-bright']).toBe('#B07B45');
    expect(vars['--theme-hero-from']).toBe('#F1E4CB');
    expect(vars['--theme-hero-to']).toBe('#E7D3AC');
    expect(vars['--theme-card-from']).toBe('#FBF6EA');
    expect(vars['--theme-card-to']).toBe('#F3E8D2');
    expect(vars['--theme-border']).toBe('#E8DCC4');
    expect(vars['--theme-page-bg']).toBe('#F7F1E5');
  });
});
