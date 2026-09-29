---
id: adr.root.0021
status: Accepted
date: 2026-09-29
scope: root agent tooling and commit workflow
relates: [adr.root.0007, adr.root.0008, adr.root.0013]
---

# ADR-0021: per-commit reviewer loop を廃止する

## Context

`main` の commit `9a40e81` では、per-commit reviewer loop の廃止が承認・実装された。
移行用 `release-0-7-0` は分岐後に旧 hook を保持しており、`main` の ADR-0012 と
この branch の ADR-0012 は異なる判断に同じ番号を使用している。そのため commit 全体の
機械的な取り込みは行わず、廃止判断をこの branch に移す。

旧 loop は認証済みの別 CLI を commit ごとに要求する。現在の binding verification は
`verify-tastile-change` と対象 repository の applicable gate で行う。

## Decision

1. Codex / Claude の hook dispatcher から per-commit reviewer 呼び出しを削除する。
   destructive command guard と toolchain policy guard は保持する。
2. `.agent-loop/` の review engine、review-only catalog / schema / gate / tests と
   `tastile-precommit-review` Skill を削除する。
3. ADR-0008 の recovery checkpoint / child result schema と checkpoint directory は保持する。
4. agent commit 前の検証は `verify-tastile-change` と変更対象の applicable gate に従う。
   PR / release の独立 review、binding evidence、GitHub required checks は省略しない。

ADR-0007 / ADR-0008 に記載された旧 per-commit reviewer への参照は、この判断で置き換える。
branch / Issue / PR と recovery checkpoint の判断は継続する。

## Verification

- hook dispatcher が旧 review engine を参照しない。
- `scripts/check-agent-environment.ps1` と `architecture:validate` が通る。
- checkpoint schema と `verify-tastile-change` が残る。
