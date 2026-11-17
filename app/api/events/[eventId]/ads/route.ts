// app/api/events/[eventId]/ads/route.ts
// 管理画面（広告管理）用: 広告を持つ店の一覧。プロジェクト所有者だけ。
// 申請中の店が先に並ぶ（lib/event-ads.ts の listAdsForAdmin）。
import { NextResponse } from 'next/server';
import { requireEventOwner } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import { listAdsForAdmin } from '@/lib/event-ads';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventOwner(request, eventId);
  if ('error' in guard) return guard.error;

  const ads = await listAdsForAdmin(db, eventId);
  return NextResponse.json({
    ads,
    // 広告の設定も一緒に返す（管理画面の案内表示用）
    adsEnabled: guard.event.adsEnabled,
    adsSlots: guard.event.adsSlots,
    adsPrice: guard.event.adsPrice,
  });
}
