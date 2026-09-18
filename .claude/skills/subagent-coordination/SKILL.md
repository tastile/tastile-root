---
name: subagent-coordination
description: Agent Supervisor / worker / reviewer の spawn・待機・cancel・resume・replace と、parent→child immutable snapshot / child→parent immutable result のライフサイクルを管理する。PROMPT.ja.md §5-§7 準拠。
---

canonical Skill は `.agents/skills/subagent-coordination/SKILL.md` である。発火時にその全文を
読み、binding workflow として実行する。この adapter に手順を複製しない。

scope: 5 child repositories (core / web / android / desktop / brands) と workspace root で
共通。実行者 agent model の宣言は本 adapter では行わず、canonical Skill 側で決定する。
