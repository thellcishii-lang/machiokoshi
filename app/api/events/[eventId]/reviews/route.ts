// app/api/events/[eventId]/reviews/route.ts
// レビューの投稿（来場者）と、全件一覧（管理人）。
// POST: 電話番号認証のトークンから本人を特定し、その店のスタンプを
// もらった客だけが書ける（資格判定は lib/event-review.ts の upsertReview）。
// 1人1店1件で、再投稿は同じレビューの更新になる。
// GET: 管理画面用の一覧（非表示も含む）。プロジェクト所有者だけ。
import { NextResponse } from 'next/server';
import { authAdmin, db } from '@/lib/firebase-admin';
import { memberIdForPhone } from '@/lib/event-coupon';
import { requireEventOwner } from '@/lib/event-auth';
import {
  listReviewsForAdmin,
  parseReviewInput,
  upsertReview,
} from '@/lib/event-review';

export const dynamic = 'force-dynamic';

export async function POST(
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエスト形式が不正です' },
      { status: 400 },
    );
  }
  const parsed = parseReviewInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await upsertReview(db, {
    eventId,
    memberId,
    value: parsed.value,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    reviewId: result.reviewId,
    created: result.created,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventOwner(request, eventId);
  if ('error' in guard) return guard.error;

  const reviews = await listReviewsForAdmin(db, eventId);
  return NextResponse.json({ reviews });
}
