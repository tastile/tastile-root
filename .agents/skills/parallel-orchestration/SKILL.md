---
name: parallel-orchestration
description: Tastile の worker 委譲、並列化、再割当、停止、成果物統合時に使う。
---

# Worker の実行契約

まず `docs/adr/0007-release-branch-and-ticket-workflow.md` を読む。
現状の fallback は read-only 調査の並列化、実装 WIP 1。共有 filesystem の native
subagent に実装を並列委譲しない。既存の staged / unstaged 差分を保持する。

## Dispatch

1. GitHub Issue が Ready、依存 Issue が検証済み Done、受入条件が確定していることを確認。
2. `docs/releases/task-contract.schema.json` に沿って全対象 repo の SHA と仕様 digest を固定。
   planning baseline は記録用であり、着手時の snapshot には統合済み依存を含める。
   affected_repositories の各 repository が base_snapshot に存在することを照合し、task 自体も
   digest で固定する。schema validation だけでこの対応を確認したことにはしない。
3. Sol が ownership、許可 tools、filesystem / network policy、budget、期待成果物を指定。
   generation は初回 1。再割当は Supervisor が atomic compare-and-swap で加算する。
   fallback は coordinator 一人だけが更新し、並列 writer を存在させない。
4. Supervisor の実効 policy ID と runtime isolation の証跡がなければ parallel implementation
   を選ばない。worktree の存在や prompt の禁止文だけで隔離済みと判定しない。

## 結果と回収

- Luna の成果物 SHA / digest、agent ID、generation、検証 command / exit code / artifact を記録。
  actual_model は実行metadataで観測できた場合だけ記録し、不明ならnullとする。mutableな
  result refの名前を保存しても、統合には必ず固定したresolved_result_digestを使用する。
  task_digest、runtime_evidence、checkpoint_digest、review欄、external_write_journalを記録する。
  reviewerのreview欄は必須で、candidate digest一致とagent IDの相違をcoordinatorが確認する。
  continuationにはsecretを除外したcheckpoint digestが必須。schemaだけで実効隔離や
  agentの独立性を証明したことにはしない。
- Sol は snapshot と generation の一致を確認。Terra は clean な固定 integration candidate を
  read-only 検査し、Luna は自己承認しない。失敗・未実行・外部 BLOCKED を区別する。
- ref の移動、結果の欠落、timeout は自動成功にしない。仕様変更と再baseは新 generation。
- 外部 write 前に現在 generation を確認し intent を記録。応答不明時は remote を照会してから
  再試行する。checkpoint は secret を除外した commit / content-addressed diff とする。
- 親停止時は child を停止・照合・回収し、process / port / DB / queue / output を片付ける。
  回収能力がない runtime で worker を起動しない。

制限時間の既定: 実装 4時間、検査 1時間、修正再試行 2回。超過時は変更範囲を分割して
Blocked に戻し、snapshot と残作業を保存する。予算増加を暗黙に行わない。
