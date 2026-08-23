# ADR-0004: Agent toolchain extensions — Context7 MCP と追加 Skill

- 日付: 2026-08-23
- 状態: Accepted
- 対象: Tastile root workspace の AI agent 構成
- 先行 ADR: [ADR-0001](./0001-agent-toolchain.md) (revise)

## Context

ADR-0001 §「選定評価」で `Context7 / Serena / RTK` は保留としていた。本 ADR は
2026-08-23 時点で Context7 を採用に切り替え、追加で `plugin-version-audit` Skill と
`i18n-literal-guard` Skill (tastile-web) と Codex role canonical reference を導入する。
Serena / RTK は引き続き保留。

### 2026-08-23 時点で測定した gap

1. **Live library documentation**: Tastile の frontend (Next.js 16 / Mantine v9 /
   Stripe v17 / Playwright 1.62 / Biome 1.9 / Knip 6 / Vitest 4 / openapi-typescript)
   は training data cutoff 以降に更新されており、model knowledge と実装の差分が
   drift を生む。release 前 / bump 後の手動 `npm view` 確認は読み取り専用 audit
   では捕捉できない skill interface 差分を拾えない。
2. **依存 version drift の定期 audit**: `scripts/audit-plugin-versions.mjs` で
   JS / MCP の pinning drift は検出できるが、ADR-0001 §「選定評価」の
   `Context7 / Serena / RTK` 保留判断以降、この capability が未整備のまま
   半年以上経過した。release 直前に audit する Skill が正本 repository に
   存在しない。
3. **i18n literal policy §11 の自動 enforcement**: ADR-0003 で inline literal を
   i18n bundle 経由へ移送する decision は確定したが、移送後の drift / 新規追加
   を定期検出する read-only audit が tastile-web にない。手動 spot check では
   scale しない。
4. **Codex role の正本 canonical reference**: `.codex/agents/*.toml` と
   `.claude/agents/*.md` の role 定義は個別に正本として機能するが、role 単位の
   routing / repair protocol は ADR に集約されていなかった。role 追加 / 削除 /
   統合時の参照点が必要。

## Decision

### D-1. Context7 MCP を採用

- 配置: `.mcp.json` (Claude Code / OpenCode 用) と `.codex/config.toml`
  (Codex CLI 用) の両方に `@upstash/context7-mcp@4.0.3` を pinned で追加。
- 起動: Bun 経由 (`bunx -y @upstash/context7-mcp@4.0.3`)。`@latest` を許可しない。
- 用途: Next.js 16 / Mantine v9 / Stripe v17 等の live library documentation を
  resolve-id ベースで取得。`rg` / `gh` / WebFetch と役割分担し、training data
  drift が大きい library の API signature / option 確認に限定。
- credential: 不要 (anonymous public registry)。repository に secret を持たない。

### D-2. `plugin-version-audit` Skill と audit script を追加

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

### D-3. `i18n-literal-guard` Skill と audit script (tastile-web)

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

### D-4. Codex role canonical reference を追加

- 配置: `CODEX_ROLES.ja.md` (repository root, role 一覧 + repair protocol)。
- 責務: `.codex/agents/*.toml` と `.claude/agents/*.md` で定義される role unit
  の正本一覧 / 主要責務 / sandbox mode / canonical path を集約。role 追加 /
  削除 / 統合時は本文書を先に更新し、native agent file を後から編集する
  (二者間 drift 回避)。
- 制約: 1 role = 1 file。`sandbox_mode` を必ず明示。role 変更は ADR 連動。
- 初回対象 role: `sol-supervisor`, `terra-inspector`, `luna-implementer`,
  `tastile-verifier`, `cross-repo-contract-reviewer`。

### D-5. ADR-0001 への back-reference

