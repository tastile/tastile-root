<!-- 日本語訳 / Translation -->

# P1: Design System v2 Token Plumbing 実装計画

> **For agentic workers:** 必須サブスキル: `superpowers:subagent-driven-development` (推奨) または `superpowers:executing-plans` を使用し、本計画をタスク単位で実装すること。各ステップはチェックボックス (`- [ ]`) 形式で進捗追跡する。

**Goal:** `tastile-web` に DS v2 規約（影/ボーダーのコア最小限・shell 完全撤廃・円中心整列）に整合する token plumbing を敷設し、P2 以降の widget / feature 適用が token 揺れなしで進められる土台を作る。

**Architecture:** 3 層 token 解決モデル（Layer 0: `globals.css` の CSS 変数定義 / Layer 1: Tailwind v4 `@theme` + Mantine v9 `cssVariablesResolver` + 新規 `tokens.ts` / Layer 2: React component）。Mantine core には最小限の border を残し、shell / card / section 層は完全撤廃（方針 B）。

**Tech Stack:** Next.js 16 / React 19 / Mantine v9.5 / Tailwind CSS v4.3 / TypeScript 5.7 / Vitest 4 / Bun 1.3 / ESLint 9.

**Spec:** `docs/superpowers/specs/2026-08-25-p1-ds-token-plumbing-design.md`

## Global Constraints

- **Repository invariants (AGENTS.md):** 開始時に branch + `git status --short` を確認。`main` 以外では作業しない。worktree を作らない。他タスク由来の uncommitted diff には触れない。
- **既存 uncommitted diff は触らない**: `src/app/dashboard/**`, `src/widgets/app-shell/**`, `src/shared/**` 等の modified / deleted ファイルは別タスク由来。本 PR で reset / checkout / stash / revert / amend しない。
- **依存追加は最小**: 新規 npm package を追加しない。既存 devDeps（postcss-preset-mantine, postcss-simple-vars, tailwind-merge, clsx 等）で完結する。ESLint custom rule は .mjs ファイルとして local 配置。
- **i18n hardcoded literal を新規追加しない**: P1 で生成する comment / identifier / doc-comment はすべて英語。
- **完了基準**: `bun run check:release` が 0 error / 0 actionable warning で通過。`bun audit` の 4 ignore（`GHSA-qx2v-qp2m-jg93` / `GHSA-6g55-p6wh-862q` / `GHSA-r28c-9q8g-f849` / `GHSA-f88m-g3jw-g9cj`）は変更禁止。
- **コミット**: 各タスク末で `git commit`。agent-initiated commit は `.agents/skills/tastile-precommit-review` 経由。コミットメッセージは英語（`feat:` / `chore:` / `test:` prefix）。
- **`src/lib/vendored/mantine-schedule` には触らない**（Knip ガード対象）。
- **既存 `eslint.config.mts` の `ignore` に新規 directory を追加しない**（production source を丸ごと ignore させない）。

## File Structure

### 新規ファイル
| ファイル | 責務 |
|---|---|
| `tastile-web/src/lib/theme/tokens.ts` | DS v2 token の `as const` マップ。color / radius / spacing |
| `tastile-web/src/lib/theme/__tests__/tokens.test.ts` | tokens.ts の unit test |
| `tastile-web/src/lib/theme/__tests__/mantine-theme.test.ts` | mantine-theme.ts の defaultProps pin test |
| `tastile-web/eslint-local-rules/no-unknown-css-var-in-tokens.mjs` | `var(--xxx)` literal 検証 ESLint rule |
| `tastile-web/eslint-local-rules/no-inline-css-var-override.mjs` | `style={{ '--xxx': ... }}` 検出 ESLint rule |
| `tastile-web/eslint-local-rules/__tests__/no-unknown-css-var-in-tokens.test.mjs` | rule の fixture テスト |
| `tastile-web/eslint-local-rules/__tests__/no-inline-css-var-override.test.mjs` | rule の fixture テスト |
| `tastile-web/scripts/check-theme-coverage.mts` | `globals.css` の 6 セレクタ存在確認静的解析 |

### 編集ファイル
| ファイル | 変更内容 |
|---|---|
| `tastile-web/src/lib/theme/mantine-theme.ts` | Card / Paper / Modal / Drawer / Divider / Button / ActionIcon / Input の defaultProps 追加 |
| `tastile-web/src/lib/theme/css-variables-resolver.ts` | `--mantine-default-border: transparent` 追加 |
| `tastile-web/src/app/globals.css` | nested-radius utility + mantine-only 宣言追加 |
| `tastile-web/eslint.config.mts` | 2 custom rule を plugins に登録 + 適用設定 |
| `tastile-web/package.json` | `lint:theme` script 追加 |

### 触らないファイル
- `tastile-web/src/lib/vendored/mantine-schedule/**`（Knip ガード）
- 他タスク由来の uncommitted diff 配下すべて

### unit 間の依存関係

