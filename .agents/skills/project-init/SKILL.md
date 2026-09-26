---
name: project-init
description: 初回プロジェクト初期化、または project-local Agent Skills / adapters / runtime / quality / governance / recovery policy を再構成するときだけ発火する。canonical source は GitHub rebuildup/project-init release-0-1-1。本 Skill は section index と Tastile 固有の現状 anchor のみを持ち、policy 全文は複写しない。
---

# Project-init (Skill adapter)

> **正本**: <https://github.com/rebuildup/project-init/tree/release-0-1-1>
> canonical source をその場で fetch して参照する。本 Skill は dispatcher /
> section index / Tastile 固有 anchor のみを保持し、policy 全文の複写は
> 行わない。`AGENTS.md` / `CLAUDE.md` へ全文を転記しない。

## 発火条件

次の場合にだけ本 Skill を発火する。**通常 task では発火しない**。

- Tastile workspace を fresh clone から最初に init する
- Agent Skills / adapters / runtime / quality / governance / recovery
  policy を再構成する
- canonical policy と repository-controlled docs の drift を audit する
- 新規 contributor / fresh agent が canonical meta-prompt の全体像を
  把握する必要がある

## Section index (canonical source)

canonical source を fetch したうえ、以下の section を参照する。Agent は
必要 section だけを `WebFetch` / `gh api` 経由で取得し、本文を context に
展開しない。

| § | 扱う内容 | Tastile 側 anchor |
| --- | --- | --- |
| §1 | 最優先原則 (Git SoT, weekly sprint, 1 Issue = 1 branch, public main protection) | `AGENTS.md`, `docs/agent-orchestration.md` §2, ADR-0007 |
| §2 | `/init` を idempotent reconciliation として扱う | 本 Skill の reconcile checklist 参照 |
| §3 | Source of Truth (canonical Git remote, released ref, active release ref, GH Issues/Projects) | `docs/HARNESS.md` §10, ADR-0009 |
| §4 | Engineering decision precedence (6 段階) | `docs/agent-orchestration.md` §3 |
| §5 | Agent architecture (Root Coordinator / Supervisor / Worker) | `docs/HARNESS.md` §11, `CODEX_ROLES.ja.md` |
| §6 | Subagent spawn を第一級 tool 化 | `.agents/skills/subagent-coordination/SKILL.md` |
| §7 | Subagent mode / immutable transfer | `docs/agent-orchestration.md` §5 |
| §8 | Execution environment isolation | `.agent-loop/`, `.claude/hooks/`, `docs/HARNESS.md` §9 |
| §9 | Runtime / host / provider portability | `docs/HARNESS.md` §9-3, §9-5 |
| §10 | Project-local / progressive disclosure | `AGENTS.md`, 本 Skill |
| §11 | Weekly release sprint / GH workflow / public main protection | `docs/HARNESS.md` §6, ADR-0007, GH branch protection API |
| §12 | Ticket branch / mandatory Draft PR / stacked PR | ADR-0007, `.agents/skills/release-branch-workflow/SKILL.md` |
| §13 | Release integration | `scripts/orchestration/verify-release.ps1`, `release-claim.ps1` |
| §14 | Task graph と最大安全並列化 | `.agents/skills/parallel-orchestration/SKILL.md` |
| §15 | 自律実行ループ | `docs/agent-orchestration.md` 全体 |
| §16 | Agent interruption recovery | ADR-0008, `.agents/skills/recover-task/SKILL.md` |
| §17 | Parent / child recovery と split-brain 防止 | `docs/agent-orchestration.md` §6-4, §7-3 |
| §18 | External side effects / idempotency | `docs/agent-orchestration.md` §8 |
| §19 | Tool / Skill / plugin ゼロベース選定 | ADR-0001, ADR-0005, `.mcp.json` |
| §20 | Architecture / design / ADR | `docs/adr/`, `docs/decisions.md` |
| §21 | Adaptive quality profile | `scripts/check-workspace.ps1`, `scripts/check-agent-environment.ps1`, child repo `AGENTS.md` |
| §22 | Verification taxonomy | `.agents/skills/verify-tastile-change/SKILL.md` |
| §23 | Worker / integration / release gate | ADR-0007 §2-4, ADR-0008, `scripts/orchestration/verify-release.ps1` |
| §24 | GitHub Actions / CI | `.github/workflows/quality.yml`, GH required status check |
| §25 | Security maintenance | ADR-0004, ADR-0012, secret-source / GHSA ingest |
| §26 | Reviewer separation | `.agents/skills/tastile-precommit-review/SKILL.md`, `CODEX_ROLES.ja.md` |
| §27 | Onboarding / repository-controlled knowledge | `README.md`, `AGENTS.md`, `docs/HARNESS.md`, 本 Skill |
| §28 | Source / documentation / GH language | `AGENTS.md` 「常時適用する不変条件」 |
| §29 | Package / search / scripts / secret / temporary policy | `AGENTS.md`, `.gitignore`, `scripts/restore-infisical-env.ps1` |
| §30 | Recovery test / context handoff / 初期化完了条件 | `docs/agent-orchestration.md` 付録 A, ADR-0008 §D-5, `.agents/skills/recover-task/SKILL.md` |

