# Push-taro 町おこし（machiokoshi）

ご当地グルメ・スタンプラリーアプリ。push-taro-event（EVENT）のコードを土台に開発する。

- 仕様の正: LP https://push-taro.com/machiokoshi （LP が仕様を兼ねる）
- 土台: push-taro-event @ e6337ae（EVENT 公開時点、PR #61 まで）

## デプロイ前に差し替えるもの（Firebase プロジェクト作成後）

- `apphosting.yaml` の NEXT_PUBLIC_FIREBASE_* 一式（現状は EVENT のプロジェクト値）
- `lib/app-origin.ts` の APP_ORIGIN（現状は EVENT の App Hosting URL）
- `lib/storage-bucket.ts` のデフォルトバケット（現状は EVENT のバケット）
- Secret Manager のシークレット参照（INFOMAIL_USER / INFOMAIL_PASS / CRON_SECRET）は新プロジェクト側に用意する

## テキストでないため未収録のファイル（Codespace から追加する）

- `public/icon-192x192.png` / `public/icon-512x512.png`（push-taro-event リポジトリの同名ファイル）
- `NotoSansCJKjp-Regular.otf` は EVENT 側でも未使用のため移植しない
