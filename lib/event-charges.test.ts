import { describe, expect, it } from 'vitest';
import {
  COUPON_ISSUE_KIND,
  PUSH_SEND_KIND,
  chargeRequiresPayment,
  couponIssueFeeOf,
  effectFromStripeEventForCharge,
  interpretCheckoutSession,
  isChargeKind,
  pushFeeOf,
} from './event-charges';

describe('単発課金の種別（kind）', () => {
  it('クーポン発行とプッシュ配信だけが単発課金', () => {
    expect(isChargeKind(COUPON_ISSUE_KIND)).toBe(true);
    expect(isChargeKind(PUSH_SEND_KIND)).toBe(true);
    expect(isChargeKind('top-placement')).toBe(false);
    expect(isChargeKind('ad-placement')).toBe(false);
    expect(isChargeKind('shop-billing')).toBe(false);
    expect(isChargeKind(undefined)).toBe(false);
    expect(isChargeKind(null)).toBe(false);
  });
});

describe('手数料の解決', () => {
  it('未設定（null）の手数料は無料（0円）に倒れる', () => {
    expect(couponIssueFeeOf({ couponIssuePrice: null })).toBe(0);
    expect(pushFeeOf({ pushPrice: null })).toBe(0);
  });

  it('設定済みの手数料はそのまま返る（0 は無料として保持）', () => {
    expect(couponIssueFeeOf({ couponIssuePrice: 0 })).toBe(0);
    expect(couponIssueFeeOf({ couponIssuePrice: 500 })).toBe(500);
    expect(pushFeeOf({ pushPrice: 0 })).toBe(0);
    expect(pushFeeOf({ pushPrice: 3000 })).toBe(3000);
  });

  it('Checkout が必要かどうかは金額が正かどうかで決まる', () => {
    expect(chargeRequiresPayment(0)).toBe(false);
    expect(chargeRequiresPayment(1)).toBe(true);
    expect(chargeRequiresPayment(500)).toBe(true);
  });
});

const paidCouponSession = {
  id: 'cs_test_123',
  mode: 'payment',
  payment_status: 'paid',
  amount_total: 500,
  metadata: {
    kind: 'coupon-issue',
    eventId: 'event-1',
    exhibitorId: 'shop-1',
    targetId: 'coupon-1',
  },
};

describe('Checkout セッションの解釈', () => {
  it('支払い済みの単発課金セッションを解釈できる', () => {
    expect(interpretCheckoutSession(paidCouponSession)).toEqual({
      sessionId: 'cs_test_123',
      kind: 'coupon-issue',
      eventId: 'event-1',
      exhibitorId: 'shop-1',
      targetId: 'coupon-1',
      amountTotal: 500,
      paid: true,
    });
  });

  it('未払いのセッションは paid: false で解釈される（却下はしない）', () => {
    const interpreted = interpretCheckoutSession({
      ...paidCouponSession,
      payment_status: 'unpaid',
    });
    expect(interpreted?.paid).toBe(false);
    expect(interpreted?.kind).toBe('coupon-issue');
  });

  it('プッシュ配信の種別も解釈できる', () => {
    const interpreted = interpretCheckoutSession({
      ...paidCouponSession,
      metadata: { ...paidCouponSession.metadata, kind: 'push-send', targetId: 'req-1' },
    });
    expect(interpreted?.kind).toBe('push-send');
    expect(interpreted?.targetId).toBe('req-1');
  });

  it('サブスクリプション（mode違い）は単発課金として解釈しない', () => {
    expect(
      interpretCheckoutSession({ ...paidCouponSession, mode: 'subscription' }),
    ).toBeNull();
  });

  it('kind が単発課金でないセッションは解釈しない', () => {
    expect(
      interpretCheckoutSession({
        ...paidCouponSession,
        metadata: { ...paidCouponSession.metadata, kind: 'top-placement' },
      }),
    ).toBeNull();
    expect(
      interpretCheckoutSession({ ...paidCouponSession, metadata: {} }),
    ).toBeNull();
    expect(
      interpretCheckoutSession({ ...paidCouponSession, metadata: null }),
    ).toBeNull();
  });

  it('対象を特定する metadata が欠けていれば解釈しない', () => {
    const { targetId: _t, ...noTarget } = paidCouponSession.metadata;
    expect(
      interpretCheckoutSession({ ...paidCouponSession, metadata: noTarget }),
    ).toBeNull();
    const { eventId: _e, ...noEvent } = paidCouponSession.metadata;
    expect(
      interpretCheckoutSession({ ...paidCouponSession, metadata: noEvent }),
    ).toBeNull();
    expect(interpretCheckoutSession(null)).toBeNull();
    expect(interpretCheckoutSession('cs_test_123')).toBeNull();
    expect(interpretCheckoutSession({})).toBeNull();
  });

  it('請求額が無ければ 0 として解釈する', () => {
    const { amount_total: _a, ...noAmount } = paidCouponSession;
    expect(interpretCheckoutSession(noAmount)?.amountTotal).toBe(0);
  });
});

describe('Webhook イベントからの効果抽出', () => {
  const completedEvent = {
    id: 'evt_1',
    type: 'checkout.session.completed',
    created: 1763352000,
    data: { object: paidCouponSession },
  };

  it('支払い完了イベントから効果を取り出せる', () => {
    const effect = effectFromStripeEventForCharge(completedEvent);
    expect(effect?.kind).toBe('coupon-issue');
    expect(effect?.targetId).toBe('coupon-1');
    expect(effect?.paid).toBe(true);
    expect(effect?.occurredAt).toBe(new Date(1763352000 * 1000).toISOString());
  });

  it('完了以外のイベント種別は対象外', () => {
    expect(
      effectFromStripeEventForCharge({
        ...completedEvent,
        type: 'invoice.paid',
      }),
    ).toBeNull();
    expect(
      effectFromStripeEventForCharge({
        ...completedEvent,
        type: 'checkout.session.expired',
      }),
    ).toBeNull();
  });

  it('未払いの完了イベントは効果にならない', () => {
    expect(
      effectFromStripeEventForCharge({
        ...completedEvent,
        data: {
          object: { ...paidCouponSession, payment_status: 'unpaid' },
        },
      }),
    ).toBeNull();
  });

  it('単発課金でないセッションの完了イベントは対象外', () => {
    expect(
      effectFromStripeEventForCharge({
        ...completedEvent,
        data: {
          object: {
            ...paidCouponSession,
            metadata: { ...paidCouponSession.metadata, kind: 'ad-placement' },
          },
        },
      }),
    ).toBeNull();
  });
});
