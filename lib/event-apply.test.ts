// lib/event-apply.test.ts
// 自己申込: 入力検証・3ヶ月ルール・既存レコードの判断・Checkout
// セッションの解釈といった純粋関数と、フェイク Firestore ＋フェイク
// Stripe による申込の状態遷移（pending → 支払い → 実体化）を検証する。
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  applyApplicationWebhookEffect,
  decideExistingExhibitor,
  effectFromStripeEventForApplication,
  getApplication,
  getApplyPageInfo,
  interpretApplicationCheckoutSession,
  isDelistedExpired,
  materializeApplication,
  parseApplicationInput,
  startAdApplication,
  startShopApplication,
  verifyAndApplyApplication,
  type ApplyDeps,
  type StripeCheckoutClient,
} from './event-apply';
import type { StripeWebhookEventLike } from './event-billing';
import type { AdAvailability } from './event-ads';
import type { Organizer } from './organizers';
import { ExhibitorAccessError } from './exhibitor-access';

const EVENT_ID = 'event-1';
const CONTRACT_ID = 'contract-1';

// ─── 純粋関数 ───

describe('parseApplicationInput', () => {
  it('名前とメールを正規化する（trim・小文字化）', () => {
    expect(
      parseApplicationInput({ name: '  店A  ', email: ' Shop@Example.COM ' }),
    ).toEqual({ ok: true, value: { name: '店A', email: 'shop@example.com' } });
  });

  it('名前が無ければエラー', () => {
    const result = parseApplicationInput({ name: ' ', email: 'a@b.co' });
    expect(result.ok).toBe(false);
  });

  it('メール形式が不正ならエラー', () => {
    expect(parseApplicationInput({ name: '店A', email: 'not-mail' }).ok).toBe(
      false,
    );
    expect(parseApplicationInput({ name: '店A' }).ok).toBe(false);
    expect(parseApplicationInput(null).ok).toBe(false);
  });
});

describe('isDelistedExpired（掲載停止の3ヶ月ルール）', () => {
  const now = new Date('2026-11-17T00:00:00.000Z');

  it('未設定・解釈できない日時は false', () => {
    expect(isDelistedExpired(null, now)).toBe(false);
    expect(isDelistedExpired('not-a-date', now)).toBe(false);
  });

  it('3ヶ月未満は false、ちょうど3ヶ月で true', () => {
    expect(isDelistedExpired('2026-08-18T00:00:00.000Z', now)).toBe(false);
    expect(isDelistedExpired('2026-08-17T00:00:00.001Z', now)).toBe(false);
    expect(isDelistedExpired('2026-08-17T00:00:00.000Z', now)).toBe(true);
    expect(isDelistedExpired('2026-05-01T00:00:00.000Z', now)).toBe(true);
  });

  it('月末日からの加算は翌々月へ繰り越す（保持が長くなる側）', () => {
    // 1/31 + 3ヶ月 → 4/31 が無いため 5/1 に繰り越す
    const delisted = '2026-01-31T00:00:00.000Z';
    expect(isDelistedExpired(delisted, new Date('2026-04-30T23:59:59.000Z'))).toBe(
      false,
    );
    expect(isDelistedExpired(delisted, new Date('2026-05-01T00:00:00.000Z'))).toBe(
      true,
    );
  });
});

describe('decideExistingExhibitor', () => {
  const now = new Date('2026-11-17T00:00:00.000Z');
  const base = {
    id: 'exh-1',
    kind: 'shop' as const,
    billingSuspended: false,
    delistedAt: null,
    closedAt: null,
  };

  it('レコードが無ければ none', () => {
    expect(decideExistingExhibitor(null, now)).toEqual({ action: 'none' });
  });

  it('閉店済みレコードは存在しないものとして扱う', () => {
    expect(
      decideExistingExhibitor({ ...base, closedAt: '2026-11-01T00:00:00.000Z' }, now),
    ).toEqual({ action: 'none' });
  });

  it('通常の登録済みは already-registered で断る', () => {
    expect(decideExistingExhibitor(base, now)).toEqual({
      action: 'reject',
      reason: 'already-registered',
    });
  });

  it('掲載停止中（3ヶ月未満）は delisted で断る', () => {
    expect(
      decideExistingExhibitor(
        { ...base, billingSuspended: true, delistedAt: '2026-10-01T00:00:00.000Z' },
        now,
      ),
    ).toEqual({ action: 'reject', reason: 'delisted' });
    // delistedAt が無い旧来の停止レコードも delisted として断る
    expect(
      decideExistingExhibitor({ ...base, billingSuspended: true }, now),
    ).toEqual({ action: 'reject', reason: 'delisted' });
  });

  it('掲載停止から3ヶ月経過で close-and-proceed', () => {
    expect(
      decideExistingExhibitor(
        { ...base, billingSuspended: true, delistedAt: '2026-08-17T00:00:00.000Z' },
        now,
      ),
    ).toEqual({ action: 'close-and-proceed', exhibitorId: 'exh-1' });
  });
});

