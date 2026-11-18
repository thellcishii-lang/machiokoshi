// app/api/events/[eventId]/coupons/[couponId]/claim/route.ts
// 来場者のクーポン取得。認証方式に応じたトークンが必須で、本人の
// memberId に紐づけて記録する（1人1回、再取得は冪等）。
// memberId の導出は lib/event-member-auth.ts（SMSオン時は電話番号、
// SMSオフ時は端末の識別子から）。
import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { claimCoupon } from '@/lib/event-coupon';
import { memberIdFromRequest } from '@/lib/event-member-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string; couponId: string }> },
) {
  const retryAfter = await enforceRateLimit(request, 'event-claim', 30, 60 * 1000);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: 'レート制限を超えました' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const { eventId, couponId } = await params;

  const auth = await memberIdFromRequest(request, eventId);
  if ('error' in auth) return auth.error;
  const memberId = auth.memberId;

  const result = await claimCoupon(eventId, couponId, memberId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(
    { ok: true, claimId: result.claimId, alreadyClaimed: result.alreadyClaimed },
    { status: result.alreadyClaimed ? 200 : 201 },
  );
}
