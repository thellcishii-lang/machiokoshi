// app/api/events/[eventId]/sms-gate/route.test.ts
// SMS送信直前ゲートの検証: SMSオン契約＋残高ありのときだけ通過し、
// 通過時点で消費が記録される。SMSオフ契約では消費自体が起きない。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEvent: vi.fn(),
  findOrganizerByOwnerUid: vi.fn(),
  tryConsumeSmsSend: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => null),
}));
vi.mock('@/lib/event-store', () => ({
  getEvent: mocks.getEvent,
}));
vi.mock('@/lib/organizers', () => ({
  findOrganizerByOwnerUid: mocks.findOrganizerByOwnerUid,
}));
vi.mock('@/lib/sms-mirror', () => ({
  tryConsumeSmsSend: mocks.tryConsumeSmsSend,
}));

import { POST } from './route';

const EVENT_ID = 'event-1';

function callPost() {
  return POST(new Request(`http://localhost/api/events/${EVENT_ID}/sms-gate`, {
    method: 'POST',
  }), {
    params: Promise.resolve({ eventId: EVENT_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEvent.mockResolvedValue({ id: EVENT_ID, ownerUid: 'owner-1' });
});

describe('POST /api/events/[eventId]/sms-gate', () => {
  it('プロジェクトが無ければ 404', async () => {
    mocks.getEvent.mockResolvedValue(null);
    const response = await callPost();
    expect(response.status).toBe(404);
    expect(mocks.tryConsumeSmsSend).not.toHaveBeenCalled();
  });

  it('SMSオフの契約は 403 で、消費は記録されない', async () => {
    mocks.findOrganizerByOwnerUid.mockResolvedValue({
      contractId: 'contract-1',
      smsAuthEnabled: false,
    });
    const response = await callPost();
    expect(response.status).toBe(403);
    expect(mocks.tryConsumeSmsSend).not.toHaveBeenCalled();
  });

  it('契約が引けない場合も 403 で、消費は記録されない', async () => {
    mocks.findOrganizerByOwnerUid.mockResolvedValue(null);
    const response = await callPost();
    expect(response.status).toBe(403);
    expect(mocks.tryConsumeSmsSend).not.toHaveBeenCalled();
  });

  it('SMSオン＋残高ありは 200 で、消費が1件記録される', async () => {
    mocks.findOrganizerByOwnerUid.mockResolvedValue({
      contractId: 'contract-1',
      smsAuthEnabled: true,
    });
    mocks.tryConsumeSmsSend.mockResolvedValue('ok');
    const response = await callPost();
    expect(response.status).toBe(200);
    expect(mocks.tryConsumeSmsSend).toHaveBeenCalledWith('contract-1');
  });

  it('SMSオン＋残高ゼロは 403', async () => {
    mocks.findOrganizerByOwnerUid.mockResolvedValue({
      contractId: 'contract-1',
      smsAuthEnabled: true,
    });
    mocks.tryConsumeSmsSend.mockResolvedValue('exhausted');
    const response = await callPost();
    expect(response.status).toBe(403);
  });
});
