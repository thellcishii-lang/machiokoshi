import { describe, expect, it } from 'vitest';
import {
  initialPushRequestStatus,
  isPushRequestApprovable,
  paidPushRequestStatus,
  parsePushRequest,
  parsePushRequestStatus,
  rejectedPushRequestStatus,
} from './event-push-request';

describe('プッシュ申請の状態読み取り', () => {
  it('既知の状態はそのまま読み、未知の値は承認待ちに倒す', () => {
    expect(parsePushRequestStatus('unpaid')).toBe('unpaid');
    expect(parsePushRequestStatus('pending')).toBe('pending');
    expect(parsePushRequestStatus('sent')).toBe('sent');
    expect(parsePushRequestStatus('rejected')).toBe('rejected');
    expect(parsePushRequestStatus('failed')).toBe('failed');
    expect(parsePushRequestStatus('approved')).toBe('pending');
    expect(parsePushRequestStatus(undefined)).toBe('pending');
    expect(parsePushRequestStatus(null)).toBe('pending');
    expect(parsePushRequestStatus(42)).toBe('pending');
  });
});

describe('プッシュ申請のライフサイクル', () => {
  it('作成直後: 無料なら承認待ち、有料なら支払い待ち', () => {
    expect(initialPushRequestStatus(0)).toBe('pending');
    expect(initialPushRequestStatus(500)).toBe('unpaid');
    expect(initialPushRequestStatus(3000)).toBe('unpaid');
  });

  it('支払い確認: 支払い待ちのときだけ承認待ちへ進む', () => {
    expect(paidPushRequestStatus('unpaid')).toBe('pending');
    // 二重適用（verify と Webhook の競合）では遷移しない
    expect(paidPushRequestStatus('pending')).toBeNull();
    expect(paidPushRequestStatus('sent')).toBeNull();
    expect(paidPushRequestStatus('rejected')).toBeNull();
    expect(paidPushRequestStatus('failed')).toBeNull();
  });

  it('却下: 承認待ちのときだけ却下できる（未払いはキューの対象外）', () => {
    expect(rejectedPushRequestStatus('pending')).toBe('rejected');
    expect(rejectedPushRequestStatus('unpaid')).toBeNull();
    expect(rejectedPushRequestStatus('sent')).toBeNull();
    expect(rejectedPushRequestStatus('rejected')).toBeNull();
    expect(rejectedPushRequestStatus('failed')).toBeNull();
  });

  it('承認キューに出るのは承認待ちだけ', () => {
    expect(isPushRequestApprovable('pending')).toBe(true);
    expect(isPushRequestApprovable('unpaid')).toBe(false);
    expect(isPushRequestApprovable('sent')).toBe(false);
    expect(isPushRequestApprovable('rejected')).toBe(false);
    expect(isPushRequestApprovable('failed')).toBe(false);
  });
});

describe('プッシュ申請ドキュメントの読み取り', () => {
  it('保存済みドキュメントをそのまま読める', () => {
    const parsed = parsePushRequest('req-1', {
      exhibitorId: 'shop-1',
      exhibitorName: 'カレー食堂 かぐら',
      title: '週末限定メニュー',
      body: '土日は村の野菜カレーが100円引きです',
      titleI18n: { ja: '週末限定メニュー', en: 'Weekend special' },
      bodyI18n: { ja: '土日は村の野菜カレーが100円引きです' },
      status: 'unpaid',
      feeAmount: 3000,
      chargeSessionId: 'cs_test_1',
      campaignId: null,
      sentCount: null,
      error: null,
      createdAt: '2026-11-17T01:00:00.000Z',
      decidedAt: null,
      sentAt: null,
    });
    expect(parsed.id).toBe('req-1');
    expect(parsed.exhibitorId).toBe('shop-1');
    expect(parsed.status).toBe('unpaid');
    expect(parsed.feeAmount).toBe(3000);
    expect(parsed.chargeSessionId).toBe('cs_test_1');
    expect(parsed.titleI18n.en).toBe('Weekend special');
    expect(parsed.createdAt).toBe('2026-11-17T01:00:00.000Z');
    expect(parsed.sentAt).toBeNull();
  });

  it('欠けたドキュメントは安全な既定値に倒れる', () => {
    const parsed = parsePushRequest('req-2', {});
    expect(parsed.exhibitorId).toBe('');
    expect(parsed.title).toBe('');
    expect(parsed.status).toBe('pending');
    expect(parsed.feeAmount).toBe(0);
    expect(parsed.chargeSessionId).toBeNull();
    expect(parsed.campaignId).toBeNull();
    expect(parsed.sentCount).toBeNull();
    expect(parsed.error).toBeNull();
    expect(parsed.createdAt).toBe('');
    expect(parsed.decidedAt).toBeNull();
  });
});
