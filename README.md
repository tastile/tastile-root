# tastile-root

This repository tracks root-level assets for the Tastile workspace that spans multiple child repositories.

## Scope

- Shared documentation for cross-project operations
- Root-level scripts and environment setup files
- Workspace conventions and operational notes

## Harness

プロジェクト全体の前提・目的・方針・構成については [docs/HARNESS.md](./docs/HARNESS.md) を参照。

正本リポジトリの高速チェック:

```powershell
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing
```

リリース相当の全チェック:

```powershell
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile full -KeepGoing -ResultPath .\.tmp\workspace-check.json
```

AI agent 環境の構成チェック:

```powershell
pwsh -NoProfile -File .\scripts\check-agent-environment.ps1
```

終了コードは `0=全通過`、`1=コード/テスト失敗`、`2=外部環境不足による BLOCKED`。一時的な失敗だけを有限回再試行する場合は `-MaxAttempts 3` を追加する。

## Agent commit / binding verification

Claude Code / Codex / OpenCode から agent-initiated commit を行う場合は per-repo fast
gate (例: `pwsh -NoProfile -File scripts\check-agent-environment.ps1` / `bun run check`)
と `verify-tastile-change` Skill による PR 直前 binding verification を実施する。
Git hook ではないため、人間が通常のターミナルから行う commit には影響しない。

```powershell
git -C tastile-web commit -m "fix: example"
```

2026-09-29 付で旧 per-commit reviewer loop (`.agent-loop/` + `tastile-precommit-review`
Skill) は廃止済み (ADR-0012)。残存する destructive / process wrapper hook は
`git-guard.mjs` と `tastile-command-guard.ps1` のみ。

## Child repositories

The following projects are managed in their own Git repositories and are intentionally excluded from this root repository:

- `tastile-android`
- `tastile-brands`
- `tastile-core`
- `tastile-core.wslc`
- `tastile-desktop`
- `tastile-web`
