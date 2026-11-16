// lib/event-shop.ts
// Push-taro 町おこし の店舗プロフィール基盤（events/{eventId} 配下）。
//
// - プロフィールは参加店ドキュメント（exhibitors/{exhibitorId}）の
//   `profile` フィールドに持つ。データは1つ: 店が店舗専用ページで
//   入れた情報が、特設サイトの店舗ページにもアプリの店舗表示にも
//   そのまま反映される（公開側は toPublicShop / listPublicShops を使う）。
// - 編集できるのは店本人だけ（API 側で参加店セッションを検証する）。
//   ここでは検証（純粋関数）と読み書きを担う。
// - 写真は API 経由で Admin SDK が Storage に保存する
//   （events/{eventId}/shop-photos/{exhibitorId}/...）。検証は
//   レビュー写真と同じ純粋関数（lib/event-review.ts）を使う。
import type { Firestore } from 'firebase-admin/firestore';
import { EVENT_EXHIBITORS_COLLECTION } from './event-coupon';
import { isHttpsUrl } from './event';

export const SHOP_PROFILE_PHOTO_MAX_COUNT = 3;

export const SHOP_PROFILE_LIMITS = {
  displayName: 60,
  address: 120,
  phone: 30,
  hoursText: 120,
  menuName: 60,
  menuDescription: 300,
  description: 1000,
} as const;

export interface ShopProfile {
  /** 表示名。未設定なら登録名（参加店名）で表示する */
  displayName: string;
  address: string;
  phone: string;
  /** 営業時間の自由文（例: 11:00〜21:00（水曜定休）） */
  hoursText: string;
  /** 対象メニュー名（例: 飯能カレー） */
  menuName: string;
  menuDescription: string;
  /** お店の紹介文 */
  description: string;
  photoUrls: string[];
  instagramUrl: string;
  /** 掲載するかどうか。既定は掲載する（true） */
  published: boolean;
}

/** 公開用の店舗情報。表示名は解決済み（未設定なら登録名）。 */
export interface PublicShop {
  exhibitorId: string;
  /** 登録名（管理上の名前） */
  name: string;
  profile: ShopProfile;
  /**
   * 特設サイトのトップ掲載（先頭5枠）の対象かどうか。参加店ドキュメントの
   * トップレベル項目 `topFeatured` が正で、課金側（lib/event-placement.ts）
   * が掲載中と判断している間だけ true。未設定の旧ドキュメントは false。
   */
  topFeatured: boolean;
}

export function emptyShopProfile(): ShopProfile {
  return {
    displayName: '',
    address: '',
    phone: '',
    hoursText: '',
    menuName: '',
    menuDescription: '',
    description: '',
    photoUrls: [],
    instagramUrl: '',
    published: true,
  };
}

// ─── 純粋関数: 読み取り整形 ───

function readString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function readPhotoUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((url): url is string => typeof url === 'string' && isHttpsUrl(url))
    .slice(0, SHOP_PROFILE_PHOTO_MAX_COUNT);
}

function readInstagramUrl(value: unknown): string {
  return typeof value === 'string' && isHttpsUrl(value) ? value : '';
}

/**
 * 保存済みプロフィールを防御的に読む（読み取り用。throw しない）。
 * 項目が無い旧ドキュメントは空プロフィール（掲載あり・表示名は登録名
 * フォールバック）として扱う。
 */
export function parseShopProfile(value: unknown): ShopProfile {
  if (typeof value !== 'object' || value === null) return emptyShopProfile();
  const source = value as Record<string, unknown>;
  return {
    displayName: readString(source.displayName, SHOP_PROFILE_LIMITS.displayName),
    address: readString(source.address, SHOP_PROFILE_LIMITS.address),
    phone: readString(source.phone, SHOP_PROFILE_LIMITS.phone),
    hoursText: readString(source.hoursText, SHOP_PROFILE_LIMITS.hoursText),
    menuName: readString(source.menuName, SHOP_PROFILE_LIMITS.menuName),
    menuDescription: readString(
      source.menuDescription,
      SHOP_PROFILE_LIMITS.menuDescription,
    ),
    description: readString(source.description, SHOP_PROFILE_LIMITS.description),
    photoUrls: readPhotoUrls(source.photoUrls),
    instagramUrl: readInstagramUrl(source.instagramUrl),
    published: source.published !== false,
  };
}

