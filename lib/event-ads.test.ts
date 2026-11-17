// lib/event-ads.test.ts
// 店舗広告の純粋ロジック: 内容の検証、申請→承認／却下の状態遷移
// （掲載版は承認まで変わらない）、掲載可否（無料／有料）と公開選定。
import { describe, expect, it } from 'vitest';
import {
  adStatusOf,
  approveAdTransition,
  emptyShopAd,
  isAdEligible,
  isAdsActionAllowed,
  parseShopAd,
  rejectAdTransition,
  selectPublicAds,
  submitAdTransition,
  validateAdContentInput,
  type AdsGatedAction,
  type PublicAdCandidate,
  type ShopAd,
  type ShopAdContent,
} from './event-ads';

const CONTENT_A: ShopAdContent = {
  imageUrl: 'https://example.com/a.jpg',
  title: '広告A',
  text: '本文A',
  linkUrl: 'https://example.com/a',
};
const CONTENT_B: ShopAdContent = {
  imageUrl: null,
  title: '広告B',
  text: '',
  linkUrl: null,
};
const T1 = '2026-11-17T01:00:00.000Z';
const T2 = '2026-11-17T02:00:00.000Z';
const T3 = '2026-11-17T03:00:00.000Z';

describe('validateAdContentInput', () => {
  it('最小の入力（タイトルだけ）を通し、前後空白を落とす', () => {
    const result = validateAdContentInput({ title: '  セール開催中  ' });
    expect(result).toEqual({
      ok: true,
      value: { imageUrl: null, title: 'セール開催中', text: '', linkUrl: null },
    });
  });

  it('タイトルが空・未指定ならエラー', () => {
    expect(validateAdContentInput({ title: '  ' }).ok).toBe(false);
    expect(validateAdContentInput({}).ok).toBe(false);
    expect(validateAdContentInput(null).ok).toBe(false);
    expect(validateAdContentInput('x').ok).toBe(false);
  });

  it('タイトル41文字・本文201文字はエラー、ちょうど上限は通る', () => {
    expect(validateAdContentInput({ title: 'あ'.repeat(41) }).ok).toBe(false);
    expect(validateAdContentInput({ title: 'あ'.repeat(40) }).ok).toBe(true);
    expect(
      validateAdContentInput({ title: 't', text: 'あ'.repeat(201) }).ok,
    ).toBe(false);
    expect(
      validateAdContentInput({ title: 't', text: 'あ'.repeat(200) }).ok,
    ).toBe(true);
  });

  it('リンク・画像は https のみ（http はエラー）', () => {
    expect(
      validateAdContentInput({ title: 't', linkUrl: 'http://example.com' }).ok,
    ).toBe(false);
    expect(
      validateAdContentInput({ title: 't', linkUrl: 'https://example.com' }).ok,
    ).toBe(true);
    expect(
      validateAdContentInput({ title: 't', imageUrl: 'http://example.com/x.jpg' })
        .ok,
    ).toBe(false);
  });
});

describe('広告の状態遷移（申請→承認／却下）', () => {
  it('保存すると申請版になり、掲載版は変わらない', () => {
    const submitted = submitAdTransition(emptyShopAd(), CONTENT_A, T1);
    expect(submitted.pending).toEqual(CONTENT_A);
    expect(submitted.pendingSubmittedAt).toBe(T1);
    expect(submitted.live).toBeNull();
    expect(adStatusOf(submitted)).toBe('pending');

    // 掲載中の広告がある状態で再申請しても、掲載版はそのまま
    const live: ShopAd = { ...submitted, live: CONTENT_B, approvedAt: T1 };
    const resubmitted = submitAdTransition(live, CONTENT_A, T2);
    expect(resubmitted.live).toEqual(CONTENT_B);
    expect(resubmitted.pending).toEqual(CONTENT_A);
    expect(adStatusOf(resubmitted)).toBe('pending');
  });

  it('承認すると申請版が掲載版に繰り上がる', () => {
    const submitted = submitAdTransition(emptyShopAd(), CONTENT_A, T1);
    const approved = approveAdTransition(submitted, T2);
    expect(approved).not.toBeNull();
    expect(approved!.live).toEqual(CONTENT_A);
    expect(approved!.pending).toBeNull();
    expect(approved!.pendingSubmittedAt).toBeNull();
    expect(approved!.approvedAt).toBe(T2);
    expect(adStatusOf(approved!)).toBe('live');
  });

  it('申請版が無ければ承認は null（何も起きない）', () => {
    expect(approveAdTransition(emptyShopAd(), T1)).toBeNull();
    const liveOnly: ShopAd = {
      ...emptyShopAd(),
      live: CONTENT_A,
      approvedAt: T1,
    };
    expect(approveAdTransition(liveOnly, T2)).toBeNull();
  });

  it('却下すると申請版は破棄され、掲載版は残り、却下日時が付く', () => {
    const live: ShopAd = {
      ...emptyShopAd(),
      live: CONTENT_B,
      approvedAt: T1,
    };
    const submitted = submitAdTransition(live, CONTENT_A, T2);
    const rejected = rejectAdTransition(submitted, T3);
    expect(rejected).not.toBeNull();
    expect(rejected!.pending).toBeNull();
    expect(rejected!.live).toEqual(CONTENT_B);
    expect(rejected!.lastRejectedAt).toBe(T3);
    expect(adStatusOf(rejected!)).toBe('live');
  });

  it('申請版が無ければ却下は null', () => {
    expect(rejectAdTransition(emptyShopAd(), T1)).toBeNull();
  });

  it('parseShopAd は保存値を防御的に読み、壊れた内容は落とす', () => {
    const parsed = parseShopAd({
      live: CONTENT_A,
      pending: { title: '申請中', text: '', imageUrl: null, linkUrl: null },
      pendingSubmittedAt: T2,
      approvedAt: T1,
      lastRejectedAt: null,
    });
    expect(parsed.live).toEqual(CONTENT_A);
    expect(parsed.pending?.title).toBe('申請中');
    expect(parseShopAd(undefined)).toEqual(emptyShopAd());
    expect(parseShopAd({ live: { title: '' } }).live).toBeNull();
  });
});

