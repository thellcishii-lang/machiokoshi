// app/api/events/[eventId]/free-coupons/redeem/route.test.ts
// 無料クーポン消込 API: 参加店セッションならどの店の達成クーポンでも
// 使え、二度目は 409 になることを検証する（遷移の実体は lib 側）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireEventExhibitor: vi.fn(),
  redeemFreeCoupon: vi.fn(),
}));

vi.mock('@/lib/event-auth', () => ({
  requireEventExhibitor: mocks.requireEventExhibitor,
}));
vi.mock('@/lib/firebase-admin', () => ({ db: {} }));
vi.mock('@/lib/event-stamp', () => ({
  redeemFreeCoupon: mocks.redeemFreeCoupon,
}));

import { POST } from './route';

const EVENT_ID = 'event-1';
const EXHIBITOR = { id: 'shop-b', name: '店B' };

function callPost(body: unknown) {
  return POST(
    new Request(
      `http://localhost/api/events/${EVENT_ID}/free-coupons/redeem`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ eventId: EVENT_ID }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEventExhibitor.mockResolvedValue({
    exhibitor: EXHIBITOR,
    event: { id: EVENT_ID },
  });
});

describe('POST /api/events/[eventId]/free-coupons/redeem', () => {
  it('参加店なら消込できる（達成した店でなくてもよい）', async () => {
    mocks.redeemFreeCoupon.mockResolvedValue({
      ok: true,
      freeCouponId: 'free-1',
    });
    const response = await callPost({ freeCouponId: 'free-1' });
    expect(response.status).toBe(200);
    expect(mocks.redeemFreeCoupon).toHaveBeenCalledWith(
      {},
      { eventId: EVENT_ID, exhibitor: EXHIBITOR, freeCouponId: 'free-1' },
    );
    const body = await response.json();
    expect(body).toEqual({ ok: true, freeCouponId: 'free-1' });
  });

  it('二度目の使用は 409', async () => {
    mocks.redeemFreeCoupon.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'この無料クーポンは使用済みです',
    });
    const response = await callPost({ freeCouponId: 'free-1' });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('この無料クーポンは使用済みです');
  });

  it('存在しないクーポンは 404', async () => {
    mocks.redeemFreeCoupon.mockResolvedValue({
      ok: false,
      status: 404,
      error: '無料クーポンが見つかりません',
    });
    const response = await callPost({ freeCouponId: 'free-x' });
    expect(response.status).toBe(404);
  });

  it('freeCouponId が無ければ 400 で、消込しない', async () => {
    const response = await callPost({});
    expect(response.status).toBe(400);
    expect(mocks.redeemFreeCoupon).not.toHaveBeenCalled();
  });

  it('未認証（ガードの 401）では消込しない', async () => {
    mocks.requireEventExhibitor.mockResolvedValue({
      error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }),
    });
    const response = await callPost({ freeCouponId: 'free-1' });
    expect(response.status).toBe(401);
    expect(mocks.redeemFreeCoupon).not.toHaveBeenCalled();
  });
});
