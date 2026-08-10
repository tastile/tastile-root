# Tastile ワークスペース契約

このリポジトリは、独立した Git リポジトリである `tastile-core`、`tastile-web`、
`tastile-android`、`tastile-desktop`、`tastile-brands` を同階層に置く shell
repository である。ルートの Git 状態だけで子リポジトリの状態を判断しない。

## 正本とルーティング

| 対象 | 最初に読む正本 | 作業場所 |
| --- | --- | --- |
| 全体方針、認証、インフラ | `docs/HARNESS.md`、`docs/decisions.md` | root |
| domain、API、schema | `tastile-core/v1/` の該当章、子の `AGENTS.md` | `tastile-core` |
| Web / Next.js | `tastile-web/AGENTS.md` | `tastile-web` |
| Android / Compose | `tastile-android/README.md` | `tastile-android` |
| Desktop / WinUI | `tastile-desktop/CLAUDE.md` | `tastile-desktop` |
| brand asset | `tastile-brands/README.md` | `tastile-brands` |

複数の子リポジトリまたは共有 contract に触れる場合は、すべての対象リポジトリの
指示と `tastile-core/v1/` の該当章を読む。brand asset は相対参照せず各 consumer
へ copy する。

## 常時適用する不変条件

- 開始時に対象ごとの branch、`git status --short`、既存差分を確認し、無関係な変更を
  reset、checkout、stash、revert、stage、commit しない。worktree は作らない。
- design / specification がある変更は、最終状態の design をユーザーと確定してから
  実装する。履歴は ADR に置く。
- source code、識別子、code comment、Git / GitHub message は英語、内部開発文書と
  project agent instruction は日本語で書く。
- frontend と script-side の package manager は Bun とする。新規 Python script は
  作らない。検索は `rg` / `rg --files` を優先する。
- business logic は `tastile-core` が所有し、client は thin client とする。v1 の語彙と
  schema を正本とし、互換 shim を独断で追加しない。
- 実値は `.env`、`.env.development`、`.env.production` のみへ置き、commit しない。
  schema は対応する `*.example` に置く。一時物は root の `.tmp/`、外部参照 clone は
  `.reference/` に置き、どちらも dependency にしない。
- 権限と利用可能な機能が許す場合、独立した作業だけを明示的な file ownership で
  並列化する。同一 file の並列編集と、subagent による自己承認は禁止する。

## Agent Skills

詳細手順は `.agents/skills/` を正本とし、trigger に一致したときだけ読む。

- `cross-repo-contract-check`: 複数 child、API / schema / auth / 共有 UI contract の変更。
- `verify-tastile-change`: PASS、DONE、GREEN、commit / merge / ship 可能と述べる直前。
- `tastile-precommit-review`: root 変更を agent が commit する直前の独立 review。

## 検証と commit

変更した各 child の local instruction が指定する全 applicable gate を実行する。全体入口:

```powershell
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile full -KeepGoing -ResultPath .\.tmp\workspace-check.json
```

agent 環境自体の検証入口:

```powershell
pwsh -NoProfile -File .\scripts\check-agent-environment.ps1
```

終了コードは `0=PASS`、`1=code/test failure`、`2=external prerequisite により BLOCKED`。
skip、broad ignore、warning suppression、古い出力で green を作らない。UI は実 browser、
PostgreSQL は到達可能な実 DB、Android は対象 device、Rust はこの host では WSL / wslc
で確認する。agent が commit する場合は `.agent-loop/README.md` の独立 review gate を通し、
英語の `<type>: <concise title>` を使う。
