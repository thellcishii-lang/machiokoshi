// app/api/events/[eventId]/social-queue/route.test.ts
// Muse 用キュー確認 API: 連携キー認証（X-Queue-Key）が必須で、
// 通れば投稿待ちを古い順の一覧として返すことを検証する。
// キーの実照合（失効チェック・ハッシュ比較）は lib/event-social の
// verifyQueueKey が担い、ここではその結果の写し方を見る。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyQueueKey: vi.fn(),
  listQueuedPosts: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  db: { __db: true },
}));
vi.mock('@/lib/event-social', () => ({
  verifyQueueKey: mocks.verifyQueueKey,
  listQueuedPosts: mocks.listQueuedPosts,
}));

import { GET } from './route';

const EVENT_ID = 'event-1';

function callGet(key?: string) {
  const request = new Request(
    `http://localhost/api/events/${EVENT_ID}/social-queue`,
    { headers: key ? { 'X-Queue-Key': key } : {} },
  );
  return GET(request, { params: Promise.resolve({ eventId: EVENT_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/events/[eventId]/social-queue', () => {
  it('キーが無ければ 401 で、一覧を出さない', async () => {
    mocks.verifyQueueKey.mockResolvedValue(false);
    const response = await callGet();
    expect(response.status).toBe(401);
    expect(mocks.verifyQueueKey).toHaveBeenCalledWith(
      { __db: true },
      EVENT_ID,
      null,
    );
    expect(mocks.listQueuedPosts).not.toHaveBeenCalled();
  });

  it('失効・不一致のキーは 401', async () => {
    mocks.verifyQueueKey.mockResolvedValue(false);
    const response = await callGet('revoked-or-wrong-key');
    expect(response.status).toBe(401);
    expect(mocks.listQueuedPosts).not.toHaveBeenCalled();
  });

  it('有効なキーでは投稿待ちを投稿に使える形で返す', async () => {
    mocks.verifyQueueKey.mockResolvedValue(true);
    mocks.listQueuedPosts.mockResolvedValue([
      {
        id: 'post-1',
        text: '1件目',
        photoUrls: ['https://example.com/a.jpg'],
        status: 'queued',
        createdAt: '2026-11-14T00:00:00.000Z',
        postedAt: null,
        postedUrl: null,
      },
      {
        id: 'post-2',
        text: '2件目',
        photoUrls: [],
        status: 'queued',
        createdAt: '2026-11-14T01:00:00.000Z',
        postedAt: null,
        postedUrl: null,
      },
    ]);
    const response = await callGet('valid-key');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.posts).toEqual([
      {
        id: 'post-1',
        text: '1件目',
        photoUrls: ['https://example.com/a.jpg'],
        createdAt: '2026-11-14T00:00:00.000Z',
      },
      {
        id: 'post-2',
        text: '2件目',
        photoUrls: [],
        createdAt: '2026-11-14T01:00:00.000Z',
      },
    ]);
  });
});
