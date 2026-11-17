// app/api/events/[eventId]/top-placement/checkout/route.ts
// トップ掲載の申込: 自店分の Stripe Checkout セッションを発行し、
// 支払いページの URL を返す（参加店セッションだけ）。
// カード情報は Stripe のホスト型ページで扱い、このアプリには触れない。
// 実際の掲載開始は Webhook（invoice.paid）で確定する。
// 既に有効な契約（active / past_due）がある店は再申込できない。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import {
  getTopPlacement,
  resolveTopPlacementAvailability,
  startTopPlacement,
} from '@/lib/event-placement';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;
  const { event, exhibitor } = guard;
  // 協賛（広告専用）アカウントはトップ掲載の対象外
  if (exhibitor.kind === 'advertiser') {
    return NextResponse.json(
      { error: '協賛アカウントはトップ掲載を利用できません' },
      { status: 403 },
    );
  }

  if (
    !event.topPlacementEnabled ||
    event.topPlacementPrice === null ||
    event.topPlacementPrice <= 0
  ) {
    // 料金 0（無料）の間は課金自体が無い（参加表明で掲載される）
    return NextResponse.json(
      { error: '現在トップ掲載のお申し込みは受け付けていません' },
      { status: 404 },
    );
  }

  const availability = await resolveTopPlacementAvailability(
    db,
    event.ownerUid,
  );
  if (!availability.available || !availability.organizer) {
    return NextResponse.json(
      { error: '現在トップ掲載のお申し込みは受け付けていません' },
      { status: 404 },
    );
  }

  const existing = await getTopPlacement(db, eventId, exhibitor.id);
  if (
    existing?.stripeSubscriptionId &&
    (existing.status === 'active' || existing.status === 'past_due')
  ) {
    return NextResponse.json(
      { error: '既にトップ掲載の契約があります' },
      { status: 409 },
    );
  }

  try {
    const result = await startTopPlacement(db, {
      contractId: availability.organizer.contractId,
      eventId,
      exhibitorId: exhibitor.id,
      exhibitorName: exhibitor.name,
      monthlyAmount: event.topPlacementPrice,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({
      ok: true,
      checkoutUrl: result.checkoutUrl,
      placement: result.placement,
    });
  } catch {
    return NextResponse.json(
      { error: 'Stripeとの通信に失敗しました。時間をおいて再度お試しください' },
      { status: 502 },
    );
  }
}
