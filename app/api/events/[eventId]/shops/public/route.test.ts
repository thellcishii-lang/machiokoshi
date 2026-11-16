// app/api/events/[eventId]/shops/public/route.test.ts
// 公開用店舗一覧: 掲載中の店（lib 側で絞り込み済み）に、各店の累計
// レビュー集計を付けて返すことを検証する。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEvent: vi.fn(),
  listPublicShops: vi.fn(),
  listPublicReviews: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ db: {} }));
vi.mock('@/lib/event-store', () => ({ getEvent: mocks.getEvent }));
vi.mock('@/lib/event-shop', () => ({
  listPublicShops: mocks.listPublicShops,
}));
vi.mock('@/lib/event-review', () => ({
  listPublicReviews: mocks.listPublicReviews,
}));

import { GET } from './route';

const EVENT_ID = 'event-1';

function callGet() {
  return GET(new Request(`http://localhost/api/events/${EVENT_ID}/shops/public`), {
    params: Promise.resolve({ eventId: EVENT_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEvent.mockResolvedValue({ id: EVENT_ID });
});

describe('GET /api/events/[eventId]/shops/public', () => {
  it('プロジェクトが無ければ 404', async () => {
    mocks.getEvent.mockResolvedValue(null);
    const response = await callGet();
    expect(response.status).toBe(404);
    expect(mocks.listPublicShops).not.toHaveBeenCalled();
  });

  it('掲載中の店に累計集計を付けて返す', async () => {
    mocks.listPublicShops.mockResolvedValue([
      {
        exhibitorId: 'shop-a',
        name: '店A',
        profile: { displayName: 'カレー堂A', published: true },
      },
      {
        exhibitorId: 'shop-b',
        name: '店B',
        profile: { displayName: 'カレー堂B', published: true },
      },
    ]);
    mocks.listPublicReviews.mockImplementation(
      async (_db: unknown, _eventId: string, options: { exhibitorId?: string }) => ({
        reviews: [],
        summary:
          options.exhibitorId === 'shop-a'
            ? {
                count: 12,
                averageStars: 4.5,
                categories: { taste: 4.6, service: 4.4, atmosphere: 4.3, presentation: 4.5 },
              }
            : {
                count: 0,
                averageStars: 0,
                categories: { taste: 0, service: 0, atmosphere: 0, presentation: 0 },
              },
      }),
    );

    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shops).toHaveLength(2);
    expect(body.shops[0].reviewSummary).toEqual({
      count: 12,
      averageStars: 4.5,
      categories: { taste: 4.6, service: 4.4, atmosphere: 4.3, presentation: 4.5 },
    });
    expect(body.shops[1].reviewSummary.count).toBe(0);
    // 個人情報（memberId 等）は形に含まれない
    expect(JSON.stringify(body)).not.toContain('memberId');
  });

  it('各店のリンクと座標をそのまま含めて返す', async () => {
    mocks.listPublicShops.mockResolvedValue([
      {
        exhibitorId: 'shop-a',
        name: '店A',
        profile: {
          displayName: 'カレー堂A',
          published: true,
          links: [{ label: '公式サイト', url: 'https://example.com/' }],
          location: { lat: 35.85, lng: 139.32 },
        },
      },
      {
        exhibitorId: 'shop-b',
        name: '店B',
        profile: {
          displayName: 'カレー堂B',
          published: true,
          links: [],
          location: null,
        },
      },
    ]);
    mocks.listPublicReviews.mockResolvedValue({
      reviews: [],
      summary: {
        count: 0,
        averageStars: 0,
        categories: { taste: 0, service: 0, atmosphere: 0, presentation: 0 },
      },
    });

    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shops[0].profile.links).toEqual([
      { label: '公式サイト', url: 'https://example.com/' },
    ]);
    expect(body.shops[0].profile.location).toEqual({
      lat: 35.85,
      lng: 139.32,
    });
    expect(body.shops[1].profile.links).toEqual([]);
    expect(body.shops[1].profile.location).toBeNull();
  });

  it('店が無ければ空の一覧を返す', async () => {
    mocks.listPublicShops.mockResolvedValue([]);
    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.shops).toEqual([]);
  });
});
