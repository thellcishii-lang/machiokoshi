// lib/event-review.test.ts
// レビューの純粋ロジック: ドキュメントID構成、入力検証、集計、
// 公開用整形（memberId を出さない・非表示を除く）、写真検証。
// Firestore を使う処理（upsertReview 等）はルートテスト側で
// lib をモックして検証する。
import { describe, expect, it } from 'vitest';
import {
  filterVisibleReviews,
  parseReviewInput,
  reviewIdFor,
  reviewPhotoStoragePath,
  sortReviewsNewestFirst,
  summarizeReviews,
  toPublicReview,
  validateReviewPhoto,
  type EventReview,
} from './event-review';

function makeReview(overrides: Partial<EventReview> = {}): EventReview {
  return {
    id: 'member-a_shop-a',
    memberId: 'member-a',
    exhibitorId: 'shop-a',
    exhibitorName: '店A',
    stars: 5,
    categories: { taste: 5, service: 4, atmosphere: 4, presentation: 3 },
    text: 'おいしかった',
    nickname: 'たろう',
    photoUrls: [],
    visible: true,
    createdAt: '2026-11-14T01:00:00.000Z',
    updatedAt: '2026-11-14T01:00:00.000Z',
    ...overrides,
  };
}

const validCategories = {
  taste: 5,
  service: 4,
  atmosphere: 3,
  presentation: 4,
};

describe('reviewIdFor', () => {
  it('memberId と exhibitorId から一意なIDを作る', () => {
    expect(reviewIdFor('member-a', 'shop-a')).toBe('member-a_shop-a');
    expect(reviewIdFor('member-a', 'shop-b')).not.toBe(
      reviewIdFor('member-a', 'shop-a'),
    );
    expect(reviewIdFor('member-b', 'shop-a')).not.toBe(
      reviewIdFor('member-a', 'shop-a'),
    );
  });
});

