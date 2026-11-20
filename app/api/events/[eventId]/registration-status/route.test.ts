// app/api/events/[eventId]/registration-status/route.test.ts
// 登録状態確認 API を検証する:
// - 購読者レコードがある端末は registered: true
// - 無い端末は registered: false
// - 認証が無ければ 401、プロジェクトが無ければ 404
// 認証は実物の memberIdFromRequest（lib/event-member-auth.ts）を通し、
// 端末認証（SMSオフ既定）では匿名認証の uid から memberId が導かれる。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getEvent: vi.fn(),
  findOrganizerByOwnerUid: vi.fn(),
  subscriberDoc: vi.fn(),
  subscriberGet: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({
  authAdmin: { verifyIdToken: mocks.verifyIdToken },
  getAdminAccessToken: vi.fn(async () => 'access-token'),
  db: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: mocks.subscriberDoc,
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/event-store', () => ({
  getEvent: mocks.getEvent,
}));
vi.mock('@/lib/organizers', () => ({
  findOrganizerByOwnerUid: mocks.findOrganizerByOwnerUid,
}));

import { GET } from './route';
import { memberIdForDevice } from '@/lib/event-coupon';

const EVENT_ID = 'event-1';
const DEVICE_UID = 'anon-uid-xyz';
const PHONE = '+819012345678';

function getRequest(token?: string) {
  return new Request(
    `http://localhost/api/events/${EVENT_ID}/registration-status`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
}

function callGet(token?: string) {
  return GET(getRequest(token), {
    params: Promise.resolve({ eventId: EVENT_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEvent.mockResolvedValue({ id: EVENT_ID, ownerUid: 'owner-1' });
  // 契約レコードが引けない既定では端末認証（smsAuthEnabled: false）
  mocks.findOrganizerByOwnerUid.mockResolvedValue(null);
  mocks.verifyIdToken.mockResolvedValue({ uid: DEVICE_UID });
  mocks.subscriberDoc.mockReturnValue({ get: mocks.subscriberGet });
  mocks.subscriberGet.mockResolvedValue({ exists: true });
});

describe('GET /api/events/[eventId]/registration-status', () => {
  it('購読者レコードがある端末は registered: true', async () => {
    const response = await callGet('token');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ registered: true });
    // 本人キーは登録時と同じ導出（端末 uid のハッシュ）で引く
    expect(mocks.subscriberDoc).toHaveBeenCalledWith(memberIdForDevice(DEVICE_UID));
  });

  it('購読者レコードが無い端末は registered: false', async () => {
    mocks.subscriberGet.mockResolvedValue({ exists: false });
    const response = await callGet('token');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ registered: false });
  });

  it('認証が無ければ 401 で、購読者は引かない', async () => {
    const response = await callGet();
    expect(response.status).toBe(401);
    expect(mocks.subscriberGet).not.toHaveBeenCalled();
  });

  it('プロジェクトが無ければ 404', async () => {
    mocks.getEvent.mockResolvedValue(null);
    // プロジェクトが引けない場合の認証は従来方式（電話番号）に倒れる
    mocks.verifyIdToken.mockResolvedValue({ phone_number: PHONE });
    const response = await callGet('token');
    expect(response.status).toBe(404);
    expect(mocks.subscriberGet).not.toHaveBeenCalled();
  });
});
