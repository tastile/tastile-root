# ADR-0004: Context7 MCP for live library documentation

- 日付: 2026-08-23
- 状態: Accepted
- 対象: Tastile root workspace の AI agent 構成
- 先行 ADR: ADR-0001 (Context7 を「保留」とした行を revise)

## Context

ADR-0001 (2026-08-09) で `Context7 / Serena / RTK` を「保留」とし、現状の
`repository source` / `LSP` / `rg` / `CLI output` で測定上の不足がないことを根拠に
見送った。

2026-08-23 に再評価した結果、以下の capability gap が顕在化した:

1. **Next.js 16 caveat**: `tastile-web/AGENTS.md` の「Next.js 16 Caveat」節が、training data
   との drift を明示的に警告している。Next.js 16 の breaking change は `node_modules/next/dist/docs/`
   から local に取得できるが、これは Next.js のみが対象。
2. **他 library の stale data risk**: Mantine v9 / TanStack Query v5 / Stripe v17 / React 19 / Zustand 5
   はいずれも最近の major / minor 更新があり、training data がそれらに追従している保証はない。
   local equivalent な docs directory は存在しない。
3. **MDN / W3C 等の Web 標準**: 新しい browser API や CSS feature の正本も、Context7 経由で
   取得できれば agent の hallucination を減らせる。

Context7 は `@upstash/context7-mcp` (4.0.3, MIT, 61.1k★, 938 commits, 2.9k forks, 活発に
保守中) として提供され、`resolve-library-id` と `query-docs` の 2 tool で version-specific な
documentation snippet を返す。

## Decision

1. `chrome-devtools-mcp` と同じ `bunx` 起動パターンで `@upstash/context7-mcp@4.0.3` を
   `.mcp.json` と `.codex/config.toml` の両方に登録する。`@latest` は禁止 (ADR-0001 の
   pinning rule 継続)。
2. 任意で `CONTEXT7_API_KEY` を `.env.development` (例示は `.env.development.example`) に
   設定可能。free tier は key なしで動作 (rate-limited)。
3. `scripts/audit-plugin-versions.mjs` の audit 対象に Context7 を追加し、drift 検出を
   release gate 前に挟めるようにする。
4. Serena と RTK は引き続き保留 (ADR-0001 の再評価 trigger 未到達)。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| `@upstash/context7-mcp` 4.0.3 | 採用 | live library docs、MIT、活発保守、free tier あり |
| `mcp-server-postgres` | 不採用 (継続) | ADR-0001 の理由継続。`psql` で代替 |
| `mcp-server-aws` | 不採用 (継続) | ADR-0001 の理由継続。AWS CLI で代替 |
| `@modelcontextprotocol/server-github` | 不採用 | `gh` CLI で代替可能。read / write 両方を MCP に乗せる利益が薄い |
| `mcp-server-git` | 不採用 | native git で代替可能 |
| Serena / RTK | 保留 (継続) | 測定上の不足なし |
| Skills mode (CLI + Skills) | 不採用 | MCP の方が context cost 低く、既存 infrastructure と整合 |

## Security、license、再現性

- License: MIT、project の Apache-2.0 と互換。
- Network dependency: MCP server が `mcp.context7.com` に HTTPS で通信。secret 送信なし
  (free tier 時)。API key 設定時は header `Authorization: Bearer <KEY>` のみ。
- Telemetry: Context7 側に telemetry 設定なし (package README 記載なし)。
- 起動: `bunx -y @upstash/context7-mcp@4.0.3` で 1 度 npm registry から取得、以降は
  bun 側で cache。fresh clone 後の再現性に影響なし。
- 任意 env: `CONTEXT7_API_KEY` 未設定でも動作。設定値は example file に placeholder として記載。
- 公式 guidance: https://github.com/upstash/context7/blob/master/docs および
  https://context7.com/docs/resources/all-clients

## Consequences and re-evaluation

採用後、`scripts/audit-plugin-versions.mjs` で Context7 を定期 audit する。`@latest`
drift を検出した場合は ADR 改訂なしで minor / patch bump を commit 可能。major bump は
別 ADR を起こす。

再評価 trigger:

- Context7 の security advisory 公開、または主要 version の破壊的変更。
- Mantine / TanStack Query / Next.js いずれかが stable channel で v17 等の major release を
  迎え、Context7 の index 反映が遅れた場合。
- Context7 が有料化されて free tier が事実上利用不能になった場合。
- native agent (Codex / Claude Code) が同等の docs lookup を native capability として
  取り込んだ場合。
- ADR-0001 の Serena / RTK 評価を更新する trigger が別途発生した場合 (Serena が symbol-level
  navigation で measured benefit を出したら再評価)。