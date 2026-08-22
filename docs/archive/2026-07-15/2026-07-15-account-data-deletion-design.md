# Account & Data Deletion — Production Launch Spec

- Date: 2026-07-15
- Owner: tastile-web + tastile-core
- Status: Design — awaiting implementation plan

## 概要

tastile の本番公開にむけ、GDPR Art.17(忘れられる権利)を満たすため、
アカウント削除(全消去)とデータ削除(コンテンツのみ)を
**2 ボタン構成**で `/profile/danger/*` に実装する。
アカウント削除はマジックリンク確認、データ削除はタイプ確認で実行する。

## 確定事項(ユーザー確認済み 2026-07-15)

| 項目 | 値 | 根拠 / メモ |
|---|---|---|
| 削除アクション | 2 ボタン: アカウント削除 / データ削除 | GDPR Art.17 + ユーザーのコンテンツだけ消したい用途を分離 |
| URL プレフィックス | **`/profile/danger/*`** | 既存の `ProfilePanel.tsx`(src/features/profile)と命名が揃う。破壊的操作を `/dashboard/preferences/*`(日常設定)から明確に分離 |
| アカウント削除対象 | Cognito `AdminDeleteUser` + `v1_owner` の匿名化 + 全 PG テーブル CASCADE + S3 avatar 3 variants best-effort | 2026-07-06 Cognito hardening spec D10 を踏襲。実スキーマに合わせて下記「データモデル」節参照 |
| データ削除対象 | `v1_tile` / `v1_plan` / `v1_placement` / `v1_execution` / `v1_execution_segment` / `v1_change_set` / `v1_change` / `v1_change_value_*`(`v1_owner` の display_name / avatar_url、`v1_owner_user`、`v1_owner_scope_profile`、`v1_owner_membership` は保持) | ユーザー回答: プロフィールは保持。実スキーマは `migrations/v1/` に従う |
| 確認フロー(アカウント削除) | **マジックリンク**(SES で確認メール → 24h 有効 → GET で検証 → POST で実行) | GDPR 的観点で最も安全 |
| 確認フロー(データ削除) | **タイプ確認**(`delete my data` 入力で実行、Cognito JWT のみ) | 軽い処理なので重くしない |
| マジックリンク送信条件 | `email_verified=true` の Cognito ユーザーのみ | 未確認ユーザーへの誤送信防止 |
| レート制限 | `/api/account/delete/request` は同一 sub 5 分 1 回 / 24 時間 3 回 | メール乱発防止 |
| 多重実行防止 | jti を DB に記録、使用済みトークンは 410 Gone | 再送・二重実行の防御 |
| スコープ | **Web のみ**(Android は別スペックで追跡) | URL prefix 議論が Web スコープのため |
| 既存仕様との関係 | `2026-07-06-cognito-aws-hardening-design.md` D10 を**実装**で満たす(同スペックは未実装だったゴール) | spec D10 の `v1_owner_user` 表記は V1_004 時点で dead、現行は `v1_owner` |

## ゴール

1. `https://app.tastile.app/profile/danger` にアクセスすると、ログイン済みユーザーに対して「アカウント削除」「データ削除」の 2 アクションが見える
2. アカウント削除はマジックリンク経由で 24 時間以内に確定でき、Cognito + Postgres + S3 の整合が取れた状態で完全削除される
3. データ削除はタイプ確認のみで即時実行され、`v1_owner` のプロフィールは保持される
4. `/dashboard/preferences/account` の profile タブ、ProfilePanel、site footer の 3 箇所から `/profile/danger` に遷移できる
5. Playwright E2E で 2 シナリオ(account / data)が緑

## 非ゴール(別 plan に defer)

- 削除前の自動エクスポート(GDPR Art.20 データポータビリティ)
- Admin / 凍結ユーザー向け手動救済フロー
- 30 日猶予付きの soft delete(削除予約 → 30 日後に確定)
- WebAuthn / passkey での再認証(現状は Cognito JWT のみ)
- Android / Desktop クライアントの同等機能
- 削除ログの長期保管(別 plan)
- 利用規約 / Privacy Policy 文面差し替え(法務レビュー待ち)

