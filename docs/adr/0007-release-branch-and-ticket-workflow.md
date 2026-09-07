# ADR-0007: Release-sprint workflow — release branch と Issue 番号 ticket branch

- 日付: 2026-09-06
- 状態: Accepted
- 対象: Tastile root workspace および全 child repository の branch / Issue / PR workflow
- 先行 ADR: [ADR-0001](./0001-agent-toolchain.md) (関連, root agent 構成), [ADR-0005](./0005-skills-and-mcp-extensions.md) (関連, Codex role 定義)
- 後続 ADR: [ADR-0008](./0008-structured-recovery-checkpoint.md) (関連, soft / hard checkpoint), [ADR-0009](./0009-github-projects-work-state.md) (関連, Projects Kanban)
- canonical policy: [agent orchestration policy](../agent-orchestration.md) §2

## Context

既存の `tastile-android/CLAUDE.md` および各 child の working rule は「work on local
main。feature branch、temporary branch、worktree を作らない」と固定している。これは
ADR-0001 (2026-08-09) 採択時の AI agent 能力と、code 規模、`tastile-android` 1
contributor の運用前提を反映した判断である。

2026-08 以降の運用で以下の gap が顕在化した。

1. **複数 AI agent の並行作業**: 1 main に複数 worker が直接 commit する運用は、
   `AGENTS.md` の「同一 file の並列編集禁止」「subagent の自己承認禁止」と矛盾する。
   同一 release window に複数 ticket が走る sprint で衝突が観測された。
2. **PR 単位の integration gate**: 現行運用は tag → release の 2 段で、PR を介さない
   bug fix が main に直 commit される経路が残る。target version 単位の整合検証
   (release gate) が tag 時点まで遅延する。
3. **durable work 識別子**: durable work item は GitHub Issue で表現する方針 (ADR-0001
   §「Skills と MCP 拡張」の方向性) だが、branch と Issue の対応が無く PR body に書く
   属人的運用になっている。
4. **target release version の明示**: child の `CHANGELOG` 自動生成と Play Console
   internal / beta / production track (`release.yml` の `track` 入力) は tag 名から
   version を解決しているが、target release を切り下げる判断が PR description に残らない。

これらを解決するため、release-x-y-z 統合 branch と Issue 番号 ticket branch を
work state の正本として導入する。

## Decision

### D-1. branch 命名と lifecycle

- **release branch**: `release-<major>-<minor>-<patch>` を `main` から作成する。例:
  `release-0-4-0` (versionName `0.4.0`)。sprint = 1 target release version に対応
  する。release branch 上に直接 commit しない (release commit は release PR 経由のみ)。
- **ticket branch**: `git branch` 上の名前は GitHub Issue 番号のみとする。例: `123`。
  feature、bugfix、chore、release task すべて同じ命名規則に従う。description / slug /
  prefix は branch 名に含めない。命名責務は Issue / PR が担う。
- **worktree 禁止**: 既存 ADR-0001 と整合するため、local contributor は引き続き
  worktree を作成しない。`AGENTS.md` の「無関係な変更を reset、checkout、stash、
  revert、stage、commit しない」不変条件の上に成り立つ。
- **integration 順序**: ticket branch → release branch (Draft PR) → main (release PR)。
  release PR は `[release-x-y-z -> main]` title に release goal、included Issues、
  breaking changes、migration notes、validation result、known limitations を含む
  (canonical contract は `tastile-desktop` / `tastile-android` の release 慣行と整合)。

### D-2. 既存 child `CLAUDE.md` / `AGENTS.md` rule の置換

「work on local main、feature / temporary / worktree を作らない」を次の 2 文に置換する。

- 「sprint の release branch は `main` から `release-x-y-z` で切る。release commit は
  release PR (release-x-y-z → main) を唯一通過点とする。」
- 「ticket の作業 branch 名は GitHub Issue 番号のみ (例: `123`)。1 Issue = 1 branch。
  worktree は使わない。」

各 child の `tastile-precommit-review` Skill は release branch / Issue番号 branch
であることを commit diff から確認する。`AGENTS.md` 不変条件に「branch 名が canonical
pattern に従う」が加わる。

### D-3. PR template の Project Fields 化

PR body に次の marker を必須化する (詳細は ADR-0009 で Projects 連動)。

- `Issue:` (`resolves #<n>`)
- `Target Release:` (`release-x-y-z` または `-` for `main` 直 commit)
- `Branch:` (`git rev-parse --abbrev-ref HEAD` の verify 結果)
- `Execution Generation:` (default 1; resume / recovery 時に 2 以上)

