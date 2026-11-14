// lib/stamp-qr.ts
// スタンプ・無料クーポン用 QR のペイロード（純粋関数のみ、クライアントからも使う）。
//
// お客さんの画面が QR を表示し、参加店の消込画面が読み取る。
// - スタンプ用: お客さん本人の識別（memberId）を持つ。店が読むとスタンプ付与。
// - 無料クーポン用: 達成で発行された無料クーポンの識別（freeCouponId）を持つ。
//   どの参加店でも使える。
// 従来のクーポン消込 QR は claimId の素の文字列で、JSON ではない。
// parseRedeemQrPayload は JSON でなければ従来の claimId として扱い、
// 消込画面が3種の QR を1つの入口で振り分けられるようにする。

export interface StampQrPayload {
  type: 'stamp';
  eventId: string;
  memberId: string;
}

export interface FreeCouponQrPayload {
  type: 'free';
  eventId: string;
  freeCouponId: string;
}

export type RedeemQrPayload =
  | StampQrPayload
  | FreeCouponQrPayload
  | { type: 'claim'; claimId: string };

/** スタンプ用 QR の表示文字列（お客さんの来場者画面が出す）。 */
export function buildStampQrPayload(eventId: string, memberId: string): string {
  return JSON.stringify({ v: 1, type: 'stamp', eventId, memberId });
}

/** 無料クーポン用 QR の表示文字列（お客さんの来場者画面が出す）。 */
export function buildFreeCouponQrPayload(
  eventId: string,
  freeCouponId: string,
): string {
  return JSON.stringify({ v: 1, type: 'free', eventId, freeCouponId });
}

/**
 * 消込画面が読んだ文字列を振り分ける（純粋関数）。
 * - JSON で type が 'stamp' / 'free' のものはそれぞれのペイロード。
 * - それ以外の文字列（従来の claimId 等）は claim として扱う。
 * - 空文字列は null。
 */
export function parseRedeemQrPayload(text: string): RedeemQrPayload | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        parsed.type === 'stamp' &&
        typeof parsed.eventId === 'string' &&
        parsed.eventId &&
        typeof parsed.memberId === 'string' &&
        parsed.memberId
      ) {
        return {
          type: 'stamp',
          eventId: parsed.eventId,
          memberId: parsed.memberId,
        };
      }
      if (
        parsed.type === 'free' &&
        typeof parsed.eventId === 'string' &&
        parsed.eventId &&
        typeof parsed.freeCouponId === 'string' &&
        parsed.freeCouponId
      ) {
        return {
          type: 'free',
          eventId: parsed.eventId,
          freeCouponId: parsed.freeCouponId,
        };
      }
    } catch {
      // JSON として読めない文字列は従来どおり claimId として扱う
    }
  }
  return { type: 'claim', claimId: trimmed };
}
