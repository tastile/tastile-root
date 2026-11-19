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
| 4a | **Web→Android**: Web UI または Web session 経由で source tile を作成 → アプリで日付ページを swipe して refresh | 数秒以内にアプリのタイムラインへ新規 tile が表示される（Core→端末の read 伝播） |
| 4b | **Android→Web**: アプリから source tile 作成 → Web dashboard / `GET /v1/source-tiles` で確認 | write が Core に到達し Web 側 read model に反映される |
| 4c | **初回 bootstrap との区別**: 新規アカウント sign-in 直後にタイムラインへ大量の tile（約 548–549 件: 休憩/睡眠の seed source + recurring placement + Start Point anchor）が現れるのは初回 provisioning の正常動作であり、ユーザー write ではない。双方向 sync の write 証拠としては 4a/4b で**ユーザーが明示的に作成した tile のみ**を使い、bootstrap 生成物の件数自体を sync 正常性の指標にしない | bootstrap 件数は別枠の観察項目。重複・再送による増殖がないこと（同一 owner で再 login / 再 mint 後も件数が増えないこと）を確認する |
| 5 | アプリを完全終了 → 再起動（コールドスタート） | セッション/token が復元され再ログイン不要、データが再表示される |
| 6 | **明示的 sign-out → sign-in**: アプリの account menu から Sign out → 同一アカウントで再ログイン | ログイン画面へ戻り、再ログイン後に同一 owner の全データ（タイムライン・tile・未同期 queue）が復元される。別アカウントでの sign-in も owner 分離の確認になる |
| 7 | token 失効シミュレーション（任意）: verify DB で token revoke → アプリ操作 | 401 → token 破棄 → 再 mint → 1 回再試行で復帰（android#93 契約） |
| 8 | **実 offline**: `adb reverse --remove tcp:3000` と `adb reverse --remove tcp:31410` で Core/Web を端末から到達不能にする（機内モードだけでは `adb reverse` の USB 経路が残るため不十分）→ アプリで refresh を試行 → cache 表示と graceful な失敗を確認 → `adb reverse tcp:3000 tcp:3000` / `adb reverse tcp:31410 tcp:31410` で復帰 → 再度 refresh | offline 中はクラッシュせず cache が表示され、復帰後の refresh で最新データに追いつく。offline 中の write が queue される仕様がある場合は復帰後に二重実行なく反映されること |

### 補足: emulator での既知の差分

- emulator では `adb reverse tcp:3000` の転送先を host の `127.0.0.1` にする必要がある。host の port 3000 が他プロセスに占有されている場合は `adb reverse tcp:3000 tcp:<空きport>` + host 側 TCP forwarder（例: `127.0.0.1:<port>` → `[::1]:3000`）で回避する。物理デバイスでは USB 経由の `adb reverse tcp:3000 tcp:3000` が直接 verify web に届く前提でよいが、host 側の port 競合は同様に起こりうる
- タイムラインの refresh はページ swipe / settle で発火する。起動直後の cache 表示だけでは server 側の新規データを判定できないため、Web→Android の確認では必ず swipe refresh を行う

### emulator 検証結果（2026-11-18、verify stack、account `g3verify002@example.com`）

emulator `tastile-g3` (API 37) で以下を実施済み。物理デバイスの受入は別途 pending であり、これらの結果は物理受入の PASS を意味しない。

| # | 項目 | 結果 |
|---|---|---|
| 1–3 | 起動・ログイン・token mint・タイムライン表示 | PASS（dashboard に verify Core のデータ表示） |
| 4a | Web→Android: Web proxy `POST /v1/source-tiles` で「G3 WebToAndroid Check」を作成 → アプリで day swipe refresh | PASS（`G3 WebToAndroid Check` が timeline cache に追加され UI 表示） |
| 4b | Android→Web: アプリからの write sync | PASS（初回 smoke で source tile 作成→Core 到達を確認済み） |
| 5 | コールドスタート | PASS（force-stop → 再起動でセッション復元・データ再表示） |
| 6 | sign-out → 別テストアカウント sign-in | PASS（ログイン画面へ遷移、`g3verify002` で sign-in 成功・owner 分離された bootstrap データ表示。同一アカウント再ログインの data restoration は物理受入で再確認推奨） |
| 8 | 実 offline（`adb reverse` remove → 復帰） | PASS（offline 中も cache 表示でクラッシュなし。復帰後 swipe refresh で最新データ表示を確認） |
| 7 | token revoke → 401 recovery | **未実施**（任意項目。物理受入または後続 emulator 回で実施） |

### 証跡の記録先

- 結果サマリ: root #105 へのコメント（G3 判定材料）
- 詳細ログ/スクリーンショット: `tastile-android/docs/evidence/<date>-g3-device/`（匿名化・秘密値なし）
- 失敗時: logcat（`adb logcat`、token/password を含む行は除外）+ 再現手順

## 6. 未実施・前提

- **APK の契約 pin 鮮度 (2026-11-20 追記)**: 記録の APK は OpenAPI pin v3.5.0 (`8a61003`) 時点の `release-0-7-0` @ `5c1e0d4` 由来。現行 contract は v3.8.1 (`49a1b449`、android PR #119 で `release-0-7-0` head `407e0b2a` に統合済み) で、生成 client の coverage は 46/46 ops。v3.5.0→v3.8.1 の差分は security schemes・summaries・`info.version` (1.1.0→1.2.0) の metadata 追加のみで、operation/schema の wire 形状に変更はない (openapi#27/#31 の semantic diff で確認済み)。したがって本 APK で実施する受入項目 (認証 token mint・timeline・source tile 双方向 sync) の契約面は互換だが、**pin 鮮度を理由に受入前の再ビルドを推奨**する。再ビルドする場合は §2 の手順で `release-0-7-0` head から `assembleDebug` し、新 SHA-256 を本表へ追記する
- **物理デバイス未接続**: 現環境は emulator `tastile-g3` (API 37) のみ。実機受入は人間のデバイス操作が必須。上記 emulator 結果は物理受入の PASS を意味しない
- emulator での instrumented test は別途結果を記録（既知の環境起因 failure あり、RC 変更との関連は baseline 比較で切り分け済み — #105 参照）
- verify stack が停止している場合は `tastile-root/deploy/verify-stack/README.md` の手順で再起動（`docker compose up -d` + `bootstrap-web-auth.sh` + web dev server）
- 新規アカウントの初回 bootstrap で source tile + recurring placement が一括 materialize される（verify DB で 2 アカウントとも約 548–549 件を確認。内訳: source template 2 + anchor 1 + sleep 約 33 + break filler 約 512–513。重複・再送増殖は確認されず、owner 単位の advisory lock + binding row で冪等。詳細は root #105 の調査コメント参照）
