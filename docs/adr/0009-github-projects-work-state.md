# ADR-0009: GitHub Projects v2 — Kanban で durable work state を pin する

- 日付: 2026-09-06
- 状態: Accepted
- 対象: Tastile root workspace および全 child repository の Issue / Project 連携
- 先行 ADR: [ADR-0001](./0001-agent-toolchain.md) (関連), [ADR-0007](./0007-release-branch-and-ticket-workflow.md) (連動)
- canonical policy: [agent orchestration policy](../agent-orchestration.md) §8

## Context

既存 Tastile 運用では durable work item を GitHub Issue で表現してきたが、status は
label (例: `priority/P1`, `area/auth`) で運用しており、次が不足する。

1. **status 遷移の正本**: `in progress` → `in review` → `done` が label だけでは機械
   的に判定できず、`pr is merged` / `issue is closed` との整合が属人的。
2. **target version の明示**: `priority/P1` などは表現できるが `target_release`
   `release-0-4-0` との関連は PR body のみで、GitHub UI 上で一覧性がない。
3. **WIP cap の自動化**: 現状 1 contributor 運用のため不要だったが、複数 AI agent
   並行運用 (ADR-0007) だと `In Progress` の WIP 上限を機械的に enforce したい。
4. **board の所有権**: repository 内に `.github/projects/` JSON を持ちたいが、
   GitHub Projects v2 は GraphQL API で外部定義する形になる。Repository 内
   controlled definition と API 上の Project 定義の同期点が ADR 化されていない。

## Decision

### D-1. board 構成

- **board name**: `<repo>` (例: `tastile-android`)。
- **status field (single-select)**: `Backlog | Ready | In Progress | In Review |
  Done`。`In Progress` で assigned agent / owner が 1 人に絞り込める。
- **priority field (single-select)**: `P0 | P1 | P2 | P3`。`P0` は current sprint、
  `P1` は next sprint、`P2+` は backlog の目安。
- **size field (single-select)**: `XS | S | M | L | XL`。
- **target_version field (text)**: `release-0-4-0` 形式。空値は backlog とする。
- **area / component field (multi-select)**: `ui | sync | auth | notifications |
  core | infra | docs` 等の repo-specific タグ。tastile-android の例: `dashboard |
  mobile | account | design-system | native | sync | release`。
- **execution_generation field (number)**: recovery 時の fence 値 (
  ADR-0008 `execution_generation` と連動)。

### D-2. 必須 field policy

新規 Issue および status 遷移ごとに次の条件を満たすこと。

- `priority`, `size`, `target_version` の 3 フィールドが non-empty。
- status が `Ready | In Progress | In Review | Done` のとき Issue が Project に
  リンクされている。
- status が `In Review` に遷移した時点で PR が linked Issue を `resolves #<n>` で
  参照している。

### D-3. WIP cap

- `In Progress` の同時 ticket 数 ≤ 3 per owner。`agent_loop_supervisor` (Sol /
  Claude equivalent) が次回 spawn 前に Project を query して verify する。
- 超過時は Project automation rule で `status: backlog` に降格する dry-run を
  weekly cron で通知する。強制降格は ADR-0010 以降の re-evaluation 後に判断。

### D-4. Issue template と Project 連動

各 child repo に追加する `.github/ISSUE_TEMPLATE/{bug,feature,chore}.yml` (ADR-0007
連動) は次の field を含む。

- `target_release` (single-select, default empty)
- `priority` (single-select, required)
- `size` (single-select, required)
- `area` (multi-select, repo-specific な候補)

### D-5. PR 連動

PR body に ADR-0007 で規定した `Issue:` / `Target Release:` / `Branch:` /
`Execution Generation:` の 4 marker を含める。Project automation で PR が merge /
close された時点で status を `Done` に遷移させる (automation は GitHub UI / API
で構成し、JSON は repository の `.github/projects/` には置かず ADR 参照のみ
残す)。

### D-6. ADR の参照点

- Project の JSON / GraphQL 定義は GitHub UI / API 経由で管理し、repository 内には
  ADR と canonical reference (`.agents/skills/project-board/SKILL.md`) のみを置く。
- Project ID / configuration drift を検出するため、weekly cron が
  `gh api graphql` で Project metadata を read-only で取得し、expected schema と
  比較する。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| GitHub Projects v2 (Kanban) | 採用 | meta-prompt §「11. Release sprint / GitHub workflow」の要件と整合。既存 Issue 運用を破壊せず拡張できる |
| repository 内 `.github/projects/*.yml` に JSON で置く | 不採用 | GitHub Projects v2 の GraphQL 定義が canonical であり、repository 内 JSON は GitHub 側に同期されないリスクが高い。ADR 参照のみ残す |
| GitHub Issues のみ + label | 不採用 | meta-prompt の Kanban 必須要件を満たさず、status 遷移の機械判定もできない |
| Linear / Jira 等 | 不採用 | 外部 dependency を増やさない方針 (ADR-0001 §「選定評価」) と整合せず、cross-repo contract review も別途 OAuth 設定が必要 |
| automation rule での強制降格 | 不採用 (dry-run のみ) | current 1 contributor 運用の延長で十分。運用計測後に re-evaluate |

## Security、license、再再現性

GitHub Projects の metadata は GraphQL で read-only 取得し、`.tmp/` 配下に保存する
(`.gitignore` で除外済み)。Project ID / automation token は secret として扱わず、
最小権限の `repo` + `project` scope を持つ GitHub App のみが API を叩く。
repository 内に token を commit しない方針は ADR-0001 と整合する。

## Consequences and re-evaluation

### 直接的な影響

- `In Review` への遷移が PR linked Issue と整合する。release PR 作成の正確性が
  board UI で観測可能になる。
- 1 sprint 内の ticket 数と target version 整合が機械的に算出可能になる。
- Issue template から Project 連動が自動で行われ、ticket 入口の摩擦が下がる。

### トレードオフ

- Projects v2 の automation rule を GitHub UI で編集する運用が残る。repository
  でそれを pin できない制約は re-evaluate trigger を満たすまで残置。
- WIP cap は soft (dry-run) であり、強制降格は別 ADR で再評価。

### 再評価 trigger

- WIP cap の hard 強制化 (status: In Progress を drop する automation) を導入
  する場合、ADR を revise。
- 別 board (例: Epics board、Release readiness board) を追加する場合、別 ADR。
- Projects v2 の GraphQL API 互換性が壊れる major release が GitHub 側で出た
  場合、別 ADR。

### 関連 ADR / 関連 Skill

- [ADR-0001](./0001-agent-toolchain.md): root agent 構成。Project automation token
  の handling を inherit する。
- [ADR-0007](./0007-release-branch-and-ticket-workflow.md): branch lifecycle と
  Project Status の同期点。
- [ADR-0008](./0008-structured-recovery-checkpoint.md): `execution_generation` 連動。
- `.agents/skills/project-board/SKILL.md` (新規): D-1 ~ D-5 の canonical reference。
- `.agents/skills/release-branch-workflow/SKILL.md` (新規, ADR-0007): Project board
  連動の入口。
- `.github/ISSUE_TEMPLATE/*.yml` (新規, ADR-0007 連動): D-4 必須 field の I/F。
