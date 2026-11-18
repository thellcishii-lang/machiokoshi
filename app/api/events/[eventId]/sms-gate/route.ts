// app/api/events/[eventId]/sms-gate/route.ts
// SMS 送信直前のゲート（SMSオン契約だけが使う）。
//
// 電話認証はクライアント側 Firebase で行われるため、サーバーは送信
// そのものを観測できない。来場者画面は SMS を送る直前にこの API を
// 叩き、契約の SMSカード残高ミラーに残高がある場合だけ送信へ進む。
// ゲートを通過した時点で消費1件として数える（本家の登録ゲートと
// 同じ「送信リクエスト時点で数える」近似。再送も送信のたびに数える）。
// 消費は lib/sms-mirror.ts がミラーを減らし、tick が本家へ報告する。
//
// この API は認証前の来場者が叩くため Authorization は見ない。
// 悪用（残高を枯らす目的の連打）はレート制限で抑える。SMSオフ契約・
// 残高ゼロでは 403 を返し、画面は送信へ進まない（フェイルクローズド）。
import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getEvent } from '@/lib/event-store';
import { findOrganizerByOwnerUid } from '@/lib/organizers';
import { tryConsumeSmsSend } from '@/lib/sms-mirror';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const retryAfter = await enforceRateLimit(request, 'sms-gate', 20, 60 * 1000);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: 'レート制限を超えました' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const { eventId } = await params;
  const event = await getEvent(eventId);
  if (!event) {
    return NextResponse.json({ error: 'イベントが見つかりません' }, { status: 404 });
  }

  const organizer = await findOrganizerByOwnerUid(event.ownerUid);
  if (!organizer || organizer.smsAuthEnabled !== true) {
    return NextResponse.json(
      { error: 'SMS認証は有効になっていません' },
      { status: 403 },
    );
  }

  const decision = await tryConsumeSmsSend(organizer.contractId);
  if (decision === 'exhausted') {
    return NextResponse.json(
      { error: 'SMSの残高が不足しています' },
      { status: 403 },
    );
  }
  if (decision !== 'ok') {
    return NextResponse.json(
      { error: 'SMS認証は有効になっていません' },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
