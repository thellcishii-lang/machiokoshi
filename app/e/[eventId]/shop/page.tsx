'use client';

// app/e/[eventId]/shop/page.tsx
// Push-taro 町おこし の参加店用 店舗専用ページ。
// 消込画面（redeem）と同じログイン作法（メール+プロジェクト専用
// アクセスコード → カスタムトークンのセッション）で入り、自店の
// プロフィールを編集する。入れた情報はデータ1つ（exhibitor の
// profile）から、特設サイトの店舗ページとアプリの店舗表示に反映される。
// 編集できるのは自店分だけ（サーバー側で参加店セッションを検証する）。
// 画面の固定文は4言語辞書（lib/ui-text.ts の REDEEM_TEXT）。
// 出店者の言語は出店者レコードに保存され、次回ログイン時も引き継がれる。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  User,
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { auth } from '@/lib/firebase-client';
import {
  SUPPORTED_LOCALES,
  normalizeLocale,
  type Locale,
} from '@/lib/i18n';
import { redeemText, uiText } from '@/lib/ui-text';
import { specialSiteShopUrl, specialSiteUrl } from '@/lib/special-site';
import PasswordInput from '@/components/PasswordInput';
import PoweredByFooter from '@/components/PoweredByFooter';

interface Exhibitor {
  id: string;
  name: string;
  lang: string;
}

interface ShopProfile {
  displayName: string;
  address: string;
  phone: string;
  hoursText: string;
  menuName: string;
  menuDescription: string;
  description: string;
  photoUrls: string[];
  instagramUrl: string;
  published: boolean;
}

interface TopPlacementState {
  enabled: boolean;
  price: number | null;
  available: boolean;
  status: string | null;
  featured: boolean;
  monthlyAmount: number | null;
}

const EMPTY_PROFILE: ShopProfile = {
  displayName: '',
  address: '',
  phone: '',
  hoursText: '',
  menuName: '',
  menuDescription: '',
  description: '',
  photoUrls: [],
  instagramUrl: '',
  published: true,
};

const PHOTO_MAX = 3;

const VIOLET = '#8B5E34';

// モックの言語セグメントは短い表記（EN など）。保存・送信は従来どおり locale で行う。
const PILL_LABELS: Record<Locale, string> = {
  ja: '日本語',
  en: 'EN',
  zh: '中文',
  ko: '한국어',
};

const containerStyle: React.CSSProperties = {
  padding: '16px 16px 32px',
  maxWidth: 480,
  margin: '0 auto',
  fontFamily: 'sans-serif',
  backgroundColor: '#f8fafc',
  minHeight: '100vh',
  boxSizing: 'border-box',
  color: '#0f172a',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 18,
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '12px 12px',
  marginTop: 6,
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  fontSize: 16,
  backgroundColor: '#ffffff',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginTop: 14,
};

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 20px',
  fontWeight: 700,
  fontSize: 16,
  backgroundColor: VIOLET,
  color: '#ffffff',
  border: 'none',
  borderRadius: 12,
  cursor: 'pointer',
};

const logoutButtonStyle: React.CSSProperties = {
  padding: '7px 13px',
  fontSize: 13.5,
  fontWeight: 700,
  borderRadius: 999,
  border: '1px solid #cbd5e1',
  backgroundColor: '#ffffff',
  color: '#475569',
  cursor: 'pointer',
  flexShrink: 0,
};

