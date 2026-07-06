# 2026-07-06 AWS Cognito Hardening Design

## 概要

`tastile-v1-users` Cognito User Pool を **AWS レビューで却下されない水準** までハードニングし、
公開サインアップを許可できる状態を成立させる。完了基準は Plan A(11 営業日 一気通貫)。

## 設計判断の確定事項(ユーザー確認済み 2026-07-06)

| 項目 | 確定 | 根拠 / メモ |
|---|---|---|
| Cognito Tier | **PLUS** を D1 に確認/有効化 | ユーザー発言「課金は有効化されてるはず」だが、describe-user-pool で `UserPoolTier: LITE` だったら変える |
| MFA 強制 | **ON** (TOTP のみ / SMS は MFA から除外) | SMS は SIM-swap + 国際送信 + コスト理由で拒否 |
| 第一因子 | **email + password**(USER_SRP_AUTH / PASSWORD_SRP) **または email + emailOTP**(USER_AUTH) | 「パスワードのみ認証が危険」というユーザー発言より、TOTP は常に必須(2要素目) |
| 第二因子 | **TOTP** のみ | SMS OTP は採用しない |
| TOTP 登録方法 | Web UI で QR 表示 + 手動 secret コード | WebAuthn(passkey)はスコープ外 |
| サインアップ UI | **誰でも到達可能** | CAPTCHA / 招待コード / 同意チェックボックスは今回実装しない |
| 利用規約 / privacy | 既存 `/terms` を流用、別 plan でレビュー | 文面差し替えは今回扱わない |

## ゴール

1. `https://app.tastile.app/auth/email` のサインアップを開いた瞬間から、**第三者レビューに耐える AWS 構成**になっている
2. 公開サインアップ後、各新規ユーザーが **TOTP セットアップ → コード検証なしにはサインインできない** 状態
3. 1 ユーザーあたりのデータ削除要請に対応できる(`/api/account/delete`)
4. abuse を示唆するメトリクス(signup_rate, MFA 設定率, ASF ブロック数, SES 苦情率)をアラーム可能

## 非ゴール(別 plan に defer)

- 利用規約 / privacy の文面差し替えと法務レビュー
- 通報 UI / 凍結 admin ツール
- WebAuthn / passkey 対応
- メール認証以外の本人確認(E メール以外の factor)
- CAPTCHA / Cloudflare Turnstile 設置
- invite-only 化(既に逆方向)

## アーキテクチャ

### Cognito User Pool `tastile-v1-users` の新構成

| 項目 | 値 | 説明 |
|---|---|---|
| `UserPoolTier` | `PLUS` | TOTP/ASF を使う前提。Lite のままだと不可 |
| `MfaConfiguration` | `ON` | 全ユーザー MFA 必須 |
| `MfaConfiguration.SmsMfa` | 無効 | SMS を MFA factor から完全除外 |
| `MfaConfiguration.SoftwareTokenMfa` | 有効 | TOTP のみ許可 |
| `Policies.SignInPolicy.AllowedFirstAuthFactors` | `["PASSWORD", "EMAIL_OTP"]` | 第一因子として従来通り |
| `Policies.PasswordPolicy` | 既存値維持(Min 12, Upper, Lower, Number) | D1 確認の上、PasswordPolicy を `update-user-pool` で再送する必要あり |
| `AdvancedSecurityMode` | `ENFORCED` | 必須。Adaptive Authentication + Compromised Credentials Check |
| `EmailConfiguration.EmailSendingAccount` | `DEVELOPER` | SES 経由、`From: auth-noreply@tastile.app` |
| `EmailConfiguration.From` | `auth-noreply@tastile.app` | SPF/DKIM pass を満たす sender |
| `AutoVerifiedAttributes` | `["email"]` | Google OAuth の Email を `email_verified=true` に自動昇格 |
| `LambdaConfig` | 7 triggers(後述) | TOTP/Lambda 連携のため |
| `UsernameAttributes` | `["email"]`(現状維持) | |

### Lambda triggers (7 関数)

すべて ap-northeast-1。Cognito から `SourceArn` 制約付きで invoke される。実装言語は **Rust**(`tastile-core` の `crates/v1/api/` に同居させるか、新規 `crates/cognito-triggers/` を切るかは D6 で実装時に決定)。