ADR-0001 §「選定評価」の Context7 行を revise し、Serena / RTK は継続保留。
ADR-0001 §「後続 ADR」セクションに本 ADR を記載。両方向 reference を残す。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| Context7 MCP 4.0.3 | 採用 | live library documentation を resolve-id ベースで取得。Next.js 16 / Mantine v9 / Stripe v17 の training data drift を測定可能な形で補う。anonymous registry 利用で credential 不要。Apache-2.0、official 公開 |
| plugin-version-audit Skill + script | 採用 | ADR-0001 §「選定評価」で保留以来 capability gap が半年以上未解決。release 直前の drift 検出は policy §27 (自動 quality gate) と整合 |
| i18n-literal-guard Skill + script | 採用 | ADR-0003 の policy を enforcement する read-only audit が必要。手動 spot check では scale しない |
| CODEX_ROLES canonical reference | 採用 | role 定義の routing / repair 一元化。新規 role 追加時の参照点として機能 |
| Serena MCP | 保留 | symbol-level navigation の measured benefit なし。tastile-core の規模拡大時に再評価 |
| RTK | 保留 | CLI output 圧縮の測定上の不足なし。`tsc` / `cargo` / `gradle` 出力で問題未検出 |
| AWS / Postgres / GitHub MCP | 保留 | ADR-0001 と同様の理由で不採用継続。CLI + project test で代替 |
| rust-analyzer / kotlin-language-server LSP | 保留 | agent 環境での LSP 経路 (MCP wrapper) は未評価。ripgrep + source 読解で現在十分 |

## Security、license、再現性

Context7 MCP は anonymous public registry を利用し credential を保持しない。
version は `.mcp.json` / `.codex/config.toml` に pinned し、`@latest` を許可しない
(ADR-0001 §「Security、license、再現性」)。`scripts/audit-plugin-versions.mjs` で
毎回 drift を観測可能。fresh clone 後、Bun と PowerShell があれば audit script と
Skills を再現できる。

## Consequences and re-evaluation

### 直接的な影響

- agent は Next.js 16 / Mantine v9 / Stripe v17 等で current API signature /
  option を resolve-id で取得可能。誤った training data に基づく実装を防ぐ。
- release 前 / bump 直前に drift を検出する read-only audit が稼働。
- tastile-web の policy §11 違反を定期検出できる。
- Codex role 定義の参照点が一元化。

### トレードオフ

- Context7 MCP は library 1 件あたり外部 round-trip を発生させる。broad な query
  ではなく、resolve-id を明示した targeted lookup に限定する (Skill 経由)。
- `plugin-version-audit` は network 依存。offline / firewall 環境では `BLOCKED`
  (exit 2) になる。
- `i18n-literal-guard` は heuristic (CJK pattern + line class) であり、false
  positive / false negative を完全には排除しない。review が必要な finding には
  `needs-review` class を付与。

### 再評価 trigger

- Context7 MCP の security advisory / license 変更 / anonymous 利用制限 / resolve
  API breaking change 発生時、または native MCP (Claude / Codex) の built-in
  documentation capability で代替可能になったとき再評価。
- `plugin-version-audit` が他言語 (Rust / Kotlin / C#) の audit 対象拡大を要求
  する段階で別 ADR。
- `i18n-literal-guard` が false positive 率を許容できないレベルで誤検知する
  場合、または i18n tooling (BabelEdit / Lokalise / Crowdin 等) を導入する場合。
- `CODEX_ROLES` の role 追加 / 削除 / 統合が発生したら、本 ADR と
  `docs/adr/0001-agent-toolchain.md` の双方を更新。

### 関連 ADR / 関連 Skill

- [ADR-0001](./0001-agent-toolchain.md): 先行 ADR (revise)。Context7 行を更新。
- [ADR-0003](./0003-i18n-inline-literal-remediation.md): i18n policy §11 の decision。
  本 ADR の D-3 はその enforcement。
- `.agents/skills/cross-repo-contract-check/`: 複数 child contract 変更時の検証。
- `.agents/skills/verify-tastile-change/`: PASS / DONE / GREEN 宣言前の binding
  verification。本 ADR の D-2 はその前段。
- `.agents/skills/tastile-precommit-review/`: agent-initiated commit 直前の独立
  review。本 ADR の追加 Skill 群と並列に catalog に追加。