```
Task 1 tokens.ts
   ↓ (依存なし)
Task 2 mantine-theme.ts  ← imports tokens.ts
   ↓ (依存なし)
Task 3 css-variables-resolver.ts
Task 4 globals.css
   ↓ (上記 4 件完了)
Task 5-6 ESLint custom rules
   ↓
Task 7 eslint.config.mts  ← registers rules
Task 8 scripts/check-theme-coverage.mts  + package.json
   ↓
Task 9 final verification
```

---

## Task 1: tokens.ts の作成（TDD）

**Files:**
- Create: `tastile-web/src/lib/theme/tokens.ts`
- Create: `tastile-web/src/lib/theme/__tests__/tokens.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `designTokens.color.{background, surface.0..3, foreground.{DEFAULT,muted,subtle,lighter}, primary.{DEFAULT,hover,fg}, success, warning, danger}` — `string`（`'var(--xxx)''` 形式）
  - `designTokens.radius.{none,xs,sm,md,lg,xl,xxl,xxxl,full}` — `number`
  - `designTokens.spacing.{control-compact,control,section,panel,page,row,row-tight}` — `number`
  - すべて `as const` で readonly literal 化

- [ ] **Step 1: ディレクトリ準備**

```bash
cd tastile-web
mkdir -p src/lib/theme/__tests__
```

- [ ] **Step 2: 失敗する test を作成**

`src/lib/theme/__tests__/tokens.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { designTokens } from '../tokens';

describe('designTokens', () => {
  describe('radius', () => {
    it('matches DS v2 radius scale', () => {
      expect(designTokens.radius).toEqual({
        none: 0,
        xs: 4,
        sm: 8,
        md: 12,
        lg: 16,
        xl: 24,
        xxl: 32,
        xxxl: 40,
        full: 9999,
      });
    });

    it('radius gap satisfies nested-radius utility spec (radius.lg - radius.md = 4)', () => {
      expect(designTokens.radius.lg - designTokens.radius.md).toBe(4);
    });

    it('radius gap satisfies nested-radius utility spec (radius.xl - radius.lg = 8)', () => {
      expect(designTokens.radius.xl - designTokens.radius.lg).toBe(8);
    });

    it('radius gap satisfies nested-radius utility spec (radius.xxl - radius.xl = 8)', () => {
      expect(designTokens.radius.xxl - designTokens.radius.xl).toBe(8);
    });

    it('radius gap satisfies nested-radius utility spec (radius.md - radius.sm = 4)', () => {
      expect(designTokens.radius.md - designTokens.radius.sm).toBe(4);
    });

    it('radius gap satisfies nested-radius utility spec (radius.sm - radius.xs = 4)', () => {
      expect(designTokens.radius.sm - designTokens.radius.xs).toBe(4);
    });
  });

  describe('color', () => {
    it('all color values are var() references', () => {
      const all = JSON.stringify(designTokens.color);
      expect(all).toMatch(/var\(--[a-z0-9-]+\)/);
    });

    it('exposes required surface levels', () => {
      expect(designTokens.color.surface[0]).toBe('var(--surface-0)');
      expect(designTokens.color.surface[1]).toBe('var(--surface-1)');
      expect(designTokens.color.surface[2]).toBe('var(--surface-2)');
      expect(designTokens.color.surface[3]).toBe('var(--surface-3)');
    });

    it('exposes primary DEFAULT / hover / fg', () => {
      expect(designTokens.color.primary.DEFAULT).toBe('var(--primary)');
      expect(designTokens.color.primary.hover).toBe('var(--primary-hover)');
      expect(designTokens.color.primary.fg).toBe('var(--primary-foreground)');
    });
  });

  describe('spacing', () => {
    it('matches DS v2 semantic spacing scale', () => {
      expect(designTokens.spacing).toEqual({
        'control-compact': 6,
        control: 8,
        section: 16,
        panel: 24,
        page: 32,
        row: 48,
        'row-tight': 44,
      });
    });
  });
});
```

- [ ] **Step 3: test を走らせ、FAIL を確認**

Run: `cd tastile-web && bun test src/lib/theme/__tests__/tokens.test.ts`
Expected: FAIL with "Cannot find module '../tokens' or its corresponding type declarations."

- [ ] **Step 4: tokens.ts を実装**

`src/lib/theme/tokens.ts`:

