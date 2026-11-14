// app/api/events/[eventId]/ranking/route.ts
// 公開用の週次ランキング（特設サイトのトップ向け）。認証なし。
// 保存済みの最新ランキングを返す。まだ計算されていなければ
// ranking は null（特設サイト側は「集計中」等で表示する想定）。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getEvent } from '@/lib/event-store';
import { getLatestRanking } from '@/lib/event-ranking';

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

  const ranking = await getLatestRanking(db, eventId);
  return NextResponse.json({ ranking });
}
