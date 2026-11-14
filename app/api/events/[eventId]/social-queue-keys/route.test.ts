// app/api/events/[eventId]/social-queue-keys/route.test.ts
// 連携キーの発行／一覧 API: 発行時のみ平文キーを返し、一覧では
// メタ情報だけを返すこと、所有者ガードが効くことを検証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  issueQueueKey: vi.fn(),
  listQueueKeys: vi.fn(),
  requireEventOwner: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  db: { __db: true },
}));
vi.mock('@/lib/event-social', () => ({
  issueQueueKey: mocks.issueQueueKey,
  listQueueKeys: mocks.listQueueKeys,
}));
vi.mock('@/lib/event-auth', () => ({
  requireEventOwner: mocks.requireEventOwner,
}));

import { GET, POST } from './route';

const EVENT_ID = 'event-1';

function request(method: string) {
  return new Request(`http://localhost/api/events/${EVENT_ID}/social-queue-keys`, {
    method,
    headers: { Authorization: 'Bearer token' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEventOwner.mockResolvedValue({
    uid: 'owner-1',
    event: { id: EVENT_ID },
  });
});

describe('POST /api/events/[eventId]/social-queue-keys', () => {
  it('発行すると keyId と平文キーを一度だけ返す', async () => {
    mocks.issueQueueKey.mockResolvedValue({
      keyId: 'qkey_abc',
      key: 'plain-secret-key',
    });
    const response = await POST(request('POST'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      keyId: 'qkey_abc',
      key: 'plain-secret-key',
    });
  });

  it('所有者でなければ 403 で、発行しない', async () => {
    mocks.requireEventOwner.mockResolvedValue({
      error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    });
    const response = await POST(request('POST'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(response.status).toBe(403);
    expect(mocks.issueQueueKey).not.toHaveBeenCalled();
  });
});

describe('GET /api/events/[eventId]/social-queue-keys', () => {
  it('一覧はメタ情報だけ（平文キーもハッシュも含まない）', async () => {
    mocks.listQueueKeys.mockResolvedValue([
      { id: 'qkey_abc', createdAt: '2026-11-14T00:00:00.000Z', revokedAt: null, revoked: false },
    ]);
    const response = await GET(request('GET'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).not.toHaveProperty('key');
    expect(body.keys[0]).not.toHaveProperty('keyHash');
  });
});
