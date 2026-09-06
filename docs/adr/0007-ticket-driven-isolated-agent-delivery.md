# ADR 0007: チケット駆動と隔離された agent 実行

状態: 採用（2026-09-05、ユーザーの方針更新による）。runtime の実装完了を意味しない。

## 背景

2週間の Web + Android 無料本番公開に向け、file ownership だけによる共有 checkout の
並列実装では、process、DB、成果物、credential、再試行の干渉を防げない。既存の
precommit review loop は commit 対象 patch の検査を担うが、worker lifecycle の
Supervisor ではない。公開リポジトリと非公開 Core の境界も維持する必要がある。

## 決定

正本は [project-init の固定 revision](https://github.com/rebuildup/project-init/tree/9081339e95264c3205553208c2f55fbf23c9745b)。
GitHub Issue を作業状態、Git を source、PR を統合の正本にする。Sol を coordinator、
Luna を実装、Terra を独立 reviewer とする。実際に利用された model は実行結果から
確認し、要求した model 名から推測しない。

release branch は `release-x-y-z`、実装 branch は repository 内の Issue 番号。
入力には全対象 repo の immutable SHA、仕様 digest、generation、所有範囲、許可 tool、
filesystem / network policy、時間と retry budget、受入条件、期待成果物を含める。
worker の結果には agent ID、入力 snapshot、generation、成果物 SHA / digest、検証結果、
既知問題を含める。integration candidate 自体を固定して独立検査する。移動した ref を
暗黙に読み直さず、新 generation を発行して再検証する。

並列実装では外部 Supervisor が workspace、process、port、DB / queue、build / test
output、credential scope、budget、cleanup を強制する。Supervisor を worker 内に置かない。
host socket / root credential を worker に渡さない。副作用は intent と remote result を
記録し、各外部 write 前に generation を fence する。親停止時の child 回収、応答不明時の
remote reconciliation、checkpoint の secret 除外を必須にする。

現在の desktop subagent は共有 filesystem を持つため、並列実装の隔離要件を満たさない。
当面は read-only 調査のみ並列化し、実装は WIP 1 とする。Supervisor を新規に自作することを
9月19日の前提にはしない。製品変更と別 ticket で既存 runtime 候補を評価する。

Issue / PR / review は日本語、commit は英語とする。従来の GitHub 英語規約と
worktree 全面禁止はこの決定で更新する。子の矛盾する instruction は各 Issue の開始時に
この決定と整合させるが、無関係な差分を巻き込まない。

## 完了と運用

AC、必須 CI、独立検査、staleness 解消、release branch への merge、明示的 Issue close、
作業状態 Done をすべて確認する。非 default branch の closing keyword だけに依存しない。
Projects 権限がない間は root#2 と status label を使用し、Projects 同期を未完了として記録する。
skip / ignore の追加、mock だけの integration、古い結果の再利用による完了は禁止する。

## 不採用・保留

- 共有 host worktree + file ownership: runtime 干渉を防げないため不採用。
- 単一 agent の実装と自己承認: 独立検査にならないため不採用。
- Docker / Podman / Dagger を名前だけで導入: 現 host で利用確認できず、期限内の必須依存にしない。
- 新規の汎用 sandbox manager: 製品リリースの工数を消費するため後続評価。
- Projects のための無断 token 権限追加: 行わない。Issue board で実務を継続する。

関連: [実行計画](../releases/2026-09-19-plan.md)、[machine-readable backlog](../releases/2026-09-19-tickets.json)。
