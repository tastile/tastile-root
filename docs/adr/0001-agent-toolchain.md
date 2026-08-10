# ADR-0001: Project-local AI agent toolchain

- 日付: 2026-08-09
- 状態: Accepted
- 対象: Tastile root workspace の AI agent 構成

## Context

Tastile は、Rust backend、Next.js Web、Kotlin / Compose Android、.NET / WinUI
Desktop、brand asset の独立 Git repository を束ねる shell repository である。root の
agent 環境は child の contract を置換せず、routing、横断検証、commit 前 review を
再現可能にする必要がある。

2026-08-09 に現行構成と公式 guidance を再調査した。Next.js は project organization を
意図的に unopinionated とし、Android は UI / data layer と unidirectional data flow を
推奨し、WinUI は data binding / MVVM による UI と非 UI の分離を案内し、Cargo は共有
lockfile と workspace member による構成を定義している。既存 child の feature / layer
分離、MVVM、Cargo workspace はこれらと矛盾しないため、architecture migration は行わない。

参照:

- https://nextjs.org/docs/app/getting-started/project-structure
- https://developer.android.com/topic/architecture/recommendations
- https://learn.microsoft.com/windows/apps/develop/data-binding/data-binding-overview
- https://doc.rust-lang.org/cargo/reference/workspaces.html

## Decision

1. `AGENTS.md` を全 agent 共通の短い canonical dispatcher とする。
2. 詳細手順は `.agents/skills/` の3 Skillへ分離する。Claude の `CLAUDE.md` と
   `.claude/`、Codex の `.codex/` は native format の adapter / role 定義とする。
3. 全体検証は `scripts/check-workspace.ps1`、agent 構成検証は
   `scripts/check-agent-environment.ps1` を canonical entry point とする。
4. UI の live DOM、network、console 確認に Chrome DevTools MCP 1.6.0 を使用する。
   Bun 経由で起動し、isolated profile、CrUX 無効、usage statistics 無効とする。
5. AWS API MCP と PostgreSQL MCP は必須構成から外す。AWS は read-only profile を使う
   AWS CLI、PostgreSQL は read-only credential を使う `psql` と project test を優先する。
   credential は repository に保存しない。
6. marketplace plugin は追加しない。既存 CLI、project Skill、agent native browser と
   Chrome DevTools MCP で現在の capability gap を満たすためである。
7. root CI は GitHub Actions とし、`actions/checkout` v6.0.2 を commit SHA で固定して
   agent environment gate を Windows 上で実行する。child の CI は各 child が所有する。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| project-local Skills | 採用 | domain routing と evidence rule を低 context cost で遅延読込できる |
| Chrome DevTools MCP 1.6.0 | 採用 | live network / console / DOM の検証能力、Apache-2.0、公式管理。remote telemetry は無効化 |
| AWS API MCP | 不採用 | AWS CLI と能力重複、schema context cost が大きい。使用時点の server には移行案内もある |
| postgres-mcp | 不採用 | `psql` と integration test で決定論的に代替可能。Python runtime と追加 credential surface が必要 |
| Superpowers | 不採用 | 現在の design-first / review Skills と重複し、bundle 導入の追加価値が未確認 |
| persistent memory | 不採用 | repository の design、ADR、Skill を project truth とし、hidden state を増やさない |
| Context7 / Serena / RTK | 保留 | 現在の repository source、LSP、`rg`、CLI output で測定上の不足がない |

## Security、license、再現性

Chrome DevTools MCP は Apache-2.0 で、project の Apache-2.0 repository と整合する。
browser profile は isolated とし、個人 session を暗黙利用しない。AWS / DB 操作は task ごとに
明示された credential と最小権限を使う。version と起動引数は `.mcp.json` と
`.codex/config.toml` に固定する。Bun、PowerShell、Git、各 child toolchain は fresh clone
後の外部 prerequisite であり、version の正本は各 child manifest / lockfile とする。

## Consequences and re-evaluation

root agent 構成は repository から復元でき、global plugin installation は必須ではない。
Chrome DevTools MCP の security advisory、license、保守停止、Chrome 非互換、または native
browser だけで同等の deterministic evidence が得られる状態になったとき再評価する。AWS / DB
CLI で schema discovery が反復的な bottleneck と測定された場合だけ、read-only integration の
再導入を別 ADR で検討する。
