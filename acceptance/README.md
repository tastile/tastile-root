# Acceptance (本番基盤先行稼働の受入ハーネス)

正本: GitHub Issue `tastile/tastile-root#165`（受入条件 A-AT01–A-AT17 + 中核 E2E）、
実行タスク `#166`（契約先行・ハーネス・baseline・未達マッピング）。

## 構成

- `contract/acceptance-contract.json` — 版管理された受入契約。各 case の id、環境適用範囲
  (`local` / `prod-equivalent` / `https`)、前提条件、timeout、チェック項目を定義する。
  実装はこの契約を読み、registry が contract と完全一致しない限り実行しない。
- `harness/` — Bun/TypeScript 製ハーネス。HTTP client、ブラウザ (Playwright)、
  fixture bootstrap、ops 注入チャネル、証跡 writer、runner を持つ。

## 実行

```bash
cd acceptance/harness
bun install
bunx tsc --noEmit                 # 型検査
bun src/main.ts --list            # contract の全 case 一覧
bun src/main.ts --profile local   # local プロファイルで全 case
bun src/main.ts --profile local --only A-AT01,A-AT05
```

環境プロファイルは `src/profile.ts` が解決する。対象 origin は
`TASTILE_ACCEPTANCE_API_BASE` / `TASTILE_ACCEPTANCE_WEB_BASE` で上書きできる。

ops 注入 (A-AT13–A-AT15) は `TASTILE_ACCEPTANCE_OPS` / `TASTILE_ACCEPTANCE_OPS_CMD` /
`TASTILE_ACCEPTANCE_COMPOSE_*` で有効化する。`https` プロファイルでは ops 注入を行わない
(承認境界)。

## 判定

各 case は `PASS` / `FAIL` / `BLOCKED` / `N-A` / `NOT-RUN` のいずれかで終わる。
`BLOCKED` は環境・前提・資格情報の不足で判定不能を意味し、FAIL とは区別する。
証跡は `.tmp/acceptance/<run-id>-<profile>/` に case ごとの check/step JSON と
summary を書き出す。
