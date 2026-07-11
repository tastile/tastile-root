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
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile full -KeepGoing -ResultPath .\artifacts\workspace-check.json
```

終了コードは `0=全通過`、`1=コード/テスト失敗`、`2=外部環境不足による BLOCKED`。一時的な失敗だけを有限回再試行する場合は `-MaxAttempts 3` を追加する。

## Agent pre-commit review

Claude Code、Codex、OpenCode をこのディレクトリから起動すると、agent が実行する `git commit` は、対象リポジトリの fast gate と別CLIエージェントの承認が揃うまで拒否される。Git hook ではないため、人間が通常のターミナルから行うcommitには影響しない。

```powershell
git -C tastile-web commit -m "fix: example"
```

単一の直接コマンドを使用すること。詳細、対応形式、テスト、トラブルシュートは [agent loop](./.agent-loop/README.md) を参照。

## Child repositories

The following projects are managed in their own Git repositories and are intentionally excluded from this root repository:

- `tastile-android`
- `tastile-brands`
- `tastile-core`
- `tastile-core.wslc`
- `tastile-desktop`
- `tastile-web`
