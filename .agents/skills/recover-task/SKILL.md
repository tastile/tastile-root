---
name: recover-task
description: AI agent の conversation / session / context が消失したとき、または fresh agent が前タスクを引き継ぐときに使用する。durable checkpoint (ADR-0008) と Issue / PR / commit graph から next step を再構成する。
---

# Recover task (fresh agent reconstruction)

fresh agent は conversation 履歴を推測しない。canonical policy / durable remote
state のみから再構成する。native resume / session ID は高速経路に過ぎず canonical
path ではない。

checkpoint の field name は schema の snake_case key
(`schema_version`, `issue_id`, `target_release`, `ticket_branch`, `base_sha`,
`checkpoint_sha_or_snapshot`, `execution_generation`, `completed_steps`,
`next_steps`, `pending_validation`, `active_children`,
`integrated_child_results`, `external_side_effects`, `decision_refs`,
`artifact_refs`, `updated_at`) を使う。canonical な status 値は
`pending | in_progress | awaiting_review | integrated | failed | abandoned` とする。
これは checkpoint lifecycle の `status` 専用である。child result の `verdict`
(`pass | fail | blocked | abandoned`)、外部 journal の `result`
(`ok | blocked | failed`)、出力時の `STATUS: READY | BLOCKED` とは別の分類であり、
consumer は field name と context を保持する。

## 12-step recovery algorithm (ADR-0008 §D-5)

1. Issue / target release を特定する。`gh issue list --search "<keyword>"` か
   `gh issue view <n>` で GitHub Issue を query する。
2. ticket branch の remote commit graph を `git fetch --all` で取得する。
3. latest valid checkpoint を `.agent-loop/checkpoint.schema.json` (ADR-0008) で
   parse する。`schema_version` が現在の gate より新しい、または `backward_compat`
   に含まれない場合は manual fallback。
4. canonical policy / design / decision refs を確認する (`docs/adr/`、
   `docs/HARNESS.md`、対象 child `AGENTS.md` / `CLAUDE.md`、本 Skill)。
5. `active_children` を `.codex/agents/*.toml` と `.claude/agents/*.md` の catalog
   から再発見する (`subagent-coordination` Skill 参照)。
6. checkpoint から workspace を再構成する。まず `git status --short` で作業ツリーが
   clean であり、かつ unrelated work を含まない専用 recovery clone / isolated
   workspace であることを確認する。dirty、共有、または専用性を確認できない場合は
   `BLOCKED` として conflict を報告し、`checkout` / `reset --hard` を実行しない。
   clean な専用 clone と確認できた場合に限り、`git checkout <ticket_branch>` と
   `git reset --hard <base_sha or checkpoint_sha>` で snapshot を復元する。
7. `completed_steps` / `pending_validation` を再評価する。`completed_steps` に
   重複する step を実行しない。
8. `external_side_effects` の actual remote state を `gh` / `git` / `sops` で確認する。
   idempotency_key と `observed_state` が食い違うものは abort する。
9. stale base / conflict を `git fetch origin <target_release>` の差分比較で確認する。
10. remaining plan を `next_steps` から再構成する。
11. safe な最小 verification (例: `pwsh -File .agent-loop/gate-root.ps1`) で
    reconstructed state を確認する。
12. `execution_generation` を increment、`updated_at` を更新、checkpoint を durability
    (git push か checkpoint.json commit) する。

## failure scenario mapping

- `native session 失効`: step 1-3 で GitHub + checkpoint だけを使い再構成。
- `parent agent 死亡`: step 5 で `active_children` を再発見し、`fencing_token` を
  失効させる前に統合 result があれば immutable result として回収する。Supervisor
  は child を即 cancel しない。
- `child agent 死亡`: step 6-9 で child snapshot を復元し、未統合 result は stale
  として破棄。`execution_generation` を increment して再 spawn。
- `provider 消失`: step 1-5 を hard checkpoint のみから復元。`rpo_seconds` /
  `rto_seconds` の target を ADR-0008 で pin。
- `context exhaustion`: step 11 まで実施後、本 Skill を fresh agent に発火させる。

## 出力

`STATUS: READY | BLOCKED` (checkpoint `status` や child `verdict` とは別の
human-facing recovery report classification)、recovered branch / commit SHA、
`execution_generation`、未完了 step、外部副作用の actual state、Blocked の根拠を必ず返す。

## 関連 ADR / 関連 Skill

- [ADR-0008](../../../docs/adr/0008-structured-recovery-checkpoint.md)
- `.agent-loop/checkpoint.schema.json`
- `.agent-loop/agent-result.schema.json`
- `.agents/skills/subagent-coordination/SKILL.md`
- `.agents/skills/verify-tastile-change/SKILL.md`
