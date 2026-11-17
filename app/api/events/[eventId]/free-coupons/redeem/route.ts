// app/api/events/[eventId]/free-coupons/redeem/route.ts
// 達成で発行された「好きな店で1回無料」クーポンの消込。
// 通常クーポン（消込は所有店だけ）と違い、どの参加店でも使える
// （原価は使われた店の負担で、システム的には記録だけ）。
// 実行できるのは参加店セッションだけ。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import { redeemFreeCoupon } from '@/lib/event-stamp';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエスト形式が不正です' },
      { status: 400 },
    );
  }
  const freeCouponId =
    typeof body.freeCouponId === 'string' ? body.freeCouponId.trim() : '';
  if (!freeCouponId) {
    return NextResponse.json(
      { error: 'freeCouponId が必要です' },
      { status: 400 },
    );
  }

  const result = await redeemFreeCoupon(db, {
    eventId,
    exhibitor: guard.exhibitor,
    freeCouponId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  // kind（'stamp' | 'login'）で消込画面の表示文を出し分ける
  return NextResponse.json({
    ok: true,
    freeCouponId: result.freeCouponId,
    kind: result.kind,
  });
}
