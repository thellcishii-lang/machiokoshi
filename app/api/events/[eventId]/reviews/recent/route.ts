// app/api/events/[eventId]/reviews/recent/route.ts
// プロジェクト全体の最新レビュー（特設サイトのトップ向け）。認証なし。
// visible のものだけを新しい順に返し、memberId は含めない。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getEvent } from '@/lib/event-store';
import { listRecentReviews } from '@/lib/event-review';

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

  const limitParam = Number(new URL(request.url).searchParams.get('limit'));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10;
  const reviews = await listRecentReviews(db, eventId, limit);
  return NextResponse.json({ reviews });
}
