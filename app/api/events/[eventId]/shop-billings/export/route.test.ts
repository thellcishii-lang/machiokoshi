// app/api/events/[eventId]/shop-billings/export/route.test.ts
// 入金一覧 CSV のダウンロード: 所有者ガード、オプション OFF の隠蔽
// （404）、全件取得と CSV レスポンスのヘッダーを検証する。
// CSV の中身の整形は lib/event-billing の単体テストで担保する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireEventOwner: vi.fn(),
  listExhibitors: vi.fn(),
  findEnabledBillingOrganizer: vi.fn(),
  listShopBillings: vi.fn(),
  listBillingPayments: vi.fn(),
  buildBillingPaymentsCsv: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ db: { __db: true } }));
vi.mock('@/lib/event-auth', () => ({
  requireEventOwner: mocks.requireEventOwner,
}));
vi.mock('@/lib/event-coupon', () => ({
  listExhibitors: mocks.listExhibitors,
}));
vi.mock('@/lib/event-billing', () => ({
  findEnabledBillingOrganizer: mocks.findEnabledBillingOrganizer,
  listShopBillings: mocks.listShopBillings,
  listBillingPayments: mocks.listBillingPayments,
  buildBillingPaymentsCsv: mocks.buildBillingPaymentsCsv,
}));

import { GET } from './route';

const EVENT_ID = 'event-1';

function callGet() {
  return GET(
    new Request(`http://localhost/api/events/${EVENT_ID}/shop-billings/export`),
    { params: Promise.resolve({ eventId: EVENT_ID }) },
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
  mocks.listExhibitors.mockResolvedValue([
    { id: 'shop-1', name: '店A', address: '住所A' },
  ]);
  mocks.listShopBillings.mockResolvedValue([]);
  mocks.listBillingPayments.mockResolvedValue([]);
  mocks.buildBillingPaymentsCsv.mockReturnValue('CSV_BODY');
});

describe('GET /api/events/[eventId]/shop-billings/export', () => {
  it('所有者でなければガードのエラーをそのまま返す', async () => {
    mocks.requireEventOwner.mockResolvedValue({
      error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    });
    const response = await callGet();
    expect(response.status).toBe(403);
    expect(mocks.listBillingPayments).not.toHaveBeenCalled();
  });

  it('オプション OFF は 404 で存在を隠す', async () => {
    mocks.findEnabledBillingOrganizer.mockResolvedValue(null);
    const response = await callGet();
    expect(response.status).toBe(404);
    expect(mocks.listBillingPayments).not.toHaveBeenCalled();
  });

  it('全件を対象に CSV をダウンロード形式で返す', async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="billing-payments-${EVENT_ID}.csv"`,
    );
    expect(await response.text()).toBe('CSV_BODY');
    // 直近50件の一覧ではなく全件対象（大きな上限で読む）。
    const limit = mocks.listBillingPayments.mock.calls[0][2] as number;
    expect(limit).toBeGreaterThan(50);
    // 店名・住所の結合元として参加店一覧も渡している。
    expect(mocks.buildBillingPaymentsCsv).toHaveBeenCalledWith(
      expect.anything(),
      [{ id: 'shop-1', name: '店A', address: '住所A' }],
      expect.anything(),
    );
  });
});