describe('isAdEligible（掲載可否）', () => {
  it('広告が無効、または料金未設定なら出さない', () => {
    expect(
      isAdEligible({ adsEnabled: false, adsPrice: 0, subscriptionStatus: null }),
    ).toBe(false);
    expect(
      isAdEligible({ adsEnabled: true, adsPrice: null, subscriptionStatus: 'active' }),
    ).toBe(false);
  });

  it('料金 0（無料）の間は課金を見ずに掲載できる', () => {
    expect(
      isAdEligible({ adsEnabled: true, adsPrice: 0, subscriptionStatus: null }),
    ).toBe(true);
    expect(
      isAdEligible({ adsEnabled: true, adsPrice: 0, subscriptionStatus: 'canceled' }),
    ).toBe(true);
  });

  it('有料の間は契約状態が active / past_due の店だけ', () => {
    expect(
      isAdEligible({ adsEnabled: true, adsPrice: 3000, subscriptionStatus: 'active' }),
    ).toBe(true);
    expect(
      isAdEligible({ adsEnabled: true, adsPrice: 3000, subscriptionStatus: 'past_due' }),
    ).toBe(true);
    expect(
      isAdEligible({ adsEnabled: true, adsPrice: 3000, subscriptionStatus: 'canceled' }),
    ).toBe(false);
    expect(
      isAdEligible({ adsEnabled: true, adsPrice: 3000, subscriptionStatus: 'unpaid' }),
    ).toBe(false);
    expect(
      isAdEligible({ adsEnabled: true, adsPrice: 3000, subscriptionStatus: null }),
    ).toBe(false);
  });
});

describe('isAdsActionAllowed（広告オプションのゲート）', () => {
  const ACTIONS: AdsGatedAction[] = [
    'enable-setting',
    'submit',
    'checkout',
    'review',
    'public-list',
  ];

  it('オプション無効なら、設定が ON でもすべての操作ができない', () => {
    for (const action of ACTIONS) {
      expect(
        isAdsActionAllowed(action, { adsOptionEnabled: false, adsEnabled: true }),
      ).toBe(false);
      expect(
        isAdsActionAllowed(action, { adsOptionEnabled: false, adsEnabled: false }),
      ).toBe(false);
    }
  });

  it('オプション有効＋設定 ON なら、すべての操作ができる', () => {
    for (const action of ACTIONS) {
      expect(
        isAdsActionAllowed(action, { adsOptionEnabled: true, adsEnabled: true }),
      ).toBe(true);
    }
  });

  it('オプション有効＋設定 OFF では、有効化だけができて他はできない', () => {
    expect(
      isAdsActionAllowed('enable-setting', {
        adsOptionEnabled: true,
        adsEnabled: false,
      }),
    ).toBe(true);
    for (const action of ACTIONS.filter((a) => a !== 'enable-setting')) {
      expect(
        isAdsActionAllowed(action, { adsOptionEnabled: true, adsEnabled: false }),
      ).toBe(false);
    }
  });
});

