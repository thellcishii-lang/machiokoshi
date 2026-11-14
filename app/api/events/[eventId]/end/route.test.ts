// app/api/events/[eventId]/end/route.test.ts
// POST /api/events/[eventId]/end が、認証・所有者チェックを通したうえで
// 開催中（live）のプロジェクトだけを終了（ended）に遷移させることを検証する。
// データ消去は行わない（updateEvent の status 変更のみ）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUidFromRequest: vi.fn(),
  getEvent: vi.fn(),
  updateEvent: vi.fn(),
}));

vi.mock('@/lib/event-auth', () => ({
  getUidFromRequest: mocks.getUidFromRequest,
}));
vi.mock('@/lib/event-store', () => ({
  getEvent: mocks.getEvent,
  updateEvent: mocks.updateEvent,
}));

import { POST } from './route';

const EVENT_ID = 'event-1';
const OWNER_UID = 'owner-1';

function postRequest() {
  return new Request(`http://localhost/api/events/${EVENT_ID}/end`, {
    method: 'POST',
  });
}

function callPost() {
  return POST(postRequest(), {
    params: Promise.resolve({ eventId: EVENT_ID }),
  });
}

function eventWith(status: string, ownerUid: string = OWNER_UID) {
  return { id: EVENT_ID, status, ownerUid };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUidFromRequest.mockResolvedValue(OWNER_UID);
  mocks.updateEvent.mockResolvedValue(undefined);
});

describe('POST /api/events/[eventId]/end', () => {
  it('未認証は 401 で、更新しない', async () => {
    mocks.getUidFromRequest.mockResolvedValue(null);
    const response = await callPost();
    expect(response.status).toBe(401);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });

  it('プロジェクトが無ければ 404', async () => {
    mocks.getEvent.mockResolvedValue(null);
    const response = await callPost();
    expect(response.status).toBe(404);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });

  it('他人のプロジェクトは 403 で、更新しない', async () => {
    mocks.getEvent.mockResolvedValue(eventWith('live', 'someone-else'));
    const response = await callPost();
    expect(response.status).toBe(403);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });

  it('開催中は ended に遷移させ、更新後のプロジェクトを返す', async () => {
    mocks.getEvent
      .mockResolvedValueOnce(eventWith('live'))
      .mockResolvedValueOnce(eventWith('ended'));
    const response = await callPost();
    expect(response.status).toBe(200);
    expect(mocks.updateEvent).toHaveBeenCalledWith(EVENT_ID, {
      status: 'ended',
    });
    const body = await response.json();
    expect(body.event.status).toBe('ended');
  });

  it('下書きは 409 で、更新しない', async () => {
    mocks.getEvent.mockResolvedValue(eventWith('draft'));
    const response = await callPost();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('終了できるのは開催中のプロジェクトだけです');
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });

  it('終了済みは 409 で、更新しない', async () => {
    mocks.getEvent.mockResolvedValue(eventWith('ended'));
    const response = await callPost();
    expect(response.status).toBe(409);
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });
});
