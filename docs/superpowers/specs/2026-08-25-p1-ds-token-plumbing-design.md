# P1: Design System v2 Token Plumbing — Design

| | |
|---|---|
| 日付 | 2026-08-25 |
| 親プロジェクト | UI 徹底改善（A〜E 全範囲） |
| 位置 | ロードマップ 8 フェーズ中の **Phase 1 (Foundation)** |
| スコープ | `tastile-web` リポジトリのみ |
| Repository 状態 | main ブランチ、uncommitted diff 多数（他タスク由来、本 PR では触らない） |
| 完了基準 | `bun run check:release` を 0 error / 0 actionable warning で通過 |

## Background / Motivation

`docs/DESIGN-SYSTEM.md` v2.0 は **「フラット：影禁止・ボーダー禁止・円中心整列の入れ子 radius」** を
明言する。一方、`src/app/globals.css` の現行 token は:

- `--border`, `--border-strong`, `--border-stronger` を投入（DS v2 違反）
- `--shadow-sm/md/lg` を投入（DS v2 違反）
- Mantine v9 内部変数との接続が `mantine-theme.ts` と `css-variables-resolver.ts` の 2 ファイルに分散

→ DS v2 ドキュメントと実装の整合が崩れかけている。P2 以降の widget / feature 適用で token が
揺れるリスクがある。**P1 で token plumbing を DS v2 規約に整流し、P2 以降が揺れない土台を敷設する。**

## 目標 (Goals)

1. **DS v2 整合の token 層を確立** — Mantine core に必要な最小限の border / shadow は許可しつつ、
   shell / card / section 層では完全撤廃できる default にする
2. **型安全な token 参照** — `tokens.ts` を `as const` で固定し、typo や drift を `tsc` で検出
3. **nested-radius utility** — `padding = 親radius - 子radius` の公式を utility 化
4. **4 テーマ安定運用** — light / dark / dark-gray / dark-black / theme-gray / theme-dark のカスケード
   を pin test + 静的解析で保証
5. **既存 component への非破壊** — P1 は component の見た目を変えず、defaultProps が効く前と後で
   レンダリングが一致することを保証

## 非目標 (Non-Goals)

- 既存 component の見た目変更（**P2 以降**）
- 新規 page / widget 追加
- i18n 関連（**P3**）
- アクセシビリティ改善（**P7**）
- パフォーマンス改善（**P7**）
- Mantine バージョン bump
- Visual regression 基盤（**P2 以降**）
- `src/lib/vendored/mantine-schedule` への介入（Knip ガード対象）

## Architecture（Section 1 で承認済み）

### 3 層 token 解決モデル

```
Layer 0 (Source of Truth)
  globals.css :root / .dark / .theme-* が CSS カスタムプロパティを定義
       ↓ (CSS カスケード)
Layer 1 (Bridge)
  globals.css @theme inline が Tailwind v4 utility へ露出
  css-variables-resolver.ts が Mantine 内部変数へ露出
  tokens.ts が TypeScript からの参照を型安全に
       ↓
Layer 2 (Consumer)
  React component: className / Mantine props / tokens.ts import
```

### 方針: B — Permissive Core / Strict Layer

- Mantine core (input / button / segmented control) は **最小限の border 残す**
- shell / card / section / drawer 層は **完全撤廃**
- `--border*` / `--shadow*` token は残置するが、**mantine-only** であることをコメントで宣言

### 触る / 作成するファイル

| ファイル | 変更 | 内容 |
|---|---|---|
| `src/app/globals.css` | 編集 | Layer 0 + Layer 1 維持。`--border*` / `--shadow*` の mantine-only 宣言。`nested-radius` 追加 |
| `src/lib/theme/mantine-theme.ts` | 編集 | `Card` / `Paper` / `Modal` / `Drawer` / `Divider` / `Button` / `ActionIcon` / `Input` の defaultProps 追加 |
| `src/lib/theme/css-variables-resolver.ts` | 編集 | `--mantine-default-border: transparent` 等で default border を透明化 |
| `src/lib/theme/tokens.ts` | **新規** | `as const` の token マップ |
| `src/lib/theme/__tests__/tokens.test.ts` | **新規** | 半径検算 / 値検証 |
| `src/lib/theme/__tests__/mantine-theme.test.ts` | **新規** | defaultProps pin |
| `eslint-local-rules/no-unknown-css-var-in-tokens.mjs` | **新規** | tokens.ts の `var(--xxx)` literal 検証 |
| `eslint-local-rules/no-inline-css-var-override.mjs` | **新規** | `style={{ '--xxx': ... }}` 検出 |
| `eslint.config.mts` | 編集 | 上記 2 custom rule を `plugins` に登録 |
| `scripts/check-theme-coverage.mts` | **新規** | `globals.css` の 4 テーマ + :root セレクタ全存在確認 |
| `docs/superpowers/specs/2026-08-25-p1-ds-token-plumbing-design.md` | **新規** | 本ファイル |

