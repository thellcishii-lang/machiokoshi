// app/api/events/[eventId]/top-placement/opt-in/route.ts
// トップ掲載が無料（料金 0）の間の参加表明（参加店セッションだけ・
// 自店分のみ）。有料の間は課金側の状態が正で、参加表明は使わない
// ため 403 を返す。表明の保存先は参加店ドキュメントの
// placementOptIn（lib/event-shop.ts）。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import { setShopPlacementOptIn } from '@/lib/event-shop';

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

  if (!event.topPlacementEnabled || event.topPlacementPrice !== 0) {
    return NextResponse.json(
      { error: '現在トップ掲載は無料の参加表明を受け付けていません' },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'リクエスト形式が不正です' },
      { status: 400 },
    );
  }
  if (typeof body.optedIn !== 'boolean') {
    return NextResponse.json(
      { error: 'optedIn が必要です' },
      { status: 400 },
    );
  }

  const saved = await setShopPlacementOptIn(
    db,
    eventId,
    exhibitor.id,
    body.optedIn,
  );
  if (!saved) {
    return NextResponse.json(
      { error: 'お店が見つかりません' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, optedIn: body.optedIn });
}
