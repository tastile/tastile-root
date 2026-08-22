# tastile-web demo-site banner — Implementation Plan (2026-07-28)

参照 spec: `docs/superpowers/specs/2026-07-28-tastile-web-demo-banner-design.md`

Worktree は使わない (`feedback_no_git_worktree_default.md`)。

## Step 1 — 新規コンポーネント

- `src/components/marketing/DemoSiteBanner.tsx` を作成
- Client Component、`useLocaleStore` を import
- 文言は spec §Copy の ja / en をハンドコード (本 PR のスコープ外で marketing-dict の
  リファクタはやらない)
- icon は `lucide-react` の `AlertTriangle`

verify: `bun run lint src/components/marketing/DemoSiteBanner.tsx` がエラー無し

## Step 2 — Vitest テスト追加

- `src/components/marketing/DemoSiteBanner.test.tsx` を新規
- `useLocaleStore` の locale を `ja` / `en` に切替してテキストが正しく出ることを確認
- レンダー後の `<a>` の `href` が各 URL を含むことを確認

verify: `bun test src/components/marketing/DemoSiteBanner.test.tsx`

## Step 3 — root layout へ挿入

- `src/app/layout.tsx` を読み、必要 import を整え、`AppProviders` 直下に
  `<DemoSiteBanner />` を 1 行挿入

verify: `bun run build` (`lint` は Step 5 でまとめて)

## Step 4 — 既存ヘッダーの位置調整

- `src/components/SiteHeader.tsx`: `sticky top-0 z-40 bg-surface-0/90 …` を
  `sticky top-9 z-40 bg-surface-0/90 …` に
- `src/components/layout/AppShell.tsx`: ルート `<div>` に `pt-9` を追加
- `/login` の body は中央寄せで filled background なことを確認 (重なるようなら追加調整)

verify: dev サーバで トップ / pricing / download / login / dashboard (E2E_BYPASS) を
Chrome Devtools MCP で目視

## Step 5 — lint + build + browser 確認

- `bun run lint`
- `bun run build` (`next build`)
- Chrome DevTools MCP で http://localhost:3000 を開き以下を確認:
  - top 36px に amber の細いバナー
  - ja (デフォルト) と en (locale 切替後) で本文・リンクが追従
  - `/pricing`, `/download` でも表示
  - SiteHeader のナビゲーションと重ならない (gap 36px)
  - `/dashboard` (E2E_BYPASS_AUTH=1 起動) でも表示、AppShell Header と重ならない

## Non-goals

- バナーの閉じるボタン追加
- `marketing-dict.ts` への組み込み (deferred — 現在はテキスト直接)
- 別 locale (de / es / fr / ko / zh-CN) の追加 (en フォールバックのまま)
- `/api/*` の調整
