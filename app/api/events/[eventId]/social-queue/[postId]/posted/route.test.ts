// app/api/events/[eventId]/social-queue/[postId]/posted/route.test.ts
// Muse 用完了 API: 連携キー認証が必須で、投稿済みへの遷移と
// 冪等（既に投稿済みでも成功）を検証する。遷移の実体は lib。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyQueueKey: vi.fn(),
  markPostPosted: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  db: { __db: true },
}));
vi.mock('@/lib/event-social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/event-social')>()),
  verifyQueueKey: mocks.verifyQueueKey,
  markPostPosted: mocks.markPostPosted,
}));

import { POST } from './route';

const EVENT_ID = 'event-1';
const POST_ID = 'post-1';

function callPost(body: unknown, key?: string) {
  const request = new Request(
    `http://localhost/api/events/${EVENT_ID}/social-queue/${POST_ID}/posted`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'X-Queue-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  return POST(request, {
    params: Promise.resolve({ eventId: EVENT_ID, postId: POST_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyQueueKey.mockResolvedValue(true);
});

describe('POST /api/events/[eventId]/social-queue/[postId]/posted', () => {
  it('キーが無ければ 401 で、遷移しない', async () => {
    mocks.verifyQueueKey.mockResolvedValue(false);
    const response = await callPost({});
    expect(response.status).toBe(401);
    expect(mocks.markPostPosted).not.toHaveBeenCalled();
  });

  it('失効・不一致のキーは 401', async () => {
    mocks.verifyQueueKey.mockResolvedValue(false);
    const response = await callPost({}, 'wrong-key');
    expect(response.status).toBe(401);
    expect(mocks.markPostPosted).not.toHaveBeenCalled();
  });

  it('投稿済みに遷移し、postedUrl を渡す', async () => {
    mocks.markPostPosted.mockResolvedValue({
      ok: true,
      alreadyPosted: false,
      post: {
        id: POST_ID,
        text: 'x',
        photoUrls: [],
        status: 'posted',
        createdAt: '2026-11-14T00:00:00.000Z',
        postedAt: '2026-11-14T09:00:00.000Z',
        postedUrl: 'https://www.instagram.com/p/abc/',
      },
    });
    const response = await callPost(
      { postedUrl: 'https://www.instagram.com/p/abc/' },
      'valid-key',
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, alreadyPosted: false });
    expect(mocks.markPostPosted).toHaveBeenCalledWith(
      { __db: true },
      EVENT_ID,
      POST_ID,
      'https://www.instagram.com/p/abc/',
    );
  });

  it('本文なし（postedUrl なし）でも遷移できる', async () => {
    mocks.markPostPosted.mockResolvedValue({
      ok: true,
      alreadyPosted: false,
      post: {
        id: POST_ID,
        status: 'posted',
        postedAt: '2026-11-14T09:00:00.000Z',
        postedUrl: null,
      },
    });
    const response = await callPost(undefined, 'valid-key');
    expect(response.status).toBe(200);
    expect(mocks.markPostPosted).toHaveBeenCalledWith(
      { __db: true },
      EVENT_ID,
      POST_ID,
      null,
    );
  });

  it('既に投稿済みでも成功を返す（冪等）', async () => {
    mocks.markPostPosted.mockResolvedValue({
      ok: true,
      alreadyPosted: true,
      post: {
        id: POST_ID,
        status: 'posted',
        postedAt: '2026-11-14T09:00:00.000Z',
        postedUrl: null,
      },
    });
    const response = await callPost({}, 'valid-key');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.alreadyPosted).toBe(true);
  });

  it('存在しない投稿は 404（lib の結果をそのまま返す）', async () => {
    mocks.markPostPosted.mockResolvedValue({
      ok: false,
      status: 404,
      error: '投稿が見つかりません',
    });
    const response = await callPost({}, 'valid-key');
    expect(response.status).toBe(404);
  });

  it('postedUrl が https でなければ 400 で、遷移しない', async () => {
    const response = await callPost({ postedUrl: 'http://example.com' }, 'valid-key');
    expect(response.status).toBe(400);
    expect(mocks.markPostPosted).not.toHaveBeenCalled();
  });
});
