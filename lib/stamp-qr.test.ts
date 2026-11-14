// lib/stamp-qr.test.ts
// QR ペイロードの生成と、消込画面側の振り分け（パース）。
import { describe, expect, it } from 'vitest';
import {
  buildFreeCouponQrPayload,
  buildStampQrPayload,
  parseRedeemQrPayload,
} from './stamp-qr';

describe('build / parse の往復', () => {
  it('スタンプ用ペイロードを往復できる', () => {
    const text = buildStampQrPayload('event-1', 'member-a');
    expect(parseRedeemQrPayload(text)).toEqual({
      type: 'stamp',
      eventId: 'event-1',
      memberId: 'member-a',
    });
  });
  it('無料クーポン用ペイロードを往復できる', () => {
    const text = buildFreeCouponQrPayload('event-1', 'free-1');
    expect(parseRedeemQrPayload(text)).toEqual({
      type: 'free',
      eventId: 'event-1',
      freeCouponId: 'free-1',
    });
  });
});

describe('parseRedeemQrPayload', () => {
  it('JSON でない文字列は従来の claimId として扱う', () => {
    expect(parseRedeemQrPayload('member-a_coupon-1')).toEqual({
      type: 'claim',
      claimId: 'member-a_coupon-1',
    });
  });
  it('壊れた JSON は claimId として扱う', () => {
    expect(parseRedeemQrPayload('{not json')).toEqual({
      type: 'claim',
      claimId: '{not json',
    });
  });
  it('必須項目が欠けた JSON は claimId として扱う', () => {
    expect(parseRedeemQrPayload('{"v":1,"type":"stamp"}')).toEqual({
      type: 'claim',
      claimId: '{"v":1,"type":"stamp"}',
    });
  });
  it('空文字列は null', () => {
    expect(parseRedeemQrPayload('')).toBeNull();
    expect(parseRedeemQrPayload('   ')).toBeNull();
  });
});
