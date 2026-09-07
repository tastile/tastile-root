---
name: subagent-coordination
description: Tastile workspace で sub-agent を spawn / integrate / 監視 / cancel / recovery するとき、または canonical SubAgent tool surface (spawn_agent / wait_agent / get_agent_status / get_agent_result / cancel_agent / resume_or_replace_agent / checkpoint_agent / recover_task) と Codex / Claude role を結びつけるときに使用する。
---

# Sub-agent coordination

Claude Code / Codex の native tool (`Agent` / `Task` / それぞれの sub-agent tool) が
canonical SubAgent surface である (ADR-0008 採用判断)。本 Skill は meta-prompt の
logical capability を native tool に bind し、`.codex/agents/*.toml` と
`.claude/agents/*.md` の role catalog を再発見可能にする。

## meta-prompt logical capability -> native tool mapping

| Logical capability | Claude Code | Codex |
| --- | --- | --- |
| `spawn_agent` | `Agent` tool | `task` (sub-agent) |
| `wait_agent` | `Agent` 呼び出しは同期 / `TaskOutput` | `wait` |
| `get_agent_status` | `TaskOutput` + `status` field | `status` |
| `get_agent_result` | `TaskOutput` (最終 output) | `result` |
| `cancel_agent` | `Agent` cancel / `Cancel` | `cancel` |
| `resume_or_replace_agent` | `SendMessage({to, message, resumeSessionId})` 互換 | `resume` / 新規 spawn |
| `checkpoint_agent` | 出力 checkpoint object の `Write` で永続化 | 同様 |
| `recover_task` | `.agents/skills/recover-task/SKILL.md` 発火 | 同様 |

## canonical 3-role trio (Codex 側)

| Role | model | sandbox | 責務 |
| --- | --- | --- | --- |
| `sol-supervisor` (`.codex/agents/sol-supervisor.toml`) | sol | read-only | task decomposition、delegation、readiness decision |
| `luna-implementer` (`.codex/agents/luna-implementer.toml`) | luna | workspace-write | 承認済み plan、明示 ownership、acceptance criteria を受けた scoped implementation |
| `terra-inspector` (`.codex/agents/terra-inspector.toml`) | terra | read-only | correctness / contract / regression / required test の独立検査 |

Claude Code 側は現在 `cross-repo-contract-reviewer.md` と `tastile-verifier.md` の
2 role mirror が canonical (ADR-0005)。`sol-supervisor` の Claude mirror は
`.claude/agents/sol-supervisor.md` で参照可能。

## role catalog の不変条件

- 1 role = 1 file。`sandbox_mode` を必ず明示。
- role 追加 / 削除 / 統合時は `CODEX_ROLES.ja.md` / `docs/HARNESS.md` §11 routing
  table と本 Skill の表を先に更新する。
- 既存 role と意味が overlap する role を新規作成しない (本 Skill の trio 上で動作
  させる)。

## child → parent result

- child は `.agent-loop/agent-result.schema.json` (ADR-0008) に従う immutable result
  を返す。
- parent は `fencing_token` 検証に失敗した result を reject する。
- 同一 `base_snapshot` から複数の child を起動する場合、`fencing_token` に monotonic
  counter を含めて split-brain を防ぐ。

## 関連 ADR / 関連 Skill

- [ADR-0005](../../../docs/adr/0005-skills-and-mcp-extensions.md): Codex role canonical reference。
- [ADR-0008](../../../docs/adr/0008-structured-recovery-checkpoint.md)
- `.codex/agents/*.toml`
- `.claude/agents/*.md`
- `.agents/skills/recover-task/SKILL.md`
- `CODEX_ROLES.ja.md`