describe('Checkout セッションの解釈と Webhook 効果', () => {
  const session = {
    id: 'cs_1',
    mode: 'subscription',
    payment_status: 'paid',
    customer: 'cus_1',
    subscription: 'sub_1',
    metadata: {
      kind: 'shop-registration',
      eventId: EVENT_ID,
      applicationId: 'app-1',
      exhibitorId: 'exh-planned',
    },
  };

  it('参加店登録のセッションを解釈する', () => {
    const interpreted = interpretApplicationCheckoutSession(session);
    expect(interpreted).toMatchObject({
      sessionId: 'cs_1',
      kind: 'shop-registration',
      type: 'shop',
      eventId: EVENT_ID,
      applicationId: 'app-1',
      plannedExhibitorId: 'exh-planned',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      paid: true,
    });
  });

  it('広告申込のセッションは type が advertiser になる', () => {
    const interpreted = interpretApplicationCheckoutSession({
      ...session,
      metadata: { ...session.metadata, kind: 'ad-application' },
    });
    expect(interpreted?.type).toBe('advertiser');
  });

  it('対象外のセッションは null（kind 違い・都度払い・metadata 欠落）', () => {
    expect(
      interpretApplicationCheckoutSession({
        ...session,
        metadata: { ...session.metadata, kind: 'ad-placement' },
      }),
    ).toBeNull();
    expect(
      interpretApplicationCheckoutSession({ ...session, mode: 'payment' }),
    ).toBeNull();
    expect(
      interpretApplicationCheckoutSession({
        ...session,
        metadata: { kind: 'shop-registration' },
      }),
    ).toBeNull();
  });

  it('未払いセッションは paid: false', () => {
    expect(
      interpretApplicationCheckoutSession({ ...session, payment_status: 'unpaid' })
        ?.paid,
    ).toBe(false);
  });

  it('Webhook 効果は支払い済みの完了イベントだけ', () => {
    const event: StripeWebhookEventLike = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      created: 1_762_000_000,
      data: { object: session },
    };
    expect(effectFromStripeEventForApplication(event)?.applicationId).toBe('app-1');
    expect(
      effectFromStripeEventForApplication({
        ...event,
        data: { object: { ...session, payment_status: 'unpaid' } },
      }),
    ).toBeNull();
    expect(
      effectFromStripeEventForApplication({ ...event, type: 'invoice.paid' }),
    ).toBeNull();
  });
});

// ─── フェイク Firestore ───

type DocData = Record<string, unknown>;

