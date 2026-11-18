// lib/event-member-auth.ts
// 来場者（お客さん）本人の API が、ID トークンから memberId を導く共通処理。
//
// 本人キーは契約の認証方式（organizers.smsAuthEnabled、データのみの
// スイッチ）で切り替わる:
// - SMSオン: 従来どおり電話番号がキー。memberId = 電話番号のハッシュ。
// - SMSオフ（既定）: 端末がキー。来場者は匿名認証でサインインし、
//   その uid（端末に保持される識別子）のハッシュが memberId になる。
//   電話番号は一切集めない。
// 方式はイベントの所有者の契約レコードから解決する。イベントが引けない
// 場合は従来方式（SMSオン側の文言・導出）に倒し、従来の応答を保つ。
import { NextResponse } from 'next/server';
import { authAdmin } from './firebase-admin';
import type { EventConfig } from './event';
import { getEvent } from './event-store';
import { findOrganizerByOwnerUid } from './organizers';
import { memberIdForDevice, memberIdForPhone } from './event-coupon';

/** ID トークンのクレームのうち本人キー導出に使う部分。 */
export interface MemberTokenClaims {
  uid?: unknown;
  phone_number?: unknown;
}

/**
 * トークンのクレームと契約の認証方式から memberId を導く（純粋関数）。
 * 方式に合う本人キーがクレームに無ければ null（= 認証エラー扱い）。
 */
export function resolveMemberIdFromClaims(
  claims: MemberTokenClaims,
  smsAuthEnabled: boolean,
): string | null {
  if (smsAuthEnabled) {
    return typeof claims.phone_number === 'string' && claims.phone_number
      ? memberIdForPhone(claims.phone_number)
      : null;
  }
  return typeof claims.uid === 'string' && claims.uid
    ? memberIdForDevice(claims.uid)
    : null;
}

/** イベントの所有者の契約が SMS 認証を使うかどうか。契約が無ければオフ。 */
export async function getEventSmsAuthEnabled(
  event: Pick<EventConfig, 'ownerUid'>,
): Promise<boolean> {
  const organizer = await findOrganizerByOwnerUid(event.ownerUid);
  return organizer?.smsAuthEnabled === true;
}

/**
 * リクエストの ID トークンから memberId を引く。引けなければ
 * エラーレスポンスを返す（各 member 系 API の従来の作法と同じ形）。
 * 文言は方式で出し分ける（SMSオン時は従来文言のまま）。
 */
export async function memberIdFromRequest(
  request: Request,
  eventId: string,
): Promise<{ memberId: string } | { error: NextResponse }> {
  const event = await getEvent(eventId);
  const smsEnabled = event ? await getEventSmsAuthEnabled(event) : true;
  const requiredMessage = smsEnabled ? '電話番号認証が必要です' : '認証が必要です';
  const expiredMessage = smsEnabled
    ? '電話番号認証の有効期限が切れています'
    : '認証の有効期限が切れています';

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      error: NextResponse.json({ error: requiredMessage }, { status: 401 }),
    };
  }
  try {
    const decoded = await authAdmin.verifyIdToken(authHeader.slice(7));
    const memberId = resolveMemberIdFromClaims(decoded, smsEnabled);
    if (!memberId) {
      return {
        error: NextResponse.json({ error: requiredMessage }, { status: 401 }),
      };
    }
    return { memberId };
  } catch {
    return {
      error: NextResponse.json({ error: expiredMessage }, { status: 401 }),
    };
  }
}
