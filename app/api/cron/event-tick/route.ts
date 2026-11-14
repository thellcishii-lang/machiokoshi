// app/api/cron/event-tick/route.ts
// Push-taro 町おこし の15分間隔スケジューラ。
// 外部のスケジューラ（Cloud Scheduler 等）から15分ごとに叩く前提。
//
// 町おこしのプロジェクトは常設のため、EVENT にあった終了処理（データ消去）と
// 日次リセットは行わない。tick の役割は2つ:
// 1. 予約配信の実行: 到期した campaign を開催中プロジェクトごとに処理する。
// 2. 週次ランキングの補完: 「直近で完了した週」のランキングが未保存の
//    プロジェクトについて計算して保存する（冪等な catch-up）。
// プロジェクトごとに try/catch し、1プロジェクトの失敗が他プロジェクトの処理を止めない。
// ランキングの失敗も配信とは独立に局所化する。
import { NextResponse } from 'next/server';
import { isValidCronRequest } from '@/lib/cron-auth';
import { db } from '@/lib/firebase-admin';
import { listLiveEvents } from '@/lib/event-store';
import { processDueCampaigns } from '@/lib/event-push';
import { ensurePreviousWeekRanking } from '@/lib/event-ranking';
import { recordTickRun, type TickRunInput } from '@/lib/tick-runs';
import { dispatchOperatorAlerts } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';

/** 実行記録とアラート送信。監視系の失敗で tick 本体を止めないため、例外は握りつぶす。 */
async function recordAndAlert(stats: TickRunInput) {
  try {
    await recordTickRun(stats);
  } catch {
    // 記録の失敗は無視する（次回 tick で改めて記録される）
  }
  try {
    await dispatchOperatorAlerts(new Date());
  } catch {
    // アラートの失敗は無視する（状態が残るので次回 tick で送り直される）
  }
}

export async function GET(req: Request) {
  if (!isValidCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAtMs = Date.now();
  const now = new Date();
  const campaignsSent: Array<{ eventId: string; sent: number }> = [];
  const errors: Array<{ eventId: string; message: string }> = [];

  try {
    const events = await listLiveEvents();

    for (const event of events) {
      try {
        const sent = await processDueCampaigns(event.id, now);
        if (sent > 0) campaignsSent.push({ eventId: event.id, sent });
      } catch (error) {
        errors.push({
          eventId: event.id,
          message: `配信処理に失敗: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      // ランキングの補完は配信と独立。失敗してもこのプロジェクトの
      // 配信結果や、他プロジェクトの処理には影響させない。
      try {
        await ensurePreviousWeekRanking(db, event, now);
      } catch (error) {
        errors.push({
          eventId: event.id,
          message: `ランキング計算に失敗: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    await recordAndAlert({
      ok: true,
      durationMs: Date.now() - startedAtMs,
      eventsProcessed: events.length,
      campaignsSent: campaignsSent.reduce((sum, c) => sum + c.sent, 0),
      errorsCount: errors.length,
    });

    return NextResponse.json({
      ok: true,
      campaignsSent,
      errors,
    });
  } catch (error) {
    await recordAndAlert({
      ok: false,
      durationMs: Date.now() - startedAtMs,
      eventsProcessed: 0,
      campaignsSent: campaignsSent.reduce((sum, c) => sum + c.sent, 0),
      errorsCount: errors.length + 1,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        campaignsSent,
        errors,
      },
      { status: 500 },
    );
  }
}
