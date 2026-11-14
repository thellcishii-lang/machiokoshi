// app/api/events/[eventId]/stamps/[stampId]/route.ts
// スタンプの取消し（押し間違い対応）。取り消せる条件はサーバー側
// （lib/event-stamp の evaluateStampCancel）で判定する:
// 自店が・当日（JST）に・現在の周で押したスタンプだけ。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import { cancelStamp } from '@/lib/event-stamp';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string; stampId: string }> },
) {
  const { eventId, stampId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;

  const result = await cancelStamp(db, {
    eventId,
    exhibitor: guard.exhibitor,
    stampId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, stampId: result.stampId });
}