## Components（Section 2 で承認済み）

### `src/lib/theme/tokens.ts`

```typescript
export const designTokens = {
  color: {
    background: 'var(--background)',
    surface: { 0: 'var(--surface-0)', 1: 'var(--surface-1)', 2: 'var(--surface-2)', 3: 'var(--surface-3)' },
    foreground: {
      DEFAULT: 'var(--foreground)',
      muted: 'var(--foreground-muted)',
      subtle: 'var(--foreground-subtle)',
      lighter: 'var(--foreground-lighter)',
    },
    primary: {
      DEFAULT: 'var(--primary)',
      hover: 'var(--primary-hover)',
      fg: 'var(--primary-foreground)',
    },
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
  },
  radius: { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40, full: 9999 },
  spacing: {
    'control-compact': 6,
    control: 8,
    section: 16,
    panel: 24,
    page: 32,
    row: 48,
    'row-tight': 44,
  },
} as const;
```

- 依存: なし
- 単独 export。React component / Mantine 解決 / test すべてが import

### `src/lib/theme/mantine-theme.ts` 拡張

```typescript
import { ActionIcon, Button, Card, Divider, Drawer, Input, Modal, Paper, createTheme } from '@mantine/core';
import { designTokens } from './tokens';

const tastile: [string, string, string, string, string, string, string, string, string, string] = [
  '#eef0fb', '#d9ddf4', '#b3b9e9', '#8a93dd', '#6c75d4',
  '#5e6ad2', '#4f5ac8', '#3f48ad', '#353e95', '#2c347d',
];

export const mantineTheme = createTheme({
  colors: { tastile },
  primaryColor: 'tastile',
  primaryShade: 6,
  fontFamily: 'var(--font-sans)',
  defaultRadius: 'md',
  cursorType: 'pointer',
  focusRing: 'auto',
  components: {
    Card: Card.extend({ defaultProps: { withBorder: false, shadow: undefined, radius: 'lg' } }),
    Paper: Paper.extend({ defaultProps: { withBorder: false, shadow: undefined, radius: 'lg' } }),
    Modal: Modal.extend({ defaultProps: { radius: 'xl', shadow: undefined, centered: true, overlayProps: { backgroundOpacity: 0.5, blur: 2 } } }),
    Drawer: Drawer.extend({ defaultProps: { radius: 0 } }),
    Divider: Divider.extend({ defaultProps: { color: 'gray.3' } }),
    Button: Button.extend({ defaultProps: { radius: 'md' } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { radius: 'md', variant: 'subtle' } }),
    Input: Input.extend({ defaultProps: { radius: 'md' } }),
  },
});
```

### `src/lib/theme/css-variables-resolver.ts` 拡張

既存 + 下記追加:

```typescript
'--mantine-default-border': 'transparent',
'--mantine-color-default-border': 'transparent',
```

### `globals.css` への nested-radius 追記

```css
@theme inline {
  --spacing-nested-xs: 0.25rem;  /* 親 8 → 子 4 */
  --spacing-nested-sm: 0.5rem;   /* 親 12 → 子 8 */
  --spacing-nested-md: 0.25rem;  /* 親 16 → 子 12 */
  --spacing-nested-lg: 0.5rem;   /* 親 24 → 子 16 */
  --spacing-nested-xl: 0.5rem;   /* 親 32 → 子 24 */
}
```

→ Tailwind v4 が `p-nested-md`, `p-nested-lg` 等を生成。

### `globals.css` への mantine-only 宣言追記

`:root` ブロック先頭に:

```css
/* ============================================
   Design System v2.0 Tokens

   --border* / --shadow* は Mantine core 専用。
   shell / card / section 層は surface-X の階層と nested-radius utility で
   視覚的階層を作る。ボーダーや影を layout / container で使わないこと。
   ============================================ */
```

## Data Flow（Section 3 で承認済み）

### 不変条件

