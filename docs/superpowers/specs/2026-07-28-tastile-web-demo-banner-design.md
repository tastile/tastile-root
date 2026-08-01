# tastile-web demo-site banner — Design (2026-07-28)

## Goal

`/`, `/pricing`, `/download`, `/login`, `/dashboard/*`, `/app/*`, `/auth/*` を含む
**すべてのページ** で「現状はデモサイトである」ことを控えめに常時明示する。

## Solution

高さ 36px の細いバナーを `app/layout.tsx` に 1 行挿入。`SiteHeader` /
`AppShell` の sticky / padding を `top-9` / `pt-9` に微調整して重なりを回避する。

## Component: `src/components/marketing/DemoSiteBanner.tsx`

- Client Component (locale store を購読)
- `useLocaleStore` の `locale` を参照。`ja` を主言語、`en` を fallback として扱う
  (ストアの `DEFAULT_LOCALE='ja'` / `FALLBACK_LOCALE='en'` をそのまま利用)
- 配置: `sticky top-0 left-0 right-0 z-50`
- 高さ: `h-9` (36px)
- 視覚: `bg-amber-500/15 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200`、
  `border-b border-amber-500/20`、内側 `px-4 flex items-center gap-3 text-xs`
- アイコン: `lucide-react` の `AlertTriangle`、サイズ `h-3.5 w-3.5`
- 閉じるボタン無し
- レスポンシブ: `sm` 以上でフル文表示、それ以下は `truncate` で省略

### Copy

**ja (primary):**
- 本文: 「このサイトは開発中です。デモとしての提供であり、品質や可用性は保証されません。データは予告無くリセットされる可能性があります。」
- リンク末尾:
  - `X: @361do_sleep` → `https://twitter.com/361do_sleep`
  - `ソース: GitHub` → `https://github.com/tastile/tastile-web`

**en (fallback / store = en):**
- 本文: "This site is under active development. It is provided as a demo;
  quality and availability are not guaranteed. Data may be reset without notice."
- リンク末尾:
  - `X: @361do_sleep` → 同上 URL
  - `Source: GitHub` → 同上 URL

## Placement in app tree

`src/app/layout.tsx` の `AppProviders` 直下に `<DemoSiteBanner />` を追加。
`AppProviders` 配下なので `useLocaleStore` が使える。

## Existing-layout deltas

| File | 変更 |
| --- | --- |
| `src/components/SiteHeader.tsx` | `sticky top-0` → `sticky top-9` |
| `src/components/layout/AppShell.tsx` | ルート `<div>` に `pt-9` を追加 |

## z-index table (post-change)

| 要素 | z |
| --- | --- |
| DemoSiteBanner | `z-50` |
| SiteHeader | `z-40` |
| AppShell Header | 通常フロー (`pt-9` で下げる) |
| SidePanel / Modal 系 | 既存値のまま (modal はバナー上に被さることを許容) |

## Verification

1. `bun run dev` → ホームでバナーが top に固定表示 (`ja`)
2. ロケールストアを `en` 切替 → バナー本文・リンクラベルが英語に追従
3. `/pricing`, `/download`, `/login`, `/auth/signup` でも表示
4. `/dashboard/*` 表示 (要ログイン or `E2E_BYPASS_AUTH`)
5. SiteHeader とバナーが視覚的に重ならない (gap 36px)
6. `bun run lint`
7. `bun test src/components/marketing/DemoSiteBanner.test.tsx` (新規)
8. Chrome DevTools MCP で http://localhost:3000 を実ブラウザ目視

## Out of scope

- バナーの閉じるボタン (要望にないため追加しない)
- メール連絡先の追加 (X のみ連絡手段として開示)
- 翻訳対象の拡張 (他 locale は `en` にフォールバック、現状要件外)
- `/api/*` route handler (root layout を継承しない、JSON 応答)