/** 公開用に整形する（表示名が未設定なら登録名に倒す）。 */
export function toPublicShop(
  exhibitor: { id: string; name: string },
  rawProfile: unknown,
  topFeatured?: unknown,
): PublicShop {
  const profile = parseShopProfile(rawProfile);
  if (!profile.displayName) profile.displayName = exhibitor.name;
  return {
    exhibitorId: exhibitor.id,
    name: exhibitor.name,
    profile,
    topFeatured: topFeatured === true,
  };
}

// ─── 純粋関数: 書き込み検証 ───

export type ValidateShopProfileResult =
  | { ok: true; value: ShopProfile }
  | { ok: false; error: string };

function validateTextField(
  source: Record<string, unknown>,
  field: keyof typeof SHOP_PROFILE_LIMITS,
  label: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = source[field];
  if (raw === undefined || raw === null) return { ok: true, value: '' };
  if (typeof raw !== 'string') {
    return { ok: false, error: `${label}の形式が不正です` };
  }
  const value = raw.trim();
  if (value.length > SHOP_PROFILE_LIMITS[field]) {
    return {
      ok: false,
      error: `${label}は${SHOP_PROFILE_LIMITS[field]}文字以内で入力してください`,
    };
  }
  return { ok: true, value };
}

/**
 * 店舗プロフィールの保存入力を検証して正規化する（書き込み用）。
 * 文字項目は任意（空でよい）で上限文字数まで。写真は最大3枚・https
 * のみ。Instagram URL は https のみ（空は可）。published は真偽値のみ
 * （未指定は掲載）。
 */
export function validateShopProfileInput(
  raw: unknown,
): ValidateShopProfileResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'リクエスト形式が不正です' };
  }
  const source = raw as Record<string, unknown>;

  const fields: Array<[keyof typeof SHOP_PROFILE_LIMITS, string]> = [
    ['displayName', '表示名'],
    ['address', '住所'],
    ['phone', '電話番号'],
    ['hoursText', '営業時間'],
    ['menuName', '対象メニュー名'],
    ['menuDescription', 'メニューの説明'],
    ['description', 'お店の紹介'],
  ];
  const texts = {} as Record<keyof typeof SHOP_PROFILE_LIMITS, string>;
  for (const [field, label] of fields) {
    const result = validateTextField(source, field, label);
    if (!result.ok) return result;
    texts[field] = result.value;
  }

  let photoUrls: string[] = [];
  if (source.photoUrls !== undefined) {
    if (!Array.isArray(source.photoUrls)) {
      return { ok: false, error: '写真の形式が不正です' };
    }
    if (source.photoUrls.length > SHOP_PROFILE_PHOTO_MAX_COUNT) {
      return {
        ok: false,
        error: `写真は${SHOP_PROFILE_PHOTO_MAX_COUNT}枚までです`,
      };
    }
    for (const url of source.photoUrls) {
      if (typeof url !== 'string' || !isHttpsUrl(url)) {
        return { ok: false, error: '写真の形式が不正です' };
      }
    }
    photoUrls = source.photoUrls as string[];
  }

  const instagramUrl =
    typeof source.instagramUrl === 'string' ? source.instagramUrl.trim() : '';
  if (instagramUrl && !isHttpsUrl(instagramUrl)) {
    return {
      ok: false,
      error: 'InstagramのURLは https:// で始まる必要があります',
    };
  }

  if (source.published !== undefined && typeof source.published !== 'boolean') {
    return { ok: false, error: '掲載設定の形式が不正です' };
  }

  return {
    ok: true,
    value: {
      ...texts,
      photoUrls,
      instagramUrl,
      published: source.published !== false,
    },
  };
}

/** 店舗写真の保存先パス。 */
export function shopPhotoStoragePath(
  eventId: string,
  exhibitorId: string,
  fileName: string,
): string {
  return `events/${eventId}/shop-photos/${exhibitorId}/${fileName}`;
}

