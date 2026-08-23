---
name: plugin-version-audit
description: Tastile workspace で pinning された MCP / package manager / ランタイム依存の最新版と advisory を release 前、または依存 bump 直前に read-only で確認する。
---

# Plugin / runtime version audit

`@latest` を自動 pull しない方針 (ADR-0001) を維持するため、pinning された依存の
drift と security advisory を release 前、または手動 bump 直前に確認する。**書込み権限を
持たない**。発見した更新は commit せず、ADR または change-set 案として提示する。

## 発火条件

- `release-claim.ps1` または `verify-release.ps1` を実行する直前。
- `chrome-devtools-mcp`, `@biomejs/biome`, `knip`, `vitest`, `@playwright/test`,
  `next`, `openapi-typescript` のいずれかを bump する task の最中。
- Bun, Node, Rust toolchain を更新する task の最中。
- 月次 / 四半期の定期棚卸し。

## Audit 対象

| 対象 | 場所 | 確認項目 |
| --- | --- | --- |
| MCP servers | `.mcp.json`, `.codex/config.toml` | pinned version, `@latest` 混入禁止 |
| Bun runtime | `tastile-web/package.json` (`packageManager`) | 最新 stable と乖離 |
| Node engine | `tastile-web/package.json` (`engines.node`) | 公式 LTS と乖離 |
| Biome | `tastile-web/package.json` (`@biomejs/biome`) | major bump 遅延の累積 |
| Knip | `tastile-web/package.json` (`knip`) | 同上 |
| Vitest | `tastile-web/package.json` (`vitest`, `@vitest/coverage-v8`) | 同上 |
| Playwright | `tastile-web/package.json` (`@playwright/test`) | 同上 |
| Next.js | `tastile-web/package.json` (`next`) | major bump 遅延の累積 |
| OpenAPI generator | `tastile-web/package.json` (`openapi-typescript`) | 同上 |
| Cargo deps (core) | `tastile-core/Cargo.toml` | advisories (`cargo audit` 等) |

## 実行

### 自動 (Bun script)

```powershell
pwsh -NoProfile -File .\scripts\audit-plugin-versions.mjs
```

終了コード: `0=PASS` (全 current), `1=OUTDATED` (drift 検出), `2=BLOCKED` (外部到達不可 /
network 失敗)。

### 手動

```bash
bunx npm view chrome-devtools-mcp version
bunx npm view @biomejs/biome version
bun pm ls  # resolve installed tree
```

スクリプト実行が失敗する場合、または offline で監査したい場合は手動手順で代替する。

## 出力

| 項目 | 必須 |
| --- | --- |
| Audit 実行日時 (UTC) | yes |
| 対象 file と pinned version | yes |
| 各対象の最新 stable version (取得できた場合) | yes |
| Drift (current < latest) | yes |
| 公式 advisory / CVE (取得できた場合) | 推奨 |
| bump 推奨 (major / minor / patch) | yes |
| bump を **しない** 判断の理由 (該当時) | yes |

## 禁止

- 監査スクリプトを `--write` モードで実行しない。**読み込み専用 audit のみ**。
- 発見した更新を自動 commit / push しない。更新判断は ADR を残し、別 commit として実施。
- security advisory を放置したまま release を通さない。`BLOCKED` を維持する。
- 監査結果の screenshot や log を commit しない (policy §30)。`.tmp/` に置く。

## 関連

- ADR-0001 (agent toolchain): MCP pinning の根拠と `@latest` 禁止ルール。
- `verify-tastile-change`: release 直前の binding Skill。`plugin-version-audit` はその前段。
- `scripts/check-agent-environment.ps1`: audit script の存在も任意で検査対象に含めてよい。
