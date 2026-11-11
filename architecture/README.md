# Tastile architecture — Source of Truth (mechanism layer)

この directory は Tastile の **仕組み** (repository、container / component、通信、trust boundary、data lifecycle、
environment、deployment、SLO / KPI / cost、PoC、risk、移行 roadmap) の正本である。
**意味** (product 定義、domain 語彙・仕様、API contract の生成元、DB schema) の正本は `tastile-core` にある。
どの事実がどこで canonical かは [`model/sot-registry.yaml`](model/sot-registry.yaml) が一意に決める (ADR-0013)。

会話履歴を知らなくても、次の順に読めば現在地と進め方が分かる。

## 読む順番

1. [docs/01-context-and-goals.md](docs/01-context-and-goals.md) — Tastile は何か (core 正本への pointer)、品質目標、制約
2. [docs/07-sot-and-ownership.md](docs/07-sot-and-ownership.md) — 何がどこで canonical か、repository の責務
3. [docs/02-structure.md](docs/02-structure.md) — context / container / component と通信
4. [docs/03-trust-and-security.md](docs/03-trust-and-security.md) — trust zone、credential、secret
5. [docs/04-data.md](docs/04-data.md) — data store、backup、retention
6. [docs/05-infrastructure-and-environments.md](docs/05-infrastructure-and-environments.md) — target infra と判断根拠、environment
7. [docs/06-delivery-and-operations.md](docs/06-delivery-and-operations.md) — build / release / deploy / SLO / 運用
8. [docs/08-migration-roadmap.md](docs/08-migration-roadmap.md) — current → target の milestone と gate
9. [docs/09-evidence-and-unknowns.md](docs/09-evidence-and-unknowns.md) — evidence、未検証事項、既知の矛盾

一覧表は [generated/](generated/README.md)、図は [views/](views/) (D2 source と SVG)。

## 構成

| path | 役割 | 編集 |
| --- | --- | --- |
| `model/*.yaml` | 構造化された正本 | 手で編集する |
| `schema/*.schema.json` | model の JSON Schema (2020-12) | model の形を変えるときだけ |
| `docs/*.md` | 判断理由と読み方の narrative。事実は model の ID で参照する | 手で編集する |
| `views/*.d2`, `views/*.svg` | model から生成した図 | 生成のみ (手編集禁止) |
| `generated/*.md` | model から生成した一覧表 | 生成のみ (手編集禁止) |
| `evidence/*.md` | 日付付きの観測記録 (PoC、運用状態、価格) | 追記のみ。上書きせず新しい日付 file を足す |
| `../docs/adr/` | system-level の判断 (ADR ≥ 0013 は YAML front matter 付き) | 手で編集する |

## Commands

```bash
bun install --frozen-lockfile
bun run architecture:generate   # model → views/*.d2, generated/*.md
bun run architecture:render     # views/*.d2 → views/*.svg (pinned D2 v0.9.0, ELK layout)
bun run architecture:validate   # schema, references, trust boundaries, SoT ownership, freshness (exit 0/1/2)
bun run architecture:audit      # + sibling repositories: stale / duplicated canonical claims (advisory)
```

`architecture:validate` の終了コードは workspace 共通 (`0=PASS`、`1=FAIL`、`2=BLOCKED`)。BLOCKED は PASS ではない。

## 変更手順

1. 変えたい事実の fact domain を `model/sot-registry.yaml` で引き、canonical location を確認する。
   - core 所有 (意味) なら tastile-core で変更する。root には pointer しか置かない。
2. 仕組みの事実なら `model/*.yaml` を変更する。判断を伴う場合は ADR を追加し、model から `adr.root.NNNN` で参照する。
3. `architecture:generate` → `architecture:render` → `architecture:validate` を実行し、生成物を同じ commit に含める。
4. 未検証の前提は `model/risks.yaml` (open question / risk) か `model/pocs.yaml` (検証計画) に置き、確定事項として書かない。

## ID 規約

`<prefix>.<name>` (lowercase kebab-case)。prefix: `actor` `sys` `ctr` `cmp` `ext` `rel` `repo` `fd` `term` `env` `iso`
`prov` `node` `tz` `cred` `dc` `sec` `ctl` `store` `ds` `qg` `slo` `kpi` `poc` `f` `risk` `oq` `ms`、ADR は `adr.root.NNNN`。
一度公開した ID は意味を変えずに使い続け、廃止は `lifecycle: retiring` + `retire_by` で表す。
