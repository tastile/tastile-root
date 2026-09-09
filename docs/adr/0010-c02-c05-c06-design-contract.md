# ADR-0010: C02 / C05 / C06 design contract — credential expiry, delivery provider, account deletion

- 日付: 2026-09-08
- 状態: Accepted (C00 design-decision 確定)
- 対象:
  - `tastile-core/crates-v1/api/src/handlers/auth.rs`
  - `tastile-core/crates-v1/api/src/handlers/common.rs`
  - `tastile-core/crates-v1/api/src/handlers/owner.rs` (新規)
  - `tastile-core/crates-v1/api/src/openapi.rs` (C06 で path 追加)
  - `tastile-core/crates-v1/storage/src/delivery_driver.rs`
  - `tastile-core/crates-v1/storage/src/session_repo.rs` (owner 単位 revoke を C02/C06 で共用)
  - `tastile-core/crates-v1/worker/src/delivery_tick.rs`
  - `tastile-android/app/src/main/java/app/tastile/android/data/notification/PushEndpointRepository.kt` (現状維持)
  - `tastile-core/docs/production/v1-core-release.md` (env 投入項目)
- 先行 ADR: [ADR-0006](./0006-kms-viaservice-removal.md) (関連, KMS 不要化の一環), [ADR-0007](./0007-release-branch-and-ticket-workflow.md) (連動), [ADR-0009](./0009-github-projects-work-state.md) (関連)
- 後続 ADR: なし (C07 / C03 / C04 / W02 / W04 / A02 / A04 は本 ADR 完了が前提)
- canonical: [agent orchestration policy](../agent-orchestration.md) §7 (ADR lifecycle)
- Issue 起点:
  - [tastile-core#121 (C00)](https://github.com/tastile/tastile-core/issues/121) — design-decision ticket
  - [tastile-core#115 (C02)](https://github.com/tastile/tastile-core/issues/115) — credential + device logout
  - [tastile-core#118 (C05)](https://github.com/tastile/tastile-core/issues/118) — notification worker + delivery provider
  - [tastile-core#119 (C06)](https://github.com/tastile/tastile-core/issues/119) — account deletion + data export
  - [tastile-root#3 (R02)](https://github.com/tastile/tastile-root/issues/3) — operator-side env 投入

## Context

2026-09-19 free Web + Android 公開のため、`tastile-core` の公開契約として

1. **credential 期限** が明示的でなく、`auth.rs:140-176` が `expires_at=None`
   を許容する。mobile / web 発行 credential が無期限になり得る。
2. **device logout** が `Authorization: Bearer` のみ revoke し、cookie 経路
   (`Cookie: tastile_api_token=…`) の session / token を見直さない。Cookie は
   別経路で残存する (C02 ticket 裏付けの観測結果)。
3. **通知配送** は Core 側で `Fake` / `Http` provider を選択肢として持つ
   (`crates-v1/storage/src/delivery_driver.rs`)。Android 側は
   `PushEndpointRepository.kt` で FCM を撤去済み (no-op provider)。9/19 free
   release で FCM を再有効化するかの判断が C05 ticket で未確定。
4. **アカウント削除 / export endpoint** が存在しない (grep 0 hit)。GDPR/
   個人情報保護の観点で本人による削除 + データ取得の最小契約が必要。

これら 4 軸は相互依存し、単独 ADR では contract が分断される。**公開に必要な
3 つの contract を 1 ADR で固定**し、C02 / C05 / C06 実装 ticket の AC 具体値
と C07 (OpenAPI revision) のスキーマ確定の双方の前提を提供する。

## Decision

### D-1. C02: credential 期限 + device logout の contract

- **D-1.1 期限必須化**. `ApiTokenCreate.expires_at` / `SessionCreate.expires_at`
  は server-side validate で `Some(_)` を要求する。未指定は 400
  `domain::ApiErrorKind::Validation` を返す。`auth.rs:140-176 permits expires_at=None`
  を塞ぐ。
- **D-1.2 signout の cookie 拡張**. `pub async fn signout` は
  `Authorization: Bearer <raw>` を第一に、`Cookie: tastile_api_token=<raw>` を
  fallback として参照する。両者の raw を hash → `session_repo::lookup_by_hash`
  → `revoke(pool, id)`。優先順位は Bearer > Cookie (2026-07-22 固定 contract
  を維持)。`bridge_auth` は signout 対象外 (web session は別途).
- **D-1.3 revoke の冪等性**. `session_repo::revoke` は `revoked_at IS NULL` を
  条件に更新、affected rows = 0 でも 200 を返す。1 device logout が all device
  logout に副作用しない。
- **D-1.4 既存 cookie contract の保全**. `bearer_auth_result` の
  Bearer > Cookie 優先順位、`bearer_wins_over_cookie_when_both_present` 等 7 ケース
  (`crates-v1/api/tests/authenticate_cookie_fallback.rs`) は維持。新規
  integration test `signout_revokes_cookie.rs` を 1 件追加。

### D-2. C05: 配送 provider + Android push の contract

- **D-2.1 provider は `fake` / `http` 2 値**.
  `DeliveryProviderConfig::from_values` の prod 偽装拒否 (既存 contract) を維持。
  staging / development では `fake` を許容。
- **D-2.2 HTTP provider の 3 endpoint**.
  `${TASTILE_DELIVERY_BASE_URL}/{push, web-push, email}` の 3 url を持たせる
  (既存)。channel i16 = 0 を web_push、1/2 を push、3 を email のマッピングは
  現状維持。
- **D-2.3 Android push = VAPID + email**.
  Android 側 `PushEndpointRepository.kt` は no-op を維持 (FCM 再有効化なし)。
  9/19 free release の Android 通知経路は web push (VAPID) + email のみとし、
  in-app / local notification で代替する。これは本 ADR 時点で **no-push**
  ポリシーの継続採用。
- **D-2.4 log 経路**. `FakeProvider` は `token_len` のみ log、token 値は
  出さない (既存 contract 維持)。`HttpDeliveryProvider` は
  `reqwest::bearer_auth(...)` を `.send()` 前に tracing 経路に乗せない。
- **D-2.5 retry / claim**. `delivery_tick::drive_delivery_batch` の SKIP LOCKED
  + `claim_token` + `idempotency_key` 構造は現状維持。`MAX_ATTEMPTS=8` を
  C05 で改訂しない。

### D-3. C06: アカウント削除 + data export の contract

- **D-3.1 削除モデル = 論理削除 (tombstone + 30 日保持)**. `v1_subject.state`
  を 3 (Deleted) に遷移、所有 resource (tile, execution, placement, delivery,
  endpoint など) は `owner_id = NULL` 化 + `anonymized_owner_id` を新規 column
  として migration 追加。30 日間保持後、別 ticket の非同期 job (`migrate_run`
  系の延長) で physical delete。
- **D-3.2 endpoint**.
  - `DELETE /v1/owners/0/{id}` — tombstone + revoke。同時 revoke 対象は
    `v1_session` / `v1_api_token` / `v1_endpoint.disabled_at`。
  - `GET /v1/owners/0/{id}/export` — JSON Lines 形式 (`v1_subject`, `v1_session`,
    `v1_api_token`, `v1_tile`, `v1_placement`, `v1_execution`, `v1_delivery`,
    `v1_endpoint` の主要 column)。
- **D-3.3 保持例外**.
  - **保持**: `v1_outbox_event` / `v1_revision` / `stripe_*` (法的義務、
    web 側 `subscription_*` を含む)。`owner_id` を NULL 化して本人特定を
    断つ。
  - **即時削除**: profile (`v1_owners`)、session / api_token / endpoint
    の `v1_*` レコード、PII を含む `v1_email` / `v1_phone` 等の補助 table。
  - **backup snapshot は 30 日経過後の physical delete 完了まで保持**。
- **D-3.4 本人認証**. 既存 `authenticate` (Bearer > cookie > bridge) のみで
  owner 本人を判定。re-auth / email confirmation は本 ADR では要求しない。
  `require_owner(kind=0, id)` で本人以外は 404 (id 存在を leak しない)。
- **D-3.5 削除完了応答**. 200 OK + JSON body
  `{ "deleted_at": <iso8601>, "retention_until": <iso8601+30d>,
     "kept": ["v1_outbox_event", "v1_revision", "stripe_*"] }`。
- **D-3.6 冪等性**. 30 日以内の 2 回目 DELETE は tombstone 確認応答として
  200 OK を返す。
- **D-3.7 OpenAPI schema**. `crates-v1/api/src/openapi.rs` に新 path 2 件
  (`/v1/owners/{kind}/{id}` DELETE、`/v1/owners/{kind}/{id}/export` GET) と
  応答 schema を追加。C07 で revision 発行の前提となる。

### D-4. 公開 contract 間の整合

- C02 / C06 共に `session_repo::revoke` を共用、C06 で追加する
  `session_repo::revoke_all_for_owner(pool, owner_id)` は C02 の (将来)
  全 device logout endpoint でも再利用できる (本 ADR では実装しない)。
- C05 の prod 偽装拒否は R02 (root#3) operator 側で投入する
  `TASTILE_DELIVERY_PROVIDER=http` の前提。C02/C06 変更とは独立。
- C06 の tombstone は C03 / C04 (Basis 永続化 / 完了評価) と独立。Basis の
  `execution_basis` を tombstone 後に読む経路は C07 で再評価する。

## Acceptance Criteria

### C02 (post-decision AC 具体値)

- [ ] `ApiTokenCreate` / `SessionCreate` の `expires_at` は server 側
  validate で必須 (未指定 → 400 Validation)。
- [ ] `signout` は Bearer + Cookie (`tastile_api_token`) 両方を revoke。
  優先順位は Bearer > Cookie (既存 contract 維持)。
- [ ] revoke は idempotent (existing `revoke(pool, id)` 維持)。
- [ ] bridge auth は signout 対象外。
- [ ] `authenticate_cookie_fallback.rs` 7 ケース全 pass。
- [ ] `bridge_auth.rs` 8 ケース全 pass (C01 と共有)。
- [ ] 新規: `signout_revokes_cookie.rs` integration test (cookie 経路 revoke の
  contract pin)。

### C05 (post-decision AC 具体値)

- [ ] `DeliveryProviderConfig::from_values` の prod fake 拒否 contract 維持。
- [ ] staging / development では fake OK を維持。
- [ ] Android 側 `PushEndpointRepository.kt` の no-op を維持、FCM 復帰は別
  ticket。9/19 release の Android 通知経路は web push (VAPID) + email + in-app
  のみ。
- [ ] Core http provider の 3 endpoint (push / web_push / email) は維持。
- [ ] `delivery_tick` の SKIP LOCKED + `claim_token` + `idempotency_key` 構造
  は維持、`MAX_ATTEMPTS=8` は改訂しない。
- [ ] 9/19 production で operator が `TASTILE_DELIVERY_PROVIDER=http` +
  `TASTILE_DELIVERY_BASE_URL=https://...` + `TASTILE_DELIVERY_PROVIDER_TOKEN`
  + `TASTILE_DELIVERY_KEY` を投入できる状態にする (これは R02 連動)。

### C06 (post-decision AC 具体値)

- [ ] `DELETE /v1/owners/0/{id}` で tombstone (`v1_subject.state = 3`)。
  `retention_until` = now + 30 days を返す。
- [ ] `GET /v1/owners/0/{id}/export` で JSON Lines 形式 (`v1_subject`,
  `v1_session`, `v1_api_token`, `v1_tile`, `v1_placement`, `v1_execution`,
  `v1_delivery`, `v1_endpoint` の主要 column)。
- [ ] 削除時: `v1_session` / `v1_api_token` / `v1_endpoint.disabled_at` を
  同時 revoke。
- [ ] 保持例外 (AC 明示): `v1_outbox_event` / `v1_revision` / `stripe_*` 系は
  保持、`owner_id` を NULL 化。
- [ ] 30 日経過後の physical delete は `migrate_run` 系の非同期 job で実行
  (本 ADR のスコープ外、別 ticket で扱う)。
- [ ] `authenticate` の既存 contract (Bearer > cookie > bridge) は維持、
  `require_owner(kind=0, id)` で本人認証 (id 存在 leak を防ぐ)。
- [ ] 冪等: 2 回目 DELETE も 200 OK (tombstone 確認応答)。
- [ ] export / delete は OpenAPI schema に追加 (`crates-v1/api/src/openapi.rs`)。
- [ ] DELETE の同時 revoke 対象 storage path は 1 transaction にまとめ、
  失敗時 partial delete を許容しない (DELETE は all-or-nothing)。

## Roll-out / Migration

### M-1. C02 の rollback

- `expires_at` 必須化は contract breaking。モバイル / Web 側で未指定 credential
  を発行している箇所がないかを `tastile-web` / `tastile-android` に対して
  grep-確認 (Luna implementer が C02 着手時)。
- 既存 mobile / web 経路が未指定で発行されている場合、C02 着手時に先に
  default 補完 (server が 30 day default を自動補完) を 1 release 挟み、
  次の release で必須化する二段 rollout を取る。
- C02 PR はこの ADR と D-1.1/D-1.2 を満たした上で、`authenticate_cookie_fallback`
  + `bridge_auth` の既存 test を pass することを必須とする。

### M-2. C05 の rollback

- `fake` provider の staging / development 許容は維持。9/19 production deploy
  時に `TASTILE_DELIVERY_PROVIDER=http` を入れ損なった場合、`from_values` が
  `None` で error を返し、worker tick が `RepoError::Conflict` で fail — 即座
  に観測される。rollback = fake 戻しは staging のみで可能、本番では
  `from_values` の None rejection を保ったまま provider 投入を operator が
  行う。

### M-3. C06 の rollback

- 物理削除 job (30 日経過後の `migrate_run` 延長) は本 ADR のスコープ外。
- tombstone 状態から 30 日以内に user が manual restore を要求した場合:
  `v1_subject.state` を 0 (Active) に戻し、`v1_session` / `v1_api_token` /
  `v1_endpoint.disabled_at` は新規発行の所有者 user が signin 時に再発行。
- 30 日経過後は hard delete — 復元不可。support 経由の個別対応のみ。

## Trade-offs

- **無期限 credential を残す選択肢 (A)** を排し、handler required 化 (D-1.1) を
  採用。理由は、no-op の mobile / web 経路で期限管理を忘れるリスクが public
  release の active threat のため。client 側の修正コストは 30-day default
  補完 (M-1) で吸収する。
- **physical delete immediate (B)** を排し、論理削除 + 30-day retention (D-3.1)
  を採用。理由は、Stripe 法的義務 (D-3.3) と audit log 保持を 1 release 内で
  満たすため。30 日保持のコスト (storage) は backup retention と合算で許容。
- **FCM 再有効化 (C)** を排し、no-push 継続 (D-2.3) を採用。理由は、9/19 free
  release で FCM プロジェクト新規作成 + google-services.json 投入 +
  Firebase Console 設定の運用負荷が critical path に乗らないため。Android
  通知は web push (VAPID) で代替、後続 sprint で再評価可能。
- **delete の all-owner wipe (D)** を排し、tombstone + anonymization (D-3.1)
  を採用。理由は、C02 の all-device-logout 系の将来拡張で tombstone state を
  reuse でき、storage migration 回数を抑えられるため。

## Verification

- C02: `cargo test --manifest-path crates-v1/Cargo.toml -p api
  --test signout_revokes_cookie` (新規)、`cargo test --manifest-path
  crates-v1/Cargo.toml -p api --test authenticate_cookie_fallback` (既存 7
  ケース)、`cargo test --manifest-path crates-v1/Cargo.toml -p api --test
  bridge_auth` (既存 8 ケース)。
- C05: Core full gate (実 DB) + worker と実 provider の配送記録 (R02 連動)。
  `cargo test --manifest-path crates-v1/Cargo.toml -p storage --lib
  delivery_driver` を prod / staging fake でそれぞれ確認。
- C06: Core API/storage integration (実 DB) + OpenAPI schema gate。`cargo test
  --manifest-path crates-v1/Cargo.toml -p api --test owner_account_lifecycle`
  (新規) で tombstone + export の contract pin。

## Open follow-up tickets (本 ADR では実装しない)

1. C03 (tastile-core#116) — Basis 値永続化
2. C04 (tastile-core#117) — Basis からの完了評価
3. C07 (tastile-core#122) — OpenAPI revision (本 ADR の D-3.7 を input に revision)
4. W02 / W04 (Web 側 ticket) — BetterAuth / Stripe 連携
5. A02 / A04 (Android 側 ticket) — delivery contract / Closed-testing release
6. physical-delete job (post-30-day) — `migrate_run` 系の非同期 job 追加