describe('selectPublicAds（公開一覧の選定）', () => {
  function candidate(
    partial: Partial<PublicAdCandidate> & { exhibitorId: string },
  ): PublicAdCandidate {
    return {
      shopName: `店${partial.exhibitorId}`,
      isSponsor: false,
      ad: { ...emptyShopAd(), live: CONTENT_A, approvedAt: T1 },
      listed: true,
      subscriptionStatus: 'active',
      ...partial,
    };
  }

  it('広告が無効なら空', () => {
    expect(
      selectPublicAds([candidate({ exhibitorId: 'a' })], {
        adsEnabled: false,
        adsPrice: 0,
        adsSlots: 5,
      }),
    ).toEqual([]);
  });

  it('承認が早い順に並び、枠数で切る', () => {
    const ads = selectPublicAds(
      [
        candidate({
          exhibitorId: 'late',
          ad: { ...emptyShopAd(), live: CONTENT_B, approvedAt: T3 },
        }),
        candidate({
          exhibitorId: 'early',
          ad: { ...emptyShopAd(), live: CONTENT_A, approvedAt: T1 },
        }),
        candidate({
          exhibitorId: 'mid',
          ad: { ...emptyShopAd(), live: CONTENT_A, approvedAt: T2 },
        }),
      ],
      { adsEnabled: true, adsPrice: 3000, adsSlots: 2 },
    );
    expect(ads.map((ad) => ad.exhibitorId)).toEqual(['early', 'mid']);
    expect(ads[0]).toEqual({
      exhibitorId: 'early',
      shopName: '店early',
      isSponsor: false,
      imageUrl: CONTENT_A.imageUrl,
      title: CONTENT_A.title,
      text: CONTENT_A.text,
      linkUrl: CONTENT_A.linkUrl,
    });
  });

  it('掲載版が無い・非公開の店・有料で未契約の店は出ない', () => {
    const ads = selectPublicAds(
      [
        candidate({
          exhibitorId: 'no-live',
          ad: { ...emptyShopAd(), pending: CONTENT_A, pendingSubmittedAt: T1 },
        }),
        candidate({ exhibitorId: 'unlisted', listed: false }),
        candidate({ exhibitorId: 'unpaid', subscriptionStatus: 'unpaid' }),
        candidate({ exhibitorId: 'ok' }),
      ],
      { adsEnabled: true, adsPrice: 3000, adsSlots: 5 },
    );
    expect(ads.map((ad) => ad.exhibitorId)).toEqual(['ok']);
  });

  it('料金 0 の間は未契約の店も出る（承認だけでよい）', () => {
    const ads = selectPublicAds(
      [candidate({ exhibitorId: 'free', subscriptionStatus: null })],
      { adsEnabled: true, adsPrice: 0, adsSlots: 5 },
    );
    expect(ads.map((ad) => ad.exhibitorId)).toEqual(['free']);
  });

  it('協賛の広告には isSponsor が立ち、枠は参加店と共有される', () => {
    const ads = selectPublicAds(
      [
        candidate({
          exhibitorId: 'sponsor-1',
          shopName: '協賛企業',
          isSponsor: true,
          ad: { ...emptyShopAd(), live: CONTENT_B, approvedAt: T1 },
        }),
        candidate({
          exhibitorId: 'shop-1',
          ad: { ...emptyShopAd(), live: CONTENT_A, approvedAt: T2 },
        }),
        candidate({
          exhibitorId: 'shop-2',
          ad: { ...emptyShopAd(), live: CONTENT_A, approvedAt: T3 },
        }),
      ],
      { adsEnabled: true, adsPrice: 3000, adsSlots: 2 },
    );
    // 承認順に2枠まで。協賛も同じ枠を取り合う
    expect(ads.map((ad) => ad.exhibitorId)).toEqual(['sponsor-1', 'shop-1']);
    expect(ads[0].isSponsor).toBe(true);
    expect(ads[0].shopName).toBe('協賛企業');
    expect(ads[1].isSponsor).toBe(false);
  });

  it('協賛の広告ライフサイクルは参加店と同じ遷移で動く', () => {
    // 状態遷移はアカウント種別に依存しない（同じ関数を使う）
    const submitted = submitAdTransition(emptyShopAd(), CONTENT_A, T1);
    const approved = approveAdTransition(submitted, T2);
    expect(approved!.live).toEqual(CONTENT_A);
    const resubmitted = submitAdTransition(approved!, CONTENT_B, T3);
    const rejected = rejectAdTransition(resubmitted, T3);
    expect(rejected!.live).toEqual(CONTENT_A);
    expect(rejected!.pending).toBeNull();
  });
});
