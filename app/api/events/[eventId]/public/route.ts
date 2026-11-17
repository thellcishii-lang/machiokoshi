// app/api/events/[eventId]/public/route.ts
// 来場者向けの公開情報。登録前の来場者が見るため認証なしで返すが、
//返すのは表示に必要な最小項目だけ（所有者uidなどは出さない）。
import { NextResponse } from 'next/server';
import { getEvent } from '@/lib/event-store';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const event = await getEvent(eventId);
  if (!event) {
    return NextResponse.json({ error: 'イベントが見つかりません' }, { status: 404 });
  }
  return NextResponse.json({
    event: {
      name: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
      status: event.status,
      resetMode: event.resetMode,
      defaultLocale: event.defaultLocale,
      // 入場用QRの取り込みが有効かどうか（来場者画面の表示制御に使う）
      admissionQrEnabled: event.admissionQrEnabled,
      // スタンプ達成特典の種類と内容（特設サイトの達成特典の表示に使う。
      // 未設定のプロジェクトでは 'free-dish' / '' になる）
      stampRewardType: event.stampRewardType,
      stampBenefitText: event.stampBenefitText,
      // 主催者リンク（最大3件、タイトル付きで来場者画面に表示する）
      links: event.links,
      // 特設サイト（本家）の表示内容。読み取り時に正規化済みの値を返す
      // （未設定のプロジェクトでは '' / null / [] になる）
      siteDescription: event.siteDescription,
      // ご当地グルメの定義（未設定は空文字）
      gourmetDefinition: event.gourmetDefinition,
      heroImageUrl: event.heroImageUrl,
      // ヘッダーに表示する正方形アイコン（未設定は null）
      siteIconUrl: event.siteIconUrl,
      // テーマカラー（#rrggbb、未設定は null で表示側の既定色）
      themeColor: event.themeColor,
      siteNotes: event.siteNotes,
      // トップ掲載（先頭5枠）課金の設定。本家は enabled が false の間は
      // 各店の topFeatured を無視し、true の間は優先表示に使う。
      // 料金は店舗ページの申込表示にも使う（未設定は null）。
      // 料金 0 は無料: topFeatured は参加表明ベースで算出済みのため、
      // 本家は従来どおり topFeatured だけを見ればよい。
      topPlacementEnabled: event.topPlacementEnabled,
      topPlacementPrice: event.topPlacementPrice,
      // 毎日ログインボーナスの設定（特設サイトの案内表示に使う。
      // 未設定のプロジェクトでは false / 7 になる）
      loginBonusEnabled: event.loginBonusEnabled,
      loginBonusDays: event.loginBonusDays,
      // 特設サイトの広告ページの設定。広告そのものは
      // /api/events/{eventId}/ads/public が返す（枠数まで・承認順）。
      // 料金 0 は無料（承認だけで掲載される。未設定は null）。
      adsEnabled: event.adsEnabled,
      adsSlots: event.adsSlots,
      adsPrice: event.adsPrice,
    },
  });
}
