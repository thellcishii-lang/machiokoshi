// app/api/events/[eventId]/reviews/public/route.ts
// 公開用レビュー一覧（特設サイトの店舗ページ向け）。認証なし。
// visible のものだけを返し、memberId は含めない。exhibitorId を
// 指定すると、その店の集計（平均・件数）もあわせて返す。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getEvent } from '@/lib/event-store';
import { listPublicReviews } from '@/lib/event-review';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const event = await getEvent(eventId);
  if (!event) {
    return NextResponse.json(
      { error: 'プロジェクトが見つかりません' },
      { status: 404 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const exhibitorId = searchParams.get('exhibitorId') ?? undefined;
  const limitParam = Number(searchParams.get('limit'));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  const { reviews, summary } = await listPublicReviews(db, eventId, {
    exhibitorId: exhibitorId || undefined,
    limit,
  });
  return NextResponse.json({ reviews, summary });
}
