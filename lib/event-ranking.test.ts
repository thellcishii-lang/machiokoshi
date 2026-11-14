// lib/event-ranking.test.ts
// 週次ランキングの純粋関数: 週期間（JST 月曜〜日曜）の境界、期間
// フィルタ、集計（最低件数・タイブレーク）を検証する。
import { describe, expect, it } from 'vitest';
import {
  buildRanking,
  filterReviewsInPeriod,
  previousWeekPeriodJst,
  weekKeyOf,
  weekPeriodJst,
} from './event-ranking';

describe('weekPeriodJst', () => {
  it('月曜当日はその日が開始日', () => {
    // 2026-11-16 は月曜
    const period = weekPeriodJst(new Date('2026-11-16T00:00:00+09:00'));
    expect(period).toEqual({ start: '2026-11-16', end: '2026-11-22' });
  });

  it('日曜は同じ週の月曜が開始日', () => {
    // 2026-11-22 は日曜
    const period = weekPeriodJst(new Date('2026-11-22T23:59:00+09:00'));
    expect(period).toEqual({ start: '2026-11-16', end: '2026-11-22' });
  });

  it('水曜はその週の月曜〜日曜', () => {
    const period = weekPeriodJst(new Date('2026-11-18T12:00:00+09:00'));
    expect(period).toEqual({ start: '2026-11-16', end: '2026-11-22' });
  });

  it('UTC では日曜でも JST で月曜なら月曜始まりの週になる', () => {
    // 2026-11-15T16:00Z = JST 2026-11-16 01:00（月曜）
    const period = weekPeriodJst(new Date('2026-11-15T16:00:00Z'));
    expect(period).toEqual({ start: '2026-11-16', end: '2026-11-22' });
  });

  it('年跨ぎ: 2027-01-01（金）は 2026-12-28 始まりの週', () => {
    const period = weekPeriodJst(new Date('2027-01-01T12:00:00+09:00'));
    expect(period).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });

  it('月跨ぎ: 2026-11-01（日）は 2026-10-26 始まりの週', () => {
    const period = weekPeriodJst(new Date('2026-11-01T12:00:00+09:00'));
    expect(period).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  });
});

describe('previousWeekPeriodJst', () => {
  it('先週の月曜〜日曜を返す', () => {
    const period = previousWeekPeriodJst(new Date('2026-11-18T12:00:00+09:00'));
    expect(period).toEqual({ start: '2026-11-09', end: '2026-11-15' });
  });

  it('月曜 00:00 ちょうどでも先週は完了した週になる', () => {
    const period = previousWeekPeriodJst(new Date('2026-11-16T00:00:00+09:00'));
    expect(period).toEqual({ start: '2026-11-09', end: '2026-11-15' });
  });

  it('年跨ぎでもずれない', () => {
    const period = previousWeekPeriodJst(new Date('2027-01-01T12:00:00+09:00'));
    expect(period).toEqual({ start: '2026-12-21', end: '2026-12-27' });
  });

  it('weekKey は期間開始日', () => {
    expect(weekKeyOf({ start: '2026-11-09', end: '2026-11-15' })).toBe(
      '2026-11-09',
    );
  });
});

describe('filterReviewsInPeriod', () => {
  const period = { start: '2026-11-09', end: '2026-11-15' };
  const at = (iso: string | null) => ({ createdAt: iso });

  it('開始日の 00:00（JST）ちょうどは含み、前日は含まない', () => {
    // 2026-11-09 00:00 JST = 2026-11-08T15:00:00Z
    expect(filterReviewsInPeriod([at('2026-11-08T15:00:00.000Z')], period)).toHaveLength(1);
    expect(filterReviewsInPeriod([at('2026-11-08T14:59:59.000Z')], period)).toHaveLength(0);
  });

  it('終了日の 23:59（JST）まで含み、翌日 00:00 は含まない', () => {
    // 2026-11-15 23:59 JST = 2026-11-15T14:59:00Z
    expect(filterReviewsInPeriod([at('2026-11-15T14:59:00.000Z')], period)).toHaveLength(1);
    // 2026-11-16 00:00 JST = 2026-11-15T15:00:00Z
    expect(filterReviewsInPeriod([at('2026-11-15T15:00:00.000Z')], period)).toHaveLength(0);
  });

  it('createdAt が null のものは含まない', () => {
    expect(filterReviewsInPeriod([at(null)], period)).toHaveLength(0);
  });
});

