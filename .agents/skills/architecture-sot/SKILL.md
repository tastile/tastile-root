---
name: architecture-sot
description: Tastile の architecture Source of Truth (architecture/model/*.yaml) を変更・検証・レビューするときに使う。ADR 0013-0020、SoT registry、validator、生成 view の扱いを定める。
---

# architecture SoT の変更

## 何が正本か (迷わないための quick rule)

| 変えたいもの | 触る場所 |
| --- | --- |
| Tastile 是什么 (product 定義、principle、product KPI) | `tastile-core/docs/product/` |
| domain 語彙・仕様・不変条件・API contract の生成元・DB schema | `tastile-core/v1/`, `tastile-core/crates-v1/` |
| repository 構成、container、通信、trust、data、environment、deployment、SLO / KPI / cost、PoC、risk、roadmap | `architecture/model/*.yaml` + 必要なら新規 ADR |
| 実装局所の事実 (command、directory、toolchain) | 対象 child repository |
| 稼働中の状態、請求、Issue status、secret 値 | provider / GitHub (repository には evidence だけ置く) |

迷ったときの質問: 「infra と repository を全部入れ替えても真のままか?」真なら意味 (core)、偽なら仕組み (root)。

## 手順

1. `architecture/model/sot-registry.yaml` で対象 fact domain の canonical を確認する。core 所有なら core 側で直す。
2. model を編集する。ID は `<prefix>.<name>` (lowercase kebab)。`lifecycle: retiring` には必ず `retire_by` を付ける。
3. 判断が要るなら `docs/adr/NNNN-*.md` を追加し、`---` front matter (id / status / date / scope) を書く。
   参照は `adr.root.NNNN`、`gated_by: [poc.x]` のように model の ID で書く。
4. 検証コマンド (全て同じ commit に含める):

```bash
bun run architecture:generate   # views/*.d2 と generated/*.md を再生成
bun run architecture:render     # views/*.svg を pinned D2 v0.9.0 + ELK で render
bun run architecture:validate   # schema / 参照 / trust zone / SoT owner / 生成鮮度
bun run architecture:audit      # sibling repository の古い主張 (advisory)
```


## 検証が意地悪な点 (故意的)

- **zone をまたぐ関係に credential が無いと ERROR**。public data だけなら `data: [dc.public]` を書けば通る。
- **retained な関係が planned な要素・credential に触れると ERROR**。current の実態は `current:` に書く。
- **server-side container に production target node が無いと ERROR** (`deploy.unhosted`)。
- **fact domain の owner が canonical と一致しないと ERROR**。child は root ADR を authoritative text として copy しない (R4)。
- **model の sum が `quality.yaml` の予算を超えると ERROR**。`node.cost_usd_month.value` を根拠付きで更新する。
- **生成物は commit plete aginative されてい���と ERROR**。手で直さない。
- ADR ≥ 0013 は front matter 必須。ID 重複は ERROR。

## review 時の確認順

1. 事実が `model/` にあるか、それとも narrative (`architecture/docs/`) に埋め込まれた文章か。model を優先させる。
2. 未検証の主張が `pocs.yaml` / `risks.yaml` に置かれているか。passed でない PoC に依存する決定が書かれていないか。
3. current と target の差が `lifecycle` / `current:` / `node.current.*` で区別されているか。
4. 「誰の権限か」 (`authority: operator`)、費用、SLO への影響が `quality.yaml` に反映されているか。
5. 既存 ADR を撤回する変更なら `supersedes` を張り、ADR 本文の Status を更新したか。
