// app/api/events/[eventId]/shop-billings/[exhibitorId]/route.test.ts
// 課金の開始（Checkout 発行）API: オプション OFF の隠蔽、月額の検証、
// 既存サブスクリプションの重複防止（409）、発行の委譲を検証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireEventOwner: vi.fn(),
  getExhibitor: vi.fn(),
  findEnabledBillingOrganizer: vi.fn(),
  getShopBilling: vi.fn(),
  startShopBilling: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ db: { __db: true } }));
vi.mock('@/lib/event-auth', () => ({
  requireEventOwner: mocks.requireEventOwner,
}));
vi.mock('@/lib/event-coupon', () => ({ getExhibitor: mocks.getExhibitor }));
vi.mock('@/lib/event-billing', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/event-billing')>();
  return {
    ...original,
    findEnabledBillingOrganizer: mocks.findEnabledBillingOrganizer,
    getShopBilling: mocks.getShopBilling,
    startShopBilling: mocks.startShopBilling,
  };
});

import { POST } from './route';

const EVENT_ID = 'event-1';
const EXHIBITOR_ID = 'shop-1';

function callPost(body: unknown) {
  return POST(
    new Request(
      `http://localhost/api/events/${EVENT_ID}/shop-billings/${EXHIBITOR_ID}`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ eventId: EVENT_ID, exhibitorId: EXHIBITOR_ID }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEventOwner.mockResolvedValue({
    uid: 'owner-1',
    event: { id: EVENT_ID },
  });
  mocks.findEnabledBillingOrganizer.mockResolvedValue({
    contractId: 'contract-1',
    billingOptionEnabled: true,
  });
  mocks.getExhibitor.mockResolvedValue({ id: EXHIBITOR_ID, name: '店A' });
  mocks.getShopBilling.mockResolvedValue(null);
  mocks.startShopBilling.mockResolvedValue({
    ok: true,
    billing: { exhibitorId: EXHIBITOR_ID, status: 'none', monthlyAmount: 3000 },
    checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
  });
});

describe('POST /api/events/[eventId]/shop-billings/[exhibitorId]', () => {
  it('オプション OFF は 404 で発行しない', async () => {
    mocks.findEnabledBillingOrganizer.mockResolvedValue(null);
    const response = await callPost({ monthlyAmount: 3000 });
    expect(response.status).toBe(404);
    expect(mocks.startShopBilling).not.toHaveBeenCalled();
  });

  it('所有者でなければ 403', async () => {
    mocks.requireEventOwner.mockResolvedValue({
      error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    });
    const response = await callPost({ monthlyAmount: 3000 });
    expect(response.status).toBe(403);
    expect(mocks.startShopBilling).not.toHaveBeenCalled();
  });

  it('月額が不正なら 400', async () => {
    const response = await callPost({ monthlyAmount: 10 });
    expect(response.status).toBe(400);
    expect(mocks.startShopBilling).not.toHaveBeenCalled();
  });

  it('参加店が無ければ 404', async () => {
    mocks.getExhibitor.mockResolvedValue(null);
    const response = await callPost({ monthlyAmount: 3000 });
    expect(response.status).toBe(404);
    expect(mocks.startShopBilling).not.toHaveBeenCalled();
  });

  it('既にサブスクリプションがある店は 409', async () => {
    mocks.getShopBilling.mockResolvedValue({
      exhibitorId: EXHIBITOR_ID,
      stripeSubscriptionId: 'sub_1',
      status: 'active',
    });
    const response = await callPost({ monthlyAmount: 5000 });
    expect(response.status).toBe(409);
    expect(mocks.startShopBilling).not.toHaveBeenCalled();
  });

  it('解約済みの店は作り直せる', async () => {
    mocks.getShopBilling.mockResolvedValue({
      exhibitorId: EXHIBITOR_ID,
      stripeSubscriptionId: 'sub_old',
      status: 'canceled',
    });
    const response = await callPost({ monthlyAmount: 5000 });
    expect(response.status).toBe(200);
    expect(mocks.startShopBilling).toHaveBeenCalledWith(
      { __db: true },
      expect.objectContaining({ monthlyAmount: 5000, exhibitorName: '店A' }),
    );
  });

  it('Checkout 未完了の店は再発行でき、URL を返す', async () => {
    mocks.getShopBilling.mockResolvedValue({
      exhibitorId: EXHIBITOR_ID,
      stripeSubscriptionId: null,
      status: 'none',
    });
    const response = await callPost({ monthlyAmount: 3000 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.checkoutUrl).toContain('checkout.stripe.com');
    expect(body.billing.status).toBe('none');
  });

  it('Stripe 設定未完了は lib のエラーをそのまま返す', async () => {
    mocks.startShopBilling.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Stripe設定が未完了です',
    });
    const response = await callPost({ monthlyAmount: 3000 });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Stripe設定が未完了');
  });
});