function createFakeDb() {
  const store = new Map<string, DocData>();
  let autoId = 0;
  const clone = (value: DocData): DocData =>
    JSON.parse(JSON.stringify(value)) as DocData;

  function docRef(path: string): Record<string, unknown> {
    const id = path.split('/').pop()!;
    return {
      id,
      path,
      get: async () => {
        const data = store.get(path);
        return {
          exists: data !== undefined,
          id,
          data: () => (data ? clone(data) : undefined),
        };
      },
      set: async (data: DocData, options?: { merge?: boolean }) => {
        if (options?.merge && store.has(path)) {
          store.set(path, { ...store.get(path)!, ...clone(data) });
        } else {
          store.set(path, clone(data));
        }
      },
      update: async (data: DocData) => {
        if (!store.has(path)) throw new Error(`更新対象がありません: ${path}`);
        store.set(path, { ...store.get(path)!, ...clone(data) });
      },
      create: async (data: DocData) => {
        if (store.has(path)) {
          const error = new Error('already exists') as Error & { code?: number };
          error.code = 6;
          throw error;
        }
        store.set(path, clone(data));
      },
      delete: async () => {
        store.delete(path);
      },
      collection: (name: string) => collectionRef(`${path}/${name}`),
    };
  }

  function collectionRef(path: string): Record<string, unknown> {
    const filters: Array<[string, unknown]> = [];
    const self: Record<string, unknown> = {
      doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
      where: (field: string, _op: string, value: unknown) => {
        filters.push([field, value]);
        return self;
      },
      limit: (_n: number) => self,
      get: async () => {
        const docs: Array<Record<string, unknown>> = [];
        for (const [docPath, data] of store.entries()) {
          if (!docPath.startsWith(`${path}/`)) continue;
          const rest = docPath.slice(path.length + 1);
          if (rest.includes('/')) continue;
          if (filters.every(([field, value]) => data[field] === value)) {
            docs.push({
              id: rest,
              data: () => clone(data),
              ref: docRef(docPath),
            });
          }
        }
        return { docs, empty: docs.length === 0 };
      },
    };
    return self;
  }

  const db = {
    collection: (name: string) => collectionRef(name),
    runTransaction: async (
      fn: (tx: {
        get: (ref: never) => Promise<unknown>;
        update: (ref: never, data: DocData) => Promise<void>;
      }) => Promise<unknown>,
    ) =>
      fn({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        update: (ref: { update: (data: DocData) => Promise<void> }, data: DocData) =>
          ref.update(data),
      }),
  };
  return { db: db as unknown as Firestore, store };
}

// ─── フェイク Stripe ───

interface FakeSession {
  id: string;
  mode: string;
  payment_status: string;
  customer: string;
  subscription: string;
  metadata: Record<string, string>;
  amount_total: number;
}

