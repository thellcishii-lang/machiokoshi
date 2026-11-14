// app/api/events/[eventId]/ranking/route.test.ts
// 公開用ランキング: 保存済みの最新ランキングを返し、未計算なら
// ranking: null で返すことを検証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEvent: vi.fn(),
  getLatestRanking: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ db: {} }));
vi.mock('@/lib/event-store', () => ({ getEvent: mocks.getEvent }));
vi.mock('@/lib/event-ranking', () => ({
  getLatestRanking: mocks.getLatestRanking,
}));

import { GET } from './route';

const EVENT_ID = 'event-1';

function callGet() {
  return GET(new Request(`http://localhost/api/events/${EVENT_ID}/ranking`), {
    params: Promise.resolve({ eventId: EVENT_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEvent.mockResolvedValue({ id: EVENT_ID });
});

describe('GET /api/events/[eventId]/ranking', () => {
  it('プロジェクトが無ければ 404', async () => {
    mocks.getEvent.mockResolvedValue(null);
    const response = await callGet();
    expect(response.status).toBe(404);
    expect(mocks.getLatestRanking).not.toHaveBeenCalled();
  });

  it('保存済みの最新ランキングを返す', async () => {
    mocks.getLatestRanking.mockResolvedValue({
      weekKey: '2026-11-09',
      periodStart: '2026-11-09',
      periodEnd: '2026-11-15',
      entries: [
        { exhibitorId: 'shop-a', exhibitorName: 'A食堂', avgStars: 4.8, reviewCount: 6 },
      ],
      computedAt: '2026-11-16T00:01:00.000Z',
    });
    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ranking.weekKey).toBe('2026-11-09');
    expect(body.ranking.entries).toHaveLength(1);
    expect(body.ranking.entries[0].reviewCount).toBe(6);
  });

  it('未計算なら ranking は null', async () => {
    mocks.getLatestRanking.mockResolvedValue(null);
    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ranking).toBeNull();
  });
});
