// lib/event-shop.test.ts
// 店舗プロフィールの純粋関数: 読み取り整形（防御的）と保存検証、
// 表示名フォールバックを検証する。
import { describe, expect, it } from 'vitest';
import {
  emptyShopProfile,
  parseShopProfile,
  shopPhotoStoragePath,
  toPublicShop,
  validateShopProfileInput,
} from './event-shop';

describe('parseShopProfile', () => {
  it('未設定（undefined / null / 非オブジェクト）は空プロフィールで掲載あり', () => {
    expect(parseShopProfile(undefined)).toEqual(emptyShopProfile());
    expect(parseShopProfile(null)).toEqual(emptyShopProfile());
    expect(parseShopProfile('x')).toEqual(emptyShopProfile());
    expect(parseShopProfile(undefined).published).toBe(true);
  });

  it('保存済みの値を読み、published=false を保持する', () => {
    const profile = parseShopProfile({
      displayName: 'カレー堂',
      address: '埼玉県飯能市…',
      photoUrls: ['https://example.com/a.jpg'],
      instagramUrl: 'https://instagram.com/shop',
      published: false,
    });
    expect(profile.displayName).toBe('カレー堂');
    expect(profile.address).toBe('埼玉県飯能市…');
    expect(profile.photoUrls).toEqual(['https://example.com/a.jpg']);
    expect(profile.instagramUrl).toBe('https://instagram.com/shop');
    expect(profile.published).toBe(false);
  });

  it('写真は https のものだけ最大3枚、Instagram は https 以外を落とす', () => {
    const profile = parseShopProfile({
      photoUrls: [
        'https://example.com/1.jpg',
        'http://example.com/2.jpg',
        123,
        'https://example.com/3.jpg',
        'https://example.com/4.jpg',
        'https://example.com/5.jpg',
      ],
      instagramUrl: 'http://instagram.com/shop',
    });
    expect(profile.photoUrls).toEqual([
      'https://example.com/1.jpg',
      'https://example.com/3.jpg',
      'https://example.com/4.jpg',
    ]);
    expect(profile.instagramUrl).toBe('');
  });

  it('文字列でない項目は空に倒し、長すぎる文字列は上限で切る', () => {
    const profile = parseShopProfile({
      displayName: 42,
      description: 'あ'.repeat(1500),
    });
    expect(profile.displayName).toBe('');
    expect(profile.description).toHaveLength(1000);
  });
});

describe('toPublicShop', () => {
  it('表示名が未設定なら登録名に倒す', () => {
    const shop = toPublicShop({ id: 'shop-a', name: '登録名A' }, undefined);
    expect(shop.exhibitorId).toBe('shop-a');
    expect(shop.name).toBe('登録名A');
    expect(shop.profile.displayName).toBe('登録名A');
  });

  it('表示名が設定されていればそれを使う', () => {
    const shop = toPublicShop(
      { id: 'shop-a', name: '登録名A' },
      { displayName: '表示名A' },
    );
    expect(shop.profile.displayName).toBe('表示名A');
    expect(shop.name).toBe('登録名A');
  });
});

describe('validateShopProfileInput', () => {
  it('正常な入力を正規化する（前後空白を落とす）', () => {
    const result = validateShopProfileInput({
      displayName: ' カレー堂 ',
      address: '埼玉県飯能市…',
      photoUrls: ['https://example.com/a.jpg'],
      instagramUrl: ' https://instagram.com/shop ',
      published: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.displayName).toBe('カレー堂');
      expect(result.value.instagramUrl).toBe('https://instagram.com/shop');
      expect(result.value.published).toBe(false);
    }
  });

  it('空の入力は空プロフィール（掲載あり）として通る', () => {
    const result = validateShopProfileInput({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(emptyShopProfile());
  });

  it('文字数上限を超えたらエラー', () => {
    const result = validateShopProfileInput({
      displayName: 'あ'.repeat(61),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('60文字以内');
  });

  it('写真が4枚以上ならエラー、https でなければエラー', () => {
    const four = validateShopProfileInput({
      photoUrls: [
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
        'https://example.com/3.jpg',
        'https://example.com/4.jpg',
      ],
    });
    expect(four.ok).toBe(false);
    const http = validateShopProfileInput({
      photoUrls: ['http://example.com/1.jpg'],
    });
    expect(http.ok).toBe(false);
  });

  it('Instagram URL が https でなければエラー', () => {
    const result = validateShopProfileInput({
      instagramUrl: 'instagram.com/shop',
    });
    expect(result.ok).toBe(false);
  });

  it('published が真偽値でなければエラー、非オブジェクトはエラー', () => {
    expect(validateShopProfileInput({ published: 'yes' }).ok).toBe(false);
    expect(validateShopProfileInput(null).ok).toBe(false);
    expect(validateShopProfileInput('x').ok).toBe(false);
  });
});

describe('shopPhotoStoragePath', () => {
  it('events/{eventId}/shop-photos/{exhibitorId}/{fileName} を作る', () => {
    expect(shopPhotoStoragePath('ev1', 'shop-a', 'x.jpg')).toBe(
      'events/ev1/shop-photos/shop-a/x.jpg',
    );
  });
});