```typescript
/**
 * Design System v2.0 token map.
 *
 * This file is the **TypeScript single source of truth** that React
 * components / Mantine theme / tests can import. CSS custom property
 * VALUES are owned by `src/app/globals.css`; this file holds the
 * `var(--xxx)` REFERENCES only.
 *
 * Adding a new token:
 *   1. Define `--xxx` in `globals.css :root` (and theme overrides if needed)
 *   2. Add a corresponding entry here
 *   3. Never the reverse order — `as const` enforces compile-time
 *      whitelist of permitted var names via the
 *      `no-unknown-css-var-in-tokens` ESLint rule
 */
export const designTokens = {
  color: {
    background: 'var(--background)',
    surface: {
      0: 'var(--surface-0)',
      1: 'var(--surface-1)',
      2: 'var(--surface-2)',
      3: 'var(--surface-3)',
    },
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
  radius: {
    none: 0,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 40,
    full: 9999,
  },
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

- [ ] **Step 5: test を走らせ、PASS を確認**

Run: `cd tastile-web && bun test src/lib/theme/__tests__/tokens.test.ts`
Expected: PASS (12 assertions)

- [ ] **Step 6: typecheck を確認**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error

- [ ] **Step 7: コミット**

```bash
cd tastile-web
git add src/lib/theme/tokens.ts src/lib/theme/__tests__/tokens.test.ts
git commit -m "feat(theme): add designTokens with DS v2 radius/color/spacing"
```

---

## Task 2: mantine-theme.ts の defaultProps 拡張（TDD）

**Files:**
- Modify: `tastile-web/src/lib/theme/mantine-theme.ts`（`components` プロパティ追加）
- Create: `tastile-web/src/lib/theme/__tests__/mantine-theme.test.ts`

**Interfaces:**
- Consumes: `tokens.ts` の `designTokens`（数値解決用 — ただし P1 では import せず literal で OK）
- Produces:
  - `mantineTheme.components.Card.defaultProps === { withBorder: false, shadow: undefined, radius: 'lg' }`
  - `mantineTheme.components.Paper.defaultProps === { withBorder: false, shadow: undefined, radius: 'lg' }`
  - `mantineTheme.components.Modal.defaultProps === { radius: 'xl', shadow: undefined, centered: true, overlayProps: { backgroundOpacity: 0.5, blur: 2 } }`
  - `mantineTheme.components.Drawer.defaultProps === { radius: 0 }`
  - `mantineTheme.components.Divider.defaultProps === { color: 'gray.3' }`
  - `mantineTheme.components.Button.defaultProps === { radius: 'md' }`
  - `mantineTheme.components.ActionIcon.defaultProps === { radius: 'md', variant: 'subtle' }`
  - `mantineTheme.components.Input.defaultProps === { radius: 'md' }`
  - `mantineTheme.primaryColor === 'tastile'`
  - `mantineTheme.defaultRadius === 'md'`

- [ ] **Step 1: 失敗する test を作成**

`src/lib/theme/__tests__/mantine-theme.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { mantineTheme } from '../mantine-theme';

type AnyProps = Record<string, unknown>;

describe('mantineTheme', () => {
  it('primaryColor is tastile', () => {
    expect(mantineTheme.primaryColor).toBe('tastile');
  });

  it('defaultRadius is md', () => {
    expect(mantineTheme.defaultRadius).toBe('md');
  });

  describe('Card defaultProps', () => {
    it('withBorder is false', () => {
      expect((mantineTheme.components?.Card?.defaultProps as AnyProps)?.withBorder).toBe(false);
    });

    it('shadow is undefined', () => {
      expect((mantineTheme.components?.Card?.defaultProps as AnyProps)?.shadow).toBeUndefined();
    });

    it('radius is lg', () => {
      expect((mantineTheme.components?.Card?.defaultProps as AnyProps)?.radius).toBe('lg');
    });
  });

  describe('Paper defaultProps', () => {
    it('withBorder is false', () => {
      expect((mantineTheme.components?.Paper?.defaultProps as AnyProps)?.withBorder).toBe(false);
    });

    it('shadow is undefined', () => {
      expect((mantineTheme.components?.Paper?.defaultProps as AnyProps)?.shadow).toBeUndefined();
    });

    it('radius is lg', () => {
      expect((mantineTheme.components?.Paper?.defaultProps as AnyProps)?.radius).toBe('lg');
    });
  });

  describe('Modal defaultProps', () => {
    it('radius is xl', () => {
      expect((mantineTheme.components?.Modal?.defaultProps as AnyProps)?.radius).toBe('xl');
    });

    it('shadow is undefined', () => {
      expect((mantineTheme.components?.Modal?.defaultProps as AnyProps)?.shadow).toBeUndefined();
    });

    it('centered is true', () => {
      expect((mantineTheme.components?.Modal?.defaultProps as AnyProps)?.centered).toBe(true);
    });
  });

  describe('Drawer defaultProps', () => {
    it('radius is 0', () => {
      expect((mantineTheme.components?.Drawer?.defaultProps as AnyProps)?.radius).toBe(0);
    });
  });

  describe('Divider defaultProps', () => {
    it('color is gray.3', () => {
      expect((mantineTheme.components?.Divider?.defaultProps as AnyProps)?.color).toBe('gray.3');
    });
  });

  describe('Button defaultProps', () => {
    it('radius is md', () => {
      expect((mantineTheme.components?.Button?.defaultProps as AnyProps)?.radius).toBe('md');
    });
  });

  describe('ActionIcon defaultProps', () => {
    it('radius is md', () => {
      expect((mantineTheme.components?.ActionIcon?.defaultProps as AnyProps)?.radius).toBe('md');
    });

    it('variant is subtle', () => {
      expect((mantineTheme.components?.ActionIcon?.defaultProps as AnyProps)?.variant).toBe('subtle');
    });
  });

  describe('Input defaultProps', () => {
    it('radius is md', () => {
      expect((mantineTheme.components?.Input?.defaultProps as AnyProps)?.radius).toBe('md');
    });
  });
});
```

- [ ] **Step 2: test を走らせ、FAIL を確認**

Run: `cd tastile-web && bun test src/lib/theme/__tests__/mantine-theme.test.ts`
Expected: FAIL — 現在の theme では `components` が undefined のため、ほとんどのアサーションが失敗する。

- [ ] **Step 3: mantine-theme.ts を編集**

`src/lib/theme/mantine-theme.ts` を以下に置換:

```typescript
import {
  ActionIcon,
  Button,
  Card,
  Divider,
  Drawer,
  Input,
  Modal,
  Paper,
  createTheme,
} from '@mantine/core';

