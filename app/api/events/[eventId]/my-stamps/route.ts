// app/api/events/[eventId]/my-stamps/route.ts
// 来場者本人のスタンプカード（現在の周の進捗と無料クーポン）。
// 認証方式に応じたトークンから本人を特定する（my-claims と同じ作法、
// lib/event-member-auth.ts）。購読者でない場合は card: null
// （画面には何も出さない）。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { memberIdFromRequest } from '@/lib/event-member-auth';
import { getStampCard } from '@/lib/event-stamp';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  const auth = await memberIdFromRequest(request, eventId);
  if ('error' in auth) return auth.error;

  const card = await getStampCard(db, eventId, auth.memberId);
  return NextResponse.json({ card });
}