## アーキテクチャ

### URL / API 一覧

| Method | Path | 層 | 認証 | 用途 |
|---|---|---|---|---|
| GET | `/profile/danger` | Web | Cognito session | 一覧ランディング(2 アクション入口) |
| GET | `/profile/danger/account?token=…` | Web | URL トークン | アカウント削除の確認画面表示 |
| GET | `/profile/danger/data` | Web | Cognito session | データ削除の確認画面 |
| POST | `/api/account/delete/request` | Web | Cognito JWT | マジックリンクメール送信 |
| POST | `/api/account/delete/confirm` | Web | URL トークン(body) | アカウント削除実行 |
| POST | `/api/account/data/delete` | Web | Cognito JWT | データ削除実行 |
| DELETE | `/api/account`(内部 Rust API) | Core | UUIDv5(JWT sub) | 既存 `2026-07-06` spec D10 の実装 |

### アカウント削除フロー

```
[Web /profile/danger]
  │  ユーザーが「アカウントを削除」ボタンを押下
  ↓
POST /api/account/delete/request
  │  Cognito JWT → sub → UUIDv5 → owner_id 解決
  │  email_verified チェック
  │  HMAC-SHA256(secret, sub || "|" || expiry_unix) 生成
  │  jti を `v1_account_delete_request` に INSERT
  │  SES で確認メール送信(リンクは /profile/danger/account?token=...)
  ↓
[メール] ユーザーがリンクをクリック
  ↓
GET /profile/danger/account?token=...
  │  トークン検証(署名 + expiry + jti 未使用)
  │  確認画面を表示(再度タイプ確認 'delete my account')
  ↓
POST /api/account/delete/confirm
  │  body: { token, typedText }
  │  typedText === 'delete my account' 確認
  │  Core に DELETE /api/account
  │    ├ 1. txn 開始
  │    │  2. v1_tile / v1_plan / v1_placement / v1_execution
  │    │     / v1_execution_segment / v1_change_set / v1_change
  │    │     / v1_change_value_text / v1_change_value_instant
  │    │     / v1_change_value_uuid / v1_change_value_role
  │    │     / v1_change_value_span / v1_idempotency
  │    │     を CASCADE DELETE
  │    │  3. v1_owner 行の display_name='deleted-user',
  │    │     avatar_url=NULL に匿名化(外部参照の整合のため)
  │    │  4. OutboxEvent::AccountDeleted 発行
  │    │  5. jti を 'consumed' に更新
  │    │  6. txn commit
  │    ├ 7. S3 avatar 3 variants best-effort delete(失敗で 200 維持)
  │    └ 8. Cognito AdminDeleteUser(失敗なら 500)
  ↓
[Web] 200 OK → cookie 削除 → 302 /login
[Web] /login?deleted=1 で「お別れメッセージ」表示
```

### データ削除フロー

```
[Web /profile/danger/data]
  │  ユーザーが 'delete my data' を入力
  ↓
POST /api/account/data/delete
  │  Cognito JWT → sub → UUIDv5 → owner_id
  │  Core に POST /api/account/data/delete
  │    ├ 1. txn 開始
  │    │  2. WHERE owner_id = $1 で以下を DELETE
  │    │     v1_tile / v1_plan / v1_placement / v1_execution
  │    │     / v1_execution_segment / v1_change_set / v1_change
  │    │     / v1_change_value_text / v1_change_value_instant
  │    │     / v1_change_value_uuid / v1_change_value_role
  │    │     / v1_change_value_span
  │    │  3. OutboxEvent::DataDeleted 発行
  │    │  4. txn commit
  ↓
[Web] 200 OK → 完了画面表示(プロフィール不変を確認できる文言付き)
```

## マジックリンク仕様

