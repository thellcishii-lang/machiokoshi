// lib/sms-mirror.ts
// SMSカード残高のアプリ側ミラーと、本家への SMS 消費報告。
//
// 前提（2026-11-18 決定）: お客さんの登録の本人確認は、契約ごとの
// データ上のスイッチ organizers.smsAuthEnabled で切り替える。既定は
// false（端末認証）で、その間このモジュールの処理は一切動かない。
// true の契約だけが SMS 電話登録になり、下記のミラー契約が効く。
// 画面にトグルは無い（設定はプロビジョニング／運営側のデータ変更のみ）。
//
// 本家とのミラー契約（本家 lib/sms-card.ts、 honke PR #51）:
// - 本家 → アプリ: プロビジョニング payload の任意項目 smsBalance
//   （絶対値）と smsAuthEnabled。smsBalance が送られてきたらミラーを
//   上書きする。ただし本家の絶対値は「まだ報告していない消費」を
//   知らないため、上書き時に未報告分（smsPendingCount）を差し引く
//   （applyProvisionedSmsBalance）。
// - アプリ → 本家: SMS 送信が成功するたびに消費を数え、署名付き
//   POST /api/sms-consumption { contractId, count, reportId } で
//   バッチ報告する。本家は reportId で冪等に残高から差し引く。
//   署名はプロビジョニングと同一方式（lib/hmac.ts: HMAC-SHA256(hex)
//   over `${timestamp}.${rawBody}`、ヘッダ X-Event-Key-Id /
//   X-Event-Timestamp / X-Event-Signature）。鍵はこのアプリが発行した
//   連携APIキー（lib/api-keys.ts）を共用する。
// - アプリ側は送信のたびにミラーを1件減らしてゲートに使うため、
//   報告の遅延があっても登録可否はミラーで判定できる。
//
// 消費の数え方（本家 PR #53 と同じ近似）: 電話認証はクライアント側
// Firebase のため、サーバーは送信そのものを観測できない。来場者画面が
// SMS を送る直前にゲート API（/api/events/[eventId]/sms-gate）を叩き、
// その時点で1件消費として数える。再送も送信のたびに数える。
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { computeSignature } from './hmac';
import {
  findActiveApiKey,
  findLatestActiveApiKey,
  type ApiKeyRecord,
} from './api-keys';
import { HONKE_BASE_URL } from './special-site';

const ORGANIZERS_COLLECTION = 'organizers';
export const SMS_USAGE_REPORTS_COLLECTION = 'smsUsageReports';

/** 件数フィールドの防御的な読み取り（未設定・不正値は 0）。 */
function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/**
 * プロビジョニングで送られてきた残高（絶対値）の無害化（純粋関数）。
 * 有限の0以上の数だけを通し、それ以外は undefined（無かったことにする）。
 */
