// app/api/events/[eventId]/social-queue-keys/[keyId]/route.test.ts
// 連携キーの失効 API: 所有者だけが失効でき、存在しないキーは
// 404 になることを検証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  revokeQueueKey: vi.fn(),
  requireEventOwner: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  db: { __db: true },
}));
vi.mock('@/lib/event-social', () => ({
  revokeQueueKey: mocks.revokeQueueKey,
}));
vi.mock('@/lib/event-auth', () => ({
  requireEventOwner: mocks.requireEventOwner,
}));

import { DELETE } from './route';

const EVENT_ID = 'event-1';
const KEY_ID = 'qkey_abc';

function callDelete() {
  const request = new Request(
    `http://localhost/api/events/${EVENT_ID}/social-queue-keys/${KEY_ID}`,
    { method: 'DELETE', headers: { Authorization: 'Bearer token' } },
  );
  return DELETE(request, {
    params: Promise.resolve({ eventId: EVENT_ID, keyId: KEY_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEventOwner.mockResolvedValue({
    uid: 'owner-1',
    event: { id: EVENT_ID },
  });
});

describe('DELETE /api/events/[eventId]/social-queue-keys/[keyId]', () => {
  it('キーを失効できる', async () => {
    mocks.revokeQueueKey.mockResolvedValue(true);
    const response = await callDelete();
    expect(response.status).toBe(200);
    expect(mocks.revokeQueueKey).toHaveBeenCalledWith(
      { __db: true },
      EVENT_ID,
      KEY_ID,
    );
  });

  it('存在しないキーは 404', async () => {
    mocks.revokeQueueKey.mockResolvedValue(false);
    const response = await callDelete();
    expect(response.status).toBe(404);
  });

  it('所有者でなければ 403 で、失効しない', async () => {
    mocks.requireEventOwner.mockResolvedValue({
      error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    });
    const response = await callDelete();
    expect(response.status).toBe(403);
    expect(mocks.revokeQueueKey).not.toHaveBeenCalled();
  });
});
