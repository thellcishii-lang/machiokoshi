// lib/event-social.test.ts
// Instagram 投稿キューの純粋関数（入力検証・並び替え・キー素材と
// ハッシュ照合）を検証する。Firestore 処理は route テスト側で
// lib をモックして担保する。
import { describe, expect, it } from 'vitest';
import {
  SOCIAL_POST_PHOTO_MAX_COUNT,
  SOCIAL_POST_TEXT_MAX_LENGTH,
  generateQueueKeyMaterial,
  hashQueueKey,
  parsePostedUrl,
  parseSocialPostInput,
  socialPhotoStoragePath,
  sortSocialPostsNewestFirst,
  sortSocialPostsOldestFirst,
  verifyQueueKeyHash,
  type SocialPost,
} from './event-social';

describe('parseSocialPostInput', () => {
  it('本文だけでも作成できる（写真は任意）', () => {
    const result = parseSocialPostInput({ text: '  今日のカレーです  ' });
    expect(result).toEqual({
      ok: true,
      value: { text: '今日のカレーです', photoUrls: [] },
    });
  });

  it('本文が空・空白のみはエラー', () => {
    expect(parseSocialPostInput({ text: '' }).ok).toBe(false);
    expect(parseSocialPostInput({ text: '   ' }).ok).toBe(false);
    expect(parseSocialPostInput({}).ok).toBe(false);
    expect(parseSocialPostInput(null).ok).toBe(false);
  });

  it('本文の上限文字数を超えたらエラー', () => {
    const tooLong = 'あ'.repeat(SOCIAL_POST_TEXT_MAX_LENGTH + 1);
    const result = parseSocialPostInput({ text: tooLong });
    expect(result.ok).toBe(false);
    const justFit = 'あ'.repeat(SOCIAL_POST_TEXT_MAX_LENGTH);
    expect(parseSocialPostInput({ text: justFit }).ok).toBe(true);
  });

  it('写真は https の URL を最大枚数まで受け付ける', () => {
    const urls = Array.from(
      { length: SOCIAL_POST_PHOTO_MAX_COUNT },
      (_, i) => `https://example.com/${i}.jpg`,
    );
    const result = parseSocialPostInput({ text: 'x', photoUrls: urls });
    expect(result).toEqual({ ok: true, value: { text: 'x', photoUrls: urls } });
  });

  it('写真が上限枚数を超えたらエラー', () => {
    const urls = Array.from(
      { length: SOCIAL_POST_PHOTO_MAX_COUNT + 1 },
      (_, i) => `https://example.com/${i}.jpg`,
    );
    expect(parseSocialPostInput({ text: 'x', photoUrls: urls }).ok).toBe(false);
  });

  it('写真に https でない URL が混ざったらエラー', () => {
    expect(
      parseSocialPostInput({ text: 'x', photoUrls: ['http://example.com/a.jpg'] }).ok,
    ).toBe(false);
    expect(
      parseSocialPostInput({ text: 'x', photoUrls: 'https://example.com/a.jpg' }).ok,
    ).toBe(false);
  });
});

describe('parsePostedUrl', () => {
  it('未指定（undefined / null / 空文字）は null で通す', () => {
    expect(parsePostedUrl(undefined)).toEqual({ ok: true, value: null });
    expect(parsePostedUrl(null)).toEqual({ ok: true, value: null });
    expect(parsePostedUrl('')).toEqual({ ok: true, value: null });
  });

  it('https の URL はそのまま通す', () => {
    expect(parsePostedUrl('https://www.instagram.com/p/abc/')).toEqual({
      ok: true,
      value: 'https://www.instagram.com/p/abc/',
    });
  });

  it('https でない値や文字列でない値はエラー', () => {
    expect(parsePostedUrl('http://example.com').ok).toBe(false);
    expect(parsePostedUrl(123).ok).toBe(false);
  });
});

function post(id: string, createdAt: string | null): SocialPost {
  return {
    id,
    text: `post-${id}`,
    photoUrls: [],
    status: 'queued',
    createdAt,
    postedAt: null,
    postedUrl: null,
  };
}

describe('並び替え', () => {
  const posts = [
    post('b', '2026-11-10T09:00:00.000Z'),
    post('a', '2026-11-12T09:00:00.000Z'),
    post('c', '2026-11-11T09:00:00.000Z'),
  ];

  it('新しい順は createdAt の降順', () => {
    expect(sortSocialPostsNewestFirst(posts).map((p) => p.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('古い順は createdAt の昇順（キューは先入れ先出し）', () => {
    expect(sortSocialPostsOldestFirst(posts).map((p) => p.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('元の配列を変更しない', () => {
    const original = [...posts];
    sortSocialPostsNewestFirst(posts);
    expect(posts).toEqual(original);
  });
});

describe('連携キー', () => {
  it('素材は qkey_ 始まりの ID と十分な長さのキー', () => {
    const material = generateQueueKeyMaterial();
    expect(material.keyId).toMatch(/^qkey_[0-9a-f]{18}$/);
    expect(material.key.length).toBeGreaterThanOrEqual(40);
    const other = generateQueueKeyMaterial();
    expect(other.keyId).not.toBe(material.keyId);
    expect(other.key).not.toBe(material.key);
  });

  it('ハッシュ化した値では照合でき、平文は保存形式に含まれない', async () => {
    const material = generateQueueKeyMaterial();
    const stored = await hashQueueKey(material.key);
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(stored).not.toContain(material.key);
    await expect(verifyQueueKeyHash(material.key, stored)).resolves.toBe(true);
  });

  it('違うキー・壊れた保存値・空は一致しない', async () => {
    const stored = await hashQueueKey('the-real-key');
    await expect(verifyQueueKeyHash('another-key', stored)).resolves.toBe(false);
    await expect(verifyQueueKeyHash('the-real-key', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyQueueKeyHash('the-real-key', null)).resolves.toBe(false);
    await expect(verifyQueueKeyHash('the-real-key', undefined)).resolves.toBe(false);
    await expect(verifyQueueKeyHash('', stored)).resolves.toBe(false);
  });
});

describe('socialPhotoStoragePath', () => {
  it('events/{eventId}/social-photos/{fileName} を作る', () => {
    expect(socialPhotoStoragePath('event-1', 'abc.jpg')).toBe(
      'events/event-1/social-photos/abc.jpg',
    );
  });
});
