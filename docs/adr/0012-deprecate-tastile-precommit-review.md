# ADR-0012: `tastile-precommit-review` と `.agent-loop/` 廃止、project-init `quality-gate` へ移行

- 日付: 2026-09-29
- 状態: Accepted
- 対象: Tastile root workspace (`.agent-loop/`, `.agents/skills/tastile-precommit-review/`, `.claude/skills/tastile-precommit-review/`) + `.claude/hooks/hook-dispatch.mjs` + `.codex/hooks.json` + 関連ドキュメント
- 先行 ADR: [ADR-0011](./0011-tastile-precommit-review-canonical-precedence.md) (本 ADR で Superseded)
- 後続 ADR: なし
- canonical policy: [Constitution](../../constitution/CONSTITUTION.md) §「Deviation」、「Operating Model](../../organization/profiles/release-driven-solo.md) §「Quality / evidence」「Agent Skills lifecycle」
- upstream source: `rebuildup/project-init@release-0-3-0` (`57fb4a2e5abe6f52e4fd9cb2cb88234496e47d4b`)

## Context

Tastile root workspace は 2026-07-10 (commit `38356e3`) から、Claude Code / Codex / OpenCode
が `git -C <repo> commit ...` を実行するたびに、`.agent-loop/Invoke-PreCommitReview.ps1`
を経由して独立 CLI reviewer を起動する per-commit precommit review loop を運用してきた。
`.agent-loop/` 配下には dispatcher / `gate-root.ps1` / `repositories.json` /
`review-result.schema.json` / `runtime/` (Dockerfile / policy / provider-gateway) /
`tests/` が含まれ、`.agents/skills/tastile-precommit-review/SKILL.md` が canonical、
`.claude/skills/tastile-precommit-review/SKILL.md` が Claude Code 用 thin adapter として
各 child repository にも複製されている。

この loop は実運用上、以下の問題を生んでいる。

1. **hook 起動の遅延**: Bash PreToolUse で必ず `Invoke-AgentHook.ps1` が pwsh 経由で
   起動し、`Invoke-PreCommitReview.ps1` が commit patch 抽出 + snapshot 化 +
   reviewer 起動の連鎖を行う。trivial な `ls` / `cat` / `rg` にも数秒の追加コストが乗る
   (per memory `feedback_global_setinterval_anti_pattern.md` と同種の latency 増)。
2. **reviewer process の wedge**: wslservice / Codex CLI / Claude CLI の停止条件で
   hook stack が凍る事例が複数回発生し、commit 経路を `git hash-object` +
   `update-index` + `write-tree` + `commit-tree` + `update-ref` の plumbing で bypass
   せざるを得ない状況が続いている (memory `project_tastile_root_gate_broken_plumbing_workaround.md`、
   `feedback_plumbing_commit_for_root.md`)。
3. **二重の binding verification**: `verify-tastile-change` Skill が既に REVIEWED と
   VERIFIED を区別し、PostgreSQL / browser / device / Rust WSL の binding evidence を要求
   している。precommit reviewer はその subset を commit 直前に再走査するだけであり、
   提供 evidence の差分は小さい。
4. **constitution / operating model との不一致**:
   `organization/profiles/release-driven-solo.md` §「Agent Skills lifecycle」は
   `bunx skills` を canonical mechanism と定め、project-init の floating source
   (`rebuildup/project-init`) を upstream SoT とする。一方 `.agent-loop/` はこの
   lifecycle とは別の review-loop を構築し、project-init の `quality-gate` Skill が
   提供する adaptive project profile と並走する状態になっていた。

`rebuildup/project-init@release-0-3-0` の `quality-gate` Skill は per-commit hook を
定義しない。代わりに project-specific な verification infrastructure を compile し、
worker / integration / release / PR Done gate の責務を分離する。`docs/releases/quality-profile.json`
は既に project-init と同型の quality profile 構造 (schemaVersion / policyRevision /
testTaxonomy / changeToGates / commands / ciNames / failurePolicy) を採用しており、
`root-fast-gate` だけが残存する per-commit loop の artifact になっている。

ユーザーは 2026-09-29 に明示的に「プレコミットチェックが無駄だから廃棄して。
project-init 方針に完全に合わせる」と指示した。

## Decision

