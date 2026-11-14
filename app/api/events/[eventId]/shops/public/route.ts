// app/api/events/[eventId]/shops/public/route.ts
// 公開用の店舗一覧（特設サイトの店舗ページ向け）。認証なし。
// 掲載中（published）の店だけを返し、各店の累計レビュー集計
// （平均星・項目別平均・件数）をあわせる。個人情報は含めない。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getEvent } from '@/lib/event-store';
import { listPublicShops } from '@/lib/event-shop';
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

  const shops = await listPublicShops(db, eventId);
  const shopsWithSummary = await Promise.all(
    shops.map(async (shop) => {
      // 累計集計は visible なレビュー全件から計算される（limit は
      // 返すレビュー一覧の件数だけに効くため、集計用に 1 を指定）。
      const { summary } = await listPublicReviews(db, eventId, {
        exhibitorId: shop.exhibitorId,
        limit: 1,
      });
      return { ...shop, reviewSummary: summary };
    }),
  );
  return NextResponse.json({ shops: shopsWithSummary });
}