export default function ExhibitorShopPage() {
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [locale, setLocale] = useState<Locale>('ja');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [exhibitor, setExhibitor] = useState<Exhibitor | null>(null);
  const [exhibitorError, setExhibitorError] = useState('');
  const [profile, setProfile] = useState<ShopProfile>(EMPTY_PROFILE);
  const [placement, setPlacement] = useState<TopPlacementState | null>(null);
  const [placementBusy, setPlacementBusy] = useState(false);
  const [placementMessage, setPlacementMessage] = useState('');
  const [message, setMessage] = useState('');
  const [messageOk, setMessageOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [eventName, setEventName] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');
  // 初回読み込みはユーザー×プロジェクトで1回だけ（言語切替で callApi の
  // 参照が変わっても、未保存のフォーム内容を読み直して消さないため）。
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`event-locale:${eventId}`);
      if (stored) setLocale(normalizeLocale(stored));
    } catch {
      // 保存が読めなくても日本語で続行する
    }
  }, [eventId]);

  // ヘッダーに出すプロジェクト名は公開情報から取る（ログイン前の画面でも出すため）
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/public`);
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (typeof data.event?.name === 'string') setEventName(data.event.name);
      } catch {
        // 取れなければヘッダーは空のまま（画面の動作には影響しない）
      }
    })();
  }, [eventId]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  const callApi = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!user) throw new Error(redeemText(locale, 'loginRequired'));
      const idToken = await user.getIdToken();
      const res = await fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...(init?.headers ?? {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data.error ?? redeemText(locale, 'apiError', { status: String(res.status) }));
      return data;
    },
    [user, locale],
  );

  useEffect(() => {
    if (!user) return;
    const loadKey = `${user.uid}:${eventId}`;
    if (loadedForRef.current === loadKey) return;
    loadedForRef.current = loadKey;
    (async () => {
      try {
        const me = await callApi(`/api/events/${eventId}/exhibitor-me`);
        setExhibitor(me.exhibitor);
        if (me.exhibitor?.lang) setLocale(normalizeLocale(me.exhibitor.lang));
        setExhibitorError('');
        const data = await callApi(`/api/events/${eventId}/shop-profile`);
        if (data.profile) setProfile({ ...EMPTY_PROFILE, ...data.profile });
        // トップ掲載の状態は取れなくても画面は出す（カードを出さないだけ）
        try {
          const placementData = await callApi(
            `/api/events/${eventId}/top-placement`,
          );
          setPlacement(placementData as TopPlacementState);
        } catch {
          setPlacement(null);
        }
      } catch (e) {
        setExhibitor(null);
        setExhibitorError(
          e instanceof Error ? e.message : redeemText(locale, 'exhibitorLoadFailed'),
        );
      }
    })();
    // locale は初期言語の確定にだけ使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, eventId, callApi]);

  // Stripe Checkout から戻ってきたときの結果表示（成功／キャンセル）。
  // 掲載の確定は Webhook 経由のため、成功時は「受付済み」の案内にする。
  useEffect(() => {
    try {
      const result = new URLSearchParams(window.location.search).get('placement');
      if (result === 'success') {
        setPlacementMessage(redeemText(locale, 'topPlacementSubscribeMessage'));
      } else if (result === 'canceled') {
        setPlacementMessage(redeemText(locale, 'topPlacementCheckoutCanceled'));
      }
    } catch {
      // 読めなければ案内なしで続行する
    }
    // 初回マウント時だけ（言語は初期値でよい）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlacementSubscribe = async () => {
    setPlacementBusy(true);
    setPlacementMessage('');
    try {
      const data = await callApi(`/api/events/${eventId}/top-placement/checkout`, {
        method: 'POST',
      });
      if (typeof data.checkoutUrl !== 'string') throw new Error('no checkout url');
      window.location.href = data.checkoutUrl;
    } catch (e) {
      setPlacementMessage(
        e instanceof Error
          ? e.message
          : redeemText(locale, 'topPlacementSubscribeFailed'),
      );
      setPlacementBusy(false);
    }
  };

  const handlePlacementCancel = async () => {
    setPlacementBusy(true);
    setPlacementMessage('');
    try {
      await callApi(`/api/events/${eventId}/top-placement/cancel`, {
        method: 'POST',
      });
      const placementData = await callApi(`/api/events/${eventId}/top-placement`);
      setPlacement(placementData as TopPlacementState);
      setPlacementMessage(redeemText(locale, 'topPlacementCancelMessage'));
    } catch (e) {
      setPlacementMessage(
        e instanceof Error
          ? e.message
          : redeemText(locale, 'topPlacementCancelFailed'),
      );
    } finally {
      setPlacementBusy(false);
    }
  };

  const handleLocaleChange = async (next: Locale) => {
    setLocale(next);
    try {
      window.localStorage.setItem(`event-locale:${eventId}`, next);
    } catch {
      // 保存できなくても画面の切替は有効にする
    }
    if (user && exhibitor) {
      try {
        await callApi(`/api/events/${eventId}/exhibitor-me`, {
          method: 'PATCH',
          body: JSON.stringify({ lang: next }),
        });
      } catch {
        // 保存に失敗しても画面の切替は止めない
      }
    }
  };

  const languagePills = (
    <div
      role="group"
      aria-label={uiText(locale, 'language')}
      style={{
        display: 'inline-flex',
        backgroundColor: '#eef1f5',
        borderRadius: 999,
        padding: 3,
        gap: 2,
        flexShrink: 0,
      }}
    >
      {SUPPORTED_LOCALES.map((l) => {
        const selected = l === locale;
        return (
          <button
            key={l}
            onClick={() => void handleLocaleChange(l)}
            aria-pressed={selected}
            style={{
              padding: '6px 12px',
              fontSize: 13.5,
              fontWeight: 700,
              borderRadius: 999,
              border: 'none',
              backgroundColor: selected ? VIOLET : 'transparent',
              color: selected ? '#ffffff' : '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {PILL_LABELS[l]}
          </button>
        );
      })}
    </div>
  );

  const brandRow = (right?: React.ReactNode) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <p style={{ fontSize: 21, fontWeight: 800, color: VIOLET, margin: 0, letterSpacing: -0.2 }}>
        {eventName}
      </p>
      {right}
    </div>
  );

  const handleLogin = async () => {
    setBusy(true);
    setLoginError('');
    try {
      // 消込画面と同じ作法: メール+パスワード（コード）をサーバーで照合し、
      // 返ってきたカスタムトークンでセッションを作る。
      const res = await fetch(`/api/events/${eventId}/exhibitor-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.customToken !== 'string') {
        throw new Error('login failed');
      }
      await signInWithCustomToken(auth, data.customToken);
    } catch {
      setLoginError(redeemText(locale, 'loginFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setForgotMessage(redeemText(locale, 'forgotPasswordNeedEmail'));
      return;
    }
    setForgotBusy(true);
    setForgotMessage('');
    try {
      const res = await fetch(`/api/events/${eventId}/exhibitor-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('request failed');
      setForgotMessage(redeemText(locale, 'forgotPasswordDone'));
    } catch {
      setForgotMessage(redeemText(locale, 'forgotPasswordFailed'));
    } finally {
      setForgotBusy(false);
    }
  };

  const updateField = (field: keyof ShopProfile, value: string | boolean) => {
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const handlePhotoSelect = async (file: File | undefined) => {
    if (!file || !user) return;
    setPhotoUploading(true);
    setMessage('');
    try {
      const idToken = await user.getIdToken();
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/events/${eventId}/shop-profile/photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== 'string') {
        throw new Error(data.error ?? redeemText(locale, 'profilePhotoFailed'));
      }
      setProfile((current) => ({
        ...current,
        photoUrls: [...current.photoUrls, data.url].slice(0, PHOTO_MAX),
      }));
    } catch (e) {
      setMessageOk(false);
      setMessage(
        e instanceof Error ? e.message : redeemText(locale, 'profilePhotoFailed'),
      );
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemovePhoto = (index: number) => {
    setProfile((current) => ({
      ...current,
      photoUrls: current.photoUrls.filter((_, i) => i !== index),
    }));
  };

  const handleSave = async () => {
    setBusy(true);
    setMessage('');
    try {
      const data = await callApi(`/api/events/${eventId}/shop-profile`, {
        method: 'PUT',
        body: JSON.stringify(profile),
      });
      if (data.profile) setProfile({ ...EMPTY_PROFILE, ...data.profile });
      setMessageOk(true);
      setMessage(redeemText(locale, 'profileSaved'));
    } catch (e) {
      setMessageOk(false);
      setMessage(
        e instanceof Error ? e.message : redeemText(locale, 'profileSaveFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!authReady) return <main style={containerStyle}>{uiText(locale, 'loading')}</main>;

  if (!user) {
    return (
      <main style={containerStyle}>
        {brandRow(languagePills)}
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '18px 0 0' }}>
          {redeemText(locale, 'shopLoginTitle')}
        </h1>
        <section style={{ ...cardStyle, padding: 16, marginTop: 14 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
            {redeemText(locale, 'emailLabel')}
            <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginTop: 12 }}>
            {redeemText(locale, 'passwordLabel')}
            <PasswordInput style={inputStyle} value={password} onChange={setPassword} autoComplete="current-password" />
          </label>
          <button
            onClick={handleLogin}
            disabled={busy}
            style={{ ...primaryButtonStyle, marginTop: 20, opacity: busy ? 0.6 : 1 }}
          >
            {redeemText(locale, 'loginButton')}
          </button>
          <button
            onClick={() => void handleForgotPassword()}
            disabled={forgotBusy}
            style={{
              display: 'block',
              margin: '14px auto 0',
              padding: 0,
              background: 'none',
              border: 'none',
              color: VIOLET,
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: 'underline',
              cursor: 'pointer',
              opacity: forgotBusy ? 0.6 : 1,
            }}
          >
            {redeemText(locale, 'forgotPasswordLink')}
          </button>
          {forgotMessage && (
            <p style={{ fontSize: 13.5, color: '#334155', marginTop: 10, textAlign: 'center' }}>
              {forgotMessage}
            </p>
          )}
          {loginError && (
            <p style={{ fontSize: 14, fontWeight: 600, color: '#b91c1c', marginTop: 12 }}>
              {loginError}
            </p>
          )}
        </section>
        <PoweredByFooter />
      </main>
    );
  }

  return (
    <main style={containerStyle}>
      {brandRow(
        <button onClick={() => void signOut(auth)} style={logoutButtonStyle}>
          {redeemText(locale, 'logoutButton')}
        </button>,
      )}

      {exhibitorError && (
        <>
          {!exhibitor && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              {languagePills}
            </div>
          )}
          <div
            style={{
              ...cardStyle,
              marginTop: 12,
              padding: '14px 16px',
              fontSize: 15,
              fontWeight: 600,
              color: '#b91c1c',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
            }}
          >
            {exhibitorError}
            {redeemText(locale, 'exhibitorErrorNote')}
          </div>
        </>
      )}

      {exhibitor && (
        <>
          <section
            style={{
              ...cardStyle,
              padding: '12px 14px',
              marginTop: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <p style={{ fontSize: 16.5, fontWeight: 800, margin: 0, flex: 1, minWidth: 110 }}>
              {exhibitor.name}
            </p>
            {languagePills}
          </section>

          <h1 style={{ fontSize: 19, fontWeight: 800, margin: '20px 0 0' }}>
            {redeemText(locale, 'shopPageTitle')}
          </h1>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 6 }}>
            {redeemText(locale, 'shopProfileNote')}
          </p>
          <p style={{ marginTop: 8 }}>
            <a
              href={`/e/${eventId}/redeem`}
              style={{ fontSize: 13.5, fontWeight: 600, color: VIOLET }}
            >
              {redeemText(locale, 'toRedeemPage')}
            </a>
          </p>
          <p style={{ marginTop: 6 }}>
            <a
              href={specialSiteShopUrl(eventId, exhibitor.id)}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 13.5, fontWeight: 600, color: VIOLET }}
            >
              {redeemText(locale, 'specialSiteShopLink')} ↗
            </a>
          </p>
          <p style={{ marginTop: 4 }}>
            <a
              href={specialSiteUrl(eventId)}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 13.5, fontWeight: 600, color: VIOLET }}
            >
              {redeemText(locale, 'specialSiteTopLink')} ↗
            </a>
          </p>

          <section style={{ ...cardStyle, padding: 16, marginTop: 12 }}>
            <label style={{ ...labelStyle, marginTop: 0 }}>
              {redeemText(locale, 'profileDisplayName')}
              <input
                style={inputStyle}
                value={profile.displayName}
                onChange={(e) => updateField('displayName', e.target.value)}
              />
            </label>
            <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 0' }}>
              {redeemText(locale, 'profileDisplayNameNote', { name: exhibitor.name })}
            </p>
            <label style={labelStyle}>
              {redeemText(locale, 'profileAddress')}
              <input
                style={inputStyle}
                value={profile.address}
                onChange={(e) => updateField('address', e.target.value)}
              />
            </label>
            <label style={labelStyle}>
              {redeemText(locale, 'profilePhone')}
              <input
                style={inputStyle}
                type="tel"
                value={profile.phone}
                onChange={(e) => updateField('phone', e.target.value)}
              />
            </label>
            <label style={labelStyle}>
              {redeemText(locale, 'profileHours')}
              <input
                style={inputStyle}
                value={profile.hoursText}
                placeholder={redeemText(locale, 'profileHoursPlaceholder')}
                onChange={(e) => updateField('hoursText', e.target.value)}
              />
            </label>
            <label style={labelStyle}>
              {redeemText(locale, 'profileMenuName')}
              <input
                style={inputStyle}
                value={profile.menuName}
                onChange={(e) => updateField('menuName', e.target.value)}
              />
            </label>
            <label style={labelStyle}>
              {redeemText(locale, 'profileMenuDescription')}
              <textarea
                style={{ ...inputStyle, minHeight: 72 }}
                value={profile.menuDescription}
                onChange={(e) => updateField('menuDescription', e.target.value)}
              />
            </label>
            <label style={labelStyle}>
              {redeemText(locale, 'profileDescription')}
              <textarea
                style={{ ...inputStyle, minHeight: 96 }}
                value={profile.description}
                onChange={(e) => updateField('description', e.target.value)}
              />
            </label>

            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
                {redeemText(locale, 'profilePhotos')}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                {profile.photoUrls.map((url, index) => (
                  <div key={url} style={{ width: 96 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      style={{
                        width: 96,
                        height: 96,
                        objectFit: 'cover',
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                        display: 'block',
                      }}
                    />
                    <button
                      onClick={() => handleRemovePhoto(index)}
                      style={{
                        width: '100%',
                        marginTop: 6,
                        padding: '5px 0',
                        fontSize: 12.5,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: '1px solid #fca5a5',
                        backgroundColor: '#ffffff',
                        color: '#b91c1c',
                        cursor: 'pointer',
                      }}
                    >
                      {redeemText(locale, 'profilePhotoRemove')}
                    </button>
                  </div>
                ))}
              </div>
              {profile.photoUrls.length < PHOTO_MAX && (
                <label
                  style={{
                    display: 'inline-block',
                    marginTop: 10,
                    padding: '10px 16px',
                    fontSize: 14,
                    fontWeight: 700,
                    borderRadius: 10,
                    border: `1px solid ${VIOLET}`,
                    color: VIOLET,
                    backgroundColor: '#ffffff',
                    cursor: photoUploading ? 'wait' : 'pointer',
                    opacity: photoUploading ? 0.6 : 1,
                  }}
                >
                  {redeemText(locale, 'profilePhotoAdd')}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: 'none' }}
                    disabled={photoUploading}
                    onChange={(e) => {
                      void handlePhotoSelect(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>

            <label style={labelStyle}>
              {redeemText(locale, 'profileInstagram')}
              <input
                style={inputStyle}
                type="url"
                placeholder="https://"
                value={profile.instagramUrl}
                onChange={(e) => updateField('instagramUrl', e.target.value)}
              />
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 600,
                marginTop: 16,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={profile.published}
                onChange={(e) => updateField('published', e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              {redeemText(locale, 'profilePublished')}
            </label>

            <button
              onClick={() => void handleSave()}
              disabled={busy}
              style={{ ...primaryButtonStyle, marginTop: 20, opacity: busy ? 0.6 : 1 }}
            >
              {redeemText(locale, 'profileSaveButton')}
            </button>
            {message && (
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: messageOk ? '#15803d' : '#b91c1c',
                  marginTop: 12,
                }}
              >
                {message}
              </p>
            )}
          </section>

          {placement && (placement.featured || placement.available) && (
            <section style={{ ...cardStyle, padding: 16, marginTop: 16 }}>
              <h2 style={{ fontSize: 16.5, fontWeight: 800, margin: 0 }}>
                {redeemText(locale, 'topPlacementTitle')}
              </h2>
              {placement.featured ? (
                <>
                  <p style={{ fontSize: 13.5, color: '#334155', marginTop: 8 }}>
                    {placement.status === 'past_due'
                      ? redeemText(locale, 'topPlacementPastDueNote')
                      : redeemText(locale, 'topPlacementFeaturedNote')}
                  </p>
                  <button
                    onClick={() => void handlePlacementCancel()}
                    disabled={placementBusy}
                    style={{
                      marginTop: 12,
                      padding: '9px 16px',
                      fontSize: 13.5,
                      fontWeight: 700,
                      borderRadius: 10,
                      border: '1px solid #fca5a5',
                      backgroundColor: '#ffffff',
                      color: '#b91c1c',
                      cursor: 'pointer',
                      opacity: placementBusy ? 0.6 : 1,
                    }}
                  >
                    {redeemText(locale, 'topPlacementCancelButton')}
                  </button>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 13.5, color: '#334155', marginTop: 8 }}>
                    {redeemText(locale, 'topPlacementNote')}
                  </p>
                  {placement.price !== null && (
                    <p style={{ fontSize: 15, fontWeight: 800, marginTop: 8 }}>
                      {redeemText(locale, 'topPlacementPrice', {
                        price: placement.price.toLocaleString('ja-JP'),
                      })}
                    </p>
                  )}
                  <button
                    onClick={() => void handlePlacementSubscribe()}
                    disabled={placementBusy}
                    style={{ ...primaryButtonStyle, marginTop: 12, opacity: placementBusy ? 0.6 : 1 }}
                  >
                    {redeemText(locale, 'topPlacementSubscribeButton')}
                  </button>
                </>
              )}
              {placementMessage && (
                <p style={{ fontSize: 13.5, fontWeight: 600, color: '#334155', marginTop: 12 }}>
                  {placementMessage}
                </p>
              )}
            </section>
          )}
          {!placement?.featured && !placement?.available && placementMessage && (
            <p style={{ fontSize: 13.5, fontWeight: 600, color: '#334155', marginTop: 16 }}>
              {placementMessage}
            </p>
          )}
        </>
      )}
      <PoweredByFooter />
    </main>
  );
}