// 10-shade palette centered on the existing --primary (#5e6ad2). The actual
// rendered colors are still driven by globals.css (--primary / --primary-hover)
// via cssVariablesResolver — this array only satisfies Mantine's type check
// and gives the light/contrast variants something sensible to fall back to
// before the CSS variables load.
const tastile: [string, string, string, string, string, string, string, string, string, string] = [
  '#eef0fb',
  '#d9ddf4',
  '#b3b9e9',
  '#8a93dd',
  '#6c75d4',
  '#5e6ad2',
  '#4f5ac8',
  '#3f48ad',
  '#353e95',
  '#2c347d',
];

/**
 * DS v2.0 compliant Mantine v9 theme.
 *
 * Default-prop policy (方針 B: Permissive Core / Strict Layer):
 *   - Card / Paper: no border, no shadow, radius lg (container 層)
 *   - Modal: no shadow, radius xl, centered
 *   - Drawer: radius 0 (画面端に張り付く)
 *   - Divider: gray.3（階層を surface で吸収、ボーダー禁止）
 *   - Button / Input / ActionIcon: radius md（affordance 確保）
 *   - ActionIcon: variant subtle（背景で階層を作る）
 *
 * 視覚的階層は `--surface-X` の段差で表現し、影 / ボーダーは使用しない。
 */
export const mantineTheme = createTheme({
  colors: { tastile },
  primaryColor: 'tastile',
  primaryShade: 6,
  fontFamily: "var(--font-sans), 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif",
  fontFamilyMonospace: 'var(--font-geist-mono)',
  defaultRadius: 'md',
  cursorType: 'pointer',
  focusRing: 'auto',
  components: {
    Card: Card.extend({
      defaultProps: { withBorder: false, shadow: undefined, radius: 'lg' },
    }),
    Paper: Paper.extend({
      defaultProps: { withBorder: false, shadow: undefined, radius: 'lg' },
    }),
    Modal: Modal.extend({
      defaultProps: {
        radius: 'xl',
        shadow: undefined,
        centered: true,
        overlayProps: { backgroundOpacity: 0.5, blur: 2 },
      },
    }),
    Drawer: Drawer.extend({
      defaultProps: { radius: 0 },
    }),
    Divider: Divider.extend({
      defaultProps: { color: 'gray.3' },
    }),
    Button: Button.extend({
      defaultProps: { radius: 'md' },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { radius: 'md', variant: 'subtle' },
    }),
    Input: Input.extend({
      defaultProps: { radius: 'md' },
    }),
  },
});
```

- [ ] **Step 4: test を走らせ、PASS を確認**

Run: `cd tastile-web && bun test src/lib/theme/__tests__/mantine-theme.test.ts`
Expected: PASS (24 assertions)

- [ ] **Step 5: typecheck を確認**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error（`Card.extend` 等が Mantine v9 で export されていることを確認）

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add src/lib/theme/mantine-theme.ts src/lib/theme/__tests__/mantine-theme.test.ts
git commit -m "feat(theme): add DS v2 defaultProps to Mantine components"
```

---

## Task 3: css-variables-resolver.ts に default border 透過を追加

**Files:**
- Modify: `tastile-web/src/lib/theme/css-variables-resolver.ts`（`variables` 内に 2 行追加）

**Interfaces:**
- Consumes: なし
- Produces:
  - `--mantine-default-border: 'transparent'`
  - `--mantine-color-default-border: 'transparent'`
  - （既存の `--mantine-color-default-hover` / `--mantine-color-default-color` 等は維持）

- [ ] **Step 1: 現状確認**

Read `src/lib/theme/css-variables-resolver.ts` を読んで、既存の `variables` オブジェクトの構造を確認。

- [ ] **Step 2: 2 行追加**

`src/lib/theme/css-variables-resolver.ts` の `variables` オブジェクト内、`'--mantine-color-default-hover': 'var(--surface-2)',` の **直後** に下記 2 行を追加:

```typescript
    // DS v2 整合: デフォルト border を透明化（Mantine component 側の defaultProps と二段構え）
    '--mantine-default-border': 'transparent',
    '--mantine-color-default-border': 'transparent',
```

