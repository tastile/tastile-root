---
name: github-delivery
description: Tastile の Issue 着手、Draft PR、release branch、検証証跡、完了処理に使う。
---

# GitHub delivery

`AGENTS.md`、ADR 0007、対象 child instruction、対象 Issue と依存を読む。
9月19日 train は `docs/releases/2026-09-19-tickets.json` を参照する。
このファイルは初期計画。着手後の state / dependency / blocker は GitHub が正本。

1. Issue の AC、ownership、依存、priority、見積もり、外部条件を確認する。
   既存 ticket と重複していれば作らず再利用する。機密詳細は private Core に置く。
2. 対象 repo の release branch の現在 SHA を解決し task snapshot に保存する。
   clean checkout と生成物の境界を確認し、依存 repo SHA も固定する。
3. Issue 番号だけの branch を作る。既存 branch は SHA と owner を照合し勝手に上書きしない。
   最初の意味ある commit で release branch 向け Draft PR を作る。Issue / PR は日本語、
   commit は英語 `<type>: <concise title>`。空 PR は作らない。
4. Issue を In Progress にし、入力 snapshot / generation と blocker を記録する。
   全 applicable gate を実行し、Terra の独立 review と clean candidate の証跡を PR に添える。
   fast gate は full gate の代わりにならない。release には実 browser / DB / device が必要。
5. merge 前に source / target SHA、generation、CI、AC、review を再確認する。
   staleness は新 generation で解消する。agent commit は既存 precommit review gate も通す。
6. release branch に merge 後、merge SHA を記録して Issue を明示的に close、状態を Done にする。
   Projects を利用できる場合は Project Done も確認する。利用不可なら root#2 と status label を
   同期し、その制約を残す。非 default branch の `Closes` だけで完了にしない。

外部 write は intent / operation ID / remote result を journal に記録する。timeout 後は検索で
既存結果を確認し、重複 Issue / PR / deploy を作らない。公開・配布・課金開始の操作は対象
release ticket の承認条件が満たされた場合に限る。
