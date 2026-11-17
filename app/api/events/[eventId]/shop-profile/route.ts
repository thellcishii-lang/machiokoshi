// app/api/events/[eventId]/shop-profile/route.ts
// 店舗プロフィールの取得・保存（店舗専用ページ用）。
// 実行できるのは参加店セッションだけ（自店のプロフィールのみ）。
// 店がここで入れた情報は、特設サイトの店舗ページとアプリの店舗表示に
// そのまま反映される（データは exhibitor ドキュメントの profile 1つ）。
import { NextResponse } from 'next/server';
import { requireEventExhibitor } from '@/lib/event-auth';
import { db } from '@/lib/firebase-admin';
import {
  getShopProfile,
  updateShopProfile,
  validateShopProfileInput,
} from '@/lib/event-shop';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;

  const profile = await getShopProfile(db, eventId, guard.exhibitor.id);
  return NextResponse.json({
    profile,
    exhibitor: { id: guard.exhibitor.id, name: guard.exhibitor.name },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const guard = await requireEventExhibitor(request, eventId);
  if ('error' in guard) return guard.error;
  // 協賛（広告専用）アカウントは店舗プロフィールを持たない
  if (guard.exhibitor.kind === 'advertiser') {
    return NextResponse.json(
      { error: '協賛アカウントは店舗プロフィールを編集できません' },
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
  const validation = validateShopProfileInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await updateShopProfile(
    db,
    eventId,
    guard.exhibitor.id,
    validation.value,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({ profile: result.profile });
}