## 現状 anchor (2026-09-12 時点)

reconcile 実施時に次の状態を baseline とする。

### verify-if-correct (変更不要)

- ✅ `AGENTS.md` が dispatcher として機能 (pointer のみ, 全文複写なし)
- ✅ ADR-0007 / 0008 / 0009 / 0010 が accepted で実装連動
- ✅ `docs/agent-orchestration.md` §2-§8 完備 (sprint workflow, decision
  precedence, escalation boundary, subagent mode, lease/fencing, recovery,
  side-effect journal)
- ✅ `CODEX_ROLES.ja.md` + `.codex/agents/*.toml` + `.claude/agents/*.md`
  で 5 role 定義、sandbox_mode 明示
- ✅ `.agents/skills/` に 11 Skills (本 Skill 追加で 11)、`.claude/skills/`
  に 7 mirror Skills
- ✅ `.agent-loop/checkpoint.schema.json` + `agent-result.schema.json` +
  `review-result.schema.json` + `Invoke-PreCommitReview.ps1`
- ✅ `scripts/check-workspace.ps1`, `check-agent-environment.ps1`,
  `orchestration/{claim,release-claim,verify-release,invoke-*}.ps1`
- ✅ `.github/workflows/quality.yml` (agent-environment gate on PR + main)
- ✅ `.mcp.json` (chrome-devtools + context7 のみ; ADR-0004/0005 準拠)
- ✅ Bun 標準 / PowerShell は publish 系のみ / `rg` 標準
- ✅ WSL2 + WSLC primary, macOS / Linux portability 経路
- ✅ Decision precedence 6 段階 / subagent taxonomy / parent-child
  immutable snapshot / external side-effect journal / secret 除外
- ✅ `.gitignore` で `.env*`, `.tmp/`, `.reference/`, worktree, IDE
  metadata を除外し `.env.example` schema のみ track

### initialize-if-missing (新規追加)

- ✅ `.agents/skills/project-init/SKILL.md` (本ファイル)
- ⏳ `.github/workflows/release-source-check.yml` (要追加; 下記 reconcile で実装)
- ⏳ GH branch protection `required_status_checks` に `agent-environment`
  と `release-source-check` を required として登録
- ⏳ GH branch protection `enforce_admins: true`
- ⏳ GH branch protection `required_conversation_resolution: true`
- ⏳ GH ruleset で `main` への PR head を `release-*` pattern に制約

### 既存 but stale (要更新)

- `docs/decisions.md` の最終更新は 2026-08-22 / 2026-06-19。最新 status
  snapshot が ADR-0010 (2026-09-08) と齟齬する可能性
- `release-0-6-0` が active sprint branch。`release-0-7-0` の staged
  work (memory pointer: `release-0-7-0-staged`) は operator commit 待ち

## Idempotent reconcile checklist

canonical §2 に従い、次の順で reconcile する。

1. **inspect** — 現状 anchor と canonical §1-§30 を突き合わせ、差分を
   「initialize / repair / update / verify」の 4 カテゴリへ分類する
2. **initialize if missing** — 欠落 Skill / workflow / schema を追加する
3. **repair if incomplete** — public main protection gap、status check
   未登録、enforce_admins 無効、required_conversation_resolution 無効を
   修復する
4. **update if stale** — `docs/decisions.md`、README、AGENTS.md、HARNESS.md
   のうち古い snapshot を最新 ADR と同期する
5. **verify if already correct** — 既存実装へ不要な改変を加えない
6. **report** — 変更内容、未変更の根拠、残る制約を簡潔に報告する

各 step で必要なら `WebFetch` で canonical source を取得する。**全文は
1 度も読み込まない**。section index と現状 anchor を context に保持し、
必要な section だけを fetch する。

## 禁止

- canonical policy 全文を `AGENTS.md` / `CLAUDE.md` へ複写しない
- 通常 task で本 Skill を trigger しない (発火条件に合致しない場合)
- 既存 canonical source (`AGENTS.md`, `docs/agent-orchestration.md`,
  `CODEX_ROLES.ja.md`, ADR) の text を Style だけ書き換えて重複作成
  しない
- sub-agent / Coordinator / Supervisor 関係で merge / auto-merge / landing
  side effect を user の明示 authorization なく実行しない (canonical §11
  および `docs/agent-orchestration.md` §4 に従う)

## 関連 ADR / 関連 Skill / canonical source

- canonical: <https://github.com/rebuildup/project-init/tree/release-0-1-1>
- [ADR-0007](../../../docs/adr/0007-release-branch-and-ticket-workflow.md)
- [ADR-0008](../../../docs/adr/0008-structured-recovery-checkpoint.md)
- [ADR-0009](../../../docs/adr/0009-github-projects-work-state.md)
- `AGENTS.md` (workspace dispatcher)
- `docs/agent-orchestration.md` (workspace orchestration policy)
- `CODEX_ROLES.ja.md` (role catalog)
- `.agents/skills/subagent-coordination/SKILL.md`
- `.agents/skills/release-branch-workflow/SKILL.md`
- `.agents/skills/recover-task/SKILL.md`
- `.agents/skills/verify-tastile-change/SKILL.md`
- `.agents/skills/tastile-precommit-review/SKILL.md`
