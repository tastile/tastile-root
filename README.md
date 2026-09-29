# tastile-root

Tastile workspace の shell repository。独立した child repository (`tastile-core`、`tastile-web`、`tastile-android`、
`tastile-desktop`、`tastile-cli` 等) を同階層に並べて開発するための governance・architecture・tooling を持つ。
root は production artifact / build / runtime の依存にならない。

## Start here

- **Architecture SoT**: [`architecture/README.md`](./architecture/README.md) — 何がどこで canonical か、構造、通信、trust boundary、
  data、infra、environment、SLO / KPI / cost、PoC、roadmap。
- **Agent / contributor contract**: [`AGENTS.md`](./AGENTS.md)
- **Decisions**: [`docs/adr/`](./docs/adr/) ([index](./architecture/generated/adrs.md))
- **Workflow**: [`docs/agent-orchestration.md`](./docs/agent-orchestration.md)

product と domain の意味 (Tastile とは何か、語彙、仕様、API contract) は `tastile-core` が正本。

## Checks

```bash
bun install --frozen-lockfile
bun run architecture:validate          # architecture SoT (exit 0 PASS / 1 FAIL / 2 BLOCKED)
bun run architecture:audit             # + stale canonical claims in sibling checkouts (advisory)
```

```powershell
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile full -KeepGoing -ResultPath .\.tmp\workspace-check.json
pwsh -NoProfile -File .\scripts\check-agent-environment.ps1
```

終了コードは `0=全通過`、`1=コード/テスト失敗`、`2=外部環境不足による BLOCKED`。

## Agent commit / binding verification

Claude Code / Codex / OpenCode から agent-initiated commit を行う場合は per-repo fast
gate (例: `pwsh -NoProfile -File scripts\check-agent-environment.ps1` / `bun run check`)
と `verify-tastile-change` Skill による PR 直前 binding verification を実施する。
Git hook ではないため、人間が通常のターミナルから行う commit には影響しない。

2026-09-29 付で旧 per-commit reviewer loop (`.agent-loop/` + `tastile-precommit-review`
Skill) は廃止済み (ADR-0021)。残存する destructive / process wrapper hook は
`git-guard.mjs` と `tastile-command-guard.ps1` のみ。

## Child repositories

child repository は各自の Git repository で管理され、この repository には含まれない。一覧と責務の正本は
[`architecture/model/repositories.yaml`](./architecture/model/repositories.yaml) ([一覧](./architecture/generated/repositories.md))。
