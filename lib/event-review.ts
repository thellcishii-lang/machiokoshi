// lib/event-review.ts
// Push-taro 町おこし のレビュー（書き込み）基盤（events/{eventId} 配下）。
//
// - reviews/{memberId}_{exhibitorId}: レビュー本体。ドキュメントIDの
//   一意性で「1人1店1件まで」を構造的に担保し、書き直しは同じ
//   ドキュメントの更新（createdAt は保持、visible は管理人の設定を保持）。
// - 書けるのは、その店のスタンプをもらった客だけ（資格判定は
//   lib/event-stamp.ts の hasStampForShop）。投稿は即時公開され、
//   不適切なものだけ管理人が非表示にできる（店側は触れない）。
// - 内容は原文のまま表示する（翻訳しない）。公開用データには
//   memberId を含めない（電話番号ハッシュを外に出さない）。
// - 写真は API 経由で Admin SDK が Storage に保存する
//   （events/{eventId}/review-photos/{memberId}/...）。ここでは
//   検証だけを担う。
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getEvent } from './event-store';
import { getExhibitor } from './event-coupon';
import {
  EVENT_STAMPS_COLLECTION,
  hasStampForShop,
} from './event-stamp';

// reviews はリセット・終了削除の対象外（電話番号を含まない台帳）。
// stamps / freeCoupons と同じ扱い（プロジェクトの完全削除は
// listCollections で拾うため対象に含まれる）。
export const EVENT_REVIEWS_COLLECTION = 'reviews';

export const REVIEW_PHOTO_MAX_COUNT = 3;
export const REVIEW_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const REVIEW_TEXT_MAX_LENGTH = 1000;
export const REVIEW_NICKNAME_MAX_LENGTH = 30;

/** 受け付ける写真の Content-Type と拡張子の対応。 */
export const REVIEW_PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ReviewCategories {
  taste: number;
  service: number;
  atmosphere: number;
  presentation: number;
}

export interface EventReview {
  id: string;
  memberId: string;
  exhibitorId: string;
  exhibitorName: string;
  stars: number;
  categories: ReviewCategories;
  text: string;
  nickname: string;
  photoUrls: string[];
  visible: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** 公開用レビュー。memberId と visible を含めない。 */
export interface PublicReview {
  id: string;
  exhibitorId: string;
  exhibitorName: string;
  stars: number;
  categories: ReviewCategories;
  text: string;
  nickname: string;
  photoUrls: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

/** 管理画面用レビュー。公開用に visible だけを足したもの。 */
export interface AdminReview extends PublicReview {
  visible: boolean;
}

export interface ReviewSummary {
  count: number;
  /** 総合の平均（小数1桁）。0件なら 0 */
  averageStars: number;
  /** 項目別の平均（小数1桁）。0件なら各 0 */
  categories: ReviewCategories;
}

/** レビューを書ける店（スタンプをもらった店）。 */
export interface ReviewableShop {
  exhibitorId: string;
  exhibitorName: string;
}

/** レビューのドキュメントID。1人1店1件を構造的に担保する。 */
export function reviewIdFor(memberId: string, exhibitorId: string): string {
  return `${memberId}_${exhibitorId}`;
}

// ─── 純粋関数: 入力検証 ───

export interface ParsedReviewInput {
  exhibitorId: string;
  stars: number;
  categories: ReviewCategories;
  text: string;
  nickname: string;
  photoUrls: string[];
}

export type ParseReviewResult =
  | { ok: true; value: ParsedReviewInput }
  | { ok: false; error: string };

function parseStarValue(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < 1 || raw > 5) return null;
  return raw;
}

function parseCategories(raw: unknown): ReviewCategories | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const taste = parseStarValue(source.taste);
  const service = parseStarValue(source.service);
  const atmosphere = parseStarValue(source.atmosphere);
  const presentation = parseStarValue(source.presentation);
  if (taste === null || service === null || atmosphere === null || presentation === null) {
    return null;
  }
  return { taste, service, atmosphere, presentation };
}

/**
 * レビュー投稿の入力検証（純粋関数）。
 * 星は総合・項目別とも 1–5 の整数必須。本文は任意（空でもよい）で
 * 上限文字数まで。写真は最大3枚、各URLは https の文字列のみ。
 */
