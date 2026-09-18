---
name: project-init
description: Tastile workspace / child repository の /init を idempotent reconciliation として実行する。Git + GitHub Issues/Projects を SoT とし、weekly release sprint / public main protection / quality-security-recovery profile / agent Skills routing を compile する。PROMPT.ja.md release-0-1-1 参照。
---

canonical Skill は `.agents/skills/project-init/SKILL.md` である。発火時にその全文を読み、
binding workflow として実行する。この adapter に手順を複製しない。

scope: workspace 全域 + 5 child repositories。reconcile checklist (canonical SKILL L108-121) の
inspect → initialize → repair → update → verify → report の 6 phase を binding 実行する。

## 関連 anchor

- `docs/agent-orchestration.md` (workspace-wide orchestration contract)
- `docs/adr/0007-release-branch-and-ticket-workflow.md`
- `docs/adr/0008-structured-recovery-checkpoint.md`
- `docs/adr/0009-github-projects-work-state.md`
- `docs/HARNESS.md` (workspace harness)
- `.agents/skills/{subagent-coordination, parallel-orchestration, github-delivery}/SKILL.md`
