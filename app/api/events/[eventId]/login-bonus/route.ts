// app/api/events/[eventId]/login-bonus/route.ts
// 毎日ログインボーナスの状態取得（GET）とチェックイン（POST）。
// 電話番号認証のトークンから本人を特定する（my-stamps と同じ作法）。
// 状態の書き込みは POST のサーバー処理だけが行うため、来場者が
// 日数を改ざんすることはできない。購読者でない場合は loginBonus: null。
import { NextResponse } from 'next/server';
import { authAdmin, db } from '@/lib/firebase-admin';
import { memberIdForPhone } from '@/lib/event-coupon';
import { checkInLoginBonus, getLoginBonusView } from '@/lib/event-login';

export const dynamic = 'force-dynamic';

async function memberIdFromRequest(
  request: Request,
): Promise<{ memberId: string } | { error: NextResponse }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      error: NextResponse.json(
        { error: '電話番号認証が必要です' },
        { status: 401 },
      ),
    };
  }
  try {
    const decoded = await authAdmin.verifyIdToken(authHeader.slice(7));
    if (typeof decoded.phone_number !== 'string' || !decoded.phone_number) {
      return {
        error: NextResponse.json(
          { error: '電話番号認証が必要です' },
          { status: 401 },
        ),
      };
    }
    return { memberId: memberIdForPhone(decoded.phone_number) };
  } catch {
    return {
      error: NextResponse.json(
        { error: '電話番号認証の有効期限が切れています' },
        { status: 401 },
      ),
    };
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const auth = await memberIdFromRequest(request);
  if ('error' in auth) return auth.error;

  const view = await getLoginBonusView(db, eventId, auth.memberId);
  return NextResponse.json({ loginBonus: view });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const auth = await memberIdFromRequest(request);
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
