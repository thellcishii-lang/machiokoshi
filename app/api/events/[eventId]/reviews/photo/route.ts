// app/api/events/[eventId]/reviews/photo/route.ts
// レビュー写真のアップロード（来場者）。電話番号認証＋購読者確認のうえ、
// Admin SDK で Storage に保存し、表示用 URL を返す。
// 保存先: events/{eventId}/review-photos/{memberId}/{uuid}.{ext}
// 検証（jpg/png/webp、1枚5MBまで）は lib/event-review.ts の純粋関数。
// 書き込みは Admin SDK 経由のみで、storage.rules 側は読み取りだけを
// 公開する（クライアントからの直接書き込みは許可しない）。
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';
import { authAdmin, db } from '@/lib/firebase-admin';
import { EVENT_SUBCOLLECTIONS } from '@/lib/event';
import { memberIdForPhone } from '@/lib/event-coupon';
import {
  reviewPhotoStoragePath,
  validateReviewPhoto,
} from '@/lib/event-review';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: '電話番号認証が必要です' }, { status: 401 });
  }
  let memberId: string;
  try {
    const decoded = await authAdmin.verifyIdToken(authHeader.slice(7));
    if (typeof decoded.phone_number !== 'string' || !decoded.phone_number) {
      return NextResponse.json({ error: '電話番号認証が必要です' }, { status: 401 });
    }
    memberId = memberIdForPhone(decoded.phone_number);
  } catch {
    return NextResponse.json(
      { error: '電話番号認証の有効期限が切れています' },
      { status: 401 },
    );
  }

  // 購読者でない電話番号ではアップロードできない
  const subscriberSnap = await db
    .collection('events')
    .doc(eventId)
    .collection(EVENT_SUBCOLLECTIONS.subscribers)
    .doc(memberId)
    .get();
  if (!subscriberSnap.exists) {
    return NextResponse.json(
      { error: 'このプロジェクトに登録していません' },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'リクエスト形式が不正です' },
      { status: 400 },
    );
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file が必要です' }, { status: 400 });
  }

  const validation = validateReviewPhoto({
    contentType: file.type,
    size: file.size,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const storagePath = reviewPhotoStoragePath(
    eventId,
    memberId,
    `${randomUUID()}.${validation.extension}`,
  );
  try {
    const bucket = getStorage().bucket();
    const storedFile = bucket.file(storagePath);
    const buffer = Buffer.from(await file.arrayBuffer());
    await storedFile.save(buffer, {
      metadata: { contentType: file.type },
    });
    await storedFile.makePublic();
    const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    return NextResponse.json({ url, storagePath });
  } catch (error) {
    console.error('[reviews/photo] Storage 保存に失敗:', error);
    return NextResponse.json(
      { error: '写真のアップロードに失敗しました' },
      { status: 500 },
    );
  }
}
