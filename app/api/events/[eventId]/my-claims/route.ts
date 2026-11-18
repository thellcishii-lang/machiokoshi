// app/api/events/[eventId]/my-claims/route.ts
// 来場者本人の取得済みクーポン一覧。認証方式に応じたトークンから
// 本人を特定する（lib/event-member-auth.ts）。
import { NextResponse } from 'next/server';
import { listClaimsByMember } from '@/lib/event-coupon';
import { memberIdFromRequest } from '@/lib/event-member-auth';
import { isLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  const auth = await memberIdFromRequest(request, eventId);
  if ('error' in auth) return auth.error;

  const langParam = new URL(request.url).searchParams.get('lang');
  const claims = await listClaimsByMember(
    eventId,
    auth.memberId,
    isLocale(langParam) ? langParam : undefined,
  );
  return NextResponse.json({ claims });
}
