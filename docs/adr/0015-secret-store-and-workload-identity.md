---
id: adr.root.0015
status: Accepted
date: 2026-09-29
scope: all repositories, all environments
relates: [adr.root.0012, adr.root.0014, adr.root.0020]
gated_by: [poc.infisical-workload-auth]
---

# ADR-0015: Secret store = Infisical、認証は workload identity を優先する

## Context

Tastile は既に Core / Web / CI で self-hosted Infisical を secret value の canonical store として運用している。
Core runtime は provider-native identity から短命 Infisical session を取得し、Web / GitHub Actions は OIDC 経路を持つ。
一方、architecture redefinition の初版では target runtime が GCP になることを理由に GCP Secret Manager を
application secret の正本へ変更した。

この変更は次の理由で撤回する。

- GCP への runtime 移行と secret control plane の移行は別問題であり、同時に行う必要がない。
- Secret Manager へ移すと、既に成立している Infisical の開発 / CI / runtime contract を再度移行することになる。
- GitHub Actions は OIDC machine identity、GCP workload は GCP-native identity で Infisical へ認証できるため、
  `INFISICAL_TOKEN`、GitHub Secret、GCP service-account JSON key のような secret zero は不要。
- Infisical を維持すると AWS → GCP 移行中も secret の編集元が変わらず、provider-neutral な secret contract を保てる。
- 開発者・agent・CI・runtime が「secret はどこにあるか」を一つだけ覚えればよい。

## Decision

1. **Tastile が管理する secret value / long-lived authentication material の唯一の編集可能な SoT は Infisical とする。**
   development / staging / production は Infisical の project / environment / machine identity で分離する。
2. **GitHub Actions → Infisical は OIDC machine identity を使う。**
   repository / environment / workflow claim を固定し、static Infisical token、GitHub Secret、service token を置かない。
3. **GCP runtime → Infisical は GCP-native workload identity auth を使う。**
   Cloud Run / Cloud Run Job の service account が発行できる短命 identity token を Infisical が検証し、
   service ごとの machine identity として必要な secret だけを取得する。固定 `INFISICAL_TOKEN` は禁止する。
4. **GitHub Actions → GCP control plane は GitHub OIDC → GCP WIF を使う。**
   これは secret delivery ではなく federated workload identity である。repository / ref / workflow を GCP 側でも限定し、
   long-lived GCP service-account key は作らない。
5. **platform binding が secret replica を要求する場合、Infisical から deploy 時に一方向同期する。**
   Cloudflare / Google Play / provider-specific binding は編集元にしない。値の変更は Infisical で行う。
6. **開発・CI/CD・deploy の認証に provider-managed static credential を使わない。**
   provider integration が GitHub App token / OAuth token 等を provider 自身の secret store へ保持する設計は採用しない。
   private Core CI は GCP workload identity で動く Tastile-owned dispatcher が Infisical から GitHub App private key を取得し、
   short-lived installation token を都度生成する。GCP Secret Manager は Tastile architecture の認証経路として使用しない。
7. **local development も Infisical を使う。**
   developer は人間の Infisical login から dev environment を取得する。production / staging secret を local に恒久保存せず、
   `.env*` は必要時の一時 materialization に限り gitignored / permission-restricted / fail-closed とする。
8. DB password、OAuth client secret、Stripe / email / R2 / VAPID / signing material 等の long-lived secret はすべて
   Infisical を canonical とする。将来 Cloud SQL IAM database authentication 等で secret 自体を除去できる場合は、
   secretを別storeへ移すのではなく credentialを廃止する。

## Authentication-material closure

開発・build・CI・deploy・runtime のために Tastile が選択・管理する長期認証 material は Infisical の外へ置かない。
provider が内部credentialを必要とする統合は、そのcredentialをTastileが管理できない場所に複製するのではなく、
workload identity + Infisical-backed application credentialで置き換える。

non-secret identifier (GCP service account name、Infisical identity ID、GitHub App ID / installation ID、project ID) は
repository / IaC に置いてよい。短命 OIDC / ID token / installation token は実行時だけ生成し、永続化しない。

## Consequences

- AWS → GCP cutoverで application secret の編集元は変わらない。
- Core / Web の既存 Infisical launcher / OIDC contract を target architectureでも継続できる。
- GCP runtimeは Infisical availabilityへ依存するため、Cloud Run cold start / scale-outを含む
  `poc.infisical-workload-auth` で latency / failure behaviorを実測する。
- self-hosted Infisical 自体の availability / backup / upgrade は継続運用対象になる。
- GCP Secret Manager application-secret migrationとCloud Build provider-managed GitHub credentialの両方が不要になる。
- ms.m8-decommission では Infisical を削除しない。AWS-specific auth path / legacy replicasだけを削除する。

## Verification

`poc.infisical-workload-auth` が以下を証明することを ms.m2-foundation / ms.m3-core-staging の gate とする。

- GitHub Actions OIDC → Infisical が static credential 0 で成立する
- pull request / unauthorized workflow から production secret を取得できない
- GCP workload identity → Infisical が static `INFISICAL_TOKEN` 0 で成立する
- service / environment を跨ぐ secret read が拒否される
- secret 不足時に build / runtime が fail-closed する