export function parseReviewInput(raw: unknown): ParseReviewResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'リクエスト形式が不正です' };
  }
  const source = raw as Record<string, unknown>;

  const exhibitorId =
    typeof source.exhibitorId === 'string' ? source.exhibitorId.trim() : '';
  if (!exhibitorId) {
    return { ok: false, error: 'exhibitorId が必要です' };
  }

  const stars = parseStarValue(source.stars);
  if (stars === null) {
    return { ok: false, error: '総合評価は1〜5で入力してください' };
  }

  const categories = parseCategories(source.categories);
  if (categories === null) {
    return {
      ok: false,
      error: '項目別評価（味・接客・雰囲気・盛り付け）は1〜5で入力してください',
    };
  }

  const text = typeof source.text === 'string' ? source.text.trim() : '';
  if (text.length > REVIEW_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      error: `本文は${REVIEW_TEXT_MAX_LENGTH}文字以内で入力してください`,
    };
  }

  const nickname =
    typeof source.nickname === 'string' ? source.nickname.trim() : '';
  if (nickname.length > REVIEW_NICKNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `ニックネームは${REVIEW_NICKNAME_MAX_LENGTH}文字以内で入力してください`,
    };
  }

  let photoUrls: string[] = [];
  if (source.photoUrls !== undefined) {
    if (!Array.isArray(source.photoUrls)) {
      return { ok: false, error: 'photoUrls の形式が不正です' };
    }
    if (source.photoUrls.length > REVIEW_PHOTO_MAX_COUNT) {
      return {
        ok: false,
        error: `写真は${REVIEW_PHOTO_MAX_COUNT}枚までです`,
      };
    }
    for (const url of source.photoUrls) {
      if (typeof url !== 'string' || !url.startsWith('https://')) {
        return { ok: false, error: 'photoUrls の形式が不正です' };
      }
    }
    photoUrls = source.photoUrls as string[];
  }

  return {
    ok: true,
    value: { exhibitorId, stars, categories, text, nickname, photoUrls },
  };
}

// ─── 純粋関数: 集計・整形 ───

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** レビュー群の集計（総合平均・項目別平均・件数）。 */
export function summarizeReviews(
  reviews: Array<Pick<EventReview, 'stars' | 'categories'>>,
): ReviewSummary {
  const count = reviews.length;
  if (count === 0) {
    return {
      count: 0,
      averageStars: 0,
      categories: { taste: 0, service: 0, atmosphere: 0, presentation: 0 },
    };
  }
  const sum = reviews.reduce(
    (acc, review) => ({
      stars: acc.stars + review.stars,
      taste: acc.taste + review.categories.taste,
      service: acc.service + review.categories.service,
      atmosphere: acc.atmosphere + review.categories.atmosphere,
      presentation: acc.presentation + review.categories.presentation,
    }),
    { stars: 0, taste: 0, service: 0, atmosphere: 0, presentation: 0 },
  );
  return {
    count,
    averageStars: roundToTenth(sum.stars / count),
    categories: {
      taste: roundToTenth(sum.taste / count),
      service: roundToTenth(sum.service / count),
      atmosphere: roundToTenth(sum.atmosphere / count),
      presentation: roundToTenth(sum.presentation / count),
    },
  };
}

