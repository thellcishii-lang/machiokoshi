// lib/event-shop.test.ts
// 店舗プロフィールの純粋関数: 読み取り整形（防御的）と保存検証、
// 表示名フォールバックを検証する。あわせて店舗リンク（最大3件）と
// 座標（保存時のジオコーディング）の判断・保存フローも検証する。
import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  effectiveShopLinks,
  emptyShopProfile,
  isShopPubliclyListed,
  listPublicShops,
  parseShopProfile,
  resolveShopLocation,
  shopPhotoStoragePath,
  toPublicShop,
  updateShopProfile,
  validateShopProfileInput,
  type ShopProfile,
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

describe('店舗リンクの読み取り（parseShopProfile）', () => {
  it('保存済みリンクを読み、座標も読む', () => {
    const profile = parseShopProfile({
      links: [
        { label: '公式サイト', url: 'https://example.com/' },
        { label: 'Instagram', url: 'https://instagram.com/shop' },
      ],
      location: { lat: 35.85, lng: 139.32 },
    });
    expect(profile.links).toEqual([
      { label: '公式サイト', url: 'https://example.com/' },
      { label: 'Instagram', url: 'https://instagram.com/shop' },
    ]);
    expect(profile.location).toEqual({ lat: 35.85, lng: 139.32 });
  });

  it('リンク項目が無い旧ドキュメントは空配列・座標なし', () => {
    const profile = parseShopProfile({ displayName: '旧店舗' });
    expect(profile.links).toEqual([]);
    expect(profile.location).toBeNull();
  });

  it('不正なリンク行は捨て、最大3件に切る', () => {
    const profile = parseShopProfile({
      links: [
        { label: 'OK', url: 'https://example.com/1' },
        { label: 'httpは不可', url: 'http://example.com/2' },
        { label: '', url: 'https://example.com/3' },
        'garbage',
        { label: 'OK2', url: 'https://example.com/4' },
        { label: 'OK3', url: 'https://example.com/5' },
        { label: 'OK4', url: 'https://example.com/6' },
      ],
    });
    expect(profile.links).toEqual([
      { label: 'OK', url: 'https://example.com/1' },
      { label: 'OK2', url: 'https://example.com/4' },
      { label: 'OK3', url: 'https://example.com/5' },
    ]);
  });

  it('座標が数値でない・範囲外なら null に倒す', () => {
    expect(parseShopProfile({ location: { lat: '35.8', lng: 139.3 } }).location).toBeNull();
    expect(parseShopProfile({ location: { lat: 91, lng: 139.3 } }).location).toBeNull();
    expect(parseShopProfile({ location: 'x' }).location).toBeNull();
  });
});

