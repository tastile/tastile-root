---
name: project-board
description: GitHub Issue の status 遷移、Project board 更新、WIP 確認、ADR-0009 で定義された必須 field (priority / size / target_version / area / execution_generation) を操作するときに使用する。
---

# Project board — Kanban state

canonical reference は ADR-0009。Project v2 の status / 必須 field / WIP cap を
project-local の invariant として運用する。Project metadata は GitHub UI / GraphQL
API が canonical source、repository 内では本 Skill と ADR-0009 のみを pin する。

## Status field 値

| Status | 必須条件 |
| --- | --- |
| `Backlog` | 必須 field なし |
| `Ready` | `priority`, `size`, `target_version` non-empty |
| `In Progress` | `Ready` 条件 + assignee 確定、open PR なし |
| `In Review` | `Ready` 条件 + linked PR (`resolves #<n>` を持つ) |
| `Done` | Issue closed |

## 必須 field

新規 Issue / status 遷移ごとに必ず埋める。

- `priority` (`P0 | P1 | P2 | P3`)
- `size` (`XS | S | M | L | XL`)
- `target_version` (例: `release-0-4-0`、空値は backlog)
- `area` (repo-specific multi-select)
- `execution_generation` (number, ADR-0008 連動; default `1`)

## WIP cap

- `In Progress` 同時 ticket 数 ≤ 3 / owner。超過時は次の spawn を保留し、Issue を
  `Ready` に戻すか、別 owner に assign し直す。
- WIP 監視は `gh api graphql` で `gh project field-list` / `item-list` を weekly
  cron で取得し、`.tmp/project-board.json` に dump する (`.gitignore` 済み)。
  dry-run を Issue body に書込まない (commit pollution 防止)。

## 遷移ルール

| from | to | 必須 action |
| --- | --- | --- |
| `Backlog` | `Ready` | `priority`, `size`, `target_version` を埋める |
| `Ready` | `In Progress` | assignee 確定、branch 名 = `<issue-number>` を確認 |
| `In Progress` | `In Review` | linked PR が `resolves #<n>` を持つ + 必須 PR marker 4 個 (ADR-0007) |
| `In Review` | `Done` | PR merged / closed、Issue closed |

## 関連 ADR / 関連 Skill

- [ADR-0009](../../../docs/adr/0009-github-projects-work-state.md)
- [ADR-0007](../../../docs/adr/0007-release-branch-and-ticket-workflow.md)
- `.agents/skills/release-branch-workflow/SKILL.md`
- `.agents/skills/recover-task/SKILL.md`
- `.agents/skills/verify-tastile-change/SKILL.md`
