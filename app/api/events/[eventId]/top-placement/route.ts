// app/api/events/[eventId]/top-placement/route.ts
// トップ掲載（特設サイトの先頭5枠）の自店向け状態取得（店舗ページ用）。
// 実行できるのは参加店セッションだけ（自店の状態のみ）。
// 購入できるかどうか（available）は、プロジェクト設定（有効＋料金）・
// 契約の店舗課金オプション・管理人の Stripe 設定がすべて揃っている
// 場合にだけ true になる。揃っていない理由は店には出さない
// （カード自体を出さない運用）。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import {
  getTopPlacement,
  isTopFeaturedForStatus,
  resolveTopPlacementAvailability,
} from '@/lib/event-placement';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;
  const { event, exhibitor } = guard;

  const placement = await getTopPlacement(db, eventId, exhibitor.id);
  const availability = await resolveTopPlacementAvailability(
    db,
    event.ownerUid,
  );
  const purchasable =
    event.topPlacementEnabled &&
    event.topPlacementPrice !== null &&
    availability.available;

  return NextResponse.json({
    // プロジェクトのトップ掲載設定（公開情報と同じ値）
    enabled: event.topPlacementEnabled,
    price: event.topPlacementPrice,
    // 今この店が買える状態かどうか（設定・オプション・Stripe が全部揃っている）
    available: purchasable,
    // 自店の契約状態（未申込なら status は null）
    status: placement?.status ?? null,
    featured: placement ? isTopFeaturedForStatus(placement.status) : false,
    monthlyAmount: placement?.monthlyAmount ?? null,
  });
}