- [ ] **Step 3: typecheck**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error

- [ ] **Step 4: 既存 unit test 全件を確認**

Run: `cd tastile-web && bun run test:unit`
Expected: 既存テストすべて pass（本変更による regression なし）

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add src/lib/theme/css-variables-resolver.ts
git commit -m "feat(theme): make Mantine default border transparent for DS v2"
```

---

## Task 4: globals.css に nested-radius utility と mantine-only 宣言を追加

**Files:**
- Modify: `tastile-web/src/app/globals.css`

**Interfaces:**
- Consumes: 既存 `:root` / `.dark, .theme-*` ブロック
- Produces:
  - `@theme inline` 内に `--spacing-nested-{xs,sm,md,lg,xl}` 5 個追加 → Tailwind が `p-nested-*` を生成
  - `:root` ブロック先頭にコメント宣言（mantine-only 方針）
  - **既存の `--border*` / `--shadow*` token は維持**（mantine core が使うため）

- [ ] **Step 1: 現状確認**

Read `src/app/globals.css` を読んで、`:root` ブロックの開始位置と `@theme inline` ブロックの位置を確認。

- [ ] **Step 2: `:root` 直前に mantine-only 宣言コメントを追加**

`:root {` の **直前**（現在ある `Design System v2.0 Tokens` コメントブロックの先頭を置換）に下記を追加:

```css
/* ============================================
   Design System v2.0 Tokens

   --border* / --shadow* は Mantine core (input / button / segmented
   control) 専用。shell / card / section 層では surface-X の階層と
   nested-radius utility で視覚的階層を作る。ボーダーや影を
   layout / container 側で使わないこと。

   Adding a new token:
     1. Add `--xxx` to :root (and theme overrides if needed)
     2. Add to src/lib/theme/tokens.ts (as const)
     3. Never the reverse order.
   ============================================ */
```

- [ ] **Step 3: `@theme inline` に nested-radius を追加**

`@theme inline {` ブロック内、`/* Fonts */` セクションの **直前** に下記を追加:

```css
  /* Nested-radius utility (DS v2 §1: padding = parent_radius - child_radius)
     Tailwind が p-nested-md, p-nested-lg 等を生成する。
     値は tokens.ts の radius gap と一致させること。 */
  --spacing-nested-xs: 0.25rem;  /* 親 8 → 子 4 (sm - xs = 4) */
  --spacing-nested-sm: 0.5rem;   /* 親 12 → 子 8 (md - sm = 4) */
  --spacing-nested-md: 0.25rem;  /* 親 16 → 子 12 (lg - md = 4) */
  --spacing-nested-lg: 0.5rem;   /* 親 24 → 子 16 (xl - lg = 8) */
  --spacing-nested-xl: 0.5rem;   /* 親 32 → 子 24 (xxl - xl = 8) */
```

- [ ] **Step 4: dev server 起動して utility を確認**

Run: `cd tastile-web && bun dev`（foreground で起動、`Ctrl+C` で停止）

別ターミナルで:
```bash
# Tailwind が utility を生成したことを確認
cd tastile-web
ls .next/dev 2>/dev/null && echo "next dev started" || echo "next dev NOT started"
# もしくは
bunx tailwindcss -i src/app/globals.css --content src/**/*.tsx --print | grep "p-nested" || echo "p-nested utility NOT generated"
```

Expected: `p-nested-md`, `p-nested-lg` 等の utility が生成されている。

dev server を停止（`Ctrl+C`）。

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add src/app/globals.css
git commit -m "feat(theme): add nested-radius utilities and DS v2 token policy comment"
```

---

## Task 5: ESLint custom rule 1: no-unknown-css-var-in-tokens

**Files:**
- Create: `tastile-web/eslint-local-rules/no-unknown-css-var-in-tokens.mjs`
- Create: `tastile-web/eslint-local-rules/__tests__/no-unknown-css-var-in-tokens.test.mjs`

**Interfaces:**
- Consumes: `src/app/globals.css` の parse 結果（`--xxx` セレクタ一覧）
- Produces: `src/lib/theme/tokens.ts` 内の `var(--xxx)` literal が `globals.css` で定義済みかを検証。未定義は error

- [ ] **Step 1: ディレクトリ準備**

```bash
cd tastile-web
mkdir -p eslint-local-rules/__tests__
```

- [ ] **Step 2: rule 実装**

`eslint-local-rules/no-unknown-css-var-in-tokens.mjs`:

```javascript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Extract `--xxx` custom property names from globals.css :root / theme blocks.
 * We deliberately exclude selector-only mentions (e.g. comments).
 */
function loadAllowedVars() {
  const cssPath = resolve(__dirname, '../src/app/globals.css');
  const css = readFileSync(cssPath, 'utf8');
  const re = /--([a-z0-9-]+)\s*:/gi;
  const allowed = new Set();
  let m;
  while ((m = re.exec(css)) !== null) {
    allowed.add(m[1]);
  }
  return allowed;
}

const allowedVars = loadAllowedVars();

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow var(--xxx) where xxx is not defined in globals.css' },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string' || !node.value.startsWith('var(--')) return;
        // extract var name: var(--name)
        const match = node.value.match(/^var\(--([a-z0-9-]+)\)$/);
        if (!match) {
          context.report({
            node,
            message: `CSS var reference must be exactly var(--name): ${node.value}`,
          });
          return;
        }
        const varName = match[1];
        if (!allowedVars.has(varName)) {
          context.report({
            node,
            message: `Unknown CSS var: --${varName}. Add it to src/app/globals.css :root first.`,
          });
        }
      },
    };
  },
};
```

- [ ] **Step 3: fixture test を作成**

`eslint-local-rules/__tests__/no-unknown-css-var-in-tokens.test.mjs`:

```javascript
import { RuleTester } from 'eslint';
import rule from '../no-unknown-css-var-in-tokens.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-unknown-css-var-in-tokens', rule, {
  valid: [
    { code: "const x = 'var(--background)';" },
    { code: "const y = 'var(--primary)';" },
    { code: "const z = 'var(--surface-1)';" },
  ],
  invalid: [
    {
      code: "const x = 'var(--nonexistent-token)';",
      errors: [{ message: /Unknown CSS var: --nonexistent-token/ }],
    },
    {
      code: "const x = 'var(--background)suffix';",
      errors: [{ message: /must be exactly var\(--name\)/ }],
    },
  ],
});
```

- [ ] **Step 4: test 実行**

Run: `cd tastile-web && node --experimental-vm-modules eslint-local-rules/__tests__/no-unknown-css-var-in-tokens.test.mjs`

Expected: PASS。失敗する場合、rule の正規表現を修正。

Node 22+ なら `--experimental-vm-modules` 不要。`node eslint-local-rules/__tests__/no-unknown-css-var-in-tokens.test.mjs` で動かない場合は `node --test` を使う:

```bash
cd tastile-web
# 代替: standalone runner
cat > /tmp/run-rule-test.mjs <<'EOF'
import { RuleTester } from 'eslint';
import rule from './eslint-local-rules/no-unknown-css-var-in-tokens.mjs';
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
tester.run('rule', rule, {
  valid: [{ code: "const x = 'var(--background)';" }],
  invalid: [{ code: "const x = 'var(--nope)';", errors: [{}] }],
});
console.log('PASS');
EOF
node /tmp/run-rule-test.mjs
```

Expected: `PASS` 出力。

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add eslint-local-rules/no-unknown-css-var-in-tokens.mjs eslint-local-rules/__tests__/no-unknown-css-var-in-tokens.test.mjs
git commit -m "feat(eslint): add no-unknown-css-var-in-tokens rule"
```

---

## Task 6: ESLint custom rule 2: no-inline-css-var-override

**Files:**
- Create: `tastile-web/eslint-local-rules/no-inline-css-var-override.mjs`
- Create: `tastile-web/eslint-local-rules/__tests__/no-inline-css-var-override.test.mjs`

**Interfaces:**
- Consumes: JSX `style={{ '--xxx': value }}` および React `style={{ '--xxx': value }}`
- Produces: `--xxx` 形式のキーが style オブジェクトにあれば error

- [ ] **Step 1: rule 実装**

`eslint-local-rules/no-inline-css-var-override.mjs`:

```javascript
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow inline style={{ "--xxx": ... }} to prevent token cascade breakage' },
    schema: [],
  },
  create(context) {
    function checkObjectExpression(node) {
      if (!node.properties) return;
      for (const prop of node.properties) {
        if (prop.type !== 'Property') continue;
        const key = prop.key;
        let name;
        if (key.type === 'Identifier') name = key.name;
        else if (key.type === 'Literal') name = key.value;
        if (typeof name === 'string' && name.startsWith('--')) {
          context.report({
            node: prop,
            message: `Inline CSS var override (--${name.slice(2)}) breaks theme cascade. Use designTokens / Mantine theme instead.`,
          });
        }
      }
    }
    return {
      ObjectExpression(node) {
        // Only flag if this object is the value of a `style` prop. Approximate
        // by parent: JSXAttribute or Property with key.name === 'style'.
        const parent = node.parent;
        if (parent?.type === 'JSXAttribute' && parent.name?.name === 'style') {
          checkObjectExpression(node);
          return;
        }
        if (parent?.type === 'Property' && parent.key?.name === 'style') {
          checkObjectExpression(node);
        }
      },
    };
  },
};
```

- [ ] **Step 2: fixture test**

`eslint-local-rules/__tests__/no-inline-css-var-override.test.mjs`:

```javascript
import { RuleTester } from 'eslint';
import rule from '../no-inline-css-var-override.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-inline-css-var-override', rule, {
  valid: [
    { code: "const s = { color: 'red' };" },
    { code: "<div style={{ color: 'red' }} />" },
    { code: "<Button style={{ padding: 8 }} />" },
  ],
  invalid: [
    {
      code: "<div style={{ '--background': 'red' }} />",
      errors: [{ message: /Inline CSS var override/ }],
    },
    {
      code: "const s = { style: { '--primary': 'red' } };",
      errors: [{ message: /Inline CSS var override/ }],
    },
  ],
});
```

- [ ] **Step 3: test 実行**

Task 5 Step 4 と同じ要領で:
```bash
cd tastile-web
cat > /tmp/run-rule-test2.mjs <<'EOF'
import { RuleTester } from 'eslint';
import rule from './eslint-local-rules/no-inline-css-var-override.mjs';
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } } });
tester.run('rule', rule, {
  valid: [{ code: "<div style={{ color: 'red' }} />" }],
  invalid: [{ code: "<div style={{ '--x': 'red' }} />", errors: [{}] }],
});
console.log('PASS');
EOF
node /tmp/run-rule-test2.mjs
```

Expected: `PASS`。

- [ ] **Step 4: 既存 src に違反がないことを確認**

```bash
cd tastile-web
grep -rn "style={{[^}]*--" src/ 2>/dev/null | head -20
```

Expected: 0 hit（または既存 diff に含まれるもののみ。本 PR では触らない）。

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add eslint-local-rules/no-inline-css-var-override.mjs eslint-local-rules/__tests__/no-inline-css-var-override.test.mjs
git commit -m "feat(eslint): add no-inline-css-var-override rule"
```

