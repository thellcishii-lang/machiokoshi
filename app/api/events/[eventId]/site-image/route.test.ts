// app/api/events/[eventId]/site-image/route.test.ts
// 特設サイト画像アップロード: kind（hero / icon、未指定は hero）を
// 受け付け、応答に含めること、不正な kind は 400 になることを検証する。
// 保存先は共通（events/{eventId}/site-images/）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireEventOwner: vi.fn(),
  fileSave: vi.fn(),
  fileMakePublic: vi.fn(),
}));

vi.mock('@/lib/event-auth', () => ({
  requireEventOwner: mocks.requireEventOwner,
}));
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      name: 'test-bucket',
      file: () => ({
        save: mocks.fileSave,
        makePublic: mocks.fileMakePublic,
      }),
    }),
  }),
}));

import { POST } from './route';

const EVENT_ID = 'event-1';

function postRequest(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request(`http://localhost/api/events/${EVENT_ID}/site-image`, {
    method: 'POST',
    body: form,
  });
}

function pngFile() {
  return new File([new Uint8Array([1, 2, 3])], 'image.png', {
    type: 'image/png',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireEventOwner.mockResolvedValue({ uid: 'owner-1' });
  mocks.fileSave.mockResolvedValue(undefined);
  mocks.fileMakePublic.mockResolvedValue(undefined);
});

describe('POST /api/events/[eventId]/site-image', () => {
  it('kind 未指定は hero として受け付け、URLと一緒に返す', async () => {
    const response = await POST(postRequest({ file: pngFile() }), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe('hero');
    expect(body.url).toContain(
      `https://storage.googleapis.com/test-bucket/events/${EVENT_ID}/site-images/`,
    );
  });

  it('kind=icon を受け付ける', async () => {
    const response = await POST(
      postRequest({ file: pngFile(), kind: 'icon' }),
      { params: Promise.resolve({ eventId: EVENT_ID }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe('icon');
  });

  it('不正な kind は 400 で、保存しない', async () => {
    const response = await POST(
      postRequest({ file: pngFile(), kind: 'banner' }),
      { params: Promise.resolve({ eventId: EVENT_ID }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.fileSave).not.toHaveBeenCalled();
  });
});
