// app/api/events/[eventId]/apply/route.ts
// 自己申込ページ（参加店登録・広告申込）の表示に必要な公開情報。
// 認証なしで返すが、返すのは受付可否と料金だけ（可否の判定材料である
// 契約・Stripe 設定の状態そのものは出さない）。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { getApplyPageInfo } from '@/lib/event-apply';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const info = await getApplyPageInfo(db, eventId);
  if (!info) {
    return NextResponse.json(
      { error: 'プロジェクトが見つかりません' },
      { status: 404 },
    );
  }
  return NextResponse.json(info);
}