---

## Task 7: eslint.config.mts に custom rule を登録

**Files:**
- Modify: `tastile-web/eslint.config.mts`

**Interfaces:**
- Consumes: Task 5/6 で作成した rule
- Produces:
  - `localRules` という plugin 名で 2 rule を登録
  - `src/lib/theme/**` に `no-unknown-css-var-in-tokens` を `'error'`
  - 全体（既存 rulesets と並列）に `no-inline-css-var-override` を `'error'`

- [ ] **Step 1: 現状確認**

Read `tastile-web/eslint.config.mts` を読んで、構成（import / 既存 plugins / ignores / rules セクション）を把握。

- [ ] **Step 2: file 先頭に plugin import を追加**

`eslint.config.mts` の **先頭の import 群** に下記を追加:

```typescript
import noUnknownCssVarInTokens from './eslint-local-rules/no-unknown-css-var-in-tokens.mjs';
import noInlineCssVarOverride from './eslint-local-rules/no-inline-css-var-override.mjs';
```

- [ ] **Step 3: plugins エントリ追加**

`defineConfig` 呼び出しの **plugins オブジェクト** に下記を追加（既存 plugins と並列）:

```typescript
    localRules: {
      rules: {
        'no-unknown-css-var-in-tokens': noUnknownCssVarInTokens,
        'no-inline-css-var-override': noInlineCssVarOverride,
      },
    },
```

