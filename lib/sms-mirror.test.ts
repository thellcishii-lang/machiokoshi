// lib/sms-mirror.test.ts
// SMSカード残高ミラーの純粋関数と、本家への消費報告の署名形式
// （本家 lib/sms-card.ts のミラー契約と一致すること）を検証する。
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyProvisionedSmsBalance,
  buildSmsConsumptionReport,
  evaluateSmsGate,
  sanitizeSmsBalance,
} from './sms-mirror';
import { computeSignature } from './hmac';

describe('sanitizeSmsBalance（プロビジョニング値の無害化）', () => {
  it('0以上の有限数だけを通し、小数は切り捨てる', () => {
    expect(sanitizeSmsBalance(100)).toBe(100);
    expect(sanitizeSmsBalance(0)).toBe(0);
    expect(sanitizeSmsBalance(10.9)).toBe(10);
  });

  it('負数・非数値・非有限は undefined（無かったことにする）', () => {
    expect(sanitizeSmsBalance(-1)).toBeUndefined();
    expect(sanitizeSmsBalance('100')).toBeUndefined();
    expect(sanitizeSmsBalance(Number.NaN)).toBeUndefined();
    expect(sanitizeSmsBalance(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(sanitizeSmsBalance(undefined)).toBeUndefined();
    expect(sanitizeSmsBalance(null)).toBeUndefined();
  });
});

describe('evaluateSmsGate（送信ゲートの判定）', () => {
  it('SMSオン＋残高ありは ok', () => {
    expect(evaluateSmsGate({ smsAuthEnabled: true, smsBalance: 5 })).toBe('ok');
  });

  it('SMSオン＋残高0は exhausted', () => {
    expect(evaluateSmsGate({ smsAuthEnabled: true, smsBalance: 0 })).toBe(
      'exhausted',
    );
    expect(evaluateSmsGate({ smsAuthEnabled: true, smsBalance: undefined })).toBe(
      'exhausted',
    );
  });

  it('SMSオフ（既定）は残高があっても disabled', () => {
    expect(evaluateSmsGate({ smsAuthEnabled: false, smsBalance: 5 })).toBe(
      'disabled',
    );
    expect(evaluateSmsGate({ smsAuthEnabled: undefined, smsBalance: 5 })).toBe(
      'disabled',
    );
  });
});

describe('applyProvisionedSmsBalance（絶対値の取り込み）', () => {
  it('未報告の消費が無ければ絶対値そのまま', () => {
    expect(applyProvisionedSmsBalance(100, 0)).toBe(100);
  });

  it('未報告分は差し引く（本家の絶対値は未報告消費を知らないため）', () => {
    expect(applyProvisionedSmsBalance(100, 30)).toBe(70);
  });

  it('差し引きで負にはならない', () => {
    expect(applyProvisionedSmsBalance(10, 30)).toBe(0);
  });
});

describe('消費報告の形式（本家とのミラー契約）', () => {
  it('ボディは contractId / count / reportId の3項目', () => {
    expect(buildSmsConsumptionReport('contract-1', 12, 'report-1')).toEqual({
      contractId: 'contract-1',
      count: 12,
      reportId: 'report-1',
    });
  });

  it('署名は HMAC-SHA256(hex) over `${timestamp}.${rawBody}`（本家の検証と同一方式）', () => {
    const secret = 'test-secret';
    const timestamp = '1763462400';
    const rawBody = JSON.stringify(
      buildSmsConsumptionReport('contract-1', 12, 'report-1'),
    );
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    expect(computeSignature(secret, timestamp, rawBody)).toBe(expected);
  });
});
