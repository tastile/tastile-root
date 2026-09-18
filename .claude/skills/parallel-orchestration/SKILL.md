---
name: parallel-orchestration
description: 複数 AI エージェント / worktree / サンドボックスを dependency graph に基づき最大安全並列化で駆動する。lease / fencing token / immutable snapshot / parent-child immutable result を管理する。
---

canonical Skill は `.agents/skills/parallel-orchestration/SKILL.md` である。発火時にその全文を
読み、binding workflow として実行する。この adapter に手順を複製しない。

scope: workspace root 専用。各 child repo (core / web / android / desktop / brands) では
`subagent-coordination` Skill を併用すること。
