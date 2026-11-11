# 07 Source of Truth and ownership

正本: `model/sot-registry.yaml` (fact domain → canonical location)、`model/repositories.yaml` (repository の責務)。
一覧: [generated/sot-registry.md](../generated/sot-registry.md)、[generated/repositories.md](../generated/repositories.md)。判断: ADR-0013。

## 一意性の規則

- **R1** fact domain ごとに canonical は 1 つ。他は derived (生成) か pointer (link のみ)。
- **R2** 事実の種類で分ける:
  - 意味 → tastile-core (product 定義、product KPI、domain 語彙・仕様・不変条件、API contract の生成元、DB schema)
  - 仕組み → tastile-root `architecture/` (構造、通信、trust、data lifecycle、environment、deployment、SLO / KPI / cost、PoC、risk、roadmap、system ADR、workflow)
  - 実装局所 → 各 child repository (command、directory、toolchain、local pitfall)
  - live state → provider / GitHub (deploy 済み revision、請求、Issue status、secret 値)
- **R3** 食い違ったら canonical が正しく、他方は修正すべき defect。履歴 (docs/raw、docs/archive、凍結 log) は evidence。
- **R4** child は root の ADR / schema / skill を authoritative text として copy しない。repository-local ADR は repository ごとの番号空間。
- **R5** live state は live system が持つ。repository には日付付き snapshot だけを置く。

迷ったら: 「infra と repository がすべて入れ替わっても真のままか?」 → 真なら意味 (core)、偽なら仕組み (root)。

## Repository の責務

| repository | 役割 | 主な所有 fact domain |
| --- | --- | --- |
| repo.root | workspace shell。仕組みの正本、governance、agent tooling、横断検証、edge 設定の宣言、履歴 | fd.system-architecture ほか (sot-registry 参照) |
| repo.core | 意味の正本と Core 実装 (api / worker / migrate) | fd.product-definition、fd.domain-language、fd.domain-spec、fd.api-contract、fd.db-schema |
| repo.web | Web 実装と auth schema | fd.web-implementation、fd.auth-schema |
| repo.android / repo.desktop / repo.cli | 各 client 実装 | fd.*-implementation、fd.download-channel (desktop) |
| repo.openapi | 生成 contract の配布 (手編集禁止) | fd.api-contract-distribution |
| repo.brands | brand asset (consumer は copy、相対参照禁止) | fd.brand-assets |

root は production artifact / build / runtime の依存にならない。child は standalone で clone / build / test できる。

## 既存文書の位置付け (2026-09-29 の再配置)

| 文書 | 新しい位置付け |
| --- | --- |
| root `docs/HARNESS.md` | pointer (本 directory への入口)。事実を持たない |
| root `docs/decisions.md` | 2026-09-29 で凍結した履歴 log。新しい判断は ADR |
| root `docs/adr/0001..0012` | 有効な判断 (0006 / 0012 は superseded)。0013 以降は front matter 付き |
| root `docs/agent-orchestration.md` | 開発 workflow の正本 (fd.dev-workflow) |
| root `docs/raw/`, `docs/archive/` | evidence |
| core `v1/00..15` | domain 仕様の正本 (00 = 語彙) |
| core `docs/product/` | product 定義と product KPI の正本 (新設) |
| core `HARNESS.md` / `v1/HARNESS.md` | Core 実装 harness (実装局所) |
| core `docs/production/` | current (AWS) runtime の手順。target については root が正本 |
| child `AGENTS.md` | 実装局所の事実のみ。system / domain の事実は link |

## 語彙

- domain 語 (Tile、SourceTile、Placement、Execution、Window、ChangeSet、Session、Delivery、Prompt …) は core
  `v1/00-glossary.md` が正本。root の [glossary](../generated/glossary.md) は pointer を持つだけで再定義しない。
- system 語 (environment、artifact、promotion、drain cycle、edge assertion …) は root `model/glossary.yaml` が正本。
- 衝突する語は disambiguation に従う: 単独の "session" を使わず "Session (Decision)" / "account session"、software の配置は
  "deploy" / "release" で "Delivery" と言わない、gate の BLOCKED と Effective の BLOCKED を区別する。

## 検査

`bun run architecture:validate` は owner の一意性、canonical path の実在 (checkout がある repository)、core glossary の anchor、
canonical prose の禁止語を検査する。`bun run architecture:audit` は child の古い主張・root ADR の copy を advisory として列挙する
(kpi.canonical-conflicts)。
