# ADR-0005: Agent toolchain extensions — Skills と Codex role canonical reference

- 日付: 2026-08-23
- 状態: Accepted
- 対象: Tastile root workspace の AI agent 構成
- 先行 ADR: [ADR-0001](./0001-agent-toolchain.md) (revise), [ADR-0004](./0004-context7-mcp.md) (related, Context7 採用)

## Context

ADR-0001 §「選定評価」で `Context7 / Serena / RTK` は保留としていた。
ADR-0004 (2026-08-23) で Context7 MCP を採用に切り替え、ADR-0001 §「後続 ADR」
セクションから双方向 reference を確立した。本 ADR は 2026-08-23 時点で
`plugin-version-audit` Skill と `i18n-literal-guard` Skill (tastile-web) と
Codex role canonical reference を導入する。Context7 の詳細は ADR-0004 を参照。
Serena / RTK は引き続き保留。

### 2026-08-23 時点で測定した gap (Context7 以外)

1. **依存 version drift の定期 audit**: ADR-0004 (Context7 採用) により MCP の
   drift 検出は `scripts/audit-plugin-versions.mjs` に追加されたが、JS package
   drift の検出と release gate 連動はまだ未整備。ADR-0001 §「選定評価」の
   `Context7 / Serena / RTK` 保留判断以降、release 前 audit capability が
   正本 Skill として存在しない。
2. **i18n literal policy §11 の自動 enforcement**: ADR-0003 で inline literal を
   i18n bundle 経由へ移送する decision は確定したが、移送後の drift / 新規追加
   を定期検出する read-only audit が tastile-web にない。手動 spot check では
   scale しない。
3. **Codex role の正本 canonical reference**: `.codex/agents/*.toml` と
   `.claude/agents/*.md` の role 定義は個別に正本として機能するが、role 単位の
   routing / repair protocol は ADR に集約されていなかった。role 追加 / 削除 /
   統合時の参照点が必要。

## Decision

### D-1. `plugin-version-audit` Skill と audit script を追加

- 配置: `.agents/skills/plugin-version-audit/SKILL.md` (canonical) と
  `scripts/audit-plugin-versions.mjs` (Bun runner)。
- 責務: pinned dependency (MCP / package manager / runtime) の drift と
  security advisory を release 前 / bump 直前に read-only で確認。
- 終了コード: `0=PASS`, `1=OUTDATED` (drift 検出), `2=BLOCKED` (外部到達不可)。
- 検出対象: `chrome-devtools-mcp`, `@upstash/context7-mcp`, `@biomejs/biome`,
  `knip`, `vitest`, `@vitest/coverage-v8`, `@playwright/test`, `next`,
  `openapi-typescript`。Cargo 依存 (tastile-core) は別 ADR で扱う。
- 禁止: `--write` モード禁止。発見した更新を自動 commit / push しない。screenshot
  / log を commit しない (`policy §30`)。結果は `.tmp/` 配下へ。

### D-2. `i18n-literal-guard` Skill と audit script (tastile-web)

- 配置: `tastile-web/.agents/skills/i18n-literal-guard/SKILL.md` (canonical) と
  `tastile-web/scripts/audit-i18n-literals.mts` (Bun runner)。
- 責務: tastile-web の `src/**/*.{ts,tsx}` を再帰走査し、CJK literal を
  comment-block / comment-line / jsx-text / jsx-attr / string-literal /
  needs-review に分類。`policy §11` 違反を read-only で報告。
- 終了コード: `0=CLEAN`, `1=VIOLATIONS` (≥1 finding), `2=SCRIPT_ERROR`。
- 除外 path: `src/shared/i18n/**`, `*.test.*`, `*.spec.*`, `__tests__/`,
  `__mocks__/`, `src/test/`, `src/lib/test/`, `src/lib/api/v1/openapi-generated.*`。
- 禁止: `--fix` モード禁止。発見した literal を自動移送しない。違反の移送は
  Skill の workflow 経由で人間 / agent が i18n bundle へ。

### D-3. Codex role canonical reference を追加

- 配置: `CODEX_ROLES.ja.md` (repository root, role 一覧 + repair protocol)。
- 責務: `.codex/agents/*.toml` と `.claude/agents/*.md` で定義される role unit
  の正本一覧 / 主要責務 / sandbox mode / canonical path を集約。role 追加 /
  削除 / 統合時は本文書を先に更新し、native agent file を後から編集する
  (二者間 drift 回避)。
