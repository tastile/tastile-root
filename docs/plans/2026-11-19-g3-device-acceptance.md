# G3 実機受入パケット (T10)

- 日付: 2026-11-19
- 対象 gate: G3 / T10（root #105）— 実機の test APK で Web/Android 双方向反映・再ログイン/コールドスタートをテストアカウントで実証
- 状態: **人間の実機操作が必要。エージェント環境に物理デバイスは接続されていないため PASS とは記録しない**

## 1. 配布物

| 項目 | 値 |
|---|---|
| APK | `app-debug.apk`（debug 署名。"署名済み test APK" の要件は debug 鍵署名で充足する解釈。release 署名が必須なら要 Infisical prod の署名情報で別途 `assembleRelease`） |
| source SHA | tastile-android `release-0-7-0` @ `5c1e0d4`（OpenAPI pin v3.5.0 `8a61003`、generated client coverage 36/36） |
| verify APK | `/Users/rebui/work/ta-g3-apk/app/build/outputs/apk/debug/app-debug.apk` |
| SHA-256 | `ea7be8cee442167fb31d09adfb0026f3c24a4f7f2388e700863f906339caec07`（40,299,938 bytes、2026-11-18 ビルド） |
| 焼き込み確認 | dex 内に `http://127.0.0.1:3000` / `http://127.0.0.1:31410` を確認済み（§2 の override が有効） |

## 2. 検証環境（verify stack、運用 SoT とは完全分離）

| 要素 | 値 |
|---|---|
| Core API | `http://127.0.0.1:31410`（docker `tastile-verify-api`、image `tastile-core-verify:local` = core `release-1-1-0` 系、`TASTILE_DELIVERY_PROVIDER=fake`） |
| Core DB | `tastile-verify-db` @ `127.0.0.1:55432`（専用 volume、運用 DB 非接触） |
| Web (auth/token mint) | `http://localhost:3000`（tastile-web `release-1-1-0` @ `73aa7190` = Next.js 16.4.6、`bun run next dev` + verify env） |
| Better Auth store | 同一 verify DB 内 `tastile_auth`（`bootstrap-web-auth.sh` 済み） |

### APK のビルド（verify URL 焼き込み）

`WEB_BASE_URL` / `TASTILE_CORE_URL` は BuildConfig に build 時焼き込みのため、dev secret の本番 URL ではなく verify URL でビルドする:

```bash
cd <android worktree>   # release-0-7-0 head
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME=~/Library/Android/sdk
infisical run --projectId 949b4193-a226-4620-8371-726a37c7195b --env dev \
  --path /tastile/android -- \
  env WEB_BASE_URL=http://127.0.0.1:3000 \
      TASTILE_CORE_URL=http://127.0.0.1:31410 \
      ./gradlew assembleDebug
# 出力: app/build/outputs/apk/debug/app-debug.apk → shasum -a 256 で記録
```

## 3. 実機接続（adb reverse）

物理デバイス上の `127.0.0.1` を開発 Mac の loopback へ転送する。USB 接続前提:

```bash
adb devices                                  # デバイスが device 状態であること
adb reverse tcp:3000 tcp:3000                # Web (auth)
adb reverse tcp:31410 tcp:31410              # Core API
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`adb reverse` は USB 接続中のみ有効。切断・再接続のたびに再実行する。

## 4. テストアカウント

- verify web (`http://localhost:3000/login`) から新規 sign-up する。email は `g3-verify-<任意>@example.com` 等、実在しないアドレスでよい（verify DB のみ、メール送信は fake/不要な経路を確認）
- パスワードは受入記録に残さない。アカウント識別子（email のローカル部まで）は証跡に記録可
- 既存の verify 用テストアカウントがあればそれを使う（無い場合は上記で作成）

## 5. 受入操作と記録方法

各項目を実施し、結果（PASS/FAIL + 観察）を証跡として保存する。スクリーンショットは個人情報を含まない範囲で `.tmp/` に保存し、Issue/PR には結果と SHA のみ記録する。

| # | 操作 | 期待 |
|---|---|---|
| 1 | アプリ起動 → ログイン画面表示 | Web ログインへの導線が出る |
| 2 | Web (`localhost:3000`) で sign-in → アプリへ復帰 | `/api/mobile/api-token` 経由で token mint 成功（expires_at 30日・scopes `tastile.read tastile.write` が送られることを Core/DB または proxy log で確認可） |
| 3 | タイムライン/予定の表示 | verify Core のデータが表示される（双方向 sync の read 側） |
| 4 | アプリから source tile 作成 → Web dashboard に反映 | write 側 sync（`createSourceTile` が Core に到達） |
| 5 | アプリを完全終了 → 再起動（コールドスタート） | セッション/token が復元され再ログイン不要、データが再表示される |
| 6 | token 失効シミュレーション（任意）: verify DB で token revoke → アプリ操作 | 401 → token 破棄 → 再 mint → 1 回再試行で復帰（android#93 契約） |
| 7 | 機内モード等で offline → 復帰 | 再接続後に sync が追いつく（可能な範囲で） |

### 証跡の記録先

- 結果サマリ: root #105 へのコメント（G3 判定材料）
- 詳細ログ/スクリーンショット: `tastile-android/docs/evidence/<date>-g3-device/`（匿名化・秘密値なし）
- 失敗時: logcat（`adb logcat`、token/password を含む行は除外）+ 再現手順

## 6. 未実施・前提

- **物理デバイス未接続**: 現環境は emulator `tastile-g3` (API 37) のみ。実機受入は人間のデバイス操作が必須
- emulator での instrumented test は別途結果を記録（既知の環境起因 failure あり、RC 変更との関連は baseline 比較で切り分け済み — #105 参照）
- verify stack が停止している場合は `tastile-root/deploy/verify-stack/README.md` の手順で再起動（`docker compose up -d` + `bootstrap-web-auth.sh` + web dev server）