| 項目 | 値 |
|---|---|
| トークン形式 | `base64url(HMAC-SHA256(secret, sub \|\| "\|" \|\| expiry_unix))` |
| `secret` | AWS Secrets Manager `tastile/account-delete-secret`(env: `TASTILE_ACCOUNT_DELETE_SECRET`) |
| 有効期限 | 24 時間 |
| 送信先 | Cognito `email` 属性(`email_verified=true` のみ) |
| 多重クリック防止 | jti を `v1_account_delete_request` に INSERT、使用時に `consumed_at` を更新 |
| レート制限 | `/api/account/delete/request` は同一 sub 5 分 1 回 / 24 時間 3 回 |
| メール文面 | 既存 SES 経由、customMessage Lambda で i18n(2026-07-06 spec と同じ経路) |

## エラーハンドリング

| エラーケース | 検出方法 | HTTP | UI 振る舞い |
|---|---|---|---|
| 未ログインで `/profile/danger/*` アクセス | middleware | – | 302 `/login?next=/profile/danger` |
| トークン無効 / 期限切れ | HMAC 検証 + expiry | 410 | 「リンクが無効です。再度リクエストしてください」+ リクエストボタン |
| トークン使用済み | jti の `consumed_at` | 410 | 「このリンクは処理済みです」 |
| レート制限超過 | token bucket | 429 | 「5 分後に再度お試しください」 |
| `email_verified=false` | Cognito describe | 403 | 「メールアドレス確認後に実行できます」+ `/auth/email/verify` 誘導 |
| SES 送信失敗 | SES client error | 502 | 「メール送信に失敗しました。1 分後に再度お試しください」 |
| Cognito `AdminDeleteUser` 失敗(post-PG-commit) | AWS SDK error | 500 | 「アカウント削除に失敗しました。サポートに連絡してください」+ 内部ログ、PG はロールバック済 |
| S3 avatar 削除失敗 | – | 200(ベストエフォート) | CloudWatch に metric、UI には見せない |
| データ削除: 対象 0 件 | SELECT COUNT | 200 | 「削除するデータがありません」 |
| データ削除: 同時 txn conflict | PG serialization | 409 | 「処理中です。少し待って再度お試しください」 |
| `typedText` 不一致 | クライアント側 + サーバー側両方 | 400 | ボタン disabled + 「'delete my account' と入力してください」 |

## データモデル追加

`v1_account_delete_request` テーブル(マイグレーション追加)

```sql
CREATE TABLE v1_account_delete_request (
    jti          UUID PRIMARY KEY,
    owner_id     UUID NOT NULL,            -- UUIDv5(JWT sub)
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address   INET NULL                 -- 監査用
);
CREATE INDEX idx_v1_account_delete_request_owner
    ON v1_account_delete_request (owner_id, requested_at DESC);
```

CASCADE 対象は既存 FK の ON DELETE CASCADE に依存。
実装時は `migrations/v1/` の V001〜V012 で
`v1_tile` / `v1_plan` / `v1_placement` / `v1_execution` /
`v1_execution_segment` / `v1_change_set` / `v1_change` /
`v1_change_value_*` が `v1_owner` への参照を持っているか確認し、
欠けていれば `ON DELETE CASCADE` を追加するマイグレーションを同梱する。

## 導線

3 箇所から `/profile/danger` へ遷移可能にする:

1. `/dashboard/preferences/account` の profile タブ最下部「アカウント管理」
   → 既存 `AccessTokenSection` の下に Danger Zone セクションを追加
2. `ProfilePanel`(`src/features/profile/ProfilePanel.tsx`)の最下部に
   「アカウント設定」リンクを追加(既に `/dashboard/preferences/account` がある場合は
   `/profile/danger` を直接指す)
3. `SiteFooter` に Danger Zone セクションを追加(`/profile/danger` 直リンク)

## テスト計画

### Core (Rust)