- 制約: 1 role = 1 file。`sandbox_mode` を必ず明示。role 変更は ADR 連動。
- 初回対象 role: `sol-supervisor`, `terra-inspector`, `luna-implementer`,
  `tastile-verifier`, `cross-repo-contract-reviewer`。

### D-4. ADR-0001 への back-reference

ADR-0001 §「選定評価」の Context7 行を revise (ADR-0004 と相互参照)、Serena /
RTK は継続保留。ADR-0001 §「後続 ADR」セクションに本 ADR と ADR-0004 を記載。
三方向 reference を残す。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| plugin-version-audit Skill + script | 採用 | ADR-0001 §「選定評価」で保留以来 capability gap が半年以上未解決。release 直前の drift 検出は policy §27 (自動 quality gate) と整合 |
| i18n-literal-guard Skill + script | 採用 | ADR-0003 の policy を enforcement する read-only audit が必要。手動 spot check では scale しない |
| CODEX_ROLES canonical reference | 採用 | role 定義の routing / repair 一元化。新規 role 追加時の参照点として機能 |
| Serena MCP | 保留 | symbol-level navigation の measured benefit なし。tastile-core の規模拡大時に再評価 |
| RTK | 保留 | CLI output 圧縮の測定上の不足なし。`tsc` / `cargo` / `gradle` 出力で問題未検出 |
| AWS / Postgres / GitHub MCP | 保留 | ADR-0001 と同様の理由で不採用継続。CLI + project test で代替 |
| rust-analyzer / kotlin-language-server LSP | 保留 | agent 環境での LSP 経路 (MCP wrapper) は未評価。ripgrep + source 読解で現在十分 |

## Security、license、再現性

Context7 MCP の security / license 詳細は ADR-0004 を参照。本 ADR の追加物は
すべて project-local で credential を持たず、fresh clone 後に Bun と PowerShell
があれば再現できる。`scripts/audit-plugin-versions.mjs` の検出対象に追加した
package は各 child の lockfile を正本とし、`@latest` を許可しない
(ADR-0001 §「Security、license、再現性」継続)。

## Consequences and re-evaluation

### 直接的な影響

- release 前 / bump 直前に JS / MCP drift を検出する read-only audit が稼働。
- tastile-web の policy §11 違反を定期検出できる。
- Codex role 定義の参照点が一元化され、role 追加 / 削除 / 統合時の drift を
  ADR と本文書で抑止できる。

### トレードオフ

- `plugin-version-audit` は network 依存。offline / firewall 環境では `BLOCKED`
  (exit 2) になる。
- `i18n-literal-guard` は heuristic (CJK pattern + line class) であり、false
  positive / false negative を完全には排除しない。review が必要な finding には
  `needs-review` class を付与。

### 再評価 trigger

- `plugin-version-audit` が他言語 (Rust / Kotlin / C#) の audit 対象拡大を要求
  する段階で別 ADR。
- `i18n-literal-guard` が false positive 率を許容できないレベルで誤検知する
  場合、または i18n tooling (BabelEdit / Lokalise / Crowdin 等) を導入する場合。
- `CODEX_ROLES` の role 追加 / 削除 / 統合が発生したら、本 ADR と
  `docs/adr/0001-agent-toolchain.md` の双方を更新。

### 関連 ADR / 関連 Skill

- [ADR-0001](./0001-agent-toolchain.md): 先行 ADR (revise)。Context7 行を
  ADR-0004 と関連付けて更新。
- [ADR-0004](./0004-context7-mcp.md): Context7 採用。本 ADR の D-1 (audit script)
  に detection target として context7-mcp を追加する。
- [ADR-0003](./0003-i18n-inline-literal-remediation.md): i18n policy §11 の decision。
  本 ADR の D-2 はその enforcement。
- `.agents/skills/cross-repo-contract-check/`: 複数 child contract 変更時の検証。
- `.agents/skills/verify-tastile-change/`: PASS / DONE / GREEN 宣言前の binding
  verification。本 ADR の D-1 はその前段。
- `.agents/skills/tastile-precommit-review/`: agent-initiated commit 直前の独立
  review。本 ADR の追加 Skill 群と並列に catalog に追加。
- `CODEX_ROLES.ja.md`: 本 ADR の D-3 が導入する canonical reference。