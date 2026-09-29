---
id: adr.root.0015
status: Accepted
date: 2026-09-29
scope: all repositories, all environments
supersedes: [adr.root.0012]
relates: [adr.root.0014, adr.root.0020]
gated_by: [poc.secret-manager-wif]
---

# ADR-0015: Secret store = GCP Secret Manager、認証は workload identity のみ

## Context

ADR-0012 (2026-09-23) は self-hosted Infisical を secret の唯一の正本にした。その原則 (編集可能な store は 1 つ、
dotenv fallback 禁止、fail closed、CI は OIDC、repository に secret を置かない) は正しいが、実装面で次の evidence がある。

- Infisical OIDC verify workflow の成功は core 3/25・web 4/18。secrets migration workflow は失敗を繰り返し未完了
  (architecture/evidence/2026-09-29-github-ops.md)。
- self-hosted Free plan に folder ACL が無く、environment ごとの project 分割と DB 専用 project の例外 (ADR-0012 amendment) が
  必要になった。同一 environment では全 repository が互いの path を読める。
- runtime が起動時に Infisical から取得する設計では、user 運用の Infisical host の可用性が Tastile の起動・scale-out の
  可用性になる。Cloud Run は任意時刻に instance を起動する (ADR-0014)。
- Web の systemd 上で対話的 login を要求して restart loop になった。
- target runtime (ADR-0014) は GCP であり、runtime identity (service account) と CI identity (GitHub OIDC → WIF) を既に持つ。

## Decision

1. **environment ごとの GCP project (`tastile-dev` / `tastile-staging` / `tastile-prod`) の Secret Manager を、secret 実値の
   唯一の編集可能 store とする。** secret 単位 IAM で、使用する service account / CI identity だけに accessor を付与する
   (repository 間・service 間で読めない)。
2. **Cloud Run は Secret Manager 参照を環境変数 / volume として宣言し、platform が instance 起動時に解決する。**
   application は secret store の client を持たない。必須値が無ければ起動失敗 (sec.fail-closed)。
3. **GitHub Actions は OIDC → Workload Identity Federation**。attribute condition で repository・ref・workflow を限定し、
   publish / deploy job だけが secret を読む。PR job は読めない。Play Console 等 Google API は SA impersonation で呼び、
   JSON key を作らない。
4. **platform が要求する binding (Cloudflare Worker secret、R2 token、Google Play upload 等) は deploy job が Secret Manager から
   同期する replica** とし、編集は Secret Manager でのみ行う。
5. **local 開発は production / staging secret を使わない。** provider の dev credential が必要な場合だけ `gcloud` 認証後に
   dev project から一時取得し、使用後に消す。`.env.example` の方針は ADR-0012 と同じく key 名のみ・空値・runtime 非使用。
6. **Infisical は cutover 完了後に retire する** (ms.m8-decommission)。それまでは current runtime (AWS) の secret 経路として
   ADR-0012 の運用を継続し、Infisical 向けの新規統合作業 (OIDC 修正、追加 migration workflow) は行わない。
7. DB credential は Secret Manager の per-role secret (`tastile_app` / `tastile_migrator` / `tastile_auth`)。Cloud SQL IAM
   database authentication で password を無くせるかは oq.cloudsql-iam-authn で検証する。

## Alternatives considered

- **Infisical を継続し target runtime に統合し直す**: 原則は同じだが、folder ACL 欠如・self-host の可用性依存・既に失敗が
  多い OIDC 経路が残る。runtime / CI identity を GCP に一本化できる利点を捨てる。
- **Infisical Cloud へ移行**: self-host の運用は消えるが、GCP identity と二重管理になり、runtime 起動時の外部依存も残る。
- **Cloud Run の平文環境変数**: 無料だが project viewer に見え、version / audit / 回転が弱い。不採用。

## Consequences

- secret 1 version ≈ $0.06 / 月 (deployment.yaml node.prod.secrets)。
- ADR-0012 は Superseded (target)。current runtime についての記述は cutover まで historical-operative として残る。
- 各 repository の `.infisical.json`・Infisical action・`scripts/*infisical*` は ms.m8-decommission で削除する。

## Verification

poc.secret-manager-wif の全 criterion (long-lived key 0、PR job read 拒否、cross-repo read 拒否、secret 欠落時の起動失敗) が
passed であることを ms.m2-foundation の exit 条件にする。