| Trigger | 関数名 | 役割 | 入力/出力 |
|---|---|---|---|
| PreSignUp | `fn-tastile-cognito-pre-signup` | email 形式 / domain blocklist / IP throttle(`signup_failures:{ip}` 5 連続失敗・200 req/hour) | in: event / out: response(エラーなら例外)、VPC 設定不要 |
| PostConfirmation | `fn-tastile-cognito-post-confirmation` | `v1_owner_user` 行を upsert(email, sub, status, created_at) | in: event / out: 200 返却、PG 接続あり |
| PreTokenGeneration | `fn-tastile-cognito-pre-token` | ID token に `gastile:tenant_id` `gastile:role` を claims として付与 | in: event / out: claims 拡張 |
| CustomMessage | `fn-tastile-cognito-custom-message` | 認証コード / TOTP 回復コードのメール本文を HTML 化(現状は `email@verificationemail.com` の素のテキスト) | in: event(email イベント種別で本文切替) / out: 置換済み本文 |
| DefineAuthChallenge | `fn-tastile-cognito-define-auth-challenge` | TOTP を第二因子として要求する challenge シーケンスを返す | in: event / out: challengeName 順 |
| CreateAuthChallenge | `fn-tastile-cognito-create-auth-challenge` | TOTP secret を生成し Cognito 側属性に保存、Cognito が Web UI に QR 返却 | in: event / out: publicChallengeParameters |
| VerifyAuthChallengeResponse | `fn-tastile-cognito-verify-auth-challenge-response` | ユーザー入力の 6 桁コードと保存した secret を TOTP RFC 6238 で照合 | in: event / out: answerCorrect: bool |

### SES / メール経路

| 項目 | 値 |
|---|---|
| SES identity | `tastile.app`(Domain 認証) |
| DKIM | SES コンソールで DKIM を有効化、生成された 3 つの CNAME を Route53 に追加 |
| MAILFROM | `mail.tastile.app` |
| SPF | `v=spf1 include:amazonses.com -all` を `tastile.app` ゾーンの TXT に追加 |
| Notifications | `bounce@`、`complaint@` を SNS Topic → CloudWatch Metrics + Lambda(`fn-ses-monitoring`)に配送 |
| Reputation guard | `BounceRate > 5%` または `ComplaintRate > 0.5%` で CloudWatch Alarm → review flag |

### Monitoring (CloudWatch)

| メトリクス / アラーム | 閾値 | アクション |
|---|---|---|
| `Cognito.SignUpCount` | dry-run 24h 後 100/day 超過 | 増加率を表示、超えたら D11 アラーム有効化 |
| `Cognito.AdminDeleteUser` | 任意運用で monitor のみ | - |
| `Custom: MfaSetupCompletionRate` | < 95% | D11 アラーム — セットアップ漏れのサインイン試行を可視化 |
| `Custom: AsfBlockCount` | (TBD by adaptive) | adaptive が学習した閾値をそのまま表示 |
| `Backup.LastRunAge` | > 26h | S3 backup cron の失敗、operator 対応 |
| SES `Reputation.BounceRate` | > 5% | SES Pause / DNS 確認 |

## コンポーネント一覧

新規追加 / 変更:

| カテゴリ | 名前 | 状態 | 補足 |
|---|---|---|---|
| AWS | Cognito User Pool tier upgrade | 変更 | Tier = LITE → PLUS |
| AWS | Cognito LambdaConfig | 変更 | 7 triggers をアタッチ |
| AWS | Cognito MfaConfiguration | 変更 | OFF → ON、SoftwareToken のみ、SMS 無効 |
| AWS | Cognito AdvancedSecurityMode | 変更 | 未設定 → ENFORCED |
| AWS | SES domain identity `tastile.app` | 追加 | D3 |
| AWS | SES DKIM keys + Route53 CNAME 3 件 | 追加 | D3 |
| AWS | SES MAILFROM `mail.tastile.app` | 追加 | D3 |
| AWS | SNS topic `tastile-ses-notifications` | 追加 | D4 |
| AWS | S3 bucket `tastile-cognito-backup-{env}` | 追加 | D10 |
| AWS | EventBridge rule (nightly) | 追加 | D10 |
| AWS | CloudWatch alarms (6 個) | 追加 | D11 |
| Lambda | `fn-tastile-cognito-pre-signup` | 新規 | Rust |
| Lambda | `fn-tastile-cognito-post-confirmation` | 新規 | Rust |
| Lambda | `fn-tastile-cognito-pre-token` | 新規 | Rust |
| Lambda | `fn-tastile-cognito-custom-message` | 新規 | Rust |
| Lambda | `fn-tastile-cognito-define-auth-challenge` | 新規 | Rust |
| Lambda | `fn-tastile-cognito-create-auth-challenge` | 新規 | Rust |
| Lambda | `fn-tastile-cognito-verify-auth-challenge-response` | 新規 | Rust |
| Lambda | `fn-tastile-cognito-backup` | 新規 | Rust、`DescribeUserPool` JSON を S3 へ |
| Lambda | `fn-ses-monitoring` | 新規 | Rust、SNS → CloudWatch Metrics |
| Postgres | `v1_signup_failures` テーブル | 新規 | D6、IP / email / first_seen / last_seen / count |
| Postgres | `v1_owner_user` 既存 | 既存 | PostConfirmation で upsert |
| API(Rust) | `DELETE /api/account` (v1) | 新規 | D10、Cognito `AdminDeleteUser` + PG cascade + S3 avatar best-effort delete |
| Web(Next.js) | `/auth/mfa-setup` ルート | 新規 | D9、QR 表示 + 手動 secret 入力 + 検証 |
| Web(Next.js) | `/auth/mfa-recovery` ボタン(ログイン画面) | 新規 | D9、EMAIL_OTP fallback で `AdminResetUserMFAPassword` 相当 |
| Web(Next.js) | `/api/account` の既存経路 | 微修正 | D10、`DELETE` ハンドラ追加 |

### 既存からの差分

- `tastile-web/src/lib/cognito/public-client.ts::startEmailOtpSignIn` — `PREFERRED_CHALLENGE: "EMAIL_OTP"` の前後で Cognito が `MfaConfiguration=ON` を見て TOTP 検証を追加要求する。public-client は `challengeName` を見て `TOTP` か `EMAIL_OTP_CODE` か分岐する形に拡張
- `tastile-web/src/app/auth/email/start/route.ts` — TOTP が必要な場合 `/auth/mfa-setup` か `/auth/email/verify` に振り分ける

## データフロー

### Signup

```
[Web] /auth/email/signup POST email
  ↓
[Web /api/account/signup] → Cognito SignUp(Username=email)
  ↓
PreSignUp Lambda: throttle + format check
  ↓
Cognito: SES via DEVELOPER で confirm コード送信
[Web] /auth/email/confirm POST email + code
  ↓
Cognito ConfirmSignUp
  ↓
PostConfirmation Lambda: PG v1_owner_user 行 upsert
  ↓
Auth entry と MFA セットアップへ
```

### Sign-in + MFA

```
[Web] /auth/email POST email
  ↓
Cognito InitiateAuth(USER_AUTH, PREFERRED_CHALLENGE=PASSWORD_SRP|EMAIL_OTP)
  ↓
ユーザー認証コード / パスワード送信
  ↓
[Web] PASSWORD_SRP or EMAIL_OTP_CODE submit
  ↓
Cognito: 第一因子 OK → 第二因子を要求 (MfaConfiguration=ON)
  ↓
[Web] /auth/mfa-setup (初回のみ) → QR 表示 → 入力コード検証
  ↓
Cognito: AssociateSoftwareToken + VerifySoftwareToken
  ↓
第二因子 OK
  ↓
PreTokenGeneration Lambda: claims 拡張
  ↓
[Web] Cookie に id_token / access_token / refresh_token をセット
```

### Account deletion

```
[Web] /settings/account 削除ボタン
  ↓
DELETE /api/account (with id_token)
  ↓
tastile-core:
  1. Cognito AdminDeleteUser(user_pool, sub)
  2. PG: v1_owner_user.user_id=sub 配下を cascade
  3. S3: avatar 3 variants を best-effort delete
  ↓
204 + Cookie clear + /login リダイレクト
```

## エラーハンドリング

