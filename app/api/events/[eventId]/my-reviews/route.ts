// app/api/events/[eventId]/my-reviews/route.ts
// 来場者本人のレビュー一覧と、レビューを書ける店の一覧（スタンプを
// もらった店）。認証方式に応じたトークンから本人を特定する
// （my-claims / my-stamps と同じ作法）。編集画面の初期値に使う。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { memberIdFromRequest } from '@/lib/event-member-auth';
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

  const auth = await memberIdFromRequest(request, eventId);
  if ('error' in auth) return auth.error;

  const [reviews, eligibleShops] = await Promise.all([
    listMyReviews(db, eventId, auth.memberId),
    listReviewableShops(db, eventId, auth.memberId),
  ]);
  return NextResponse.json({ reviews, eligibleShops });
}
