---
name: cross-repo-contract-check
description: Tastile の変更が複数 child repository、API、schema、auth flow、または client 間の共有挙動に触れるときに使用する。
---

# Cross-repository contract check

root は child を ignore するため、root の clean status は child の状態を証明しない。
`verify-tastile-change` が各 package の実行証跡を確認するのに対し、この Skill は producer
と全 consumer の contract が一致するか確認する。

## 手順

1. 対象 child を列挙する。core API 変更では web、Android、desktop の全 consumer を検索する。
2. 各 child の local instruction と `tastile-core/v1/` の該当章を読む。schema / API では
   `v1/10` と `v1/14` を含める。
3. 各 child で `git status --short`、`git diff --stat`、該当 diff を確認する。
4. 次の contract matrix を作る。

| 項目 | 必須証跡 |
| --- | --- |
| Producer | core type、handler、serializer |
| Consumers | web、Android、desktop の call site |
| Schema | canonical column と numeric registry |
| Migration | 実行された migration path |
| Tests | producer / consumer contract の現在の実行証跡 |

5. web と Android で共有する visible behavior は、control 数、順序、label、i18n key、遷移を
   比較する。layout と個別 rendering の差は許容するが、composition と behavior は drift
   させない。
6. canonical contract が要求しない alias、dual-read、adapter、`accept both` を拒否する。
7. commit、version、release は child ごとに独立して計画する。

必須 cell の空欄、consumer drift、未実行 migration、独断 shim、root だけの status 確認が
あれば `BLOCKED: <mismatch>` とする。各 package の独立 compile だけでは PASS にしない。