| エラーケース | 検出方法 | 対応 |
|---|---|---|
| PreSignUp throttle 上限 | Lambda 直前 5 連続失敗・200 req/hour | `TooManyRequestsException` 返却、UI でレートリミット表示 |
| SES bounce | SES → SNS → CloudWatch | Alarm → operator 通知 |
| TOTP secret 消失(Cookie 消失等) | `/auth/mfa-recovery` ボタン | EMAIL_OTP fallback で第二因子認証 → Lambda で TOTP 無効化 + 再設定誘導 |
| TOTP 入力コード不一致 | Verify Auth Challenge Lambda | 3 回失敗で一時ロック → Cognito の閾値 |
| backup 失敗 | EventBridge Lambda 終了コード != 0 | CloudWatch Alarm → operator |
| Cognito throttling | `Cognito.Throttles` メトリクス | Alarm → tier 上げ / client 側 retry |
| TOTP mandatory だが setting なし | WEB 側で `challengeName === "MFA_SETUP"` を検知 | `/auth/mfa-setup` にリダイレクト |
| MFA_RECOVERY_EMAIL_OTP flow | Cognito が発行 | `customMessage` Lambda で subject/body を多言語化 |

## テスト方針

| レイヤ | やること |
|---|---|
| AWS | Tier change 後の `aws cognito-idp describe-user-pool` で `UserPoolTier=PLUS` 確認 |
| AWS | 流出した既知のパスワードで SignUp 試行し `RiskDecision` でブロックされること |
| AWS | SES `swaks` でテスト送信、`dig TXT` で DKIM/SPF が `pass` |
| Lambda | ローカル Python / cargo test で event payload → response の shape テスト |
| Lambda | 統合テスト: `aws cognito-idp sign-up` を D6 後 / D7 後 / D9 後に叩き、`create-user` → `confirm-sign-up` → `initiate-auth` の full flow を CLI で確認 |
| Web | D9 後、Playwright で /auth/email/signup → confirm → MFA setup → signin をブラウザで実行 |
| Web | D10 後、Playwright で DELETE /api/account が idempotent に動くことを確認 |
| Monitoring | D11 で synthetically CloudWatch アラームを発火、operator 通知が届くことを確認 |
| 受け入れ | D11 24h 後のサインアップ数/MFA 設定率/エラー率を Grafana / CloudWatch ダッシュボードに表示 |

## 11 営業日スケジュール(Plan A)

| 日 | やること | 検証基準 |
|---|---|---|
| D1 | `describe-user-pool` で Tier 確認 → LITE なら PLUS に billing 申請 + 変更 | `aws cognito-idp describe-user-pool` で `UserPoolTier: PLUS` |
| D2 | `AdvancedSecurityMode=ENFORCED`、AdaptiveAuthentication=ENFORCED に。`update-user-pool` で反映。`AutoVerifiedAttributes=[email]` も併せて設定 | 流出した既知パスワードで SignUp 試行 → Cognito が risk-decision でブロック |
| D3 | SES ドメイン identity `tastile.app` + DKIM 有効化 + Route53 CNAME 3 件 + MAILFROM `mail.tastile.app` + SPF TXT | `nslookup -type=TXT` / `dig TXT` で DKIM/SPF pass、`swaks` で test メールが DKIM=pass で届く |
| D4 | SES Notifications → SNS Topic `tastile-ses-notifications` 設定 + Lambda `fn-ses-monitoring` で CloudWatch Metrics `BounceRate` `ComplaintRate` を publish | synthesized bounce イベントで CloudWatch `SES.BounceRate` メトリクスが更新 |
| D5 | `EmailConfiguration` を `DEVELOPER` に、`From: auth-noreply@tastile.app` に切り替え | 新規 SignUp の確認メールが FROM=`auth-noreply@tastile.app`、SPF/DKIM ヘッダ pass |
| D6 | `fn-tastile-cognito-pre-signup`(Rust)、`v1_signup_failures` テーブル作成、IAM ロール設定 | SignUp で `+` ランダムアドレス 5 連続失敗→6 回目 `TooManyRequestsException` |
| D7 | `fn-tastile-cognito-post-confirmation`(Rust)、`v1_owner_user` 行 upsert の冪等性確保 | ConfirmSignUp 後、Postgres の `v1_owner_user` に該当 sub 行が created_at/set_at 付きで存在 |
| D8 | `fn-tastile-cognito-pre-token`(Rust)、`fn-tastile-cognito-custom-message`(Rust)実装。claims に `gastile:tenant_id` を追加。メール本文は `multipart/alternative` で HTML + text fallback 形式 | ID token を JWT decode して新クレーム確認。サインアップ確認メールが HTML で届く。TOTP 回復フロー用テンプレ切替が Cognito triggerSource `ForgotPassword` でも発火することを確認 |
| D9 | TOTP MFA triggers 3 種(Define/Create/Verify Auth Challenge)+ `/auth/mfa-setup` Web ルート + `/auth/mfa-recovery` の EMAIL_OTP fallback 経路。E2E: signup → confirm → MFA setup → signin → TOTP recovery | サインイン後 `MfaSetup` challenge が返る。 QR 表示 → 手動入力 → 検証コード通過 → id_token 発行まで通す。`/auth/mfa-recovery` から EMAIL_OTP 認証 → TOTP 無効化 → 再設定誘導の full path が動く |
| D10 | S3 bucket `tastile-cognito-backup-prod` + EventBridge nightly + `fn-tastile-cognito-backup` 実装。`DELETE /api/account`(Rust)を実装して Cognito `AdminDeleteUser` + `v1_owner_user` + `v7_tiles` / `v7_placements` / `v7_demands` / `v1_owner_membership` / `v1_owner_access_grant_*` cascade delete + S3 avatar 3 variants best-effort delete | 手動で backup Lambda 起動 → S3 に最新 JSON あり。`DELETE /api/account` 呼び出しで PG sub 配下行の全消失を SQL で select=0 確認 + Cognito describe=NotFound 確認 |
| D11 | CloudWatch alarms 6 個を設置。`/auth/email` サインアップを開く | synthetically signup_rate / MfaSetupCompletionRate アラーム発火テスト。 24h dry-run 後 signups > 0 / MFA setup ≥ 95%、SES Reputation `BounceRate < 5%`、`ComplaintRate < 0.5%` |