### D-1. `.agent-loop/` を削除する

root から `.agent-loop/` 配下を `git rm -r` で削除する。tracked file 12 件
(top-level 6 + `runtime/` 3 + `tests/` 3) すべてが対象。

```
.agent-loop/Invoke-AgentHook.ps1
.agent-loop/Invoke-PreCommitReview.ps1
.agent-loop/gate-root.ps1
.agent-loop/README.md
.agent-loop/repositories.json
.agent-loop/review-result.schema.json
.agent-loop/runtime/Dockerfile
.agent-loop/runtime/policy.json
.agent-loop/runtime/provider-gateway.mjs
.agent-loop/tests/Invoke-PreCommitReview.Tests.ps1
.agent-loop/tests/Test-AgentAdapters.ps1
.agent-loop/tests/Test-ReviewSkills.ps1
```

削除後は `.gitignore` に `.agent-loop/` を追加しない (削除対象は tracked であり、
ignore rule は不要)。`docs/chat.md` の `.agent-loop` 言及は歴史的記録として残す。

### D-2. `tastile-precommit-review` Skill を root と全 child repository から削除する

canonical 本文:

- `.agents/skills/tastile-precommit-review/SKILL.md` を削除。

Claude Code thin adapter:

- `.claude/skills/tastile-precommit-review/SKILL.md` を削除。

child repository (gitignored from root、各 repo の独立 commit) の working tree から:

- `tastile-core/.agents/skills/tastile-precommit-review/` を削除
  (`.claude/skills/tastile-precommit-review/` は child core には存在しない)。
- `tastile-web/.agents/skills/tastile-precommit-review/` と
  `tastile-web/.claude/skills/tastile-precommit-review/` を削除。
- `tastile-android/.agents/skills/tastile-precommit-review/` と
  `tastile-android/.claude/skills/tastile-precommit-review/` を削除。
- `tastile-desktop/.agents/skills/tastile-precommit-review/` を削除
  (`.claude/skills/tastile-precommit-review/` は child desktop には存在しない)。
- `tastile-blogs/.agents/skills/tastile-precommit-review/` と
  `tastile-blogs/.claude/skills/tastile-precommit-review.md` を削除。

ADR-0011 § D-2 で確立した thin-adapter precedence rule は本 ADR で
廃止する thin adapter が消えるため関連性を失う。ADR-0011 本文は §「Deviation」「再評価
trigger」 の参考史料として残し、front matter の `状態` を `Superseded by ADR-0012
(2026-09-29)` に変更する。

### D-3. 残存 hook の責務を破壊コマンド保護と toolchain 政策に限定する

`.claude/hooks/hook-dispatch.mjs` から `agent-loop-precommit-review` guard を削除し、
`PUBLISHES` constant も不要になったため除去する。残存 guard は:

- `git-guard.mjs` — 破壊的コマンド検出 (`rm -rf` / `git reset --hard` /
  `git push --force` (lease なし) など)。fail-closed。
- `tastile-command-guard.ps1` — bun / cargo / gradle の toolchain policy と
  `git add/commit` の root 実行禁止。permissionDecision JSON での deny。

`.codex/hooks.json` から `.agent-loop\Invoke-AgentHook.ps1 -Caller codex` を起動する
`PreToolUse` entry を削除する。`context-mode` 系の entry は codex 機能の都合で
保持する。

`.claude/settings.json` は `.claude/hooks/hook-dispatch.mjs` のみを参照しており、
構造変更は不要。

### D-4. binding verification は `verify-tastile-change` に統一する

agent-initiated commit 直前の binding verification contract は `verify-tastile-change`
Skill が担う (REVIEWED ≠ VERIFIED、PostgreSQL / browser / device / Rust WSL の
binding evidence 記録)。precommit reviewer はこれを commit 直前に slice していたに
過ぎず、削除後の binding contract は劣化しない。`AGENTS.md` / `docs/HARNESS.md` /
各 plan / spec の「`tastile-precommit-review` を通す」記述は `verify-tastile-change`
(必要に応じて `cross-repo-contract-check` / `plugin-version-audit`) へ置換する。

### D-5. `quality-profile.json` を project-init `quality-gate` 形に再 pin する

