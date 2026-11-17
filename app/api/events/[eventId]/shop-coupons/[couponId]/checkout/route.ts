// app/api/events/[eventId]/shop-coupons/[couponId]/checkout/route.ts
// 参加店向け: 支払い待ちクーポンの支払いページを（再）発行する。
// 発行の途中で離脱したり、セッションが期限切れになったりしたときに、
// 店舗ページの「お支払いへ」からここを叩いて再開する。
// 金額はクーポン作成時点のスナップショット（feeAmount）を使う。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import { getCoupon } from '@/lib/event-coupon';
import { resolveAdAvailability } from '@/lib/event-ads';
import {
  COUPON_ISSUE_KIND,
  setCouponChargeSession,
  startOneTimeCharge,
} from '@/lib/event-charges';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string; couponId: string }> },
) {
  const { eventId, couponId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;
  const { event, exhibitor } = guard;
  if (exhibitor.kind === 'advertiser') {
    return NextResponse.json(
      { error: '協賛アカウントではクーポンを発行できません' },
      { status: 403 },
    );
  }

  const coupon = await getCoupon(eventId, couponId);
  if (!coupon || coupon.exhibitorId !== exhibitor.id) {
    return NextResponse.json(
      { error: 'クーポンが見つかりません' },
      { status: 404 },
    );
  }
  if (!coupon.paymentPending || coupon.feeAmount === null || coupon.feeAmount <= 0) {
    return NextResponse.json(
      { error: 'このクーポンはお支払い待ちではありません' },
      { status: 409 },
    );
  }

  const availability = await resolveAdAvailability(db, event.ownerUid);
  if (!availability.available || !availability.organizer) {
    return NextResponse.json(
      { error: '現在クーポン発行のお支払いを受け付けていません' },
      { status: 404 },
    );
  }

  try {
    const charge = await startOneTimeCharge(db, {
      contractId: availability.organizer.contractId,
      eventId,
      exhibitorId: exhibitor.id,
      kind: COUPON_ISSUE_KIND,
      targetId: coupon.id,
      amount: coupon.feeAmount,
    });
    if (!charge.ok) {
      return NextResponse.json(
        { error: charge.error },
        { status: charge.status },
      );
    }
    await setCouponChargeSession(db, eventId, coupon.id, charge.sessionId);
    return NextResponse.json({ ok: true, checkoutUrl: charge.checkoutUrl });
  } catch {
    return NextResponse.json(
      { error: 'Stripeとの通信に失敗しました。時間をおいて再度お試しください' },
      { status: 502 },
    );
  }
}