## リスク

| リスク | 影響 | 緩和策 |
|---|---|---|
| Cognito Plus tier 課金が予算超過 | 月次 MAU × $0.05 が膨らむ | Cost Anomaly Detection + 月初 $__ ハードアラート。バックアップ先の S3 コストも別 budget でキャップ |
| TOTP Secret 漏洩(WEB UI の screenshot 収集/Logger 転記) | 1 ユーザー侵害 | Sentry / Vercel log の secret filter、CSP で画面キャプチャ抑止、`SecretAccessKey` env 未使用を保証 |
| SES ドメイン新規のため初週 spam フォルダ率高 | signups されない | 最初の 1 週は bounce / complaint を毎日手動確認。welcome mail の from を変更せず固定 |
| Lambda 7 関数の同時リリースによる rollback 難 | half-done state | 各 Lambda を個別 ON/OFF できる環境変数フラグ(`ENABLE_TOTP_MFA` 等)で D9 で一括切替 |
| Plus tier は Free ではない | 月額固定 + MAU 従量課金 | 公開後 1 週間は毎日 Cost Explorer で確認、異常があれば SES Tier 引き下げ緊急プランを別途 hold |
| TOTP 強制で SIGN_IN_BLOCKED になる既存 Google ユーザー | 既存ユーザーがログイン不可 | 既存ユーザー(sub 2 名)は WEB UI で recovery → EMAIL_OTP → TOTP 再設定の順に手動で対応。D11 で操作 |

## 依存関係 / ブロッカー

- AWS billing 連絡先 / 請求先アカウントが Plus tier を有効化できる権限を持っていること(D1 で確認)
- Route53 hosted zone `tastile.app` の TXT / CNAME 編集権限(D3)
- SES が production access を granted されていること(D3 で疎通不可なら `service-quota-request` を申請。普通は当該リージョンで既に有効化されている)
- `tastile-core` の `v1_owner_user` スキーマに Confirmed の user を作成する経路(PostConfirmation Lambda)が既に存在しないこと(D7 で確認。既存なら upsert 冪等性を壊さない形に改修)

## 関連ドキュメント

- HARNESS.md §7(認証モデル)
- `docs/plans/2026-07-04-owner-polymorphic-and-avatar.md` の deferred hardening 行
- `project_cognito_emailotp_misconfigured_20260706.md` (memory)
- (将来) `docs/plans/2026-07-XX-auth-hardening.md` ← **本設計はこの plan の title として採用予定**