`docs/releases/quality-profile.json` から `root-fast-gate` command と
`changeToGates.root-docs-or-agent-policy` 内の `root-fast-gate` を取り除く。
`policyRevision` を `release-0-3-0` SHA `57fb4a2e5abe6f52e4fd9cb2cb88234496e47d4b`
へ更新 (現状 `9081338e...` は stale。`constitution/CONSTITUTION.md` §「Upstream
source」 と一致させる)。`note` フィールドの「Web の `check:release` advisory ignore」
記述は既存の状態を保持しつつ、root fast gate が project-init `quality-gate` に
統合された旨を明記する。

### D-6. project-init Skills を bootstrap する

`skills-lock.json` は既に 18 件の project-init Skill を track しているが、
`.agents/skills/` には 5 件の local Skill と `tastile-precommit-review` のみが
install されており、project-init Skill の大半が未 install だった。本 ADR 適用時に
`mise run skills-bootstrap` (fallback: `bunx skills add rebuildup/project-init
--skill '*' --agent claude-code --agent codex -y`) を実行し、`.agents/skills/` と
`.claude/skills/` に project-init Skills を install する。`tastile-precommit-review`は
install しない。

install する Skills:

- `quality-gate`, `correctness-assurance`, `design-refinement`,
  `engineering-decisions`, `agent-delivery-estimation`, `agent-recovery`,
  `herdr-runtime`, `interaction-discipline`, `linear-release-control`,
  `onboarding`, `policy-evaluation`, `sandbox-runtime`, `secrets-management`,
  `security-audit`, `security-maintenance`, `worktree-workflow`,
  `writing-discipline`

install しない Skills (local を維持):

- `verify-tastile-change`, `cross-repo-contract-check`, `parallel-orchestration`,
  `github-delivery`, `plugin-version-audit`

### D-7. child repository の follow-up は独立 Issue / PR で実施する

`/tastile-*/` は root の `.gitignore` で除外されており、root commit には child の
working tree 変更は含まれない。本 ADR 適用時に child の working tree を更新するが、
各 child repository の独立 commit / PR 化は child owner が別途実施する (Issue #TBD
で追跡)。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| `.agent-loop/` を完全削除 (本 ADR) | 採用 | per-commit review loop は project-init のどの Skill にも対応する責務がない。残しても reviewer wedge / latency / `verify-tastile-change` との二重化の三点で cost > benefit |
| `.agent-loop/` を read-only に降格 | 不採用 | `gate-root.ps1` の fast gate 機能は `scripts/check-agent-environment.ps1` と `bun scripts/check-release-plan.ts` で代替可能。`Invoke-PreCommitReview.ps1` の reviewer 起動は binding verification ではない |
| reviewer を別 CLI から廃止し `verify-tastile-change` のみに統一 (本 ADR) | 採用 | Constitution §「Evidence Integrity」と一致。binding evidence は current SHA に pin されるべきで、commit 直前 snapshot は stale 化リスクが高い |
| `quality-gate` Skill を bootstrap (本 ADR D-6) | 採用 | skills-lock.json は既に SoT として track。`.agents/skills/` 未 install は drift。`bunx skills` 経路で reconcile |
| `quality-gate` Skill を自前で再実装 | 不採用 | upstream から install する方が operating model §「Agent Skills lifecycle」と一致し、project-init 側の update を自動追随できる |
| 全 child repo を同一 commit に同梱 | 不採用 | `/tastile-*/` は root の tracking 外。child の独立 commit / PR を維持する |
| ADR-0011 を完全削除 | 不採用 | precedence rule の歴史的決定を保持するため、`Superseded` 表示で front matter のみ更新 |

## Security、license、再現性

- 削除対象は project-local で credential を持たず、`.agent-loop/runtime/Dockerfile`
  / `provider-gateway.mjs` も公開 distribution に含まれていない (memory
  `feedback_no_fabricated_addresses.md`)。
- `repositories.json` の `core-wslc` / `web-wslc` entry など local clone path を
  含んでいたが、これらは wslc container 内 host 固有 path で security boundary とは
  無関係。
- 残存 hook (`git-guard.mjs` / `tastile-command-guard.ps1`) は fail-closed で
  destructive command と toolchain 違反を block する契約を変更しない。
