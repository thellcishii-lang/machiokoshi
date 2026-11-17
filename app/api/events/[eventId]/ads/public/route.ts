// app/api/events/[eventId]/ads/public/route.ts
// 公開用の広告一覧（特設サイトの広告ページ向け）。認証なし。
// 掲載版（承認済み）があり、掲載可否（有料の間は契約状態、無料の
// 間は承認のみ）を通った広告だけを、承認が早い順に枠数まで返す。
// 広告が無効なプロジェクトでは空配列（lib/event-ads.ts が判定）。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getEvent } from '@/lib/event-store';
import { listPublicAds } from '@/lib/event-ads';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
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
  const ads = await listPublicAds(db, eventId);
  return NextResponse.json({ ads });
}
