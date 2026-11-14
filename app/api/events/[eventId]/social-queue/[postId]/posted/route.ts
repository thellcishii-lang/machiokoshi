// app/api/events/[eventId]/social-queue/[postId]/posted/route.ts
// Muse 用の完了 API。Instagram への投稿が済んだ投稿を
// 「投稿済み」に遷移させる。既に投稿済みでも成功を返す（冪等）。
// 認証は連携キー（ヘッダ X-Queue-Key）。キーが無い・失効・不一致は 401。
// リクエスト本文は任意: { postedUrl?: string }（投稿の URL）。
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import {
  markPostPosted,
  parsePostedUrl,
  verifyQueueKey,
} from '@/lib/event-social';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string; postId: string }> },
) {
  const { eventId, postId } = await params;

  const presented = request.headers.get('X-Queue-Key');
  const verified = await verifyQueueKey(db, eventId, presented);
  if (!verified) {
    return NextResponse.json(
      { error: '連携キーが無効です' },
      { status: 401 },
    );
  }

  // 本文は任意。空（本文なし）も許容し、ある場合は JSON として読む。
  let postedUrl: string | null = null;
  const rawBody = await request.text();
  if (rawBody.trim()) {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'リクエスト形式が不正です' },
        { status: 400 },
      );
    }
    const parsed = parsePostedUrl(body.postedUrl);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    postedUrl = parsed.value;
  }

  const result = await markPostPosted(db, eventId, postId, postedUrl);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    alreadyPosted: result.alreadyPosted,
    post: {
      id: result.post.id,
      status: result.post.status,
      postedAt: result.post.postedAt,
      postedUrl: result.post.postedUrl,
    },
  });
}
