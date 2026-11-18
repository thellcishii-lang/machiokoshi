// lib/event-member-auth.test.ts
// 認証方式（契約の smsAuthEnabled）による本人キー導出の分岐と、
// 端末会員の memberId がスタンプ・クーポン・レビューの各キーに
// そのまま流れること（電話会員と同じ作法で扱えること）を検証する。
import { describe, expect, it } from 'vitest';
import { resolveMemberIdFromClaims } from './event-member-auth';
import { claimIdFor, memberIdForDevice, memberIdForPhone } from './event-coupon';
import { stampIdFor } from './event-stamp';
import { reviewIdFor } from './event-review';
import { buildStampQrPayload, parseRedeemQrPayload } from './stamp-qr';

const PHONE = '+819012345678';
const DEVICE_UID = 'anon-uid-xyz';

describe('resolveMemberIdFromClaims（認証方式の分岐）', () => {
  it('SMSオン: 電話番号のあるトークンからは電話の memberId', () => {
    expect(
      resolveMemberIdFromClaims({ uid: 'u1', phone_number: PHONE }, true),
    ).toBe(memberIdForPhone(PHONE));
  });

  it('SMSオン: 電話番号の無いトークンは本人として扱わない', () => {
    expect(resolveMemberIdFromClaims({ uid: DEVICE_UID }, true)).toBeNull();
    expect(resolveMemberIdFromClaims({}, true)).toBeNull();
  });

  it('SMSオフ（既定）: uid から端末の memberId を導く', () => {
    expect(resolveMemberIdFromClaims({ uid: DEVICE_UID }, false)).toBe(
      memberIdForDevice(DEVICE_UID),
    );
  });

  it('SMSオフ: 電話番号があっても端末キーで導く（電話はキーにしない）', () => {
    expect(
      resolveMemberIdFromClaims({ uid: DEVICE_UID, phone_number: PHONE }, false),
    ).toBe(memberIdForDevice(DEVICE_UID));
  });

  it('SMSオフ: uid の無いトークンは本人として扱わない', () => {
    expect(resolveMemberIdFromClaims({ phone_number: PHONE }, false)).toBeNull();
    expect(resolveMemberIdFromClaims({}, false)).toBeNull();
  });

  it('端末会員と電話会員は別の本人になる', () => {
    expect(memberIdForDevice(DEVICE_UID)).not.toBe(memberIdForPhone(PHONE));
  });
});

describe('端末会員の memberId の流れ（スタンプ・クーポン・レビュー）', () => {
  const deviceMemberId = memberIdForDevice(DEVICE_UID);

  it('スタンプ用QR（店が読み取る客のQR）が端末会員でも往復する', () => {
    // 来場者画面は my-stamps の応答の memberId で QR を作り、店の読み取り
    // 側は payload から memberId を取り戻す。端末会員でも同じ往復が効く。
    const payload = buildStampQrPayload('event-1', deviceMemberId);
    const parsed = parseRedeemQrPayload(payload);
    expect(parsed).toMatchObject({
      type: 'stamp',
      eventId: 'event-1',
      memberId: deviceMemberId,
    });
  });

  it('スタンプ記録のIDは端末会員でも一意に決まる', () => {
    expect(stampIdFor(deviceMemberId, 1, 'shop-a')).toBe(
      `${deviceMemberId}_1_shop-a`,
    );
    expect(stampIdFor(deviceMemberId, 1, 'shop-a')).not.toBe(
      stampIdFor(memberIdForPhone(PHONE), 1, 'shop-a'),
    );
  });

  it('クーポン取得のID（1人1回判定）は端末会員でも一意に決まる', () => {
    expect(claimIdFor(deviceMemberId, 'coupon-a')).toBe(
      `${deviceMemberId}_coupon-a`,
    );
    expect(claimIdFor(deviceMemberId, 'coupon-a')).not.toBe(
      claimIdFor(memberIdForPhone(PHONE), 'coupon-a'),
    );
  });

  it('レビューのID（1人1店1件）は端末会員でも一意に決まる', () => {
    expect(reviewIdFor(deviceMemberId, 'shop-a')).toBe(
      reviewIdFor(deviceMemberId, 'shop-a'),
    );
    expect(reviewIdFor(deviceMemberId, 'shop-a')).not.toBe(
      reviewIdFor(memberIdForPhone(PHONE), 'shop-a'),
    );
  });
});
