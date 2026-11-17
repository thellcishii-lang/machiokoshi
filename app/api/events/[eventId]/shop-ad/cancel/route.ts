// app/api/events/[eventId]/shop-ad/cancel/route.ts
// 広告の解約（参加店セッションだけ・自店分のみ）。
// トップ掲載の解約と同じ作法で Stripe 側を即時解約し、掲載もその場で
// 止める（lib/event-ads.ts の cancelAdPlacement）。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import { findOrganizerByOwnerUid } from '@/lib/organizers';
import { cancelAdPlacement } from '@/lib/event-ads';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;
  const { event, exhibitor } = guard;

  // 解約は、店舗課金オプションが後から OFF になっていても実行できる
  // ようにする（契約の解決にオプション状態は見ない）。
  const organizer = await findOrganizerByOwnerUid(event.ownerUid);
  if (!organizer) {
    return NextResponse.json(
      { error: '広告の契約が見つかりません' },
      { status: 404 },
    );
  }

  try {
    const result = await cancelAdPlacement(
      db,
      organizer.contractId,
      eventId,
      exhibitor.id,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, placement: result.placement });
  } catch {
    return NextResponse.json(
      { error: 'Stripeとの通信に失敗しました。時間をおいて再度お試しください' },
      { status: 502 },
    );
  }
}
