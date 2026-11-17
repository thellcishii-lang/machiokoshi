// app/api/events/[eventId]/shop-ad/route.ts
// 特設サイト広告の自店向け状態取得（GET）と広告内容の保存＝申請（PUT）。
// 実行できるのは参加店セッションだけ（自店分のみ）。
// GET: プロジェクトの広告設定・課金状態・自店の広告（掲載版／申請版）を返す。
// PUT: 内容を検証して「申請中（pending）」として保存する。掲載中（live）
// は管理人が承認するまで変わらない（lib/event-ads.ts）。
// 料金 0（無料）の間は課金を一切見ず、承認だけで掲載される。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import {
  getAdPlacement,
  getShopAd,
  isAdEligible,
  isAdSubscribedForStatus,
  resolveAdAvailability,
  submitShopAd,
  validateAdContentInput,
} from '@/lib/event-ads';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;
  const { event, exhibitor } = guard;

  const [ad, placement] = await Promise.all([
    getShopAd(db, eventId, exhibitor.id),
    getAdPlacement(db, eventId, exhibitor.id),
  ]);
  const freeMode = event.adsEnabled && event.adsPrice === 0;
  // 有料の間だけ、課金レール（オプション＋Stripe）が揃っているかを見る
  let purchasable = false;
  if (event.adsEnabled && event.adsPrice !== null && event.adsPrice > 0) {
    const availability = await resolveAdAvailability(db, event.ownerUid);
    purchasable = availability.available;
  }
  const eligible = isAdEligible({
    adsEnabled: event.adsEnabled,
    adsPrice: event.adsPrice,
    subscriptionStatus: placement?.status ?? null,
  });

  return NextResponse.json({
    // プロジェクトの広告設定（公開情報と同じ値）
    enabled: event.adsEnabled,
    price: event.adsPrice,
    slots: event.adsSlots,
    // 料金 0: 課金なしで承認だけで掲載される
    freeMode,
    // 今この店が申し込める状態かどうか（有料の間のみ意味を持つ）
    available: purchasable,
    // 自店の契約状態（未申込なら status は null）
    status: placement?.status ?? null,
    subscribed: placement ? isAdSubscribedForStatus(placement.status) : false,
    monthlyAmount: placement?.monthlyAmount ?? null,
    // 掲載可否（算出済み: 無料なら承認だけで true になりうる）
    eligible,
    // 自店の広告（掲載版・申請版・却下履歴）
    ad,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;
  const { event, exhibitor } = guard;

  if (!event.adsEnabled) {
    return NextResponse.json(
      { error: 'このプロジェクトでは広告を受け付けていません' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエスト形式が不正です' },
      { status: 400 },
    );
  }
  const validation = validateAdContentInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await submitShopAd(db, eventId, exhibitor.id, validation.value);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, ad: result.ad });
}
