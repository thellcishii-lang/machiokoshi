// app/api/events/[eventId]/site-settings/route.test.ts
// 特設サイト設定 API: アイコン（siteIconUrl）が取得・保存の往復で
// 欠けずに通ること、https でない URL は 400 になることを検証する。
// 検証・正規化の実体は lib/event-site.ts の純粋関数。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireEventOwner: vi.fn(),
  updateEvent: vi.fn(),
}));

vi.mock('@/lib/event-auth', () => ({
  requireEventOwner: mocks.requireEventOwner,
}));
vi.mock('@/lib/event-store', () => ({
  updateEvent: mocks.updateEvent,
}));

import { GET, PUT } from './route';

const EVENT_ID = 'event-1';

const EVENT = {
  siteDescription: '紹介文',
  gourmetDefinition: '地元産野菜を使うこと。\n味噌ベースのルー。',
  heroImageUrl: null,
  siteIconUrl: 'https://example.com/icon.png',
  themeColor: '#6f7d3c',
  siteNotes: [],
  topPlacementEnabled: false,
  topPlacementPrice: null,
};

function callGet() {
  return GET(new Request(`http://localhost/api/events/${EVENT_ID}/site-settings`), {
    params: Promise.resolve({ eventId: EVENT_ID }),
  });
}

function callPut(body: unknown) {
  return PUT(
    new Request(`http://localhost/api/events/${EVENT_ID}/site-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ eventId: EVENT_ID }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEventOwner.mockResolvedValue({ uid: 'owner-1', event: EVENT });
  mocks.updateEvent.mockResolvedValue(undefined);
});

describe('GET /api/events/[eventId]/site-settings', () => {
  it('現在のアイコン URL を含めて返す', async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.siteIconUrl).toBe('https://example.com/icon.png');
  });

  it('現在のご当地グルメの定義を含めて返す', async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.gourmetDefinition).toBe(
      '地元産野菜を使うこと。\n味噌ベースのルー。',
    );
  });
});

describe('PUT /api/events/[eventId]/site-settings', () => {
  it('アイコン URL を正規化して保存し、そのまま返す（往復）', async () => {
    const response = await callPut({
      siteDescription: '紹介文',
      heroImageUrl: null,
      siteIconUrl: ' https://example.com/new-icon.png ',
      siteNotes: [],
      topPlacementEnabled: false,
      topPlacementPrice: null,
    });
    expect(response.status).toBe(200);
    expect(mocks.updateEvent).toHaveBeenCalledWith(
      EVENT_ID,
      expect.objectContaining({
        siteIconUrl: 'https://example.com/new-icon.png',
      }),
    );
    const body = await response.json();
    expect(body.siteIconUrl).toBe('https://example.com/new-icon.png');
  });

  it('アイコンを外す（null）こともできる', async () => {
    const response = await callPut({
      siteDescription: '',
      heroImageUrl: null,
      siteIconUrl: null,
      siteNotes: [],
      topPlacementEnabled: false,
      topPlacementPrice: null,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.siteIconUrl).toBeNull();
  });

  it('ご当地グルメの定義を保存し、そのまま返す（往復・改行保持）', async () => {
    const response = await callPut({
      siteDescription: '紹介文',
      gourmetDefinition: ' 地元産野菜を使うこと。\n味噌ベースのルー。 ',
      heroImageUrl: null,
      siteIconUrl: null,
      siteNotes: [],
      topPlacementEnabled: false,
      topPlacementPrice: null,
    });
    expect(response.status).toBe(200);
    expect(mocks.updateEvent).toHaveBeenCalledWith(
      EVENT_ID,
      expect.objectContaining({
        gourmetDefinition: '地元産野菜を使うこと。\n味噌ベースのルー。',
      }),
    );
    const body = await response.json();
    expect(body.gourmetDefinition).toBe(
      '地元産野菜を使うこと。\n味噌ベースのルー。',
    );
  });

  it('定義が1001文字なら 400 で、保存しない', async () => {
    const response = await callPut({
      siteDescription: '',
      gourmetDefinition: 'あ'.repeat(1001),
      heroImageUrl: null,
      siteIconUrl: null,
      siteNotes: [],
      topPlacementEnabled: false,
      topPlacementPrice: null,
    });
    expect(response.status).toBe(400);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });

  it('テーマカラーを小文字に正規化して保存し、そのまま返す（往復）', async () => {
    const response = await callPut({
      siteDescription: '',
      gourmetDefinition: '',
      heroImageUrl: null,
      siteIconUrl: null,
      themeColor: '#DD5E22',
      siteNotes: [],
      topPlacementEnabled: false,
      topPlacementPrice: null,
    });
    expect(response.status).toBe(200);
    expect(mocks.updateEvent).toHaveBeenCalledWith(
      EVENT_ID,
      expect.objectContaining({ themeColor: '#dd5e22' }),
    );
    const body = await response.json();
    expect(body.themeColor).toBe('#dd5e22');
  });

  it('テーマカラー未設定（null）はそのまま通り、GET でも返る', async () => {
    const getResponse = await callGet();
    const getBody = await getResponse.json();
    expect(getBody.themeColor).toBe('#6f7d3c');

    const response = await callPut({
      siteDescription: '',
      gourmetDefinition: '',
      heroImageUrl: null,
      siteIconUrl: null,
      themeColor: null,
      siteNotes: [],
      topPlacementEnabled: false,
      topPlacementPrice: null,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.themeColor).toBeNull();
  });

  it('形式の違うテーマカラーは 400 で、保存しない', async () => {
    const response = await callPut({
      siteDescription: '',
      gourmetDefinition: '',
      heroImageUrl: null,
      siteIconUrl: null,
      themeColor: 'red',
      siteNotes: [],
      topPlacementEnabled: false,
      topPlacementPrice: null,
    });
    expect(response.status).toBe(400);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });

  it('https でないアイコン URL は 400 で、保存しない', async () => {
    const response = await callPut({
      siteDescription: '',
      heroImageUrl: null,
      siteIconUrl: 'http://example.com/icon.png',
      siteNotes: [],
      topPlacementEnabled: false,
      topPlacementPrice: null,
    });
    expect(response.status).toBe(400);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
});
