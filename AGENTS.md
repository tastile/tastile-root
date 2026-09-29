# Tastile ワークスペース契約

このリポジトリは、独立した Git リポジトリ (`tastile-core`、`tastile-web`、`tastile-android`、
`tastile-desktop`、`tastile-cli`。必要に応じて `tastile-brands` 等) を同階層に置く shell
repository である。ルートの Git 状態だけで子リポジトリの状態を判断しない。repository の一覧と
責務の正本は `architecture/model/repositories.yaml`。

## 正本とルーティング

**何がどこで canonical かは `architecture/model/sot-registry.yaml` が一意に決める (ADR-0013)。**
意味 (product・domain・API contract・DB schema) は `tastile-core`、仕組み (構造・通信・trust・data
lifecycle・environment・deployment・SLO / KPI / cost・PoC・risk・roadmap) は root `architecture/`。

| 対象 | 最初に読む正本 | 作業場所 |
| --- | --- | --- |
| 全体像、構造、インフラ、環境、認証境界、品質目標 | `architecture/README.md` → `architecture/model/` | root |
| product の目的・原則・KPI | `tastile-core/docs/product/README.md` | `tastile-core` |
| domain 語彙・仕様・API・schema | `tastile-core/v1/` の該当章 (00 = 語彙)、子の `AGENTS.md` | `tastile-core` |
| system-level の判断 | `docs/adr/` (索引 `architecture/generated/adrs.md`) | root |
| 開発 workflow (branch / Issue / PR / recovery) | `docs/agent-orchestration.md`、ADR-0007〜0009 | root |
| Web / Next.js | `tastile-web/AGENTS.md` | `tastile-web` |
| Android / Compose | `tastile-android/AGENTS.md` | `tastile-android` |
| Desktop / WinUI | `tastile-desktop/AGENTS.md` | `tastile-desktop` |
| CLI / TUI | `tastile-cli/AGENTS.md` | `tastile-cli` |
| brand asset | `tastile-brands/README.md` | `tastile-brands` |

複数の子リポジトリまたは共有 contract に触れる場合は、すべての対象リポジトリの
指示、`tastile-core/v1/` の該当章、`architecture/model/` の該当要素を読む。brand asset は
相対参照せず各 consumer へ copy する。`docs/HARNESS.md` は入口 pointer、`docs/decisions.md` は
凍結済み履歴、`docs/raw/`・`docs/archive/` は evidence であり、いずれも authority ではない。

## 常時適用する不変条件

- 開始時に対象ごとの branch、`git status --short`、既存差分を確認し、無関係な変更を
  reset、checkout、stash、revert、stage、commit しない。共有 host 上に並列実装用の
  worktree は作らない。Supervisor が隔離を保証する runtime 内でのみ使用できる。
- design / specification がある変更は、最終状態の design をユーザーと確定してから
  実装する。履歴は ADR に置く。
- source code、識別子、code comment、commit message は英語。Issue、PR、review、
  内部開発文書、project agent instruction は日本語で書く。
- frontend と script-side の package manager は Bun とする。新規 Python script は
  作らない。検索は `rg` / `rg --files` を優先する。
- business logic は `tastile-core` が所有し、client は thin client とする。v1 の語彙と
  schema を正本とし、互換 shim を独断で追加しない。
- secret 実値の編集可能な store は environment ごとに 1 つだけ。current / target とも Infisical
  (ADR-0012、ADR-0015)。GCP runtime は workload identity で Infisical から取得する。
  `.env*`、`local.properties`、GitHub Secrets、AWS Parameter Store / Secrets Manager に独立 copy や
  fallback を作らず、必須値が無ければ fail closed。dotenv file が必要なツールに限り、認証後に一時生成し
  Git ignore・ユーザー限定権限にした上で利用後に削除する。子 repository の `.env.example` は key name だけを
  空値で記載する schema-only file に限り許可し、runtime や fallback では使わない。一時物は root の
  `.tmp/`、外部参照 clone は `.reference/` に置き、どちらも dependency にしない。
