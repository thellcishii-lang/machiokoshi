// lib/event-stamp.test.ts
// スタンプの純粋ロジック: ドキュメントID構成、達成判定、現在の周の解決、
// 取消し可否。Firestore を使う処理（grantStamp 等）はルートテスト側で
// lib をモックして検証する。
import { describe, expect, it } from 'vitest';
import {
  evaluateStampCancel,
  isRoundCompleted,
  resolveCurrentRound,
  stampIdFor,
} from './event-stamp';

describe('stampIdFor', () => {
  it('memberId・周・参加店ID から一意なIDを作る', () => {
    expect(stampIdFor('member-a', 1, 'shop-a')).toBe('member-a_1_shop-a');
    expect(stampIdFor('member-a', 2, 'shop-a')).not.toBe(
      stampIdFor('member-a', 1, 'shop-a'),
    );
    expect(stampIdFor('member-a', 1, 'shop-b')).not.toBe(
      stampIdFor('member-a', 1, 'shop-a'),
    );
  });
});

describe('isRoundCompleted', () => {
  it('達成個数に届いたら達成', () => {
    expect(isRoundCompleted(5, 5)).toBe(true);
    expect(isRoundCompleted(6, 5)).toBe(true);
    expect(isRoundCompleted(4, 5)).toBe(false);
    expect(isRoundCompleted(0, 5)).toBe(false);
    expect(isRoundCompleted(1, 1)).toBe(true);
  });
});

describe('resolveCurrentRound', () => {
  it('保存済みの stampRound があればそれが正', () => {
    expect(resolveCurrentRound(3, [1, 1, 2], 5)).toBe(3);
    expect(resolveCurrentRound(1, [], 5)).toBe(1);
  });
  it('保存が無くスタンプも無ければ 1周目', () => {
    expect(resolveCurrentRound(undefined, [], 5)).toBe(1);
    expect(resolveCurrentRound(null, [], 5)).toBe(1);
  });
  it('保存が無ければ実績の最大周を引き継ぐ（未達成ならその周）', () => {
    expect(resolveCurrentRound(undefined, [1, 1, 2], 5)).toBe(2);
  });
  it('最大周が達成済みなら次の周に進める', () => {
    expect(resolveCurrentRound(undefined, [2, 2, 2, 2, 2], 5)).toBe(3);
  });
  it('不正な保存値は実績からの復元に倒す', () => {
    expect(resolveCurrentRound(0, [1], 5)).toBe(1);
    expect(resolveCurrentRound('2', [2, 2], 5)).toBe(2);
  });
});

describe('evaluateStampCancel', () => {
  const today = '2026-11-14';
  const stamp = {
    exhibitorId: 'shop-a',
    round: 2,
    grantedDateJst: today,
  };
  it('自店・当日・現在の周なら取り消せる', () => {
    expect(evaluateStampCancel(stamp, 'shop-a', 2, today)).toEqual({
      allowed: true,
    });
  });
  it('他店のスタンプは取り消せない', () => {
    expect(evaluateStampCancel(stamp, 'shop-b', 2, today)).toEqual({
      allowed: false,
      reason: 'not-owner',
    });
  });
  it('過去の周のスタンプは取り消せない', () => {
    expect(evaluateStampCancel(stamp, 'shop-a', 3, today)).toEqual({
      allowed: false,
      reason: 'not-current-round',
    });
  });
  it('当日以外のスタンプは取り消せない', () => {
    expect(
      evaluateStampCancel(
        { ...stamp, grantedDateJst: '2026-11-13' },
        'shop-a',
        2,
        today,
      ),
    ).toEqual({ allowed: false, reason: 'not-today' });
  });
});
