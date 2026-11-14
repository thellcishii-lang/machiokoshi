// app/api/events/[eventId]/stamps/[stampId]/route.test.ts
// スタンプ取消し API: 参加店ガード＋ lib の判定結果（当日OK／他店403／
// 過去の周・当日以外409）をステータスに写すことを検証する。
// 条件判定の実体は lib/event-stamp の evaluateStampCancel（単体テスト済み）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireEventExhibitor: vi.fn(),
  cancelStamp: vi.fn(),
}));

vi.mock('@/lib/event-auth', () => ({
  requireEventExhibitor: mocks.requireEventExhibitor,
}));
vi.mock('@/lib/firebase-admin', () => ({ db: {} }));
vi.mock('@/lib/event-stamp', () => ({
  cancelStamp: mocks.cancelStamp,
}));

import { DELETE } from './route';

const EVENT_ID = 'event-1';
const STAMP_ID = 'member-a_1_shop-a';
const EXHIBITOR = { id: 'shop-a', name: '店A' };

function callDelete() {
  return DELETE(
    new Request(
      `http://localhost/api/events/${EVENT_ID}/stamps/${STAMP_ID}`,
      { method: 'DELETE' },
    ),
    { params: Promise.resolve({ eventId: EVENT_ID, stampId: STAMP_ID }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEventExhibitor.mockResolvedValue({
    exhibitor: EXHIBITOR,
    event: { id: EVENT_ID },
  });
});

describe('DELETE /api/events/[eventId]/stamps/[stampId]', () => {
  it('当日の自店スタンプは取り消せる', async () => {
    mocks.cancelStamp.mockResolvedValue({ ok: true, stampId: STAMP_ID });
    const response = await callDelete();
    expect(response.status).toBe(200);
    expect(mocks.cancelStamp).toHaveBeenCalledWith(
      {},
      { eventId: EVENT_ID, exhibitor: EXHIBITOR, stampId: STAMP_ID },
    );
    const body = await response.json();
    expect(body).toEqual({ ok: true, stampId: STAMP_ID });
  });

  it('他店のスタンプは 403', async () => {
    mocks.cancelStamp.mockResolvedValue({
      ok: false,
      status: 403,
      error: '自店のスタンプだけ取り消せます',
    });
    const response = await callDelete();
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('自店のスタンプだけ取り消せます');
  });

  it('過去の周のスタンプは 409', async () => {
    mocks.cancelStamp.mockResolvedValue({
      ok: false,
      status: 409,
      error: '過去の周のスタンプは取り消せません',
    });
    const response = await callDelete();
    expect(response.status).toBe(409);
  });

  it('未認証（ガードの 401）では取り消さない', async () => {
    mocks.requireEventExhibitor.mockResolvedValue({
      error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }),
    });
    const response = await callDelete();
    expect(response.status).toBe(401);
    expect(mocks.cancelStamp).not.toHaveBeenCalled();
  });
});
