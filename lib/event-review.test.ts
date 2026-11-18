// lib/event-review.test.ts
// レビューの純粋ロジック: ドキュメントID構成、入力検証、集計、
// 公開用整形（memberId を出さない・非表示を除く）、写真検証。
// Firestore を使う処理（upsertReview 等）はルートテスト側で
// lib をモックして検証する。
import { describe, expect, it } from 'vitest';
import {
  filterVisibleReviews,
  legacyCategoriesFromScores,
  parseReviewCategoryScores,
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
    categoryScores: [
      { label: '味', stars: 5 },
      { label: '接客', stars: 4 },
      { label: '雰囲気', stars: 4 },
      { label: '盛り付け', stars: 3 },
    ],
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

/** 項目名と星の対応から categoryScores を作る（並びは渡した順）。 */
function scoresOf(entries: Array<[string, number]>) {
  return entries.map(([label, stars]) => ({ label, stars }));
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
  it('最小入力（星と項目別だけ）を通す。旧形式の項目別は既定の項目名に写す', () => {
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
        categoryScores: scoresOf([
          ['味', 5],
          ['接客', 4],
          ['雰囲気', 3],
          ['盛り付け', 4],
        ]),
        text: '',
        nickname: '',
        photoUrls: [],
      });
    }
  });

  it('項目名つきの項目別（categoryScores）を受け付け、項目名の空白を落とす', () => {
    const result = parseReviewInput({
      exhibitorId: 'shop-a',
      stars: 4,
      categoryScores: [
        { label: ' コスパ ', stars: 5 },
        { label: '量', stars: 3 },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.categoryScores).toEqual(
        scoresOf([
          ['コスパ', 5],
          ['量', 3],
        ]),
      );
    }
  });

  it('categoryScores の形が不正なら落とす', () => {
    const cases: unknown[] = [
      [],
      [{ label: '味', stars: 5 }, { label: '味', stars: 4 }],
      [{ label: '味', stars: 0 }],
      [{ label: '味', stars: 6 }],
      [{ label: '味', stars: 3.5 }],
      [{ label: '', stars: 5 }],
      [{ label: 'あ'.repeat(11), stars: 5 }],
      [{ label: '味' }],
      [{ stars: 5 }],
      ['味'],
      '味',
      Array.from({ length: 7 }, (_, i) => ({ label: `項目${i}`, stars: 5 })),
    ];
    for (const categoryScores of cases) {
      const result = parseReviewInput({
        exhibitorId: 'shop-a',
        stars: 5,
        categoryScores,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('項目別がどちらも無ければ落とす', () => {
    expect(parseReviewInput({ exhibitorId: 'shop-a', stars: 5 }).ok).toBe(false);
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
        categoryScores: scoresOf([
          ['味', 5],
          ['接客', 4],
          ['雰囲気', 4],
          ['盛り付け', 3],
        ]),
      }),
      makeReview({
        stars: 4,
        categoryScores: scoresOf([
          ['味', 4],
          ['接客', 4],
          ['雰囲気', 2],
          ['盛り付け', 3],
        ]),
      }),
      makeReview({
        stars: 4,
        categoryScores: scoresOf([
          ['味', 5],
          ['接客', 5],
          ['雰囲気', 3],
          ['盛り付け', 4],
        ]),
      }),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.averageStars).toBe(4.3);
    expect(summary.categoryAverages).toEqual([
      { label: '味', average: 4.7 },
      { label: '接客', average: 4.3 },
      { label: '雰囲気', average: 3 },
      { label: '盛り付け', average: 3.3 },
    ]);
    // 互換用の固定4項目も同じ平均になる
    expect(summary.categories).toEqual({
      taste: 4.7,
      service: 4.3,
      atmosphere: 3,
      presentation: 3.3,
    });
  });

  it('項目の内容が途中で変わっても、項目名ごとに含むレビューだけで平均する', () => {
    const summary = summarizeReviews([
      makeReview({
        stars: 5,
        categoryScores: scoresOf([
          ['味', 5],
          ['接客', 5],
        ]),
      }),
      makeReview({
        stars: 3,
        categoryScores: scoresOf([
          ['味', 3],
          ['コスパ', 4],
        ]),
      }),
    ]);
    expect(summary.categoryAverages).toEqual([
      { label: '味', average: 4 },
      { label: '接客', average: 5 },
      { label: 'コスパ', average: 4 },
    ]);
    // 互換用の固定4項目は既定の項目名だけを写す
    expect(summary.categories).toEqual({
      taste: 4,
      service: 5,
      atmosphere: 0,
      presentation: 0,
    });
  });

  it('0件ならすべて0で項目別は空', () => {
    expect(summarizeReviews([])).toEqual({
      count: 0,
      averageStars: 0,
      categoryAverages: [],
      categories: { taste: 0, service: 0, atmosphere: 0, presentation: 0 },
    });
  });
});

describe('parseReviewCategoryScores（保存済みレビューの項目別を読む）', () => {
  it('現在の形式（categoryScores）をそのまま読む', () => {
    expect(
      parseReviewCategoryScores({
        categoryScores: scoresOf([
          ['コスパ', 5],
          ['量', 3],
        ]),
      }),
    ).toEqual(
      scoresOf([
        ['コスパ', 5],
        ['量', 3],
      ]),
    );
  });

  it('導入前の形式（categories の固定4項目）を既定の項目名に写す', () => {
    expect(
      parseReviewCategoryScores({
        categories: { taste: 5, service: 4, atmosphere: 3, presentation: 2 },
      }),
    ).toEqual(
      scoresOf([
        ['味', 5],
        ['接客', 4],
        ['雰囲気', 3],
        ['盛り付け', 2],
      ]),
    );
  });

  it('categoryScores があれば旧形式より優先する', () => {
    expect(
      parseReviewCategoryScores({
        categoryScores: scoresOf([['量', 4]]),
        categories: { taste: 1, service: 1, atmosphere: 1, presentation: 1 },
      }),
    ).toEqual(scoresOf([['量', 4]]));
  });

  it('壊れた要素は落とし、どちらも無ければ空配列', () => {
    expect(
      parseReviewCategoryScores({
        categoryScores: [
          { label: '味', stars: 5 },
          { label: '味', stars: 3 },
          { label: '', stars: 5 },
          { label: '接客', stars: 'x' },
          'bad',
        ],
      }),
    ).toEqual(scoresOf([['味', 5]]));
    expect(parseReviewCategoryScores({})).toEqual([]);
    expect(parseReviewCategoryScores({ categoryScores: 'x' })).toEqual([]);
  });
});

describe('legacyCategoriesFromScores（互換用の固定4項目）', () => {
  it('既定の項目名だけを写し、無い項目は0', () => {
    expect(
      legacyCategoriesFromScores(
        scoresOf([
          ['味', 5],
          ['コスパ', 4],
          ['盛り付け', 2],
        ]),
      ),
    ).toEqual({ taste: 5, service: 0, atmosphere: 0, presentation: 2 });
    expect(legacyCategoriesFromScores([])).toEqual({
      taste: 0,
      service: 0,
      atmosphere: 0,
      presentation: 0,
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

  it('項目名つきの項目別評価（スナップショット）をそのまま出す', () => {
    const pub = toPublicReview(
      makeReview({ categoryScores: scoresOf([['コスパ', 4]]) }),
    );
    expect(pub.categoryScores).toEqual(scoresOf([['コスパ', 4]]));
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