function createFakeStripe() {
  const sessions = new Map<string, FakeSession>();
  let sessionSeq = 0;
  let customerSeq = 0;
  const client: StripeCheckoutClient = {
    customers: {
      create: async () => ({ id: `cus_${++customerSeq}` }),
    },
    checkout: {
      sessions: {
        create: async (params) => {
          const id = `cs_${++sessionSeq}`;
          const record = params as {
            mode: string;
            customer: string;
            metadata: Record<string, string>;
            line_items: Array<{ price_data: { unit_amount: number } }>;
          };
          sessions.set(id, {
            id,
            mode: record.mode,
            payment_status: 'unpaid',
            customer: record.customer,
            subscription: `sub_${id}`,
            metadata: record.metadata,
            amount_total: record.line_items[0].price_data.unit_amount,
          });
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
        retrieve: async (id) => {
          const session = sessions.get(id);
          if (!session) throw new Error('session not found');
          return session;
        },
      },
    },
  };
  return {
    client,
    sessions,
    markPaid: (id: string) => {
      const session = sessions.get(id);
      if (session) session.payment_status = 'paid';
    },
    lastSessionId: () => `cs_${sessionSeq}`,
  };
}

// ─── テスト用の依存一式 ───

function setup(options?: {
  shopMonthlyPrice?: number | null;
  adsPrice?: number | null;
  adsEnabled?: boolean;
  billingAvailable?: boolean;
  billingOptionEnabled?: boolean;
  adsOptionEnabled?: boolean;
}) {
  const { db, store } = createFakeDb();
  const stripe = createFakeStripe();
  const registerCalls: Array<Record<string, unknown>> = [];

  store.set(`events/${EVENT_ID}`, {
    name: 'テストプロジェクト',
    ownerUid: 'owner-1',
    defaultLocale: 'ja',
    shopMonthlyPrice:
      options?.shopMonthlyPrice === undefined ? 3000 : options.shopMonthlyPrice,
    adsEnabled: options?.adsEnabled ?? true,
    adsPrice: options?.adsPrice === undefined ? 5000 : options.adsPrice,
  });
  store.set(`organizers/${CONTRACT_ID}/billing/stripe`, {
    secretKey: 'sk_test_abcdefghijklmnop',
    webhookSecret: 'whsec_abcdefghijklmnop',
  });

  const deps: Partial<ApplyDeps> = {
    resolveAvailability: async () =>
      ({
        available: options?.billingAvailable ?? true,
        organizer:
          (options?.billingAvailable ?? true)
            ? ({
                contractId: CONTRACT_ID,
                billingOptionEnabled: options?.billingOptionEnabled ?? false,
              } as unknown as Organizer)
            : null,
        stripeConfigured: options?.billingAvailable ?? true,
      }) as AdAvailability,
    resolveAdsOption: async () => options?.adsOptionEnabled ?? true,
    stripeFactory: () => stripe.client,
    register: async (input) => {
      registerCalls.push({ ...input });
      const exhibitorId = input.exhibitorId!;
      // 実物と同じく、同じメールの未閉店レコードがあれば衝突にする
      for (const [path, data] of store.entries()) {
        if (
          path.startsWith(`events/${EVENT_ID}/exhibitors/`) &&
          data.email === input.email &&
          !data.closedAt
        ) {
          throw new ExhibitorAccessError(
            'そのメールアドレスはこのプロジェクトで既に登録されています',
            400,
          );
        }
      }
      store.set(`events/${EVENT_ID}/exhibitors/${exhibitorId}`, {
        name: input.name,
        email: input.email,
        lang: 'ja',
        kind: input.kind ?? 'shop',
        source: input.source ?? 'admin',
      });
      return { exhibitorId, email: input.email, mailSent: true };
    },
  };

  const exhibitorDocs = () =>
    [...store.entries()]
      .filter(([path]) => path.startsWith(`events/${EVENT_ID}/exhibitors/`))
      .map(([path, data]) => ({ id: path.split('/').pop()!, data }));
  const applicationDocs = () =>
    [...store.entries()]
      .filter(([path]) => path.startsWith(`events/${EVENT_ID}/applications/`))
      .map(([path, data]) => ({ id: path.split('/').pop()!, data }));

  return { db, store, stripe, deps, registerCalls, exhibitorDocs, applicationDocs };
}

function completedEventFor(session: FakeSession): StripeWebhookEventLike {
  return {
    id: `evt_${session.id}`,
    type: 'checkout.session.completed',
    created: 1_762_000_000,
    data: { object: { ...session } },
  };
}

// ─── 申込の状態遷移 ───

describe('参加店の自己登録（有料）', () => {
  it('申込 → 支払い待ち（参加店レコードはまだ無い）→ Webhook で実体化', async () => {
    const { db, store, stripe, deps, registerCalls, exhibitorDocs } = setup();

    const started = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    expect(started.ok).toBe(true);
    if (!started.ok || started.status !== 'pending') throw new Error('pendingのはず');
    expect(started.checkoutUrl).toContain('checkout.stripe.test');
    // 支払い確認前は参加店レコードを作らない
    expect(exhibitorDocs()).toHaveLength(0);
    // 課金レコードは予定 ID で作られ、金額が固定される
    const application = await getApplication(db, EVENT_ID, started.applicationId);
    expect(application?.status).toBe('pending');
    expect(application?.amount).toBe(3000);
    const billing = store.get(
      `events/${EVENT_ID}/shopBillings/${application!.plannedExhibitorId}`,
    );
    expect(billing).toMatchObject({ monthlyAmount: 3000, status: 'none' });

    // 支払い完了 → Webhook で実体化
    const session = stripe.sessions.get(stripe.lastSessionId())!;
    stripe.markPaid(session.id);
    const applied = await applyApplicationWebhookEffect(
      db,
      completedEventFor(session),
      deps,
    );
    expect(applied).toEqual({ applied: true, duplicate: false });
    expect(exhibitorDocs()).toHaveLength(1);
    expect(exhibitorDocs()[0].data).toMatchObject({
      email: 'shop@example.com',
      kind: 'shop',
      source: 'self',
    });
    expect(registerCalls).toHaveLength(1);
    const completed = await getApplication(db, EVENT_ID, started.applicationId);
    expect(completed?.status).toBe('completed');
    expect(completed?.mailSent).toBe(true);
    // 課金レコードにサブスクリプションが紐づく
    expect(
      store.get(`events/${EVENT_ID}/shopBillings/${application!.plannedExhibitorId}`),
    ).toMatchObject({ stripeSubscriptionId: `sub_${session.id}` });

    // Webhook の再送では二重に作らない・メールも送らない
    const again = await applyApplicationWebhookEffect(
      db,
      completedEventFor(session),
      deps,
    );
    expect(again).toEqual({ applied: false, duplicate: true });
    expect(exhibitorDocs()).toHaveLength(1);
    expect(registerCalls).toHaveLength(1);
  });

  it('戻り照会（verify）でも実体化でき、Webhook と二重にならない', async () => {
    const { db, stripe, deps, registerCalls, exhibitorDocs } = setup();
    const started = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    if (!started.ok) throw new Error('開始できるはず');
    const session = stripe.sessions.get(stripe.lastSessionId())!;

    // 未払いの照会は 402
    const unpaid = await verifyAndApplyApplication(
      db,
      { eventId: EVENT_ID, sessionId: session.id },
      deps,
    );
    expect(unpaid).toMatchObject({ ok: false, status: 402 });
    expect(exhibitorDocs()).toHaveLength(0);

    stripe.markPaid(session.id);
    const verified = await verifyAndApplyApplication(
      db,
      { eventId: EVENT_ID, sessionId: session.id },
      deps,
    );
    expect(verified).toMatchObject({ ok: true, type: 'shop' });
    expect(exhibitorDocs()).toHaveLength(1);

    const webhook = await applyApplicationWebhookEffect(
      db,
      completedEventFor(session),
      deps,
    );
    expect(webhook.duplicate).toBe(true);
    expect(registerCalls).toHaveLength(1);
  });

  it('支払い待ちの申込は再開できる（申込レコードは増えない）', async () => {
    const { db, deps, applicationDocs } = setup();
    const first = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    const second = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('開始できるはず');
    expect(second.applicationId).toBe(first.applicationId);
    expect(applicationDocs()).toHaveLength(1);
  });
});

describe('参加店の自己登録（無料・前提条件・重複）', () => {
  it('料金 0 は支払いなしでその場で登録が完了する', async () => {
    const { db, store, deps, exhibitorDocs } = setup({ shopMonthlyPrice: 0 });
    const started = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    expect(started).toMatchObject({ ok: true, status: 'completed' });
    expect(exhibitorDocs()).toHaveLength(1);
    expect(exhibitorDocs()[0].data.source).toBe('self');
    // 無料の課金レコード（月額0・active）が残る
    expect(
      store.get(`events/${EVENT_ID}/shopBillings/${exhibitorDocs()[0].id}`),
    ).toMatchObject({ monthlyAmount: 0, status: 'active' });
  });

  it('料金未設定（null）や課金レール未整備では受け付けない（404）', async () => {
    const noPrice = setup({ shopMonthlyPrice: null });
    expect(
      await startShopApplication(
        noPrice.db,
        EVENT_ID,
        { name: '店A', email: 'shop@example.com' },
        noPrice.deps,
      ),
    ).toMatchObject({ ok: false, status: 404 });

    const noRail = setup({ billingAvailable: false });
    expect(
      await startShopApplication(
        noRail.db,
        EVENT_ID,
        { name: '店A', email: 'shop@example.com' },
        noRail.deps,
      ),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it('登録済みメールは 400 で断る', async () => {
    const { db, store, deps } = setup();
    store.set(`events/${EVENT_ID}/exhibitors/exh-1`, {
      name: '既存店',
      email: 'shop@example.com',
      kind: 'shop',
    });
    const result = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('掲載停止中（3ヶ月未満）のメールは断る', async () => {
    const { db, store, deps } = setup();
    store.set(`events/${EVENT_ID}/exhibitors/exh-1`, {
      name: '停止中の店',
      email: 'shop@example.com',
      kind: 'shop',
      billingSuspended: true,
      delistedAt: '2026-10-20T00:00:00.000Z',
    });
    const result = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('掲載停止から3ヶ月経過したメールは、旧レコードを閉店にして新規登録できる', async () => {
    const { db, store, deps, exhibitorDocs } = setup({ shopMonthlyPrice: 0 });
    // 4ヶ月前に掲載停止になった店（delistedAt は実行時点から見て十分に過去）
    const longAgo = new Date();
    longAgo.setUTCMonth(longAgo.getUTCMonth() - 4);
    store.set(`events/${EVENT_ID}/exhibitors/old-1`, {
      name: '旧店',
      email: 'shop@example.com',
      kind: 'shop',
      billingSuspended: true,
      delistedAt: longAgo.toISOString(),
      profile: { displayName: '旧店の情報' },
    });

    const started = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A（新）', email: 'shop@example.com' },
      deps,
    );
    expect(started).toMatchObject({ ok: true, status: 'completed' });

    // 旧レコードは閉店印が付き、内容は残る
    const old = store.get(`events/${EVENT_ID}/exhibitors/old-1`);
    expect(typeof old?.closedAt).toBe('string');
    expect(old?.profile).toEqual({ displayName: '旧店の情報' });
    // 新レコードは別 ID で作られる
    const docs = exhibitorDocs();
    expect(docs).toHaveLength(2);
    const fresh = docs.find((doc) => doc.id !== 'old-1');
    expect(fresh?.data).toMatchObject({ email: 'shop@example.com', source: 'self' });
  });
});

describe('参加店の自己登録（住所・店舗課金オプション）', () => {
  it('オプション ON で住所が無いと 400（申込レコードも作らない）', async () => {
    const { db, deps, applicationDocs } = setup({ billingOptionEnabled: true });
    const result = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (!result.ok) expect(result.error).toContain('住所');
    expect(applicationDocs()).toHaveLength(0);
  });

  it('オプション ON で住所が上限（120文字）を超えると 400', async () => {
    const { db, deps } = setup({ billingOptionEnabled: true });
    const result = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com', address: 'あ'.repeat(121) },
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (!result.ok) expect(result.error).toContain('120');
  });

  it('オプション ON＋住所あり（無料）: 申込レコードに保持され、実体化で登録へ渡る', async () => {
    const { db, deps, registerCalls } = setup({
      billingOptionEnabled: true,
      shopMonthlyPrice: 0,
    });
    const started = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com', address: '埼玉県飯能市テスト1-2-3' },
      deps,
    );
    expect(started).toMatchObject({ ok: true, status: 'completed' });
    if (!started.ok) throw new Error('開始できるはず');
    const application = await getApplication(db, EVENT_ID, started.applicationId);
    expect(application?.address).toBe('埼玉県飯能市テスト1-2-3');
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0].address).toBe('埼玉県飯能市テスト1-2-3');
  });

  it('オプション ON＋住所あり（有料）: 支払い待ちの申込に住所が残り、Webhook 実体化で渡る', async () => {
    const { db, stripe, deps, registerCalls } = setup({
      billingOptionEnabled: true,
    });
    const started = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com', address: '東京都テスト区テスト4-5-6' },
      deps,
    );
    if (!started.ok || started.status !== 'pending') throw new Error('pendingのはず');
    const application = await getApplication(db, EVENT_ID, started.applicationId);
    expect(application?.address).toBe('東京都テスト区テスト4-5-6');
    expect(registerCalls).toHaveLength(0);

    const session = stripe.sessions.get(stripe.lastSessionId())!;
    stripe.markPaid(session.id);
    const applied = await applyApplicationWebhookEffect(
      db,
      completedEventFor(session),
      deps,
    );
    expect(applied.applied).toBe(true);
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0].address).toBe('東京都テスト区テスト4-5-6');
  });

  it('オプション OFF では住所なしで登録でき、登録へ住所は渡らない', async () => {
    const { db, deps, registerCalls } = setup({ shopMonthlyPrice: 0 });
    const started = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    expect(started).toMatchObject({ ok: true, status: 'completed' });
    if (!started.ok) throw new Error('開始できるはず');
    const application = await getApplication(db, EVENT_ID, started.applicationId);
    expect(application?.address).toBeNull();
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0].address).toBeUndefined();
  });
});