describe('buildRanking', () => {
  const exhibitors = [
    { id: 'shop-a', name: 'A食堂' },
    { id: 'shop-b', name: 'Bカレー' },
    { id: 'shop-c', name: 'Cそば' },
  ];
  const review = (
    exhibitorId: string,
    stars: number,
    visible = true,
  ) => ({
    exhibitorId,
    exhibitorName: 'レビュー側の店名',
    stars,
    visible,
  });

  it('平均星の高い順に並び、件数も返る', () => {
    const entries = buildRanking(
      [
        review('shop-a', 5), review('shop-a', 4), review('shop-a', 4),
        review('shop-b', 5), review('shop-b', 5), review('shop-b', 5),
        review('shop-c', 3), review('shop-c', 3), review('shop-c', 3),
      ],
      exhibitors,
      3,
    );
    expect(entries.map((e) => e.exhibitorId)).toEqual(['shop-b', 'shop-a', 'shop-c']);
    expect(entries[0]).toEqual({
      exhibitorId: 'shop-b',
      exhibitorName: 'Bカレー',
      avgStars: 5,
      reviewCount: 3,
    });
    expect(entries[1].avgStars).toBe(4.3);
  });

  it('最低件数に届かない店は対象外', () => {
    const entries = buildRanking(
      [review('shop-a', 5), review('shop-a', 5), review('shop-b', 1), review('shop-b', 1), review('shop-b', 1)],
      exhibitors,
      3,
    );
    expect(entries.map((e) => e.exhibitorId)).toEqual(['shop-b']);
  });

  it('非表示レビューは数えない', () => {
    const entries = buildRanking(
      [
        review('shop-a', 5), review('shop-a', 5), review('shop-a', 5, false),
        review('shop-b', 4), review('shop-b', 4), review('shop-b', 4),
      ],
      exhibitors,
      3,
    );
    // shop-a は可視2件で最低件数未満 → 対象外
    expect(entries.map((e) => e.exhibitorId)).toEqual(['shop-b']);
  });

  it('平均が同点なら件数が多い順、さらに店名順で決定的に並ぶ', () => {
    const entries = buildRanking(
      [
        review('shop-a', 4), review('shop-a', 4), review('shop-a', 4), review('shop-a', 4),
        review('shop-b', 4), review('shop-b', 4), review('shop-b', 4),
        review('shop-c', 4), review('shop-c', 4), review('shop-c', 4),
      ],
      exhibitors,
      3,
    );
    expect(entries.map((e) => e.exhibitorId)).toEqual(['shop-a', 'shop-b', 'shop-c']);
  });

  it('店名は参加店台帳の登録名を使う（レビュー側の店名ではない）', () => {
    const entries = buildRanking(
      [review('shop-a', 5), review('shop-a', 5), review('shop-a', 5)],
      exhibitors,
      3,
    );
    expect(entries[0].exhibitorName).toBe('A食堂');
  });

  it('台帳に無い店（削除済み）のレビューは対象外', () => {
    const entries = buildRanking(
      [
        review('shop-gone', 5), review('shop-gone', 5), review('shop-gone', 5),
        review('shop-a', 3), review('shop-a', 3), review('shop-a', 3),
      ],
      exhibitors,
      3,
    );
    expect(entries.map((e) => e.exhibitorId)).toEqual(['shop-a']);
  });

  it('対象が無ければ空配列', () => {
    expect(buildRanking([], exhibitors, 3)).toEqual([]);
  });
});