- [ ] **Step 4: rule 適用設定**

`src/lib/theme/**` 向けの rules ブロック（既存に無ければ新規追加）:

```typescript
    {
      files: ['src/lib/theme/**/*.ts'],
      rules: {
        'localRules/no-unknown-css-var-in-tokens': 'error',
      },
    },
```

全体向け（`ignores` の後、files 制限なし）:

```typescript
    {
      rules: {
        'localRules/no-inline-css-var-override': 'error',
      },
    },
```

- [ ] **Step 5: lint を走らせ、PASS を確認**

Run: `cd tastile-web && bun run lint`
Expected: 0 error（rule が既存 src で誤検知しないことを確認）

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add eslint.config.mts
git commit -m "chore(eslint): register DS v2 custom rules"
```

---

## Task 8: check-theme-coverage.mts 静的解析スクリプト

**Files:**
- Create: `tastile-web/scripts/check-theme-coverage.mts`
- Modify: `tastile-web/package.json`（`lint:theme` script 追加）

**Interfaces:**
- Consumes: `src/app/globals.css`
- Produces:
  - 6 セレクタ（:root / .dark / .theme-gray / .theme-dark / .theme-dark-black / .theme-dark-gray）の存在確認
  - exit 0 = all present, exit 1 = missing

- [ ] **Step 1: ディレクトリ確認**

```bash
cd tastile-web
ls scripts/ | head -10
```

- [ ] **Step 2: script 実装**

`scripts/check-theme-coverage.mts`:

```typescript
#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REQUIRED_SELECTORS = [
  ':root',
  '.dark',
  '.theme-gray',
  '.theme-dark',
  '.theme-dark-black',
  '.theme-dark-gray',
] as const;