describe('店舗リンクの保存検証（validateShopProfileInput）', () => {
  it('リンク0件・3件は通り、前後空白は落とす', () => {
    const none = validateShopProfileInput({ links: [] });
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.value.links).toEqual([]);

    const three = validateShopProfileInput({
      links: [
        { label: ' 公式サイト ', url: ' https://example.com/ ' },
        { label: 'Instagram', url: 'https://instagram.com/shop' },
        { label: 'X', url: 'https://x.com/shop' },
      ],
    });
    expect(three.ok).toBe(true);
    if (three.ok) {
      expect(three.value.links).toEqual([
        { label: '公式サイト', url: 'https://example.com/' },
        { label: 'Instagram', url: 'https://instagram.com/shop' },
        { label: 'X', url: 'https://x.com/shop' },
      ]);
    }
  });

  it('リンク4件はエラー', () => {
    const result = validateShopProfileInput({
      links: [1, 2, 3, 4].map((i) => ({
        label: `リンク${i}`,
        url: `https://example.com/${i}`,
      })),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('3件まで');
  });

  it('https でないURLはエラー', () => {
    const result = validateShopProfileInput({
      links: [{ label: 'サイト', url: 'http://example.com/' }],
    });
    expect(result.ok).toBe(false);
  });

  it('表示名31文字・URL501文字はエラー', () => {
    const longLabel = validateShopProfileInput({
      links: [{ label: 'あ'.repeat(31), url: 'https://example.com/' }],
    });
    expect(longLabel.ok).toBe(false);
    if (!longLabel.ok) expect(longLabel.error).toContain('30文字以内');

    const longUrl = validateShopProfileInput({
      links: [
        { label: 'サイト', url: `https://example.com/${'a'.repeat(500)}` },
      ],
    });
    expect(longUrl.ok).toBe(false);
    if (!longUrl.ok) expect(longUrl.error).toContain('500文字以内');
  });

  it('空行は捨て、片方だけの行はエラー', () => {
    const dropped = validateShopProfileInput({
      links: [
        { label: '', url: '' },
        { label: '公式サイト', url: 'https://example.com/' },
      ],
    });
    expect(dropped.ok).toBe(true);
    if (dropped.ok) expect(dropped.value.links).toHaveLength(1);

    expect(
      validateShopProfileInput({ links: [{ label: '名前だけ', url: '' }] }).ok,
    ).toBe(false);
    expect(
      validateShopProfileInput({
        links: [{ label: '', url: 'https://example.com/' }],
      }).ok,
    ).toBe(false);
  });

  it('クライアントが送った座標は無視される（検証結果は常に null）', () => {
    const result = validateShopProfileInput({
      address: '埼玉県飯能市',
      location: { lat: 35.85, lng: 139.32 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.location).toBeNull();
  });
});

describe('effectiveShopLinks（Instagram の暗黙リンク）', () => {
  it('リンクが空で Instagram だけあれば、それが1件目になる', () => {
    const profile = parseShopProfile({
      instagramUrl: 'https://instagram.com/shop',
    });
    expect(effectiveShopLinks(profile)).toEqual([
      { label: 'Instagram', url: 'https://instagram.com/shop' },
    ]);
  });

  it('リンクが設定されていれば Instagram は混ざらない', () => {
    const profile = parseShopProfile({
      instagramUrl: 'https://instagram.com/shop',
      links: [{ label: '公式サイト', url: 'https://example.com/' }],
    });
    expect(effectiveShopLinks(profile)).toEqual([
      { label: '公式サイト', url: 'https://example.com/' },
    ]);
  });

  it('どちらも無ければ空配列', () => {
    expect(effectiveShopLinks(parseShopProfile({}))).toEqual([]);
  });

  it('toPublicShop では profile.links が実効リンクになる', () => {
    const shop = toPublicShop(
      { id: 'shop-a', name: '店A' },
      { instagramUrl: 'https://instagram.com/shop' },
    );
    expect(shop.profile.links).toEqual([
      { label: 'Instagram', url: 'https://instagram.com/shop' },
    ]);
    expect(shop.profile.location).toBeNull();
  });
});

function profileWith(partial: Partial<ShopProfile>): ShopProfile {
  return { ...emptyShopProfile(), ...partial };
}

describe('resolveShopLocation', () => {
  it('住所が空なら座標なし（変換は呼ばない）', async () => {
    const geocode = vi.fn(async () => ({ lat: 35.85, lng: 139.32 }));
    await expect(
      resolveShopLocation(
        profileWith({ address: '埼玉県飯能市' }),
        profileWith({ address: '' }),
        geocode,
      ),
    ).resolves.toBeNull();
    expect(geocode).not.toHaveBeenCalled();
  });

  it('住所が同じで座標があれば使い回す（変換は呼ばない）', async () => {
    const geocode = vi.fn(async () => ({ lat: 1, lng: 2 }));
    const previous = profileWith({
      address: '埼玉県飯能市',
      location: { lat: 35.85, lng: 139.32 },
    });
    await expect(
      resolveShopLocation(previous, profileWith({ address: '埼玉県飯能市' }), geocode),
    ).resolves.toEqual({ lat: 35.85, lng: 139.32 });
    expect(geocode).not.toHaveBeenCalled();
  });

  it('住所が変われば変換し、座標がまだ無い場合も変換する', async () => {
    const geocode = vi.fn(async () => ({ lat: 35.85, lng: 139.32 }));
    const previous = profileWith({
      address: '埼玉県飯能市',
      location: { lat: 35.0, lng: 139.0 },
    });
    await expect(
      resolveShopLocation(previous, profileWith({ address: '埼玉県狭山市' }), geocode),
    ).resolves.toEqual({ lat: 35.85, lng: 139.32 });
    await expect(
      resolveShopLocation(
        profileWith({ address: '埼玉県飯能市' }),
        profileWith({ address: '埼玉県飯能市' }),
        geocode,
      ),
    ).resolves.toEqual({ lat: 35.85, lng: 139.32 });
    expect(geocode).toHaveBeenCalledTimes(2);
  });

  it('変換できなければ null、変換が例外でも null', async () => {
    await expect(
      resolveShopLocation(
        profileWith({}),
        profileWith({ address: '住所' }),
        async () => null,
      ),
    ).resolves.toBeNull();
    await expect(
      resolveShopLocation(
        profileWith({}),
        profileWith({ address: '住所' }),
        async () => {
          throw new Error('boom');
        },
      ),
    ).resolves.toBeNull();
  });
});

// updateShopProfile / listPublicShops 用の最小フェイク Firestore。
// exhibitors コレクションの doc 取得・更新と一覧取得だけを再現する。
function fakeShopDb(
  docs: Array<{ id: string; data: Record<string, unknown> }>,
) {
  const updates: Array<{ id: string; value: { profile: ShopProfile } }> = [];
  const collection = {
    doc: (id: string) => {
      const found = docs.find((d) => d.id === id);
      return {
        get: async () => ({
          exists: found !== undefined,
          data: () => found?.data,
        }),
        update: async (value: { profile: ShopProfile }) => {
          updates.push({ id, value });
        },
      };
    },
    get: async () => ({
      docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
    }),
  };
  const db = {
    collection: () => ({
      doc: () => ({ collection: () => collection }),
    }),
  };
  return { db: db as unknown as Firestore, updates };
}

describe('updateShopProfile（保存フローと座標）', () => {
  it('住所から座標を求めて一緒に保存する', async () => {
    const { db, updates } = fakeShopDb([
      { id: 'shop-a', data: { name: '店A', profile: {} } },
    ]);
    const input = validateShopProfileInput({ address: '埼玉県飯能市' });
    if (!input.ok) throw new Error('input should be valid');
    const result = await updateShopProfile(db, 'ev1', 'shop-a', input.value, async () => ({
      lat: 35.85,
      lng: 139.32,
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.location).toEqual({ lat: 35.85, lng: 139.32 });
    }
    expect(updates).toHaveLength(1);
    expect(updates[0].value.profile.location).toEqual({
      lat: 35.85,
      lng: 139.32,
    });
  });

  it('ジオコーディングが例外を投げても保存は成功する（座標なし）', async () => {
    const { db, updates } = fakeShopDb([
      { id: 'shop-a', data: { name: '店A', profile: {} } },
    ]);
    const input = validateShopProfileInput({ address: '埼玉県飯能市' });
    if (!input.ok) throw new Error('input should be valid');
    const result = await updateShopProfile(db, 'ev1', 'shop-a', input.value, async () => {
      throw new Error('geocoder down');
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile.location).toBeNull();
    expect(updates).toHaveLength(1);
  });

  it('店が無ければ 404', async () => {
    const { db } = fakeShopDb([]);
    const input = validateShopProfileInput({});
    if (!input.ok) throw new Error('input should be valid');
    const result = await updateShopProfile(db, 'ev1', 'missing', input.value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe('listPublicShops（公開APIの形・旧ドキュメント）', () => {
  it('リンク・座標の無い旧ドキュメントは links [] / location null で出る', async () => {
    const { db } = fakeShopDb([
      {
        id: 'shop-a',
        data: {
          name: '店A',
          profile: { displayName: '店A', address: '埼玉県飯能市' },
        },
      },
    ]);
    const shops = await listPublicShops(db, 'ev1');
    expect(shops).toHaveLength(1);
    expect(shops[0].profile.links).toEqual([]);
    expect(shops[0].profile.location).toBeNull();
  });

  it('Instagram だけの旧ドキュメントはリンクに Instagram が入る', async () => {
    const { db } = fakeShopDb([
      {
        id: 'shop-a',
        data: {
          name: '店A',
          profile: {
            displayName: '店A',
            instagramUrl: 'https://instagram.com/shop',
            location: { lat: 35.85, lng: 139.32 },
          },
        },
      },
    ]);
    const shops = await listPublicShops(db, 'ev1');
    expect(shops[0].profile.links).toEqual([
      { label: 'Instagram', url: 'https://instagram.com/shop' },
    ]);
    expect(shops[0].profile.location).toEqual({ lat: 35.85, lng: 139.32 });
  });
});

describe('isShopPubliclyListed', () => {
  it('掲載あり＋課金停止でなければ公開する', () => {
    const profile = parseShopProfile({ published: true });
    expect(isShopPubliclyListed(profile, undefined)).toBe(true);
    expect(isShopPubliclyListed(profile, false)).toBe(true);
  });

  it('課金停止中の店は、掲載設定がオンでも公開しない', () => {
    const profile = parseShopProfile({ published: true });
    expect(isShopPubliclyListed(profile, true)).toBe(false);
  });

  it('店自身が掲載をオフにしていれば、課金状態によらず公開しない', () => {
    const profile = parseShopProfile({ published: false });
    expect(isShopPubliclyListed(profile, undefined)).toBe(false);
    expect(isShopPubliclyListed(profile, true)).toBe(false);
  });
});
