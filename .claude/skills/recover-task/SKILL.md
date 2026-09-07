---
name: recover-task
description: AI agent の conversation / session / context が消失したとき、または fresh agent が前タスクを引き継ぐときに使用する。
---

canonical Skill は `../../.agents/skills/recover-task/SKILL.md` である。発火時にその全文を読み、
binding workflow として実行する。この adapter に手順を複製しない。

adapter 自身は `../../docs/HARNESS.md` §9-5、`../../docs/adr/0008-structured-recovery-checkpoint.md`、
`../../.agent-loop/checkpoint.schema.json`、`../../.agent-loop/agent-result.schema.json` を参照する。
