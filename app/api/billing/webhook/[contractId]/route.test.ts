// app/api/billing/webhook/[contractId]/route.test.ts
// 店舗課金の Stripe Webhook: 契約の特定・オプション OFF の隠蔽・
// 署名検証（モック）失敗時の 400・正常時の適用委譲を検証する。
// 状態遷移そのものは lib/event-billing の純粋関数テストで担保する。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrganizer: vi.fn(),
  getStripeBillingSettings: vi.fn(),
  verifyStripeWebhookEvent: vi.fn(),
  applyStripeWebhookEffect: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ db: { __db: true } }));
vi.mock('@/lib/organizers', () => ({ getOrganizer: mocks.getOrganizer }));
vi.mock('@/lib/event-billing', () => ({
  getStripeBillingSettings: mocks.getStripeBillingSettings,
  verifyStripeWebhookEvent: mocks.verifyStripeWebhookEvent,
  applyStripeWebhookEffect: mocks.applyStripeWebhookEffect,
}));

import { POST } from './route';

const CONTRACT_ID = 'contract-1';

function request(headers: Record<string, string> = { 'stripe-signature': 'sig' }) {
  return new Request(`http://localhost/api/billing/webhook/${CONTRACT_ID}`, {
    method: 'POST',
    headers,
    body: '{"id":"evt_1","type":"invoice.paid"}',
  });
}

function callPost() {
  return POST(request(), { params: Promise.resolve({ contractId: CONTRACT_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizer.mockResolvedValue({
    contractId: CONTRACT_ID,
    billingOptionEnabled: true,
  });
  mocks.getStripeBillingSettings.mockResolvedValue({
    secretKey: 'sk_live_x',
    webhookSecret: 'whsec_x',
  });
  mocks.verifyStripeWebhookEvent.mockReturnValue({
    id: 'evt_1',
    type: 'invoice.paid',
    data: { object: {} },
  });
  mocks.applyStripeWebhookEffect.mockResolvedValue({
    applied: true,
    duplicate: false,
  });
});

describe('POST /api/billing/webhook/[contractId]', () => {
  it('契約者が無ければ 404', async () => {
    mocks.getOrganizer.mockResolvedValue(null);
    const response = await callPost();
    expect(response.status).toBe(404);
    expect(mocks.verifyStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it('オプション OFF の契約は 404 で存在を隠す', async () => {
    mocks.getOrganizer.mockResolvedValue({
      contractId: CONTRACT_ID,
      billingOptionEnabled: false,
    });
    const response = await callPost();
    expect(response.status).toBe(404);
    expect(mocks.verifyStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it('Stripe 設定が未完了なら 400', async () => {
    mocks.getStripeBillingSettings.mockResolvedValue(null);
    const response = await callPost();
    expect(response.status).toBe(400);
  });

  it('署名ヘッダが無ければ 400', async () => {
    const response = await POST(request({}), {
      params: Promise.resolve({ contractId: CONTRACT_ID }),
    });
    expect(response.status).toBe(400);
    expect(mocks.verifyStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it('署名検証に失敗したら 400 で適用しない', async () => {
    mocks.verifyStripeWebhookEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const response = await callPost();
    expect(response.status).toBe(400);
    expect(mocks.applyStripeWebhookEffect).not.toHaveBeenCalled();
  });

  it('検証できたら生ボディで検証し、適用して 200', async () => {
    const response = await callPost();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ received: true, applied: true });
    // 生ボディ（文字列）で検証していること
    expect(mocks.verifyStripeWebhookEvent).toHaveBeenCalledWith(
      'sk_live_x',
      'whsec_x',
      '{"id":"evt_1","type":"invoice.paid"}',
      'sig',
    );
    expect(mocks.applyStripeWebhookEffect).toHaveBeenCalledWith(
      { __db: true },
      CONTRACT_ID,
      expect.objectContaining({ id: 'evt_1', type: 'invoice.paid' }),
    );
  });
});