describe('parseReviewInput', () => {
  it('最小入力（星と項目別だけ）を通す', () => {
    const result = parseReviewInput({
      exhibitorId: 'shop-a',
      stars: 4,
      categories: validCategories,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        exhibitorId: 'shop-a',
        stars: 4,
        categories: validCategories,
        text: '',
        nickname: '',
        photoUrls: [],
      });
    }
  });

  it('本文・ニックネームは前後の空白を落とし、写真URLを受け付ける', () => {
    const result = parseReviewInput({
      exhibitorId: ' shop-a ',
      stars: 5,
      categories: validCategories,
      text: '  また来たい  ',
      nickname: ' たろう ',
      photoUrls: ['https://example.com/a.jpg'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.exhibitorId).toBe('shop-a');
      expect(result.value.text).toBe('また来たい');
      expect(result.value.nickname).toBe('たろう');
      expect(result.value.photoUrls).toEqual(['https://example.com/a.jpg']);
    }
  });

  it('総合の星が 1〜5 の整数でなければ落とす', () => {
    for (const stars of [0, 6, 3.5, '5', undefined]) {
      const result = parseReviewInput({
        exhibitorId: 'shop-a',
        stars,
        categories: validCategories,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('項目別が欠けたり範囲外なら落とす', () => {
    const cases: unknown[] = [
      { taste: 5, service: 4, atmosphere: 3 },
      { taste: 5, service: 4, atmosphere: 3, presentation: 0 },
      { taste: 5, service: 4, atmosphere: 3, presentation: 6 },
      null,
      undefined,
    ];
    for (const categories of cases) {
      const result = parseReviewInput({
        exhibitorId: 'shop-a',
        stars: 5,
        categories,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('exhibitorId が無ければ落とす', () => {
    expect(
      parseReviewInput({ stars: 5, categories: validCategories }).ok,
    ).toBe(false);
    expect(
      parseReviewInput({
        exhibitorId: '  ',
        stars: 5,
        categories: validCategories,
      }).ok,
    ).toBe(false);
  });

  it('本文が長すぎると落とす', () => {
    const result = parseReviewInput({
      exhibitorId: 'shop-a',
      stars: 5,
      categories: validCategories,
      text: 'あ'.repeat(1001),
    });
    expect(result.ok).toBe(false);
    const justFit = parseReviewInput({
      exhibitorId: 'shop-a',
      stars: 5,
      categories: validCategories,
      text: 'あ'.repeat(1000),
    });
    expect(justFit.ok).toBe(true);
  });

  it('写真は3枚まで、https のURLだけ', () => {
    const tooMany = parseReviewInput({
      exhibitorId: 'shop-a',
      stars: 5,
      categories: validCategories,
      photoUrls: [
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
        'https://example.com/3.jpg',
        'https://example.com/4.jpg',
      ],
    });
    expect(tooMany.ok).toBe(false);
    const notHttps = parseReviewInput({
      exhibitorId: 'shop-a',
      stars: 5,
      categories: validCategories,
      photoUrls: ['http://example.com/1.jpg'],
    });
    expect(notHttps.ok).toBe(false);
  });

  it('オブジェクトでなければ落とす', () => {
    expect(parseReviewInput(null).ok).toBe(false);
    expect(parseReviewInput('x').ok).toBe(false);
  });
});

describe('summarizeReviews', () => {
  it('総合平均と項目別平均を小数1桁で返す', () => {
    const summary = summarizeReviews([
      makeReview({
        stars: 5,
        categories: { taste: 5, service: 4, atmosphere: 4, presentation: 3 },
      }),
      makeReview({
        stars: 4,
        categories: { taste: 4, service: 4, atmosphere: 2, presentation: 3 },
      }),
      makeReview({
        stars: 4,
        categories: { taste: 5, service: 5, atmosphere: 3, presentation: 4 },
      }),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.averageStars).toBe(4.3);
    expect(summary.categories).toEqual({
      taste: 4.7,
      service: 4.3,
      atmosphere: 3,
      presentation: 3.3,
    });
  });

  it('0件ならすべて0', () => {
    expect(summarizeReviews([])).toEqual({
      count: 0,
      averageStars: 0,
      categories: { taste: 0, service: 0, atmosphere: 0, presentation: 0 },
    });
  });
});

describe('toPublicReview', () => {
  it('memberId と visible を含めない', () => {
    const pub = toPublicReview(makeReview());
    expect(pub).not.toHaveProperty('memberId');
    expect(pub).not.toHaveProperty('visible');
    expect(pub.exhibitorName).toBe('店A');
    expect(pub.stars).toBe(5);
  });
});

describe('filterVisibleReviews（公開一覧から非表示を除く）', () => {
  it('visible=false のレビューは公開一覧から消える', () => {
    const reviews = [
      makeReview({ id: 'r1' }),
      makeReview({ id: 'r2', visible: false }),
      makeReview({ id: 'r3' }),
    ];
    const visible = filterVisibleReviews(reviews);
    expect(visible.map((r) => r.id)).toEqual(['r1', 'r3']);
  });
});

describe('sortReviewsNewestFirst', () => {
  it('更新日時の新しい順に並べる', () => {
    const reviews = [
      makeReview({ id: 'r1', updatedAt: '2026-11-10T00:00:00.000Z' }),
      makeReview({ id: 'r2', updatedAt: '2026-11-14T00:00:00.000Z' }),
      makeReview({ id: 'r3', updatedAt: '2026-11-12T00:00:00.000Z' }),
    ];
    expect(sortReviewsNewestFirst(reviews).map((r) => r.id)).toEqual([
      'r2',
      'r3',
      'r1',
    ]);
  });
});

describe('validateReviewPhoto', () => {
  it('jpg/png/webp を通し、拡張子を返す', () => {
    expect(validateReviewPhoto({ contentType: 'image/jpeg', size: 1024 })).toEqual({
      ok: true,
      extension: 'jpg',
    });
    expect(validateReviewPhoto({ contentType: 'image/png', size: 1024 })).toEqual({
      ok: true,
      extension: 'png',
    });
    expect(validateReviewPhoto({ contentType: 'image/webp', size: 1024 })).toEqual({
      ok: true,
      extension: 'webp',
    });
  });

  it('対応外の形式は落とす', () => {
    expect(
      validateReviewPhoto({ contentType: 'image/gif', size: 1024 }).ok,
    ).toBe(false);
    expect(
      validateReviewPhoto({ contentType: 'application/pdf', size: 1024 }).ok,
    ).toBe(false);
  });

  it('5MB超と空ファイルは落とす', () => {
    expect(
      validateReviewPhoto({
        contentType: 'image/jpeg',
        size: 5 * 1024 * 1024 + 1,
      }).ok,
    ).toBe(false);
    expect(
      validateReviewPhoto({
        contentType: 'image/jpeg',
        size: 5 * 1024 * 1024,
      }).ok,
    ).toBe(true);
    expect(validateReviewPhoto({ contentType: 'image/jpeg', size: 0 }).ok).toBe(
      false,
    );
  });
});

describe('reviewPhotoStoragePath', () => {
  it('events/{eventId}/review-photos/{memberId}/ 配下になる', () => {
    expect(reviewPhotoStoragePath('event-1', 'member-a', 'x.jpg')).toBe(
      'events/event-1/review-photos/member-a/x.jpg',
    );
  });
});