describe('広告の自己申込', () => {
  it('申込 → 支払い → Webhook で協賛レコードが作られる', async () => {
    const { db, store, stripe, deps, exhibitorDocs } = setup();
    const started = await startAdApplication(
      db,
      EVENT_ID,
      { name: '協賛企業', email: 'sponsor@example.com' },
      deps,
    );
    expect(started.ok).toBe(true);
    if (!started.ok || started.status !== 'pending') throw new Error('pendingのはず');
    expect(exhibitorDocs()).toHaveLength(0);
    const application = await getApplication(db, EVENT_ID, started.applicationId);
    expect(application?.amount).toBe(5000);
    expect(
      store.get(`events/${EVENT_ID}/adPlacements/${application!.plannedExhibitorId}`),
    ).toMatchObject({ monthlyAmount: 5000, status: 'unpaid' });

    const session = stripe.sessions.get(stripe.lastSessionId())!;
    stripe.markPaid(session.id);
    const applied = await applyApplicationWebhookEffect(
      db,
      completedEventFor(session),
      deps,
    );
    expect(applied.applied).toBe(true);
    expect(exhibitorDocs()).toHaveLength(1);
    expect(exhibitorDocs()[0].data).toMatchObject({
      email: 'sponsor@example.com',
      kind: 'advertiser',
      source: 'self',
    });
    expect(
      store.get(`events/${EVENT_ID}/adPlacements/${application!.plannedExhibitorId}`),
    ).toMatchObject({ stripeSubscriptionId: `sub_${session.id}` });
  });

  it('料金 0 は支払いなしでその場で完了する', async () => {
    const { db, deps, exhibitorDocs } = setup({ adsPrice: 0 });
    const started = await startAdApplication(
      db,
      EVENT_ID,
      { name: '協賛企業', email: 'sponsor@example.com' },
      deps,
    );
    expect(started).toMatchObject({ ok: true, status: 'completed' });
    expect(exhibitorDocs()[0].data.kind).toBe('advertiser');
  });

  it('広告オプション無効・広告 OFF・料金未設定では受け付けない（404）', async () => {
    const noOption = setup({ adsOptionEnabled: false });
    expect(
      await startAdApplication(
        noOption.db,
        EVENT_ID,
        { name: '協賛', email: 'sponsor@example.com' },
        noOption.deps,
      ),
    ).toMatchObject({ ok: false, status: 404 });

    const disabled = setup({ adsEnabled: false });
    expect(
      await startAdApplication(
        disabled.db,
        EVENT_ID,
        { name: '協賛', email: 'sponsor@example.com' },
        disabled.deps,
      ),
    ).toMatchObject({ ok: false, status: 404 });

    const noPrice = setup({ adsPrice: null });
    expect(
      await startAdApplication(
        noPrice.db,
        EVENT_ID,
        { name: '協賛', email: 'sponsor@example.com' },
        noPrice.deps,
      ),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it('登録済みの協賛メールは 409 でログインへ案内する', async () => {
    const { db, store, deps } = setup();
    store.set(`events/${EVENT_ID}/exhibitors/adv-1`, {
      name: '協賛企業',
      email: 'sponsor@example.com',
      kind: 'advertiser',
    });
    const result = await startAdApplication(
      db,
      EVENT_ID,
      { name: '協賛企業', email: 'sponsor@example.com' },
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) expect(result.error).toContain('ログイン');
  });
});

describe('materializeApplication の冪等性', () => {
  it('完了済みの申込を再び実体化しても何も起きない', async () => {
    const { db, deps, registerCalls } = setup({ shopMonthlyPrice: 0 });
    const started = await startShopApplication(
      db,
      EVENT_ID,
      { name: '店A', email: 'shop@example.com' },
      deps,
    );
    if (!started.ok) throw new Error('開始できるはず');
    const again = await materializeApplication(db, EVENT_ID, started.applicationId, undefined, deps);
    expect(again).toMatchObject({ ok: true, alreadyCompleted: true });
    expect(registerCalls).toHaveLength(1);
  });
});

describe('getApplyPageInfo', () => {
  it('受付可否と料金を返す', async () => {
    const { db, deps } = setup();
    const info = await getApplyPageInfo(db, EVENT_ID, deps);
    expect(info).toMatchObject({
      eventName: 'テストプロジェクト',
      shop: { available: true, fee: 3000 },
      ad: { available: true, fee: 5000 },
    });
  });

  it('店舗課金オプション ON のときだけ billingAddressRequired が立つ', async () => {
    const on = setup({ billingOptionEnabled: true });
    const onInfo = await getApplyPageInfo(on.db, EVENT_ID, on.deps);
    expect(onInfo?.shop.billingAddressRequired).toBe(true);

    const off = setup();
    const offInfo = await getApplyPageInfo(off.db, EVENT_ID, off.deps);
    expect(offInfo?.shop.billingAddressRequired).toBe(false);
  });

  it('広告オプションが無効なら広告は受付不可、料金未設定なら店舗登録は受付不可', async () => {
    const { db, deps } = setup({ adsOptionEnabled: false, shopMonthlyPrice: null });
    const info = await getApplyPageInfo(db, EVENT_ID, deps);
    expect(info?.ad.available).toBe(false);
    expect(info?.shop.available).toBe(false);
  });
});
