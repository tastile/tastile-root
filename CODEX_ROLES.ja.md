# Codex 役割分担 (canonical)

> **正本**: この文書は Tastile workspace の Codex 役割分担の canonical source である。
> 通常タスクで毎回読み込む必要はない。**必要な role unit が missing / stale のときにだけ**
> 読み込み、repair 後に閉じる。完全 init prompt の代替ではない。

## 適用範囲

- 対象: `.codex/agents/*.toml` と `.claude/agents/*.md` で定義される role unit
- 参照: `docs/plans/2026-08-01-codex-three-role-agents.md` (初期 3 役割設計)
- 不変条件: `AGENTS.md` 「常時適用する不変条件」、`docs/HARNESS.md` 全体方針

## Role unit 一覧

| Role | Native format | Sandbox | 主要責務 | 触れないもの |
| --- | --- | --- | --- | --- |
| `sol-supervisor` | codex (.toml) | read-only | task decomposition, delegation, scope, evidence quality, readiness decision | 実装 file edit |
| `terra-inspector` | codex (.toml) | read-only | correctness, contract, regression, verification evidence の独立検査 | edit, write, commit, push, deploy, mutation |
| `luna-implementer` | codex (.toml) | workspace-write | 承認済み plan と ownership の下での scoped implementation | 割り当て外 file、無許可 commit/push/deploy |
| `tastile-verifier` | codex + claude | read-only | PASS / DONE / GREEN 宣言前の read-only verification、binding Skill は `verify-tastile-change` | edit, write, commit, push, deploy, mutation |
| `cross-repo-contract-reviewer` | codex + claude | read-only | 複数 child, API, schema, auth, 共有 client behavior の review、binding Skill は `cross-repo-contract-check` | edit, write, commit, push, deploy, mutation |

## Canonical reference path

各 role の binding definition は以下に置く。**正本は native agent format の file**であり、この文書は要約と routing のために存在する。

| Role | Code path |
| --- | --- |
| sol-supervisor | `.codex/agents/sol-supervisor.toml` |
| terra-inspector | `.codex/agents/terra-inspector.toml` |
| luna-implementer | `.codex/agents/luna-implementer.toml` |
| tastile-verifier | `.codex/agents/tastile-verifier.toml`, `.claude/agents/tastile-verifier.md` |
| cross-repo-contract-reviewer | `.codex/agents/cross-repo-contract-reviewer.toml`, `.claude/agents/cross-repo-contract-reviewer.md` |

## Repair protocol

role unit が missing / stale の場合のみこの文書を参照し、次の順で修復する:

1. 上記 table で対象 role の `Code path` を確認する。
2. native format の file が存在しなければ、`.codex/agents/<role>.toml` または `.claude/agents/<role>.md` を template を参考に新規作成する。template は native format の既存 role (同じ agent) をコピーし、`name`, `description`, `developer_instructions`, `sandbox_mode` を該当 role の責務に合わせて書き換える。
3. 既存 file が stale なら、native format の file を直接編集する。**この文書を更新してから file を編集する** (二者間 drift を避けるため)。
4. 修復後、`scripts/check-agent-environment.ps1` を実行して required files の存在を検証する。
5. codex を使うなら `.codex/config.toml` の `model` / `model_reasoning_effort` が native role 定義と整合するか確認する。`@latest` pinning を禁止している check ルール (ADR-0001) に従う。

## 制約

- 役割分担を MVP へ勝手に縮小しない (policy §17)。
- 役割定義は Code (英語) で書き、description / developer_instructions は native agent が理解する言語で書く。
- 1 role を 1 file に 1:1 で対応させ、複数の role を 1 file にまとめない。
- `sandbox_mode` を role ごとに必ず明示する。read-only のはずの role が write できてはいけない。
- role 追加 / 削除 / 統合は ADR に記録する (policy §15)。

## ADR 連動

- ADR-0001 (project-local AI agent toolchain): MCP と plugin 採否の根拠。role 定義ではない。
- ADR-0003 (i18n literal remediation): role が翻訳済みかを本 ADR と合わせて確認する余地はあるが、role 自身の責務ではない。
- 本文書で role を追加・削除する場合は、新規 ADR を作成して `docs/adr/` に置く。既存 ADR との supersede / revise 関係を双方 reference で残す。