/** 公開用に整形する（memberId と visible を落とす）。 */
export function toPublicReview(review: EventReview): PublicReview {
  return {
    id: review.id,
    exhibitorId: review.exhibitorId,
    exhibitorName: review.exhibitorName,
    stars: review.stars,
    categories: review.categories,
    text: review.text,
    nickname: review.nickname,
    photoUrls: review.photoUrls,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

/** 非表示を除いた公開対象だけを残す（純粋関数）。 */
export function filterVisibleReviews<T extends { visible: boolean }>(
  reviews: T[],
): T[] {
  return reviews.filter((review) => review.visible);
}

/** 新しい順（更新日時、無ければ作成日時）に並べる（純粋関数）。 */
export function sortReviewsNewestFirst<T extends EventReview>(reviews: T[]): T[] {
  return [...reviews].sort((a, b) => {
    const aKey = a.updatedAt ?? a.createdAt ?? '';
    const bKey = b.updatedAt ?? b.createdAt ?? '';
    return bKey.localeCompare(aKey) || a.id.localeCompare(b.id);
  });
}

// ─── 純粋関数: 写真検証 ───

export type ReviewPhotoValidation =
  | { ok: true; extension: string }
  | { ok: false; error: string };

/**
 * レビュー写真の検証（純粋関数）。jpg/png/webp のみ、1枚5MBまで。
 * アップロード API が保存前に呼ぶ。
 */
export function validateReviewPhoto(input: {
  contentType: string;
  size: number;
}): ReviewPhotoValidation {
  const extension = REVIEW_PHOTO_EXTENSIONS[input.contentType];
  if (!extension) {
    return {
      ok: false,
      error: '写真は JPEG / PNG / WebP のいずれかでアップロードしてください',
    };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, error: '写真ファイルが空です' };
  }
  if (input.size > REVIEW_PHOTO_MAX_BYTES) {
    return { ok: false, error: '写真は1枚5MBまでです' };
  }
  return { ok: true, extension };
}

/** レビュー写真の保存先パス。 */
export function reviewPhotoStoragePath(
  eventId: string,
  memberId: string,
  fileName: string,
): string {
  return `events/${eventId}/review-photos/${memberId}/${fileName}`;
}

// ─── Firestore 読み書き ───

function reviewsRef(db: Firestore, eventId: string) {
  return db
    .collection('events')
    .doc(eventId)
    .collection(EVENT_REVIEWS_COLLECTION);
}

function toIsoString(value: unknown): string | null {
  const timestamp = value as { toDate?: () => Date } | undefined;
  return timestamp?.toDate?.().toISOString() ?? null;
}

function mapReview(
  id: string,
  data: FirebaseFirestore.DocumentData,
): EventReview {
  const categories = (data.categories ?? {}) as Record<string, unknown>;
  const photoUrls = Array.isArray(data.photoUrls)
    ? data.photoUrls.filter((url): url is string => typeof url === 'string')
    : [];
  return {
    id,
    memberId: String(data.memberId ?? ''),
    exhibitorId: String(data.exhibitorId ?? ''),
    exhibitorName: String(data.exhibitorName ?? ''),
    stars: typeof data.stars === 'number' ? data.stars : 0,
    categories: {
      taste: typeof categories.taste === 'number' ? categories.taste : 0,
      service: typeof categories.service === 'number' ? categories.service : 0,
      atmosphere:
        typeof categories.atmosphere === 'number' ? categories.atmosphere : 0,
      presentation:
        typeof categories.presentation === 'number'
          ? categories.presentation
          : 0,
    },
    text: String(data.text ?? ''),
    nickname: String(data.nickname ?? ''),
    photoUrls,
    visible: data.visible !== false,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

/** プロジェクトの全レビュー（非表示も含む）。ランキング集計など内部用。 */
export async function listAllReviews(
  db: Firestore,
  eventId: string,
): Promise<EventReview[]> {
  const snap = await reviewsRef(db, eventId).get();
  return snap.docs.map((doc) => mapReview(doc.id, doc.data()));
}

// ─── 投稿（作成・更新） ───

export type UpsertReviewResult =
  | { ok: true; reviewId: string; created: boolean }
  | { ok: false; status: number; error: string };

/**
 * レビューを投稿する（1人1店1件。再投稿は同じドキュメントの更新）。
 * 書けるのは、その店のスタンプをもらった客だけ（資格なしは 403）。
 * 編集しても createdAt は保持し、管理人が付けた非表示（visible=false）も
 * 保持する（書き直しで非表示を解除できないように）。
 */
export async function upsertReview(
  db: Firestore,
  input: {
    eventId: string;
    memberId: string;
    value: ParsedReviewInput;
  },
): Promise<UpsertReviewResult> {
  const event = await getEvent(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: 'プロジェクトが見つかりません' };
  }
  const exhibitor = await getExhibitor(input.eventId, input.value.exhibitorId);
  if (!exhibitor) {
    return { ok: false, status: 404, error: 'お店が見つかりません' };
  }
  const eligible = await hasStampForShop(
    db,
    input.eventId,
    input.memberId,
    input.value.exhibitorId,
  );
  if (!eligible) {
    return {
      ok: false,
      status: 403,
      error: 'レビューは、そのお店のスタンプをもらった方だけが書けます',
    };
  }

  const reviewId = reviewIdFor(input.memberId, input.value.exhibitorId);
  const ref = reviewsRef(db, input.eventId).doc(reviewId);
  const existing = await ref.get();
  const created = !existing.exists;

  await ref.set(
    {
      memberId: input.memberId,
      exhibitorId: input.value.exhibitorId,
      exhibitorName: exhibitor.name,
      stars: input.value.stars,
      categories: input.value.categories,
      text: input.value.text,
      nickname: input.value.nickname,
      photoUrls: input.value.photoUrls,
      visible: created ? true : existing.data()?.visible !== false,
      createdAt: created
        ? FieldValue.serverTimestamp()
        : existing.data()?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );

  return { ok: true, reviewId, created };
}

// ─── 一覧 ───

/** 本人のレビュー一覧（編集用。非表示のものも本人には見える）。 */
export async function listMyReviews(
  db: Firestore,
  eventId: string,
  memberId: string,
): Promise<EventReview[]> {
  const snap = await reviewsRef(db, eventId)
    .where('memberId', '==', memberId)
    .get();
  return sortReviewsNewestFirst(
    snap.docs.map((doc) => mapReview(doc.id, doc.data())),
  );
}

/**
 * レビューを書ける店の一覧（スタンプをもらった店）。
 * スタンプ記録から重複を除いて集める。店名は最新のスタンプのものを採る。
 */
export async function listReviewableShops(
  db: Firestore,
  eventId: string,
  memberId: string,
): Promise<ReviewableShop[]> {
  const snap = await db
    .collection('events')
    .doc(eventId)
    .collection(EVENT_STAMPS_COLLECTION)
    .where('memberId', '==', memberId)
    .get();
  const byExhibitor = new Map<string, ReviewableShop>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const exhibitorId = String(data.exhibitorId ?? '');
    if (!exhibitorId) continue;
    byExhibitor.set(exhibitorId, {
      exhibitorId,
      exhibitorName: String(data.exhibitorName ?? ''),
    });
  }
  return [...byExhibitor.values()].sort((a, b) =>
    a.exhibitorName.localeCompare(b.exhibitorName, 'ja'),
  );
}

/**
 * 公開用一覧（特設サイトの店舗ページ向け）。
 * visible のものだけ。exhibitorId 指定時はその店の全件から集計し、
 * 一覧は新しい順に limit 件まで。未指定時はプロジェクト全体が対象。
 */
export async function listPublicReviews(
  db: Firestore,
  eventId: string,
  options: { exhibitorId?: string; limit?: number } = {},
): Promise<{ reviews: PublicReview[]; summary: ReviewSummary }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const all = await listAllReviews(db, eventId);
  const visible = filterVisibleReviews(all);
  const scoped = options.exhibitorId
    ? visible.filter((review) => review.exhibitorId === options.exhibitorId)
    : visible;
  const summary = summarizeReviews(scoped);
  const reviews = sortReviewsNewestFirst(scoped)
    .slice(0, limit)
    .map(toPublicReview);
  return { reviews, summary };
}

/** プロジェクト全体の最新レビュー（特設サイトのトップ向け）。 */
export async function listRecentReviews(
  db: Firestore,
  eventId: string,
  limit = 10,
): Promise<PublicReview[]> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const all = await listAllReviews(db, eventId);
  return sortReviewsNewestFirst(filterVisibleReviews(all))
    .slice(0, capped)
    .map(toPublicReview);
}

/** 管理画面用の一覧（非表示も含む全件、memberId は出さない）。 */
export async function listReviewsForAdmin(
  db: Firestore,
  eventId: string,
): Promise<AdminReview[]> {
  const all = await listAllReviews(db, eventId);
  return sortReviewsNewestFirst(all).map((review) => ({
    ...toPublicReview(review),
    visible: review.visible,
  }));
}

// ─── 表示切り替え（管理人だけ） ───

export type SetReviewVisibilityResult =
  | { ok: true; reviewId: string; visible: boolean }
  | { ok: false; status: number; error: string };

/**
 * レビューの表示／非表示を切り替える。updatedAt は動かさない
 * （再表示で一覧の並びが変わらないように）。
 */
export async function setReviewVisibility(
  db: Firestore,
  input: { eventId: string; reviewId: string; visible: boolean },
): Promise<SetReviewVisibilityResult> {
  const ref = reviewsRef(db, input.eventId).doc(input.reviewId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: 'レビューが見つかりません' };
  }
  await ref.update({ visible: input.visible });
  return { ok: true, reviewId: input.reviewId, visible: input.visible };
}