1. CSS 変数の値書き換えは `:root` と `.dark` / `.theme-*` のみ
2. テーマ切替は `<html>` の class のみが起点。React state 経由で `style` を直接書かない
3. Mantine の 10 階調配列は型チェック / fallback のみ。実値は CSS 変数経由
4. `tokens.ts` は build-time plain object。runtime 外部入力からの token 値読み出し禁止
5. 新規 token 追加は `globals.css :root` → `tokens.ts` の順。逆順禁止

### 4 テーマ × token 解決

| token | light | dark | theme-gray | theme-dark | theme-dark-black | theme-dark-gray |
|---|---|---|---|---|---|---|
| `--background` | `#f7f8f8` | `#08090a` | `#08090a` | `#08090a` | `#010102` | `#08090a` |
| `--surface-0` | `#f3f4f5` | `#0f1011` | `#0f1011` | `#0f1011` | `#08090a` | `#0f1011` |
| `--surface-1` | `#ffffff` | `rgba(255,255,255,0.02)` | 同 | 同 | 同 | 同 |
| `--foreground` | `#111217` | `#f7f8f8` | 同 | 同 | 同 | 同 |
| `--primary` | `#5e6ad2` | `#5e6ad2` | 同 | 同 | 同 | 同 |
| `--border` | `#e4e8ec` | `rgba(255,255,255,0.08)` | 同 | 同 | 同 | 同 |

`globals.css` のこの表が **正本**。`tokens.ts` は `var(--xxx)` への参照のみ。

## Error Handling（Section 4 で承認済み）

| 失敗 | 検出 | 防御 |
|---|---|---|
| token typo | `tsc` / `no-unknown-css-var-in-tokens` | `as const` + 許可リスト検証 |
| token 上書き事故 | `no-inline-css-var-override` | CI grep + lint |
| defaultProps 漏れ | `mantine-theme.test.ts` | pin test |
| 4 テーマ不整合 | `scripts/check-theme-coverage.mts` | 静的 CSS parse |
| nested-radius スケール乖離 | `tokens.test.ts` | `radius.lg - radius.md` 検算 |

### ロールバック手順

P1 PR 失敗時は **revert 1 commit** で全 token 巻き戻し。単一 PR / 単一 commit を厳守する。

## Testing（Section 5 で承認済み）

### 検証マトリクス

| 検証 | ツール | 範囲 | 完了条件 |
|---|---|---|---|
| Unit | Vitest | `tokens.ts` / `mantine-theme.ts` | 12+ assertion 全 pass |
| Type | `tsc --noEmit` | 全体 | 0 error |
| Lint | Biome + ESLint（既存 + custom 2 rule） | 全体 | 0 error / 0 actionable warning |
| Static | `scripts/check-theme-coverage.mts` | `globals.css` | 6 セレクタ（:root / .dark / .theme-gray / .theme-dark / .theme-dark-black / .theme-dark-gray）全存在 |
| Build | `bun run build:prod` | 全体 | 0 error |
| E2E 既存 | `bun run test:e2e` | 既存 Playwright | 全 pass（新規追加なし） |
| Manual | dev server 目視 | 4 テーマ + focus | 4 項目全 OK |

### Unit テスト詳細

#### `src/lib/theme/__tests__/tokens.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { designTokens } from '../tokens';

describe('designTokens', () => {
  it('radius scale matches DS v2', () => {
    expect(designTokens.radius).toEqual({
      none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40, full: 9999,
    });
  });

  it('radius gap matches nested-radius utility spacing', () => {
    // padding = parent_radius - child_radius の検算
    expect(designTokens.radius.lg - designTokens.radius.md).toBe(4);  // p-nested-md
    expect(designTokens.radius.xl - designTokens.radius.lg).toBe(8);  // p-nested-lg
    expect(designTokens.radius.xxl - designTokens.radius.xl).toBe(8); // p-nested-xl
    expect(designTokens.radius.sm - designTokens.radius.xs).toBe(4);  // p-nested-xs
    expect(designTokens.radius.md - designTokens.radius.sm).toBe(4);  // p-nested-sm
  });

  it('all color values are var() references', () => {
    const all = JSON.stringify(designTokens.color);
    expect(all).toMatch(/var\(--[a-z0-9-]+\)/);
  });
});
```

#### `src/lib/theme/__tests__/mantine-theme.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { mantineTheme } from '../mantine-theme';

