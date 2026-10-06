---
id: adr.root.0020
status: Accepted
date: 2026-09-29
scope: all repositories
relates: [adr.root.0007, adr.root.0014, adr.root.0015, adr.root.0019]
gated_by: [poc.cloud-build-ci]
---

# ADR-0020: Build, CI, release, deploy — build once / promote by digest、private CI minutes を使わない

## Context

- release branch / Issue 番号 ticket branch / merge commit の workflow は ADR-0007 で確定している (変更しない)。
- tastile-core (private) の CI は 1 run ≈ 20 分 (Linux)。2026-09 の Actions 利用が $2 の hard cap に達し、2026-09-26 以降の
  core run は全て 0 step で失敗。その間に merge された変更で 3 test が壊れている (poc.core-suite-vanilla-pg)。
- deploy は tag push → workflow → SSM / systemd。core production deploy は ≈ 45 分で成功率 3/12。web は tag と package.json
  の version 不一致で失敗、Android は versionCode 重複で Play upload 失敗、Desktop は 4 桁 version と R2 digest mismatch。
- 2026-09-27 の web 初回 deploy で ≈ 72 秒の停止と rollback。

## Decision

1. **build once。** 各 service の OCI image は release commit から 1 回だけ build し、Artifact Registry に digest で置く。
   staging で検証した digest をそのまま production に promotion する (iso.one-artifact)。環境差は config / secret のみ。
2. **tastile-core の heavy CI と全 image build は Cloud Build** (e2-standard-2、PostgreSQL 付き)。
   private Core repositoryとの接続にCloud Build provider-managed GitHub connectionは使わない。
   `sa-ci-dispatcher` で動くTastile-owned dispatcherをCloud Schedulerから起動し、GCP-native authでInfisicalへ入り、
   Infisicalだけに保存したTastile CI GitHub App private keyからshort-lived installation tokenを生成する。
   dispatcherがCore PR/commitを取得してprivate GCS source bucketへuploadしCloud Build APIを呼び、結果をGitHub commit statusへ返す。
   dispatcherの毎分起動方式と費用はADR-0023で更新し、request課金の非公開Cloud Run serviceを使う。
   PR codeを実行する`sa-cloud-build-ci`にはGitHub credential / Infisical access / Artifact Registry write / deploy権限を与えない。
   private repositoryでGitHub Actions minutesを使わない (kpi.private-ci-spend = $0)。public repositoryはGitHub Actionsを使い続ける。
3. **merge 前 gate は CI の可用性に依存させない。** CI が使えない場合、PR に local full gate (実 PostgreSQL) の結果と commit SHA を
   evidence として添付すれば review 可能とする。CI 不可を理由に gate を省略しない。
4. **deploy = revision 作成 + migrate job + traffic 移動。** 手順は `core-migrate` job → `core-api` / `core-worker` / `web` の
   新 revision を no-traffic で作成 → smoke (/v1/ready、auth e2e) → traffic 100%。rollback は前 revision へ traffic を戻す
   (≤ 5 分, kpi.rollback-time)。migration は expand / contract で旧 revision と互換に保つ。
5. **version の単一正本は各 repository の manifest** (core `Cargo.toml [workspace.package]`、web `package.json`、cli `Cargo.toml`、
   android `versionName`、desktop 3 桁 SemVer)。tag は manifest から作り、手入力しない。Android `versionCode` は release job が
   Play の最新値 + 1 を取得して設定する。Desktop の 4 桁 assembly version は 3 桁 SemVer から導出する。
6. **journal。** production / staging への外部 mutation (deploy、migration、DNS、secret 更新) は docs/journal/<env>/ に記録する
   (docs/agent-orchestration.md §8)。deploy 済み state の正本は Cloud Run revision 一覧 (fd.deployed-state)。

## Alternatives considered

- **Core を public にして free minutes を使う**: Core のみ private の方針 (raw corpus 2026-07-22) に反する。
- **Actions の budget を上げる**: operator が拒否 (raw corpus 2026-09-28)。
- **self-hosted runner (開発機)**: 無料だが可用性が開発機に依存し、secret 境界が開発機に広がる。

## Consequences

- Cloud Build free tier 2,500 分 / 月で core CI ≈ 100 run 相当。超過分は $0.006 / 分。
- private Core CI の唯一の長期GitHub credentialは Tastile CI GitHub App private keyで、Infisicalだけに保存する。
  App ID / installation IDはnon-secret pointer。dispatcher以外へprivate keyを渡さない。
- 各 repo の release workflow を「tag = manifest version」「digest promotion」に揃える作業が ms.m3-core-staging〜ms.m5-clients に入る。

## Verification

poc.cloud-build-ci (Infisical-backed dispatcher、median ≤ 25 分、40 run / 月で ≤ 1,000 分、GitHub status報告、provider-managed GitHub credential 0) を ms.m2-foundation の exit 条件にする。
