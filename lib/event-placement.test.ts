// lib/event-placement.test.ts
// トップ掲載の純粋関数: プロジェクト設定（料金・ON/OFF）の検証、
// 状態→掲載判定、Stripe Webhook の kind 振り分けと効果への変換を検証する。
import { describe, expect, it } from 'vitest';
import {
  isValidTopPlacementPrice,
  normalizeTopPlacementEnabled,
  normalizeTopPlacementPrice,
  parseTopPlacementEnabled,
  parseTopPlacementPrice,
  TOP_PLACEMENT_PRICE_MAX,
  TOP_PLACEMENT_PRICE_MIN,
} from './event';
import {
  effectFromStripeEventForPlacement,
  isTopFeaturedForStatus,
  parseTopPlacementStatus,
  placementTransitionForSubscriptionStatus,
  stripeEventKind,
  TOP_PLACEMENT_KIND,
} from './event-placement';
import type { StripeWebhookEventLike } from './event-billing';

function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  created = 1_762_000_000,
): StripeWebhookEventLike {
  return { id: `evt_${type}`, type, created, data: { object } };
}

const PLACEMENT_META = {
  kind: TOP_PLACEMENT_KIND,
  contractId: 'contract-1',
  eventId: 'event-1',
  exhibitorId: 'shop-1',
};

describe('トップ掲載の料金検証', () => {
  it('範囲内の整数だけを受け付ける', () => {
    expect(isValidTopPlacementPrice(TOP_PLACEMENT_PRICE_MIN)).toBe(true);
    expect(isValidTopPlacementPrice(3000)).toBe(true);
    expect(isValidTopPlacementPrice(TOP_PLACEMENT_PRICE_MAX)).toBe(true);
    expect(isValidTopPlacementPrice(TOP_PLACEMENT_PRICE_MIN - 1)).toBe(false);
    expect(isValidTopPlacementPrice(TOP_PLACEMENT_PRICE_MAX + 1)).toBe(false);
    expect(isValidTopPlacementPrice(3000.5)).toBe(false);
    expect(isValidTopPlacementPrice('3000')).toBe(false);
    expect(isValidTopPlacementPrice(null)).toBe(false);
  });

  it('読み取り用 parse は不正値を null（未設定）に倒す', () => {
    expect(parseTopPlacementPrice(5000)).toBe(5000);
    expect(parseTopPlacementPrice(undefined)).toBeNull();
    expect(parseTopPlacementPrice(null)).toBeNull();
    expect(parseTopPlacementPrice(50)).toBeNull();
    expect(parseTopPlacementPrice('5000')).toBeNull();
  });

  it('書き込み用 normalize は未指定を null、不正値は throw', () => {
    expect(normalizeTopPlacementPrice(undefined)).toBeNull();
    expect(normalizeTopPlacementPrice(null)).toBeNull();
    expect(normalizeTopPlacementPrice(1000)).toBe(1000);
    expect(() => normalizeTopPlacementPrice(99)).toThrow();
    expect(() => normalizeTopPlacementPrice(1000.5)).toThrow();
  });
});

describe('トップ掲載の ON/OFF 検証', () => {
  it('読み取り用 parse は true のみ有効', () => {
    expect(parseTopPlacementEnabled(true)).toBe(true);
    expect(parseTopPlacementEnabled(false)).toBe(false);
    expect(parseTopPlacementEnabled(undefined)).toBe(false);
    expect(parseTopPlacementEnabled('true')).toBe(false);
  });

  it('書き込み用 normalize は未指定をオフ、真偽値以外は throw', () => {
    expect(normalizeTopPlacementEnabled(undefined)).toBe(false);
    expect(normalizeTopPlacementEnabled(true)).toBe(true);
    expect(normalizeTopPlacementEnabled(false)).toBe(false);
    expect(() => normalizeTopPlacementEnabled('yes')).toThrow();
    expect(() => normalizeTopPlacementEnabled(1)).toThrow();
  });
});

describe('掲載状態と topFeatured 判定', () => {
  it('parseTopPlacementStatus は未知の値を unpaid に倒す', () => {
    expect(parseTopPlacementStatus('active')).toBe('active');
    expect(parseTopPlacementStatus('past_due')).toBe('past_due');
    expect(parseTopPlacementStatus('canceled')).toBe('canceled');
    expect(parseTopPlacementStatus('unpaid')).toBe('unpaid');
    expect(parseTopPlacementStatus(undefined)).toBe('unpaid');
    expect(parseTopPlacementStatus('none')).toBe('unpaid');
  });

  it('active と past_due の間だけ掲載する', () => {
    expect(isTopFeaturedForStatus('active')).toBe(true);
    expect(isTopFeaturedForStatus('past_due')).toBe(true);
    expect(isTopFeaturedForStatus('canceled')).toBe(false);
    expect(isTopFeaturedForStatus('unpaid')).toBe(false);
  });

  it('Stripe 状態からの遷移は店舗課金と揃う', () => {
    expect(placementTransitionForSubscriptionStatus('active')).toEqual({
      status: 'active',
      featured: true,
    });
    expect(placementTransitionForSubscriptionStatus('trialing')).toEqual({
      status: 'active',
      featured: true,
    });
    expect(placementTransitionForSubscriptionStatus('past_due')).toEqual({
      status: 'past_due',
      featured: null,
    });
    expect(placementTransitionForSubscriptionStatus('unpaid')).toEqual({
      status: 'unpaid',
      featured: false,
    });
    expect(placementTransitionForSubscriptionStatus('canceled')).toEqual({
      status: 'canceled',
      featured: false,
    });
    expect(placementTransitionForSubscriptionStatus('incomplete')).toBeNull();
    expect(placementTransitionForSubscriptionStatus('unknown')).toBeNull();
  });
});

