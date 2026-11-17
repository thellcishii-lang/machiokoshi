// app/api/events/[eventId]/shop-push-requests/[requestId]/checkout/route.ts
// 参加店向け: 支払い待ちのプッシュ配信申請の支払いページを（再）発行する。
// 金額は申請作成時点のスナップショット（feeAmount）を使う。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import { resolveAdAvailability } from '@/lib/event-ads';
import {
  PUSH_SEND_KIND,
  startOneTimeCharge,
} from '@/lib/event-charges';
import {
  getPushRequest,
  setPushRequestChargeSession,
} from '@/lib/event-push-request';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string; requestId: string }> },
) {
  const { eventId, requestId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;
  const { event, exhibitor } = guard;
  if (exhibitor.kind === 'advertiser') {
    return NextResponse.json(
      { error: '協賛アカウントではプッシュ配信を申請できません' },
      { status: 403 },
    );
  }

  const pushRequest = await getPushRequest(db, eventId, requestId);
  if (!pushRequest || pushRequest.exhibitorId !== exhibitor.id) {
    return NextResponse.json({ error: '申請が見つかりません' }, { status: 404 });
  }
  if (pushRequest.status !== 'unpaid' || pushRequest.feeAmount <= 0) {
    return NextResponse.json(
      { error: 'この申請はお支払い待ちではありません' },
      { status: 409 },
    );
  }

  const availability = await resolveAdAvailability(db, event.ownerUid);
  if (!availability.available || !availability.organizer) {
    return NextResponse.json(
      { error: '現在プッシュ配信のお支払いを受け付けていません' },
      { status: 404 },
    );
  }

  try {
    const charge = await startOneTimeCharge(db, {
      contractId: availability.organizer.contractId,
      eventId,
      exhibitorId: exhibitor.id,
      kind: PUSH_SEND_KIND,
      targetId: pushRequest.id,
      amount: pushRequest.feeAmount,
    });
    if (!charge.ok) {
      return NextResponse.json(
        { error: charge.error },
        { status: charge.status },
      );
    }
    await setPushRequestChargeSession(db, eventId, pushRequest.id, charge.sessionId);
    return NextResponse.json({ ok: true, checkoutUrl: charge.checkoutUrl });
  } catch {
    return NextResponse.json(
      { error: 'Stripeとの通信に失敗しました。時間をおいて再度お試しください' },
      { status: 502 },
    );
  }
}
