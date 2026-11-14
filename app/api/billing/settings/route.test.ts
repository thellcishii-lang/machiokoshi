// app/api/billing/settings/route.test.ts
// 店舗課金の Stripe 設定 API: オプション OFF では存在を隠す（404）、
// レスポンスにキーの値が絶対に含まれないこと、保存がサーバー専用
// ドキュメント向け関数に委譲されることを検証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  getUidFromRequest: vi.fn(),
  passwordChangeBlock: vi.fn(),
  findEnabledBillingOrganizer: vi.fn(),
  getStripeBillingSettingsState: vi.fn(),
  saveStripeBillingSettings: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ db: { __db: true } }));
vi.mock('@/lib/event-auth', () => ({
  getUidFromRequest: mocks.getUidFromRequest,
  passwordChangeBlock: mocks.passwordChangeBlock,
}));
vi.mock('@/lib/event-billing', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/event-billing')>();
  return {
    ...original,
    findEnabledBillingOrganizer: mocks.findEnabledBillingOrganizer,
    getStripeBillingSettingsState: mocks.getStripeBillingSettingsState,
    saveStripeBillingSettings: mocks.saveStripeBillingSettings,
  };
});

import { GET, PUT } from './route';

const SECRET = 'sk_live_abcdefghijklmnop';

function request(method: string, body?: unknown) {
  return new Request('http://localhost/api/billing/settings', {
    method,
    headers: { Authorization: 'Bearer token' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUidFromRequest.mockResolvedValue('owner-1');
  mocks.passwordChangeBlock.mockResolvedValue(null);
  mocks.findEnabledBillingOrganizer.mockResolvedValue({
    contractId: 'contract-1',
    billingOptionEnabled: true,
  });
  mocks.getStripeBillingSettingsState.mockResolvedValue({
    secretKeyConfigured: true,
    webhookSecretConfigured: false,
  });
});

describe('GET /api/billing/settings', () => {
  it('未認証は 401', async () => {
    mocks.getUidFromRequest.mockResolvedValue(null);
    const response = await GET(request('GET'));
    expect(response.status).toBe(401);
  });

  it('オプション OFF（契約者でない含む）は 404 で存在を隠す', async () => {
    mocks.findEnabledBillingOrganizer.mockResolvedValue(null);
    const response = await GET(request('GET'));
    expect(response.status).toBe(404);
    expect(mocks.getStripeBillingSettingsState).not.toHaveBeenCalled();
  });

  it('保存状態と Webhook URL だけを返し、キーの値は含まない', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.secretKeyConfigured).toBe(true);
    expect(body.webhookSecretConfigured).toBe(false);
    expect(body.webhookUrl).toContain('/api/billing/webhook/contract-1');
    expect(body).not.toHaveProperty('secretKey');
    expect(body).not.toHaveProperty('webhookSecret');
    expect(JSON.stringify(body)).not.toContain('sk_');
    expect(JSON.stringify(body)).not.toContain('whsec_');
  });
});

describe('PUT /api/billing/settings', () => {
  it('保存し、応答にはキー値を含めない', async () => {
    const response = await PUT(request('PUT', { secretKey: SECRET }));
    expect(response.status).toBe(200);
    expect(mocks.saveStripeBillingSettings).toHaveBeenCalledWith(
      { __db: true },
      'contract-1',
      { secretKey: SECRET },
    );
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('形式が不正なキーは 400 で保存しない', async () => {
    const response = await PUT(request('PUT', { secretKey: 'not-a-key' }));
    expect(response.status).toBe(400);
    expect(mocks.saveStripeBillingSettings).not.toHaveBeenCalled();
  });

  it('パスワード変更ゲートが立っていれば 403 で保存しない', async () => {
    mocks.passwordChangeBlock.mockResolvedValue(
      NextResponse.json({ error: 'パスワード変更が必要です' }, { status: 403 }),
    );
    const response = await PUT(request('PUT', { secretKey: SECRET }));
    expect(response.status).toBe(403);
    expect(mocks.saveStripeBillingSettings).not.toHaveBeenCalled();
  });

  it('オプション OFF は 404 で保存しない', async () => {
    mocks.findEnabledBillingOrganizer.mockResolvedValue(null);
    const response = await PUT(request('PUT', { secretKey: SECRET }));
    expect(response.status).toBe(404);
    expect(mocks.saveStripeBillingSettings).not.toHaveBeenCalled();
  });
});
