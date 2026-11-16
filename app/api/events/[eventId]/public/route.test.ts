// app/api/events/[eventId]/public/route.test.ts
// 公開情報 API が特設サイトの表示内容（アイコン含む）を event の中に
// そのまま出すことを検証する。読み取り側（event-store）の正規化済みの
// 値が素通りすること、未設定は null になることが契約。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEvent: vi.fn(),
}));

vi.mock('@/lib/event-store', () => ({
  getEvent: mocks.getEvent,
}));

import { GET } from './route';

const EVENT_ID = 'event-1';

function eventWith(partial: Record<string, unknown>) {
  return {
    name: 'テストカレー',
    startDate: '2026-01-01',
    endDate: '9999-12-31',
    status: 'live',
    resetMode: 'full-daily',
    defaultLocale: 'ja',
    admissionQrEnabled: false,
    links: [],
    siteDescription: '紹介文',
    gourmetDefinition: '',
    heroImageUrl: null,
    siteIconUrl: null,
    themeColor: null,
    siteNotes: [],
    topPlacementEnabled: false,
    topPlacementPrice: null,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/events/[eventId]/public', () => {
  it('siteIconUrl を event の中に含めて返す', async () => {
    mocks.getEvent.mockResolvedValue(
      eventWith({ siteIconUrl: 'https://example.com/icon.png' }),
    );
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.event.siteIconUrl).toBe('https://example.com/icon.png');
    expect(data.event.siteDescription).toBe('紹介文');
  });

  it('gourmetDefinition を event の中に含めて返す（未設定は空文字）', async () => {
    mocks.getEvent.mockResolvedValue(
      eventWith({ gourmetDefinition: '地元産野菜を使うこと。' }),
    );
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();
    expect(data.event.gourmetDefinition).toBe('地元産野菜を使うこと。');

    mocks.getEvent.mockResolvedValue(eventWith({}));
    const unset = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const unsetData = await unset.json();
    expect(unsetData.event.gourmetDefinition).toBe('');
  });

  it('themeColor を event の中に含めて返す（未設定は null）', async () => {
    mocks.getEvent.mockResolvedValue(
      eventWith({ themeColor: '#dd5e22' }),
    );
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();
    expect(data.event.themeColor).toBe('#dd5e22');

    mocks.getEvent.mockResolvedValue(eventWith({}));
    const unset = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const unsetData = await unset.json();
    expect(unsetData.event.themeColor).toBeNull();
  });

  it('未設定のプロジェクトでは siteIconUrl は null', async () => {
    mocks.getEvent.mockResolvedValue(eventWith({}));
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();
    expect(data.event.siteIconUrl).toBeNull();
  });

  it('プロジェクトが無ければ 404', async () => {
    mocks.getEvent.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(response.status).toBe(404);
  });
});