export function sanitizeSmsBalance(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

/**
 * 本家から絶対値が届いたときのミラーの取り込み（純粋関数）。
 * 本家の台帳は未報告の消費を知らないため、その分を差し引いてから
 * ミラーにする（報告済みになれば次の絶対値と一致していく）。
 */
export function applyProvisionedSmsBalance(
  absoluteBalance: number,
  pendingCount: number,
): number {
  return Math.max(0, Math.floor(absoluteBalance) - normalizeCount(pendingCount));
}

export type SmsGateDecision = 'ok' | 'exhausted' | 'disabled';

/** 送信ゲートの判定（純粋関数）。SMSオフは 'disabled'、残高0は 'exhausted'。 */
export function evaluateSmsGate(input: {
  smsAuthEnabled: unknown;
  smsBalance: unknown;
}): SmsGateDecision {
  if (input.smsAuthEnabled !== true) return 'disabled';
  return normalizeCount(input.smsBalance) > 0 ? 'ok' : 'exhausted';
}

/**
 * SMS 送信1件分の消費をミラーへ記録する（送信直前のゲート）。
 * 残高を1件減らし、未報告分を1件増やす（トランザクション）。
 * 残高が無い・SMSオフ・契約が無い場合は消費せず理由を返す。
 */
export async function tryConsumeSmsSend(
  contractId: string,
): Promise<SmsGateDecision> {
  const ref = db.collection(ORGANIZERS_COLLECTION).doc(contractId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'disabled' as const;
    const data = snap.data()!;
    const decision = evaluateSmsGate({
      smsAuthEnabled: data.smsAuthEnabled,
      smsBalance: data.smsBalance,
    });
    if (decision !== 'ok') return decision;
    tx.update(ref, {
      smsBalance: normalizeCount(data.smsBalance) - 1,
      smsPendingCount: normalizeCount(data.smsPendingCount) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return 'ok' as const;
  });
}

/** 本家への消費報告ボディ（純粋関数）。reportId が冪等キーになる。 */
export function buildSmsConsumptionReport(
  contractId: string,
  count: number,
  reportId: string,
): { contractId: string; count: number; reportId: string } {
  return { contractId, count, reportId };
}

/**
 * 消費報告の署名に使う連携APIキー。
 * 環境変数 HONKE_SMS_REPORT_KEY_ID でキーIDを指定できればそれを使い、
 * 無ければ有効なキーのうち最も新しいものを使う（本家は通常、最新の
 * 発行キーを保持して検証するため）。
 */
export async function resolveSmsReportSigningKey(
  env: Record<string, string | undefined> = process.env,
): Promise<ApiKeyRecord | null> {
  const specified = env.HONKE_SMS_REPORT_KEY_ID;
  if (specified) {
    const key = await findActiveApiKey(specified);
    if (key) return key;
  }
  return findLatestActiveApiKey();
}

export interface SmsUsageFlushSummary {
  sent: number;
  failed: number;
  /** 署名キーが無くて送れなかった契約数 */
  skipped: number;
}

/**
 * 未報告の消費を本家へまとめて報告する（tick から呼ぶ）。
 * 契約ごとに「未送信の報告ドキュメント」を1件だけ持ち、失敗しても
 * 次回は同じ reportId で再送する（本家側で冪等に処理される）。
 * 1契約の失敗が他契約の報告を止めないよう、例外は契約単位で受ける。
 */
export async function flushSmsUsageReports(): Promise<SmsUsageFlushSummary> {
  const snap = await db
    .collection(ORGANIZERS_COLLECTION)
    .where('smsPendingCount', '>', 0)
    .limit(20)
    .get();
  if (snap.empty) return { sent: 0, failed: 0, skipped: 0 };

  const key = await resolveSmsReportSigningKey();
  if (!key) return { sent: 0, failed: 0, skipped: snap.size };

  let sent = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    try {
      const ok = await flushOrganizerSmsUsage(doc.id, key);
      if (ok) sent += 1;
      else failed += 1;
    } catch (error) {
      console.warn('[sms-mirror] 消費報告に失敗:', doc.id, error);
      failed += 1;
    }
  }
  return { sent, failed, skipped: 0 };
}

async function flushOrganizerSmsUsage(
  contractId: string,
  key: ApiKeyRecord,
): Promise<boolean> {
  const reportsRef = db.collection(SMS_USAGE_REPORTS_COLLECTION);
  const pendingSnap = await reportsRef
    .where('contractId', '==', contractId)
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  let reportRef: FirebaseFirestore.DocumentReference;
  let count: number;
  if (!pendingSnap.empty) {
    reportRef = pendingSnap.docs[0].ref;
    count = normalizeCount(pendingSnap.docs[0].data().count);
    if (count <= 0) return false;
  } else {
    const organizerSnap = await db
      .collection(ORGANIZERS_COLLECTION)
      .doc(contractId)
      .get();
    count = normalizeCount(organizerSnap.data()?.smsPendingCount);
    if (count <= 0) return true; // 既に報告済み（競合で先に送られた）
    reportRef = reportsRef.doc(randomUUID());
    await reportRef.set({
      contractId,
      count,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  const rawBody = JSON.stringify(
    buildSmsConsumptionReport(contractId, count, reportRef.id),
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${HONKE_BASE_URL}/api/sms-consumption`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key-Id': key.id,
      'X-Event-Timestamp': timestamp,
      'X-Event-Signature': computeSignature(key.secret, timestamp, rawBody),
    },
    body: rawBody,
  });
  if (!res.ok) return false;

  // 本家が受け付けた（再送で applied=false の場合も本家は受理済み）。
  // 未報告分からこの報告の件数を差し引き、報告を送信済みにする。
  const organizerRef = db.collection(ORGANIZERS_COLLECTION).doc(contractId);
  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(organizerRef);
    const current = normalizeCount(orgSnap.data()?.smsPendingCount);
    tx.update(organizerRef, {
      smsPendingCount: Math.max(0, current - count),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(reportRef, {
      status: 'sent',
      sentAt: FieldValue.serverTimestamp(),
    });
  });
  return true;
}