// ─── 課金による掲載停止（店舗課金オプション） ───
//
// 参加店ドキュメントのトップレベル項目 `billingSuspended` で管理する。
// プロフィール（profile）の中には入れない: 店が店舗専用ページで
// プロフィールを保存すると profile は丸ごと置き換わるため、その際に
// 課金側の停止状態が消えたり、店自身が解除できたりしないようにする。
// 店自身の掲載 ON/OFF（profile.published）とは独立したフラグで、
// 公開判定は「掲載する設定 かつ 課金停止でない」こと。

/**
 * 公開一覧に載せるかどうか（純粋関数）。
 * billingSuspended が未設定（undefined）の旧ドキュメントは停止でない扱い。
 */
export function isShopPubliclyListed(
  profile: ShopProfile,
  billingSuspended: unknown,
): boolean {
  return profile.published && billingSuspended !== true;
}

// ─── Firestore 読み書き ───

function exhibitorRef(db: Firestore, eventId: string, exhibitorId: string) {
  return db
    .collection('events')
    .doc(eventId)
    .collection(EVENT_EXHIBITORS_COLLECTION)
    .doc(exhibitorId);
}

/** 自店プロフィールの読み取り（未設定なら空プロフィール）。 */
export async function getShopProfile(
  db: Firestore,
  eventId: string,
  exhibitorId: string,
): Promise<ShopProfile> {
  const snap = await exhibitorRef(db, eventId, exhibitorId).get();
  return parseShopProfile(snap.data()?.profile);
}

export type UpdateShopProfileResult =
  | { ok: true; profile: ShopProfile }
  | { ok: false; status: number; error: string };

/** 自店プロフィールの保存（プロフィール全体を置き換える）。 */
export async function updateShopProfile(
  db: Firestore,
  eventId: string,
  exhibitorId: string,
  profile: ShopProfile,
): Promise<UpdateShopProfileResult> {
  const ref = exhibitorRef(db, eventId, exhibitorId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: 'お店が見つかりません' };
  }
  await ref.update({ profile });
  return { ok: true, profile };
}

/**
 * 公開用の店舗一覧（掲載中の店だけ）。
 * 「掲載する設定（profile.published）」かつ「課金停止でない
 * （billingSuspended）」店だけを返す。表示名の解決（未設定なら
 * 登録名）は toPublicShop で行う。
 */
export async function listPublicShops(
  db: Firestore,
  eventId: string,
): Promise<PublicShop[]> {
  const snap = await db
    .collection('events')
    .doc(eventId)
    .collection(EVENT_EXHIBITORS_COLLECTION)
    .get();
  return snap.docs
    .map((doc) => ({
      shop: toPublicShop(
        { id: doc.id, name: String(doc.data().name ?? '') },
        doc.data().profile,
        doc.data().topFeatured,
      ),
      billingSuspended: doc.data().billingSuspended,
    }))
    .filter(({ shop, billingSuspended }) =>
      isShopPubliclyListed(shop.profile, billingSuspended),
    )
    .map(({ shop }) => shop)
    .sort((a, b) => a.profile.displayName.localeCompare(b.profile.displayName, 'ja'));
}

/**
 * 課金による掲載停止フラグの付け替え（店舗課金オプションの Webhook
 * 処理から使う）。プロフィールには触れない。店が無ければ false。
 */
export async function setShopBillingSuspended(
  db: Firestore,
  eventId: string,
  exhibitorId: string,
  suspended: boolean,
): Promise<boolean> {
  const ref = exhibitorRef(db, eventId, exhibitorId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update({ billingSuspended: suspended });
  return true;
}

// ─── トップ掲載フラグ（トップ掲載課金） ───
//
// billingSuspended と同じ考え方で、参加店ドキュメントのトップレベル項目
// `topFeatured` で管理する（プロフィール保存で消えたり店が勝手に
// 付け替えたりできないように）。付け替えは課金側
// （lib/event-placement.ts の Webhook 処理・解約処理）だけが行う。

/**
 * トップ掲載フラグの付け替え。プロフィールには触れない。
 * 店が無ければ false。
 */
export async function setShopTopFeatured(
  db: Firestore,
  eventId: string,
  exhibitorId: string,
  featured: boolean,
): Promise<boolean> {
  const ref = exhibitorRef(db, eventId, exhibitorId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update({ topFeatured: featured });
  return true;
}