- infra・environment・credential の変更は `architecture/model/` を先に変更し、`bun run architecture:validate`
  を通す。production mutation・課金・公開判断は operator の authority (security.yaml `ctl.prod-mutation-authority`)。
- 権限と利用可能な機能が許す場合、独立した作業だけを明示的な file ownership で
  並列化する。同一 file の並列編集と、subagent による自己承認は禁止する。
- **branch workflow (ADR-0007)** — `main` は released / integrated state。active
  sprint は `release-<major>-<minor>-<patch>` branch、ticket branch は GitHub Issue
  番号のみ。`feature/*`、`fix-*` 等の prefix / slug 入り branch は禁止。
- **durable checkpoint (ADR-0008)** — agent 実行の soft / hard checkpoint は
  `.agent-loop/checkpoint.schema.json` / `.agent-loop/agent-result.schema.json` を正本とする。
  fresh agent は conversation 履歴ではなく canonical policy + durable remote
  state のみから再構成する。
- **Project work state (ADR-0009)** — durable work item は GitHub Issue とし、
  Project v2 の必須 field (`priority / size / target_version / execution_generation`)
  を満たすまで status を `Ready` へ遷移しない。

## 並行開発と orchestration policy

sprint branch 規約、engineering decision precedence、user escalation
boundary、subagent mode taxonomy、worker lease / fencing、recovery
checkpoint schema、external side-effect journal は
`docs/agent-orchestration.md` を参照。**通常 task では AGENTS.md /
HARNESS.md / CODEX_ROLES.ja.md の pointer のみ参照し、本文書は初回
init / orchestration 再構成時に全文を読む**。

## Agent Skills

詳細手順は `.agents/skills/` を正本とし、trigger に一致したときだけ読む。

- `cross-repo-contract-check`: 複数 child、API / schema / auth / 共有 UI contract の変更。
- `architecture-sot`: `architecture/model/*.yaml`、SoT registry、生成 view、ADR 0013-0020 の変更・検証・review。
- `verify-tastile-change`: PASS、DONE、GREEN、commit / merge / ship 可能と述べる直前。
- `plugin-version-audit`: pinned 依存（MCP / Bun / Node / Biome / Knip / Vitest / Playwright / Next /
  openapi-typescript）の drift と advisory を release 前、または bump 直前に read-only で確認する。
- `parallel-orchestration`: worker への実装委譲、並列化、再割当、停止、成果物統合。
- `github-delivery`: Issue の着手、Draft PR、release branch、検証証跡、明示的な完了処理。
- `release-branch-workflow`: sprint planning、Issue 起票、PR 開始、release 統合の直前
  (ADR-0007)。
- `recover-task`: agent context / session / sandbox 消失後、または fresh agent が前
  タスクを引き継ぐとき (ADR-0008)。
- `project-board`: Issue status 遷移、Project field 操作、WIP 確認 (ADR-0009)。
- `subagent-coordination`: sub-agent を spawn / integrate / 監視 / cancel /
  recover-task するとき、Codex trio (Sol / Luna / Terra) と Claude role catalog を
  参照する (ADR-0005 + ADR-0008)。

## 検証と commit

変更した各 child の local instruction が指定する全 applicable gate を実行する。root の
architecture SoT を変更した場合は次を通す (生成物は同じ commit に含める):

```bash
bun run architecture:generate && bun run architecture:render && bun run architecture:validate
```

全体入口:

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
PostgreSQL は到達可能な実 DB、Android は対象 device、Rust は Linux (WSL / wslc / Linux host)
で確認する。agent が commit する場合は `verify-tastile-change` による binding verification を行い、
英語の `<type>: <concise title>` を使う。旧 per-commit reviewer loop は廃止済み (ADR-0021)。
