// app/api/events/[eventId]/my-reviews/route.ts
// 来場者本人のレビュー一覧と、レビューを書ける店の一覧（スタンプを
// もらった店）。電話番号認証のトークンから本人を特定する
// （my-claims / my-stamps と同じ作法）。編集画面の初期値に使う。
import { NextResponse } from 'next/server';
import { authAdmin, db } from '@/lib/firebase-admin';
import { memberIdForPhone } from '@/lib/event-coupon';
import {
  listMyReviews,
  listReviewableShops,
} from '@/lib/event-review';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: '電話番号認証が必要です' }, { status: 401 });
  }
  let memberId: string;
  try {
    const decoded = await authAdmin.verifyIdToken(authHeader.slice(7));
    if (typeof decoded.phone_number !== 'string' || !decoded.phone_number) {
      return NextResponse.json({ error: '電話番号認証が必要です' }, { status: 401 });
    }
    memberId = memberIdForPhone(decoded.phone_number);
  } catch {
    return NextResponse.json(
      { error: '電話番号認証の有効期限が切れています' },
      { status: 401 },
    );
  }

  const [reviews, eligibleShops] = await Promise.all([
    listMyReviews(db, eventId, memberId),
    listReviewableShops(db, eventId, memberId),
  ]);
  return NextResponse.json({ reviews, eligibleShops });
}
