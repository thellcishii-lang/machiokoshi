// app/api/events/[eventId]/login-bonus/route.ts
// 毎日ログインボーナスの状態取得（GET）とチェックイン（POST）。
// 認証方式に応じたトークンから本人を特定する（my-stamps と同じ作法、
// lib/event-member-auth.ts）。
// 状態の書き込みは POST のサーバー処理だけが行うため、来場者が
// 日数を改ざんすることはできない。購読者でない場合は loginBonus: null。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { memberIdFromRequest } from '@/lib/event-member-auth';
import { checkInLoginBonus, getLoginBonusView } from '@/lib/event-login';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const auth = await memberIdFromRequest(request, eventId);
  if ('error' in auth) return auth.error;

  const view = await getLoginBonusView(db, eventId, auth.memberId);
  return NextResponse.json({ loginBonus: view });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const auth = await memberIdFromRequest(request, eventId);
  if ('error' in auth) return auth.error;

  const result = await checkInLoginBonus(db, {
    eventId,
    memberId: auth.memberId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    loginBonus: result.view,
    alreadyCheckedIn: result.alreadyCheckedIn,
    issuedCouponIds: result.issuedCouponIds,
  });
}
