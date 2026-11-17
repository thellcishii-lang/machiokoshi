// app/api/events/[eventId]/top-placement/cancel/route.ts
// トップ掲載の解約（参加店セッションだけ・自店分のみ）。
// 店舗課金の解約と同じ作法で Stripe 側を即時解約し、掲載もその場で
// 止める（lib/event-placement.ts の cancelTopPlacement）。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import { findOrganizerByOwnerUid } from '@/lib/organizers';
import { cancelTopPlacement } from '@/lib/event-placement';

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

  // 解約は、店舗課金オプションが後から OFF になっていても実行できる
  // ようにする（契約の解決にオプション状態は見ない）。
  const organizer = await findOrganizerByOwnerUid(event.ownerUid);
  if (!organizer) {
    return NextResponse.json(
      { error: 'トップ掲載の契約が見つかりません' },
      { status: 404 },
    );
  }

  try {
    const result = await cancelTopPlacement(
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
