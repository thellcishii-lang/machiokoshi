// app/api/events/[eventId]/site-settings/route.ts
// 特設サイト（本家上の公開ページ）の表示内容の取得・保存（管理人本人だけ）。
// 保存先はプロジェクトドキュメントのトップレベル項目
// （siteDescription / heroImageUrl / siteNotes）。
// 検証・正規化は lib/event-site.ts の純粋関数に寄せ、updateEvent 経由で
// 保存する（リンク等の既存項目と同じ経路）。
import { NextResponse } from 'next/server';
import { requireEventOwner } from '@/lib/event-auth';
import { updateEvent } from '@/lib/event-store';
import {
  normalizeHeroImageUrl,
  normalizeSiteDescription,
  normalizeSiteNotes,
  type SiteSettings,
} from '@/lib/event-site';

export const dynamic = 'force-dynamic';

function currentSettings(event: {
  siteDescription: string;
  heroImageUrl: string | null;
  siteNotes: SiteSettings['siteNotes'];
}): SiteSettings {
  return {
    siteDescription: event.siteDescription,
    heroImageUrl: event.heroImageUrl,
    siteNotes: event.siteNotes,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventOwner(request, eventId);
  if ('error' in guard) return guard.error;
  return NextResponse.json(currentSettings(guard.event));
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventOwner(request, eventId);
  if ('error' in guard) return guard.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'リクエスト形式が不正です' },
      { status: 400 },
    );
  }

  let settings: SiteSettings;
  try {
    settings = {
      siteDescription: normalizeSiteDescription(body.siteDescription),
      heroImageUrl: normalizeHeroImageUrl(body.heroImageUrl),
      siteNotes: normalizeSiteNotes(body.siteNotes),
    };
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : '入力内容が不正です',
      },
      { status: 400 },
    );
  }

  try {
    await updateEvent(eventId, settings);
  } catch (error) {
    console.error('[site-settings] 保存に失敗:', error);
    return NextResponse.json(
      { error: '特設サイト設定の保存に失敗しました' },
      { status: 500 },
    );
  }
  return NextResponse.json(settings);
}
