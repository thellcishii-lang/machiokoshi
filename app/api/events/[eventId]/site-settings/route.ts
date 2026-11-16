// app/api/events/[eventId]/site-settings/route.ts
// 特設サイト（本家上の公開ページ）の表示内容の取得・保存（管理人本人だけ）。
// 保存先はプロジェクトドキュメントのトップレベル項目
// （siteDescription / gourmetDefinition / heroImageUrl / siteIconUrl /
// themeColor / siteNotes / topPlacementEnabled / topPlacementPrice）。
// 検証・正規化は lib/event-site.ts と lib/event.ts の純粋関数に寄せ、
// updateEvent 経由で保存する（リンク等の既存項目と同じ経路）。
import { NextResponse } from 'next/server';
import { requireEventOwner } from '@/lib/event-auth';
import { updateEvent } from '@/lib/event-store';
import {
  normalizeGourmetDefinition,
  normalizeHeroImageUrl,
  normalizeSiteDescription,
  normalizeSiteIconUrl,
  normalizeSiteNotes,
  normalizeThemeColor,
  type SiteSettings,
} from '@/lib/event-site';
import {
  normalizeTopPlacementEnabled,
  normalizeTopPlacementPrice,
} from '@/lib/event';

export const dynamic = 'force-dynamic';

/** 特設サイト設定一式（表示内容＋トップ掲載設定）。 */
interface SiteSettingsResponse extends SiteSettings {
  /** トップ掲載（先頭5枠）課金の ON/OFF */
  topPlacementEnabled: boolean;
  /** トップ掲載の月額料金（円）。未設定は null */
  topPlacementPrice: number | null;
}

function currentSettings(event: {
  siteDescription: string;
  gourmetDefinition: string;
  heroImageUrl: string | null;
  siteIconUrl: string | null;
  themeColor: string | null;
  siteNotes: SiteSettings['siteNotes'];
  topPlacementEnabled: boolean;
  topPlacementPrice: number | null;
}): SiteSettingsResponse {
  return {
    siteDescription: event.siteDescription,
    gourmetDefinition: event.gourmetDefinition,
    heroImageUrl: event.heroImageUrl,
    siteIconUrl: event.siteIconUrl,
    themeColor: event.themeColor,
    siteNotes: event.siteNotes,
    topPlacementEnabled: event.topPlacementEnabled,
    topPlacementPrice: event.topPlacementPrice,
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

  let settings: SiteSettingsResponse;
  try {
    settings = {
      siteDescription: normalizeSiteDescription(body.siteDescription),
      gourmetDefinition: normalizeGourmetDefinition(body.gourmetDefinition),
      heroImageUrl: normalizeHeroImageUrl(body.heroImageUrl),
      siteIconUrl: normalizeSiteIconUrl(body.siteIconUrl),
      themeColor: normalizeThemeColor(body.themeColor),
      siteNotes: normalizeSiteNotes(body.siteNotes),
      topPlacementEnabled: normalizeTopPlacementEnabled(
        body.topPlacementEnabled,
      ),
      topPlacementPrice: normalizeTopPlacementPrice(body.topPlacementPrice),
    };
    // トップ掲載を有効にするなら料金が必須（料金なしでは店が買えない）。
    if (settings.topPlacementEnabled && settings.topPlacementPrice === null) {
      throw new Error('トップ掲載を有効にする場合は、掲載料金を設定してください');
    }
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
