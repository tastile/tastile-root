---
id: adr.root.0013
status: Accepted
date: 2026-09-29
scope: tastile-root, tastile-core, all child repositories
relates: [adr.root.0007, adr.root.0011, adr.root.0012]
---

# ADR-0013: Architecture Source of Truth — model-first、意味 / 仕組みの ownership 分離

## Context

- 2026-09-29 までの architecture 情報は `docs/HARNESS.md`、`docs/decisions.md`、各 child の AGENTS / README / CLAUDE、
  core の `v1/`・`HARNESS.md`・`docs/production/`、会話履歴に分散していた。同じ事実が複数箇所で異なる値を持っていた
  (例: v1 正本が「00..14」「15 ファイル」「16 ファイル」、認証が Cognito と Better Auth、infra が「3 台構成」「Docker 禁止」
  と WSLC container / Containerfile の併存、tastile-brands が local に存在する前提)。
- 「生活のフレームワーク」の検討で root と core のどちらが product 方針の正本かが揺れ、user は core を正本と指摘した
  (raw corpus 2026-09-26〜27、core#172)。
- 文章だけの SoT は drift を機械的に検出できず、agent は会話履歴なしに正しい現在地を再構成できなかった。

## Decision

1. **事実の種類で ownership を分ける (sot-registry.yaml R2)。**
   - 意味 (product 定義・product KPI・domain 語彙・domain 仕様・API contract の生成元・DB schema) → `tastile-core`。
   - 仕組み (repository 構成、container / component、通信、trust boundary、data lifecycle、environment、deployment、
     SLO・engineering KPI・cost、PoC、risk、移行 roadmap、system ADR、開発 workflow) → `tastile-root/architecture/`。
   - 実装局所の事実 (command、directory、toolchain) → 各 child repository。
   - live state (deploy 済み revision、請求額、Issue status、secret 値) → provider / GitHub。repository は日付付き evidence のみ。
2. **model-first。** 仕組み層の正本は `architecture/model/*.yaml` (JSON Schema `architecture/schema/`) とする。
   人間向け narrative は `architecture/docs/`、図は model から生成する D2 (`architecture/views/*.d2`、SVG は pinned D2 で
   render)、一覧表は生成 catalog (`architecture/generated/`)。生成物は手編集しない。
3. **表現の選択。** 図は D2 を採用し、layout は決定的な ELK を既定とする。TALA は手動検討用に使ってよいが正本の render
   には使わない (node 追加で配置が大きく変わり diff review できないため)。図は正本ではなく view である。
4. **一意性を validator で強制する。** `bun run architecture:validate` が schema、ID 一意性、参照整合、trust zone 横断の
   認証有無、production 配置漏れ、cost budget、SoT owner の一意性と path 実在、core glossary anchor、canonical prose の
   禁止語、ADR front matter、PoC 判定の整合、生成物と render の鮮度を検査する (exit 0 / 1 / 2)。
   `--cross-repo` は child の古い正本主張を advisory として列挙する。
5. **既存文書の扱い。** `docs/HARNESS.md` は pointer に縮退する。`docs/decisions.md` は 2026-09-29 で凍結した履歴 log とし、
   新しい判断は ADR (≥ 0013 は YAML front matter 必須) で書く。`docs/raw/`・`docs/archive/` は evidence であり authority ではない。
6. **ADR の名前空間。** root ADR は `adr.root.NNNN`。child の repository-local ADR は同じ番号でも別物であり、root ADR の
   copy を child に authoritative text として置かない (R4)。

## Alternatives considered

- **Structurizr DSL / C4-PlantUML を正本にする**: C4 に特化し view 生成も可能だが、SoT registry・SLO・PoC・cost・
  roadmap のような非構造図の事実を表せず、別正本が必要になる。YAML + JSON Schema は言語中立で Bun の validator から扱える。
- **D2 を正本にする**: layout は良いが、ownership・lifecycle・credential 等の属性検査ができない。view に留める。
- **root に product 定義も置く**: public root から読めて便利だが、user が core を product 方針の正本と明示しており、
  domain 語彙との整合を同じ repository 内で保てる core が妥当。root は pointer のみ持つ。

## Consequences

- 仕組みの事実を変える PR は model を変更し、`architecture:generate` / `architecture:render` の結果を同じ PR に含める。
- child repository の文書は事実を再記述せず link する。既存の古い主張は `architecture:audit` の advisory が消えるまで順次修正する。
- core が private のため public root から core の product 定義は読めない。root の narrative は derived summary であることを明記する。

## Verification

- `bun run architecture:validate` PASS (root CI `Root quality gate` の architecture job)。
- `bun run architecture:audit` の advisory 件数を `kpi.canonical-conflicts` として追跡する。