function main(): void {
  const cssPath = resolve(__dirname, '../src/app/globals.css');
  const css = readFileSync(cssPath, 'utf8');

  const missing: string[] = [];
  for (const sel of REQUIRED_SELECTORS) {
    // For :root, match the exact `:root {` opener.
    // For class selectors, match the class name as a token (preceded by space / `{` / `,`).
    const re = sel === ':root'
      ? /:root\s*\{/
      : new RegExp(`(?:^|[\\s,])${sel.replace(/\./g, '\\.')}\\b`);
    if (!re.test(css)) {
      missing.push(sel);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing theme selectors in src/app/globals.css:`);
    for (const sel of missing) {
      console.error(`  - ${sel}`);
    }
    process.exit(1);
  }

  console.log(`OK: all ${REQUIRED_SELECTORS.length} theme selectors present in src/app/globals.css`);
}

main();
```

- [ ] **Step 3: script を走らせ、PASS を確認**

Run: `cd tastile-web && bun scripts/check-theme-coverage.mts`
Expected: `OK: all 6 theme selectors present in src/app/globals.css`

失敗時: `globals.css` の対応するセレクタを修正（本 PR で触らない既存テーマが欠けていれば別タスクで扱う）。

- [ ] **Step 4: package.json に script 追加**

`package.json` の `scripts` セクションに下記を追加:

```json
    "lint:theme": "bun scripts/check-theme-coverage.mts",
```

- [ ] **Step 5: 既存 scripts ブロックが壊れていないことを確認**

Run: `cd tastile-web && bun run lint:theme`
Expected: `OK: all 6 theme selectors present ...`

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add scripts/check-theme-coverage.mts package.json
git commit -m "feat(scripts): add check-theme-coverage for DS v2 6-selector guarantee"
```

---

## Task 9: 最終検証 — `bun run check:release` + manual smoke

**Files:**
- 編集なし（read-only verification）
- 万一修正が出たら各 Task に追加 commit する

**Interfaces:**
- Consumes: Task 1〜8 の成果物すべて
- Produces: 0 error / 0 actionable warning な release gate 通過 + 4 テーマ目視確認 OK

- [ ] **Step 1: check 通過**

Run: `cd tastile-web && bun run check`
Expected: 0 error（lint:biome / eslint / typecheck / knip / test:unit 全 pass）

失敗時の debug:
- Biome / ESLint 失敗 → 直前の commit を `git revert`
- typecheck 失敗 → Task 1, 2, 3 の戻り値を確認
- knip 失敗 → 新規 import した export が未使用になっていないか確認
- test 失敗 → 個別 test を再走

- [ ] **Step 2: check:release 通過**

Run: `cd tastile-web && bun run check:release`
Expected: 0 error（check + bun audit + build:prod 全 pass）

失敗時: build error なら `next.config.ts` / `tsconfig.json` / import path を確認。

- [ ] **Step 3: lint:theme 通過**

Run: `cd tastile-web && bun run lint:theme`
Expected: `OK: all 6 theme selectors present ...`

- [ ] **Step 4: dev server 起動 + manual smoke**

```bash
cd tastile-web
bun dev  # foreground, Ctrl+C で停止
```

別ターミナルで `http://localhost:3000/dashboard/projects` を開き:
1. `<Card>` / `<Paper>` の見た目が既存と一致（影なし、ボーダーなし、`radius: lg`）
2. DevTools Console で `<html class="dark">` に切替 → 全画面が dark 反映
3. DevTools Console で `<html class="theme-dark-black">` に切替 → 背景が `#010102` を確認
4. Tab キーで `outline: 2px solid var(--focus-ring)` が見える

4 項目すべて OK なら manual smoke 完了。dev server を停止。

- [ ] **Step 5: 既存 E2E が壊れていないことを確認**

Run: `cd tastile-web && bun run test:e2e`
Expected: 既存 Playwright test すべて pass（P1 で新規追加なし）

- [ ] **Step 6: 変更ファイル最終確認**

```bash
cd tastile-web
git status --short
git log --oneline -10
```

Expected:
- 既存 uncommitted diff（他タスク由来）は **そのまま残存**（触らない）
- 本 PR の commit 8〜9 件が積まれている
- 既存 E2E が pass している

- [ ] **Step 7: コミット（修正があった場合のみ）**

修正が出た場合のみ:
```bash
cd tastile-web
git add -u
git commit -m "chore(theme): final verification fixes for DS v2 token plumbing"
```

修正なしなら commit なし。

---

## Self-Review Notes

**1. Spec coverage:**
- 3 層 token モデル → Task 1, 2, 3, 4
- nested-radius utility → Task 4
- DS v2 整合 defaultProps → Task 2
- 4 テーマ静的解析 → Task 8
- ESLint custom rule 1 → Task 5
- ESLint custom rule 2 → Task 6
- 型安全な token → Task 1
- 完了基準 → Task 9

すべて対応する Task あり。漏れなし。

**2. Placeholder scan:**
- 0 件
- Task 1〜9 の各 step はすべて具体コード / 具体コマンドを含む

**3. Type consistency:**
- `designTokens` の key 名は Task 1（tokens.ts）と Task 2 test の `mantineTheme.primaryColor === 'tastile'` で一致
- defaultProps の signature は Task 2 test と Task 2 実装で完全一致
- ESLint rule 名 `localRules/no-unknown-css-var-in-tokens` / `localRules/no-inline-css-var-override` は Task 5/6 と Task 7 で一致
- 6 セレクタ名は Task 8 script と spec で一致