| テスト | 確認内容 |
|---|---|
| `account_repo::request_delete` | HMAC 生成・有効期限・SES send の mock 検証 |
| `account_repo::confirm_delete`(正常系) | 全テーブル `SELECT COUNT(*) WHERE owner_id = $1 = 0` をアサート。Cognito `AdminDeleteUser` が呼ばれる |
| `account_repo::confirm_delete`(トークン無効) | 410 を返す |
| `account_repo::confirm_delete`(使用済み) | DB jti 一致で 410 を返す |
| `account_repo::data_delete` | v1_tile / v1_plan / v1_placement / v1_execution / v1_execution_segment / v1_change_set / v1_change / v1_change_value_* のみ削除、`v1_owner` / `v1_owner_user` / `v1_owner_scope_profile` / `v1_owner_membership` は不変 |
| `account_repo::data_delete`(空状態) | 0 件でも 200、副作用なし |
| 統合テスト | `seed-bypass-demo.sql` で seed → `confirm_delete` → 全テーブル 0 件 + `v1_owner` が匿名化済を確認 |

### Web (Next.js)

| テスト | 確認内容 |
|---|---|
| `/profile/danger` middleware | 未ログイン → 302 to `/login?next=/profile/danger` |
| `/api/account/delete/request` レート制限 | 5 分 1 回 / 24 時間 3 回を超えると 429 |
| `/api/account/delete/confirm`(GET) | トークン検証 → 確認画面表示 |
| `MagicLinkConfirm` コンポーネント | 「アカウントを削除」ボタン押下 → POST → ローディング → 完了画面 |
| `DataDeleteSection` コンポーネント | `delete my data` 入力不一致時はボタン disabled、一致時のみ submit |
| `ProfilePanel` | 「アカウント設定」リンクが `/profile/danger` を指す |
| `SiteFooter` | `/profile/danger` リンクが Danger Zone セクションにある |

### E2E (Playwright)

| シナリオ | 期待結果 |
|---|---|
| ログイン → `/profile/danger` → 「アカウント削除」→ 確認メールリンクを踏む → 完了画面 → `/login` にリダイレクト | cookie クリア、再ログインで空状態 |
| ログイン → `/profile/danger/data` → `delete my data` 入力 → 送信 → 完了 | タイル履歴だけ消えてプロフィール残る |

## 実装順序

1. **Core**: `request_delete` / `confirm_delete` / `data_delete` ハンドラ
   + 統合テスト(Cargo)
2. **Web**: API route 4 本(`/api/account/delete/{request,confirm}`, `/api/account/data/delete`)
3. **Web**: `/profile/danger/{,account,data}` ページ + 既存 `/dashboard/preferences/account` へ導線
4. **Web**: `ProfilePanel` / `SiteFooter` 導線
5. **E2E**: Playwright で 2 シナリオ
6. **CI**: `cargo test` + `bun run check` + Playwright 緑化を確認

## セキュリティ / プライバシー

- マジックリンクトークンは **HTTPS 必須**(`app.tastile.app`)
- S3 avatar 削除は **best-effort**(失敗でユーザ体験を阻害しない)
- `v1_owner` を完全 DELETE せず**匿名化**にする理由: 外部参照
  (コメント / 他 owner の tile 共有) の FK 整合性を保つため
- `OutboxEvent::AccountDeleted` / `DataDeleted` を発行し、監査可能性を確保
- レート制限は IP 単位ではなく sub 単位(共有 IP 環境でも機能)

## ロールバック

- フィーチャーフラグ `account_deletion_enabled`(web + core)で false にすると
  API が 503 を返し、UI の導線も非表示になる
- 削除予約(soft delete)は採用しないため、誤って実行された場合の復元手段は
  Cognito backup(`fn-tastile-cognito-backup`)と PG の 7 日 backup snapshot
  に依存する

## オープン項目

- `tastile-core/migrations/v1/` V001〜V012 で `v1_tile` / `v1_plan` / `v1_placement` /
  `v1_execution` / `v1_execution_segment` / `v1_change_set` / `v1_change` /
  `v1_change_value_*` が `v1_owner` への参照を持つか、`ON DELETE CASCADE` が
  設定済みか確認(`v1_owner` は完全削除でなく匿名化なので、FK を切る必要は
  ないが child 行は削除される必要がある)
- Cognito `AdminDeleteUser` 失敗時の retry 戦略(本スペックでは実装せず、
  CloudWatch alarm で検出のみ)
- `email_verified=false` ユーザーに対して「先に email verify させる」
  フローの UX(本スペックではリンク誘導のみ)