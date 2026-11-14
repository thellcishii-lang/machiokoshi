// app/api/events/[eventId]/social-posts/[postId]/route.test.ts
// 投稿の削除 API: 投稿待ちだけ削除でき、投稿済みは 409、
// 存在しない投稿は 404 になることを検証する（実体は lib）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  deleteQueuedPost: vi.fn(),
  requireEventOwner: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  db: { __db: true },
}));
vi.mock('@/lib/event-social', () => ({
  deleteQueuedPost: mocks.deleteQueuedPost,
}));
vi.mock('@/lib/event-auth', () => ({
  requireEventOwner: mocks.requireEventOwner,
}));

import { DELETE } from './route';

const EVENT_ID = 'event-1';
const POST_ID = 'post-1';

function callDelete() {
  const request = new Request(
    `http://localhost/api/events/${EVENT_ID}/social-posts/${POST_ID}`,
    { method: 'DELETE', headers: { Authorization: 'Bearer token' } },
  );
  return DELETE(request, {
    params: Promise.resolve({ eventId: EVENT_ID, postId: POST_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEventOwner.mockResolvedValue({
    uid: 'owner-1',
    event: { id: EVENT_ID },
  });
});

describe('DELETE /api/events/[eventId]/social-posts/[postId]', () => {
  it('投稿待ちの投稿を削除できる', async () => {
    mocks.deleteQueuedPost.mockResolvedValue({ ok: true });
    const response = await callDelete();
    expect(response.status).toBe(200);
    expect(mocks.deleteQueuedPost).toHaveBeenCalledWith(
      { __db: true },
      EVENT_ID,
      POST_ID,
    );
  });

  it('投稿済みの投稿は 409（lib の結果をそのまま返す）', async () => {
    mocks.deleteQueuedPost.mockResolvedValue({
      ok: false,
      status: 409,
      error: '投稿済みの投稿は削除できません',
    });
    const response = await callDelete();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain('投稿済み');
  });

  it('存在しない投稿は 404', async () => {
    mocks.deleteQueuedPost.mockResolvedValue({
      ok: false,
      status: 404,
      error: '投稿が見つかりません',
    });
    const response = await callDelete();
    expect(response.status).toBe(404);
  });

  it('所有者でなければ 403 で、削除しない', async () => {
    mocks.requireEventOwner.mockResolvedValue({
      error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    });
    const response = await callDelete();
    expect(response.status).toBe(403);
    expect(mocks.deleteQueuedPost).not.toHaveBeenCalled();
  });
});