- `bunx skills add rebuildup/project-init --skill '*' ...` は fresh clone でも
  `mise.toml` の `skills-bootstrap` task から再現可能。
- `skills-lock.json` の `computedHash` が bootstrap 後に変化する場合は
  `bunx skills update -p -y` で追従し、hash drift を commit に同梱する。

## Consequences and re-evaluation

### 直接的な影響

- agent-initiated commit hook の遅延が消え、`ls` / `cat` / `rg` 等の Bash call に
  pwsh 経由の reviewer 起動コストが乗らなくなる。
- reviewer CLI 認証切れ / wedge による commit 不可状態を解消できる
  (plumbing workaround が不要になる)。
- `verify-tastile-change` が binding verification の単一窓口になり、commit 前 snapshot
  と PR 前の binding evidence の二重定義が消える。
- project-init の 17 Skill が `.agents/skills/` と `.claude/skills/` に install され、
  agent 起動時の progressive disclosure 候補が広がる。
- `docs/releases/quality-profile.json` の `policyRevision` pin が
  `constitution/CONSTITUTION.md` §「Upstream source」 と一致する。

### トレードオフ

- `verify-tastile-change` 自体は binding contract を要求するため、agent は PR 直前
  (commit 後) に evidence を集める必要がある。これは commit 直前 snapshot よりも
  fresh SHA / live state を反映できる利点がある一方、commit 自体には reviewer の
 介入がない。`organization/profiles/release-driven-solo.md` §「Quality / evidence」
  の「current SHA の validation evidence を使用」「false green を禁止」 と整合する。
- child repository の follow-up commit / PR は本 ADR 適用とは別 timing になる。
  child owner が着手するまで child 側に `tastile-precommit-review` Skill が残るが、
  それは独立 Git repository の tracking であり root commit には影響しない。
- skills-lock.json の `computedHash` が変わった場合、`bunx skills update -p -y` を
  実行する PR を別途建てる必要がある。

### 再評価 trigger

- `quality-gate` Skill が per-commit hook を含むように upstream 側で進化した場合
  は本 ADR を revise し、`docs/releases/quality-profile.json` に新 gate を反映する。
- `verify-tastile-change` が binding contract として不十分になった場合 (例: 特定
  child で reviewer が必要になったケース) は child 側で `tastile-<child>-review`
  Skill を新設し、skills-lock.json に追加する形で対応する (root 側に新しい
  per-commit hook は設けない)。
- agent wedge 系の memory (`feedback_wslc_daemon_wedge.md`、
  `feedback_worker_deadlock_during_test_resetdb.md`) が再発し、かつ
  `verify-tastile-change` のみでは catch できない failure が増えた場合は、
  child 固有の reviewer Skill 再導入を検討する別 ADR を起こす。
- project-init の `quality-gate` Skill が `policyRevision` を超えて evolution した場合、
  `docs/releases/quality-profile.json` と本 ADR を同時に更新する。

### 関連 ADR / 関連 Skill

- [ADR-0011](./0011-tastile-precommit-review-canonical-precedence.md): thin-adapter
  precedence rule を確立した ADR。本 ADR で `Superseded` 表示。
- [ADR-0005](./0005-skills-and-mcp-extensions.md): canonical Skills + Codex role
  reference。本 ADR で `tastile-precommit-review` 行を削除。
- [ADR-0007](./0007-ticket-driven-isolated-agent-delivery.md): agent delivery の
  isolation。本 ADR の `tastile-precommit-review` 撤廃と直交 (delivery contract
  自体は継続)。
- `verify-tastile-change` Skill (`.agents/skills/verify-tastile-change/SKILL.md`):
  本 ADR 適用後に binding verification の primary contract。
- `cross-repo-contract-check` / `parallel-orchestration` / `github-delivery` /
  `plugin-version-audit` Skills: 維持。
- project-init の `quality-gate` Skill (bootstrap 対象):
  `.agents/skills/quality-gate/SKILL.md` (install 後)。
- `organization/profiles/release-driven-solo.md` §「Agent Skills lifecycle」:
  `bunx skills` を canonical mechanism とする lifecycle の根拠。
- `constitution/CONSTITUTION.md` §「Deviation」「Upstream source」:
  本 deviation の許容根拠と upstream source の pin 整合性。