describe('stripeEventKind（Webhook の振り分け）', () => {
  it('kind が無い店舗課金のイベントは null', () => {
    expect(
      stripeEventKind(
        stripeEvent('checkout.session.completed', {
          mode: 'subscription',
          metadata: { eventId: 'event-1', exhibitorId: 'shop-1' },
        }),
      ),
    ).toBeNull();
    expect(
      stripeEventKind(
        stripeEvent('customer.subscription.updated', {
          id: 'sub_1',
          status: 'active',
          metadata: { eventId: 'event-1', exhibitorId: 'shop-1' },
        }),
      ),
    ).toBeNull();
  });

  it('トップ掲載の Checkout / サブスクリプションは kind を返す', () => {
    expect(
      stripeEventKind(
        stripeEvent('checkout.session.completed', {
          mode: 'subscription',
          metadata: PLACEMENT_META,
        }),
      ),
    ).toBe(TOP_PLACEMENT_KIND);
    expect(
      stripeEventKind(
        stripeEvent('customer.subscription.deleted', {
          id: 'sub_1',
          metadata: PLACEMENT_META,
        }),
      ),
    ).toBe(TOP_PLACEMENT_KIND);
  });

  it('請求書は subscription_details の metadata から kind を読む', () => {
    expect(
      stripeEventKind(
        stripeEvent('invoice.paid', {
          id: 'in_1',
          parent: {
            subscription_details: { subscription: 'sub_1', metadata: PLACEMENT_META },
          },
        }),
      ),
    ).toBe(TOP_PLACEMENT_KIND);
    expect(
      stripeEventKind(
        stripeEvent('invoice.paid', {
          id: 'in_1',
          subscription: 'sub_1',
          metadata: { eventId: 'event-1' },
        }),
      ),
    ).toBeNull();
  });

  it('対象外のイベント種別は null', () => {
    expect(
      stripeEventKind(stripeEvent('payment_intent.succeeded', { id: 'pi_1' })),
    ).toBeNull();
  });
});

describe('effectFromStripeEventForPlacement', () => {
  it('店舗課金（kind なし）のイベントは対象外', () => {
    expect(
      effectFromStripeEventForPlacement(
        stripeEvent('invoice.paid', {
          id: 'in_1',
          subscription: 'sub_1',
          customer: 'cus_1',
          amount_paid: 3000,
        }),
      ),
    ).toBeNull();
  });

  it('checkout.session.completed で ID を紐づける（掲載はまだ変えない）', () => {
    const effect = effectFromStripeEventForPlacement(
      stripeEvent('checkout.session.completed', {
        mode: 'subscription',
        subscription: 'sub_1',
        customer: 'cus_1',
        metadata: PLACEMENT_META,
      }),
    );
    expect(effect).toMatchObject({
      subscriptionId: 'sub_1',
      customerId: 'cus_1',
      metadataEventId: 'event-1',
      metadataExhibitorId: 'shop-1',
      placementPatch: {
        stripeSubscriptionId: 'sub_1',
        stripeCustomerId: 'cus_1',
      },
      featured: null,
      payment: null,
    });
  });

  it('invoice.paid で active 化＋掲載開始＋支払い記録', () => {
    const effect = effectFromStripeEventForPlacement(
      stripeEvent('invoice.paid', {
        id: 'in_1',
        subscription: 'sub_1',
        customer: 'cus_1',
        amount_paid: 3000,
        status_transitions: { paid_at: 1_762_000_000 },
        parent: {
          subscription_details: { subscription: 'sub_1', metadata: PLACEMENT_META },
        },
      }),
    );
    expect(effect).toMatchObject({
      subscriptionId: 'sub_1',
      metadataEventId: 'event-1',
      metadataExhibitorId: 'shop-1',
      placementPatch: { status: 'active' },
      featured: true,
      payment: { amount: 3000, status: 'paid', invoiceId: 'in_1' },
    });
  });

  it('invoice.payment_failed は past_due にし、掲載フラグには触らない', () => {
    const effect = effectFromStripeEventForPlacement(
      stripeEvent('invoice.payment_failed', {
        id: 'in_2',
        subscription: 'sub_1',
        customer: 'cus_1',
        amount_due: 3000,
        metadata: PLACEMENT_META,
      }),
    );
    expect(effect).toMatchObject({
      placementPatch: { status: 'past_due' },
      featured: null,
      payment: { amount: 3000, status: 'failed', invoiceId: 'in_2' },
    });
  });

  it('customer.subscription.updated（unpaid）で掲載を止める', () => {
    const effect = effectFromStripeEventForPlacement(
      stripeEvent('customer.subscription.updated', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'unpaid',
        metadata: PLACEMENT_META,
      }),
    );
    expect(effect).toMatchObject({
      placementPatch: { status: 'unpaid' },
      featured: false,
      payment: null,
    });
  });

  it('customer.subscription.updated（incomplete）は対象外', () => {
    expect(
      effectFromStripeEventForPlacement(
        stripeEvent('customer.subscription.updated', {
          id: 'sub_1',
          status: 'incomplete',
          metadata: PLACEMENT_META,
        }),
      ),
    ).toBeNull();
  });

  it('customer.subscription.deleted で解約＋掲載停止', () => {
    const effect = effectFromStripeEventForPlacement(
      stripeEvent('customer.subscription.deleted', {
        id: 'sub_1',
        customer: 'cus_1',
        metadata: PLACEMENT_META,
      }),
    );
    expect(effect).toMatchObject({
      placementPatch: { status: 'canceled' },
      featured: false,
      payment: null,
    });
  });
});