describe('mantineTheme', () => {
  it('primaryColor is tastile', () => {
    expect(mantineTheme.primaryColor).toBe('tastile');
  });

  it('defaultRadius is md', () => {
    expect(mantineTheme.defaultRadius).toBe('md');
  });

  it('Card defaultProps are DS v2 compliant', () => {
    const props = mantineTheme.components?.Card?.defaultProps as Record<string, unknown> | undefined;
    expect(props?.withBorder).toBe(false);
    expect(props?.shadow).toBeUndefined();
    expect(props?.radius).toBe('lg');
  });

  it('Paper defaultProps are DS v2 compliant', () => {
    const props = mantineTheme.components?.Paper?.defaultProps as Record<string, unknown> | undefined;
    expect(props?.withBorder).toBe(false);
    expect(props?.shadow).toBeUndefined();
    expect(props?.radius).toBe('lg');
  });

  it('Modal defaultProps are DS v2 compliant', () => {
    const props = mantineTheme.components?.Modal?.defaultProps as Record<string, unknown> | undefined;
    expect(props?.radius).toBe('xl');
    expect(props?.shadow).toBeUndefined();
    expect(props?.centered).toBe(true);
  });

  it('Divider defaultProps are DS v2 compliant', () => {
    const props = mantineTheme.components?.Divider?.defaultProps as Record<string, unknown> | undefined;
    expect(props?.color).toBe('gray.3');
  });

  it('Input / Button / ActionIcon radius is md', () => {
    expect((mantineTheme.components?.Input?.defaultProps as any)?.radius).toBe('md');
    expect((mantineTheme.components?.Button?.defaultProps as any)?.radius).toBe('md');
    expect((mantineTheme.components?.ActionIcon?.defaultProps as any)?.radius).toBe('md');
  });

  it('ActionIcon default variant is subtle', () => {
    expect((mantineTheme.components?.ActionIcon?.defaultProps as any)?.variant).toBe('subtle');
  });
});
```

### Manual smoke checklist

`bun dev` 起動後:

1. `/dashboard/projects` を開き、`<Card>` / `<Paper>` / `<Divider>` / `<Modal>` の見た目が既存と一致（影なし、ボーダーなし、radius 階層）
2. `<html class="dark">` に切替 → 全画面が dark 反映
3. `<html class="theme-dark-black">` に切替 → 背景が `#010102`
4. Tab キーで `outline: 2px solid var(--focus-ring)` が見える

### 完了基準

- 上記 7 軸すべてクリア
- `bun run check:release` 0 error / 0 actionable warning
- 既存 component のレンダリングに regression がない（manual smoke + 既存 E2E）

## Out of Scope（明示的に除く）

- P2 以降の widget / feature 適用
- 既存 `Card` / `Paper` の inline `style` 指定の剥がし
- Mantine 以外の UI library の検証
- `src/lib/vendored/mantine-schedule` の介入
- package.json の dependency 追加（必要 ESLint パッケージは確認の上、最小限）

## Risk & Rollback

| リスク | 確率 | 影響 | 対応 |
|---|---|---|---|
| defaultProps 変更で既存 component 破綻 | 中 | 中 | `mantine-theme.test.ts` で全 defaultProps pin + manual smoke |
| ESLint custom rule が誤検知 | 中 | 低 | rule 1 個ずつ追加、rule ごとに既存 src で `bun run lint` 通過を確認 |
| nested-radius utility 命名が tailwind v4 で予約語と衝突 | 低 | 低 | `nested-*` prefix 採用で予約語衝突を回避 |
| `globals.css` 編集で hot reload が壊れる | 低 | 低 | dev server 再起動で復旧 |
| 4 テーマのうち 1 個のカスケード漏れ | 低 | 中 | `check-theme-coverage.mts` で 6 セレクタ全存在を CI gate |

### Rollback

単一 PR / 単一 commit を厳守。`git revert <commit-sha>` で 30 秒以内に復旧可能。

## Reference

- `docs/DESIGN-SYSTEM.md` v2.0（正本）
- `tastile-web/AGENTS.md` repo-local contract
- `../AGENTS.md` workspace contract
- `tastile-web/src/lib/theme/mantine-theme.ts`（現状）
- `tastile-web/src/lib/theme/css-variables-resolver.ts`（現状）
- `tastile-web/src/app/globals.css`（現状）
- Mantine v9 theme API: https://mantine.dev/theming/theme-object/
- Mantine v9 cssVariablesResolver: https://mantine.dev/theming/css-variables/
- Tailwind v4 `@theme`: https://tailwindcss.com/docs/theme

## Open Questions

なし（全 5 セクションでユーザー承認済み）。
