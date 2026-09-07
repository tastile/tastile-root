---
name: release-branch-workflow
description: Tastile で sprint planning、GitHub Issue 作成、PR 開始、release 統合を行う直前に使用する。release-x-y-z branch と Issue 番号 ticket branch の lifecycle と Project 連動 (ADR-0007 / ADR-0009) を適用する。
---

# Release-branch workflow

`main` は released / integrated source state を表す。sprint = 1 target release version。
worktree は作らない (ADR-0001 不変条件)。ticket 作業は 1 Issue = 1 branch。

## Branch lifecycle

| 段階 | branch 名 | 内容 |
| --- | --- | --- |
| design freeze | `main` (read-only) | ADR / design / spec を `docs/adr/` に置く |
| Issue 起票 | (なし) | GitHub Issue 本文に `priority / size / target_release / area` を埋める |
| ticket branch | `<issue-number>` (digits only) | 実装 commit を push する。Draft PR を開く |
| release branch | `release-<major>-<minor>-<patch>` | `main` から作成。sprint 統合先 |
| release PR | `[release-x-y-z -> main]` | release goal、included Issues、breaking changes、migration、validation、known limitations を記述 |
| post-merge tag | `v<version>` (local tag) | contributor が `gpg` / `ssh-key` 署名付きで打つ。`release.yml` が AAB / Play / GitHub Release に流す |

## branch 名 canonical pattern

PR 作成前に次の正規表現で branch を確認する。

```regex
^(?:[0-9]+|release-[0-9]+-[0-9]+-[0-9]+|main)$
```

それ以外 (`feature/foo`、`fix-123-hotfix` など) は ADR-0007 §D-1 に違反。

## PR 必須 marker

PR body に次の 4 marker を必ず置く。`project-board` Skill と組み合わせて Project
field を同期する。

- `Issue:` (`resolves #<n>` または `part of #<n>`)
- `Target Release:` (`release-x-y-z` または `-` for main 直 commit)
- `Branch:` (`git rev-parse --abbrev-ref HEAD` 結果の verify 用)
- `Execution Generation:` (default `1`; recovery 後に increment)

## pre-commit reviewer との接続

`.agent-loop/Invoke-PreCommitReview.ps1` は snapshot、fast gate、independent review を
実行する。branch 名 canonical pattern と PR marker の確認は、この Skill を適用する
worker / reviewer が commit・PR 作成前に手動で行う必須 check であり、現行 review script
が自動で行うとはみなさない。hook 側への自動 check 追加は別 ownership の変更として扱う。

## 関連 ADR / 関連 Skill

- [ADR-0007](../../../docs/adr/0007-release-branch-and-ticket-workflow.md)
- [ADR-0009](../../../docs/adr/0009-github-projects-work-state.md)
- `.agents/skills/project-board/SKILL.md`
- `.agents/skills/tastile-precommit-review/SKILL.md`
- `.agents/skills/verify-tastile-change/SKILL.md`
