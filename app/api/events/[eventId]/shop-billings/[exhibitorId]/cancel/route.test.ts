// app/api/events/[eventId]/shop-billings/[exhibitorId]/cancel/route.test.ts
// 課金の解約 API: オプション OFF の隠蔽、所有者ガード、解約の委譲と
// 結果の伝播を検証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireEventOwner: vi.fn(),
  findEnabledBillingOrganizer: vi.fn(),
  cancelShopBilling: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ db: { __db: true } }));
vi.mock('@/lib/event-auth', () => ({
  requireEventOwner: mocks.requireEventOwner,
}));
vi.mock('@/lib/event-billing', () => ({
  findEnabledBillingOrganizer: mocks.findEnabledBillingOrganizer,
  cancelShopBilling: mocks.cancelShopBilling,
}));

import { POST } from './route';

const EVENT_ID = 'event-1';
const EXHIBITOR_ID = 'shop-1';

function callPost() {
  return POST(
    new Request(
      `http://localhost/api/events/${EVENT_ID}/shop-billings/${EXHIBITOR_ID}/cancel`,
      { method: 'POST', headers: { Authorization: 'Bearer token' } },
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
  mocks.cancelShopBilling.mockResolvedValue({
    ok: true,
    billing: { exhibitorId: EXHIBITOR_ID, status: 'canceled' },
  });
});

describe('POST /api/events/[eventId]/shop-billings/[exhibitorId]/cancel', () => {
  it('オプション OFF は 404 で解約しない', async () => {
    mocks.findEnabledBillingOrganizer.mockResolvedValue(null);
    const response = await callPost();
    expect(response.status).toBe(404);
    expect(mocks.cancelShopBilling).not.toHaveBeenCalled();
  });

  it('所有者でなければ 403', async () => {
    mocks.requireEventOwner.mockResolvedValue({
      error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    });
    const response = await callPost();
    expect(response.status).toBe(403);
    expect(mocks.cancelShopBilling).not.toHaveBeenCalled();
  });

  it('解約できたら canceled の課金レコードを返す', async () => {
    const response = await callPost();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.billing.status).toBe('canceled');
    expect(mocks.cancelShopBilling).toHaveBeenCalledWith(
      { __db: true },
      'contract-1',
      EVENT_ID,
      EXHIBITOR_ID,
    );
  });

  it('課金が無ければ lib の 404 を伝播する', async () => {
    mocks.cancelShopBilling.mockResolvedValue({
      ok: false,
      status: 404,
      error: '課金が見つかりません',
    });
    const response = await callPost();
    expect(response.status).toBe(404);
  });
});
