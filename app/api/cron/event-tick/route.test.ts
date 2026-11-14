// app/api/cron/event-tick/route.test.ts
// tick: 配信処理に加えて、live プロジェクトの週次ランキング catch-up が
// 呼ばれること。ランキングの失敗が配信や他プロジェクトを止めないこと。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listLiveEvents: vi.fn(),
  processDueCampaigns: vi.fn(),
  ensurePreviousWeekRanking: vi.fn(),
  recordTickRun: vi.fn(),
  dispatchOperatorAlerts: vi.fn(),
}));

vi.mock('@/lib/cron-auth', () => ({ isValidCronRequest: () => true }));
vi.mock('@/lib/firebase-admin', () => ({ db: {} }));
vi.mock('@/lib/event-store', () => ({
  listLiveEvents: mocks.listLiveEvents,
}));
vi.mock('@/lib/event-push', () => ({
  processDueCampaigns: mocks.processDueCampaigns,
}));
vi.mock('@/lib/event-ranking', () => ({
  ensurePreviousWeekRanking: mocks.ensurePreviousWeekRanking,
}));
vi.mock('@/lib/tick-runs', () => ({ recordTickRun: mocks.recordTickRun }));
vi.mock('@/lib/monitoring', () => ({
  dispatchOperatorAlerts: mocks.dispatchOperatorAlerts,
}));

import { GET } from './route';

const EVENTS = [
  { id: 'event-1', rankingMinReviews: 3 },
  { id: 'event-2', rankingMinReviews: 5 },
];

function callGet() {
  return GET(new Request('http://localhost/api/cron/event-tick'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listLiveEvents.mockResolvedValue(EVENTS);
  mocks.processDueCampaigns.mockResolvedValue(0);
  mocks.ensurePreviousWeekRanking.mockResolvedValue(false);
  mocks.recordTickRun.mockResolvedValue(undefined);
  mocks.dispatchOperatorAlerts.mockResolvedValue(undefined);
});

describe('GET /api/cron/event-tick', () => {
  it('live プロジェクト全件に配信処理とランキング補完が呼ばれる', async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    expect(mocks.processDueCampaigns).toHaveBeenCalledTimes(2);
    expect(mocks.ensurePreviousWeekRanking).toHaveBeenCalledTimes(2);
    expect(mocks.ensurePreviousWeekRanking).toHaveBeenCalledWith(
      {},
      EVENTS[0],
      expect.any(Date),
    );
    expect(mocks.ensurePreviousWeekRanking).toHaveBeenCalledWith(
      {},
      EVENTS[1],
      expect.any(Date),
    );
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.errors).toEqual([]);
  });

  it('1件のランキング失敗が他プロジェクトの処理を止めず、エラーに局所化される', async () => {
    mocks.ensurePreviousWeekRanking.mockImplementation(
      async (_db: unknown, event: { id: string }) => {
        if (event.id === 'event-1') throw new Error('boom');
        return true;
      },
    );
    const response = await callGet();
    expect(response.status).toBe(200);
    // 両プロジェクトとも配信・ランキングの両方が試みられている
    expect(mocks.processDueCampaigns).toHaveBeenCalledTimes(2);
    expect(mocks.ensurePreviousWeekRanking).toHaveBeenCalledTimes(2);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].eventId).toBe('event-1');
    expect(body.errors[0].message).toContain('ランキング計算に失敗');
  });

  it('ランキング失敗は配信結果（campaignsSent）に影響しない', async () => {
    mocks.processDueCampaigns.mockResolvedValue(2);
    mocks.ensurePreviousWeekRanking.mockRejectedValue(new Error('boom'));
    const response = await callGet();
    const body = await response.json();
    expect(body.campaignsSent).toEqual([
      { eventId: 'event-1', sent: 2 },
      { eventId: 'event-2', sent: 2 },
    ]);
    expect(body.errors).toHaveLength(2);
  });
});
