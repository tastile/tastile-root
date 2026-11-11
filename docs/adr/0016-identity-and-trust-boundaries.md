---
id: adr.root.0016
status: Accepted
date: 2026-09-29
scope: tastile-web, tastile-core, tastile-android, tastile-desktop, tastile-cli
relates: [adr.root.0010, adr.root.0014, adr.root.0015]
gated_by: [poc.jwt-assertion]
---

# ADR-0016: Identity and trust — Better Auth は IdP、Core は署名付き assertion と scoped token だけを信頼する

## Context

- 2026-08-22 の決定 (docs/decisions.md) で account 認証は Better Auth (web 内蔵) になり、Core は `v1_subject.external_subject`
  = Better Auth user id から owner を導出する。
- BFF → Core は shared secret `x-tastile-web-bridge-secret` と `x-tastile-web-session-user` header で user を表明する
  (core `api/src/handlers/common.rs`)。secret を持つ者は **任意 user** になれる。Web が侵害されれば全 user の data に届く。
- native client の token 取得が 3 系統に分かれている: Android / Desktop は `/api/mobile/api-token` に session bearer を送り
  PKCE なしで mint、CLI は `/cli/authorize` + `/api/cli/token` (PKCE S256、TTL ≤ 5 分、single-use)。Desktop は mint した
  token ではなく session token を v1 Bearer に使っている (oq.desktop-bearer)。
- Core には granular scope (`tastile.read` / `tastile.write`、OwnerAdmin) と中央 AuthContext が入った (core ADR-0012 / #176)。

## Decision

1. **Better Auth (cmp.web.auth) が唯一の identity provider。** account lifecycle、MFA、social login、email 検証を所有する。
   Core は password や social token を扱わない。
2. **BFF → Core は Better Auth が署名する短命 JWT (cred.web-core-jwt) だけで user を表明する。** EdDSA、aud=`tastile-core`、
   iss=web origin、sub=Better Auth user id、exp ≤ 5 分。Core は web の JWKS を cache して検証する (rel.core-jwks)。
   environment ごとに鍵が異なるため staging の token は production で通らない。bridge secret は ms.m4-web-staging で廃止する。
3. **native client と自動化は Core API token (cred.core-api-token) だけを使う。** 取得は共通の connect flow
   (Authorization Code + PKCE S256、system browser、app link / loopback redirect、TTL ≤ 5 分、single-use、scope 交差)。
   CLI の現行 flow を一般化し、`/api/mobile/api-token` は ms.m5-clients で廃止する。token は OS secure storage に置く。
4. **Core の AuthContext が唯一の認可点。** credential 種別は `api_token` と `web_assertion` の 2 つに収束させる。
   `x-owner-id` 等の開発用 header 経路は local / ci 以外で起動時に拒否する (iso.no-bypass-auth)。
5. **edge assertion は identity ではない。** origin 直アクセスを拒否するための低権限 header であり、認可判断に使わない。
6. 他 owner の resource は「存在しない」として応答する (ctl.owner-boundary)。

## Alternatives considered

- **bridge secret を維持し network で守る**: Cloud Run の web と core は同一 VPC を前提にしない。secret 漏洩時の blast radius
  が全 user のまま。不採用。
- **Core が Better Auth DB を直接読む**: Core が auth schema に結合し ctl.no-client-db の例外が増える。不採用。
- **Core に独自 OAuth server を実装**: identity を二重化する (Cognito 時代の反省)。不採用。

## Consequences

- Core に JWKS 検証 (EdDSA) を追加、web に better-auth `jwt` plugin を追加 (poc.jwt-assertion)。
- Android / Desktop の sign-in UI は system browser 経由に揃う。Desktop の native email/password form は廃止候補。
- API token の既定 TTL・rotation は ADR-0010 C02 の定義に従う。

## Verification

poc.jwt-assertion (negative case 全拒否、JWKS cache 時の追加 latency p95 < 2 ms、bridge secret 参照 0) を ms.m4-web-staging の
exit 条件にする。