### D-4. tag との関係

既存 `release.yml` の tag → AAB / Play / GitHub Release 経路は不変。release PR
merge 後にローカル tag `v<version>` を打ち、tag → release workflow を起動する。
commit 命令と tag 命令を分離し、pre-commit reviewer (`Invoke-PreCommitReview.ps1`)
が tag 操作をサポートしないことは現状維持。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| release-x-y-z + Issue番号 ticket branch | 採用 | meta-prompt 要件との整合。durable work 識別子と target version の明示が PR body で同時観測可能。1 sprint = 1 release branch で conflict scope が閉じている |
| Git Flow style (develop / feature / release / hotfix) | 不採用 | "develop" branch は複数 contributor が commit する前提で、ADR-0001 の main-only 方針と相反。target version 解決を別途定義する必要が出る |
| Trunk-based + feature flag | 不採用 | Compose / WinUI の UI 安全性と cross-repo schema drift 検出で feature flag 基盤が無い。tastile-android の runtime migration 進捗と整合しない |
| Conventional Release / release-drafter | 保留 | release branch 運用が 1 sprint 完了した後の再評価対象。tag → AAB / Play への連結は手動 |
| 既存「main only」継続 | 不採用 | meta-prompt §1 「active sprint は release-x-y-z branch」と §「ticket branch は Issue番号だけを使用」を満たさない |

## Security、license、再現性

branch 命名規則は `.git/hooks` 不要 (Push 側で reject しない) で、
`.agent-loop/Invoke-PreCommitReview.ps1` が local commit 時に reviewer snapshot の
reproducibility を確保する。release PR → main merge 後の tag は contributor の
ローカル GPG / SSH 鍵で署名する。CI / tag 連携は既存 `release.yml` の `permissions`
を流用する。

## Consequences and re-evaluation

### 直接的な影響

- 同一 release window 内の複数 ticket が独立 branch で動作し、PR 単位で integration
  gate を通過する。conflict は release PR 時点で 1 度検出される。
- PR body に target release と Issue 番号が現れるため、release note 自動生成の
  input が canonical source of truth に揃う。
- `tastile-precommit-review` Skill に "branch 名が canonical pattern に従うか" check
  が加わり、self-approval の抑止が強化される。

### トレードオフ

- branch 運用のため contributor は `git fetch` / `git push` の頻度が上がる。
  network 断 / push 失敗時の復旧手順 (Draft PR からの復旧) を
  `.agents/skills/recover-task/SKILL.md` (ADR-0008 連動) で補う。
- release branch が長期生存するため stale 検知 (`git fetch` 後の
  `release-x-y-z..main` の divergence) を weekly cron で監視する。
  `.github/workflows/recovery-drill.yml` がこの観点も含む。

### 再評価 trigger

- 1 sprint 完了後に release note / cherry-pick コストを測定し、release branch 寿命
  が target version の範囲に収まっているか検証する。
- cross-repo contract 変更 (v1 schema / auth) で 1 release branch が 2 version に
  またがる必要性が出たら、ADR を supersede する。
- tag → release automation (release-drafter / conventional-release) を導入する場合、
  別 ADR で本 ADR を revise。

### 関連 ADR / 関連 Skill

- [ADR-0001](./0001-agent-toolchain.md): root agent 構成の先行 ADR。本 ADR は
  branch / Issue workflow を導入し、ADR-0001 §「Skills」catalog に新 Skill を 4 件
  追加する。
- [ADR-0005](./0005-skills-and-mcp-extensions.md): Codex role canonical reference。
  本 ADR の branch pattern は `sol-supervisor` の read-only posture を保持する。
- [ADR-0008](./0008-structured-recovery-checkpoint.md): soft / hard checkpoint。
  本 ADR の `Execution Generation` フィールドと組み合わせる。
- [ADR-0009](./0009-github-projects-work-state.md): GitHub Projects Kanban。
  本 ADR の `Target Release` フィールドの正本を Project の `Target Version` に置く。
- `.agents/skills/release-branch-workflow/SKILL.md`: 本 ADR の発火条件と手順を
  集約する first-party Skill。
- `.agents/skills/tastile-precommit-review/SKILL.md`: commit 直前に canonical branch
  pattern を再確認する。
- `.agent-loop/Invoke-PreCommitReview.ps1`: snapshot isolation と reviewer 起動。
  branch pattern check は本 ADR 採択後の minor enhancement として扱う。
