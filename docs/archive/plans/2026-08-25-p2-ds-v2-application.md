# P2: Design System v2 Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P1 で敷設した DS v2 token plumbing を `src/widgets/**` `src/features/**` `src/views/**` の 150 tsx 全てに適用し、`shadow=*` `withBorder` `border-*`（whitelist 除く） `bg-surface-elevated` を全廃。strict 0-violation CI gate を敷設し、a11y の focus indicator を `:focus-visible` + `--focus-ring` で redesign する。

**Architecture:** 3 sub-phases — **P2a (foundation: gates before sweep)** で新 ESLint 3 rules / Mantine 内部 surface override / `--focus-ring` token / Playwright DS assertion を整備、**P2b (4-batch sweep)** で 150 tsx を widget グループ別に掃討、**P2c (focus redesign)** で全 interactive element に `:focus-visible` + `--focus-ring` を適用。各 batch は独立 ship-ready。

**Tech Stack:** Next.js 16 / React 19 / Mantine v9.5 / Tailwind CSS v4.3 / TypeScript 5.7 / Vitest 4 / Bun 1.3 / ESLint 9 / Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-p2-ds-v2-application-design.md`

## Global Constraints

P1 Global Constraints を継承し、追加で以下:

- **Repository invariants (AGENTS.md):** 開始時に branch + `git status --short` を確認。`main` 以外では作業しない。worktree を作らない。他タスク由来の uncommitted diff には触らない。
- **既存 uncommitted diff は触らない**: P2 開始時点（HEAD = `2fe12684`）の 16 pre-existing modified files + untracked `.agents/skills/`, `.claude/`, `.mcp.json` は別タスク由来。本 PR で reset / checkout / stash / revert / amend しない。
- **依存追加は最小**: 新規 npm package を追加しない。ESLint custom rule は `eslint-local-rules/*.mjs` + `__tests__/*.test.mjs` 形式で `node --test` で unit test する（既存 P1 pattern）。
- **i18n hardcoded literal を新規追加しない**: P2 で生成する comment / identifier / doc-comment はすべて英語。Mantine component 名 / CSS class / i18n key は例外（既存 library の identifier であり新規 literal ではない）。
- **完了基準**: `bun run check:release` が 0 error / 0 actionable warning で通過。`bun audit` の 4 ignore（`GHSA-qx2v-qp2m-jg93` / `GHSA-6g55-p6wh-862q` / `GHSA-r28c-9q8g-f849` / `GHSA-f88m-g3jw-g9cj`）は変更禁止。
- **コミット**: 各タスク末で `git commit`。agent-initiated commit は `.agents/skills/tastile-precommit-review` 経由。コミットメッセージは英語（`feat:` / `chore:` / `test:` prefix）。
- **`src/lib/vendored/mantine-schedule` には触らない**（Knip ガード対象）。
- **既存 `eslint.config.mts` の `ignore` に新規 directory を追加しない**（production source を丸ごと ignore させない）。
- **whitelist は最小限**: Tailwind `border-0` / `border-collapse` / `border-spacing` / `border-transparent` のみ許可。whitelist の追加は spec amendment 扱い。
- **batch 独立性**: P2b Batch 1〜4 はそれぞれ独立 ship-ready。各 batch 末で ESLint 0 / typecheck 0 / Playwright DS assertion green を満たす。
- **focus redesign は P2c で独立 phase**: P2b sweep 中に focus を触らない。P2b は shadow / border / bg のみ。

## File Structure

### 新規ファイル

| ファイル | 責務 |
|---|---|
| `tastile-web/eslint-local-rules/no-mantine-shadow.mjs` | Mantine `shadow="..."` / `shadow={X}` 検出 |
| `tastile-web/eslint-local-rules/__tests__/no-mantine-shadow.test.mjs` | fixture test |
| `tastile-web/eslint-local-rules/no-mantine-border.mjs` | Mantine `withBorder` / `withBorder={true}` 検出 |
| `tastile-web/eslint-local-rules/__tests__/no-mantine-border.test.mjs` | fixture test |
| `tastile-web/eslint-local-rules/no-token-violations.mjs` | Tailwind `border-*`（whitelist 除く） `shadow-*` `bg-surface-elevated` 検出 |
| `tastile-web/eslint-local-rules/__tests__/no-token-violations.test.mjs` | fixture test |
| `tastile-web/scripts/check-ds-coverage.mts` | 静的解析: 全 tsx に禁止 pattern がないことを確認 |
| `tastile-web/tests/e2e/ds-v2-compliance.spec.ts` | Playwright computed-style assertion |

### 編集ファイル

| ファイル | 変更内容 |
|---|---|
| `tastile-web/src/app/globals.css` | `--focus-ring` / `--focus-ring-offset` / `--focus-ring-color` token 追加、6 theme override |
| `tastile-web/src/lib/theme/mantine-theme.ts` | Menu / Popover / Tooltip / HoverCard / Notification / Select / Combobox / Pills / Chip を defaultProps 追加 |
| `tastile-web/src/lib/theme/__tests__/mantine-theme.test.ts` | 新 component の defaultProps pin test 追加 |
| `tastile-web/eslint.config.mts` | 3 新 rules を 'error' で登録 |
| `tastile-web/package.json` | `lint:ds` script 登録、`test:e2e` 拡張 |
| `tastile-web/src/widgets/**/*.tsx` (Batch 1) | DS v2 適用 |
| `tastile-web/src/widgets/floating-header/ui/*.tsx` (Batch 2) | DS v2 適用 |
| `tastile-web/src/widgets/side-tool-panel/ui/*.tsx` (Batch 2) | DS v2 適用 |
| `tastile-web/src/features/create-tile/ui/*.tsx` (Batch 3) | DS v2 適用 |
| `tastile-web/src/features/manage-*/ui/*.tsx` (Batch 4) | DS v2 適用 |
| `tastile-web/src/features/marketing/**/*.tsx` (Batch 4) | DS v2 適用 |
| `tastile-web/src/features/execute-tile/**/*.tsx` (Batch 4) | DS v2 適用 |
| `tastile-web/src/features/view-notifications/**/*.tsx` (Batch 4) | DS v2 適用 |
| `tastile-web/src/views/dashboard/**` (Batch 4) | DS v2 適用 |

### 触らないファイル
- `tastile-web/src/lib/vendored/mantine-schedule/**`（Knip ガード）
- 他タスク由来の uncommitted diff 配下すべて（`src/widgets/app-shell/**`, `src/shared/**`, `src/app/dashboard/**`, `package.json`, `biome.json`, etc. — **ただし P2a/P2b で `src/widgets/app-shell/**` と `src/app/dashboard/**` を sweep する必要が生じた場合は、uncommitted diff と merge conflict しないよう注意。P2b Batch 1/4 の implementer は uncommitted diff 部分を変更せず、sweep 対象を確定してから reviewer に相談**）
- `tastile-web/src/shared/context/auth-context.tsx`, `src/shared/hooks/use-track-visit.ts` 等の pre-existing modified files

## DS v2 Sweep 変換パターン（P2b 全 task で参照）

各 P2b task implementer は以下パターンを各 file に適用する:

### 変換ルール

| 旧表記 | 新表記 |
|---|---|
| `shadow="lg"` `shadow="xl"` `shadow="sm"` `shadow="md"` | 削除（component から prop を除去） |
| `shadow={undefined}` | 削除 |
| `shadow={X}` （任意の値） | 削除 |
| `withBorder` `withBorder={true}` | 削除 |
| `withBorder={false}` | 削除（既に false なので冗長） |
| `border-border` | 削除 |
| `border-border/30` `border-border/50` `border-border/20` 等の alpha バリアント | 削除 |
| `border-b border-border` | 削除（spacing のみで構造分離） |
| `border-r border-border` | 削除（surface-1 bg で構造分離） |
| `border-l border-border/20` | 削除（surface-2 bg で構造分離） |
| `border-t border-border` | 削除 |
| `border border-border` | 削除 |
| `bg-surface-elevated` (AppShell containers / FloatingHeader / RightSidebar) | `bg-surface-1` |
| `border-0` | 保持（whitelist） |
| `border-collapse` | 保持（whitelist） |
| `border-spacing` | 保持（whitelist） |
| `border-transparent` | 保持（whitelist） |

### 構造分離のフォールバック

`border-b border-border` を削除した結果、視覚的階層が失われる場合は:

1. 親要素に `bg-surface-1` を追加し、子要素との bg の段差で階層を作る
2. 親要素に `py-{N}` を追加し、spacing で分離する
3. 親要素に `border-b border-border` の代わりに `<Divider>` を挿入（Mantine Divider は P1 で `color: 'gray.3'` が default なので border を出さない）

`shadow` を削除した結果、立体感が失われる場合は:

1. `bg-surface-2` または `bg-surface-3` に切り替えて contrast で階層を作る
2. 親要素に `bg-surface-1` を追加し、子要素を `bg-surface-2` にして 1 段上げる

### コミットメッセージ規約

- `feat(shell): remove borders from AppShell containers` — Batch 1 widget 単位
- `feat(create-tile): apply DS v2 tokens to sub-panels` — Batch 3 group 単位
- `feat(manage-tasks): DS v2 sweep` — Batch 4 feature 単位
- `fix(focus): apply :focus-visible to interactive elements` — P2c 単位
- `chore(eslint): register no-mantine-shadow / no-mantine-border / no-token-violations`
- `feat(scripts): add check-ds-coverage for DS v2 token discipline`
- `test(e2e): add ds-v2-compliance Playwright spec`

### unit 間の依存関係

```
P2a (Foundation)
  Task 1  --focus-ring tokens in globals.css
  Task 2  mantine-theme.ts: 9 new components defaultProps + test
  Task 3  no-mantine-shadow rule + test
  Task 4  no-mantine-border rule + test
  Task 5  no-token-violations rule + test
  Task 6  eslint.config.mts: register 3 rules + verify lint 0 on P2a-introduced files
  Task 7  check-ds-coverage.mts + package.json wiring
  Task 8  Playwright ds-v2-compliance.spec.ts
  Task 9  P2a final verification

P2b Batch 1 (Shell, ~10 files)
  Task 10  ActivityBar.tsx sweep
  Task 11  AppShell.tsx + 7 sub-components sweep
  Task 12  Header.tsx + AccountMenu/ActiveExecutionBar/GlobalPromptBanner sweep
  Task 13  LeftTabs/MobileBottomTabs/RightSidebar/TimelineAxis sweep
  Task 14  Batch 1 verification

P2b Batch 2 (Floating widgets, ~5 files)
  Task 15  FloatingHeader.tsx + ExecutionControls.tsx sweep
  Task 16  SideToolPanel.tsx sweep
  Task 17  Batch 2 verification

P2b Batch 3 (Create tile, ~30 files)
  Task 18  create-tile sub-panels (CompletionSubPanel, ConditionPanel, DurationSubPanel, EventDetailsSubPanel, IntentSubPanel, MetaSubPanel) — 6 files
  Task 19  create-tile components (BehaviorPreview, ConditionEditor, EssentialRow, FieldRow, PanelErrorBanner, ProjectPicker, QuickCreate) — 7 files
  Task 20  create-tile modals + flow (CreateProjectModal, FlowSequencePanel, PlacementRulesPanel) — 3 files + remaining
  Task 21  Batch 3 verification

P2b Batch 4 (Remaining, ~105 files)
  Task 22  manage-projects sweep
  Task 23  manage-schedule sweep
  Task 24  manage-tasks sweep
  Task 25  manage-settings sweep
  Task 26  marketing sweep
  Task 27  execute-tile sweep
  Task 28  view-notifications sweep
  Task 29  views/dashboard sweep
  Task 30  Batch 4 verification

P2c (Focus redesign)
  Task 31  Apply :focus-visible + --focus-ring across interactive elements
  Task 32  Playwright focus assertion
  Task 33  P2c final verification
```

---

## Task 1: `--focus-ring` token を globals.css に追加

**Files:**
- Modify: `tastile-web/src/app/globals.css`（`:root` と 6 theme override に token 追加）

**Interfaces:**
- Consumes: P1 で敷設された 6 theme selector（`:root`, `.dark`, `.theme-gray`, `.theme-dark`, `.theme-dark-black`, `.theme-dark-gray`）
- Produces: `--focus-ring: 2px` / `--focus-ring-offset: 2px` / `--focus-ring-color: var(--primary)` が全 6 selector で定義

- [ ] **Step 1: 既存 globals.css の :root セクションを確認**

Run: `cd tastile-web && grep -n "^-" src/app/globals.css | head -40`
Expected: `:root` ブロック内に既存 token の一覧。どこに focus-ring を追加するか位置を決める。

- [ ] **Step 2: `:root` に 3 token を追加**

`src/app/globals.css` の `:root { ... }` ブロック内の既存 token 末尾に追記:

```css
	--focus-ring: 2px;
	--focus-ring-offset: 2px;
	--focus-ring-color: var(--primary);
```

- [ ] **Step 3: 6 theme override に `--focus-ring-color` を追加**

`.dark,` `.theme-gray,` `.theme-dark,` `.theme-dark-black,` `.theme-dark-gray` の各 override ブロックに以下を追加（既存 P1 token と同じ位置に追加）:

```css
	--focus-ring-color: var(--primary);
```

- [ ] **Step 4: check-theme-coverage.mts (P1) を実行**

Run: `cd tastile-web && bun scripts/check-theme-coverage.mts`
Expected: `OK: all 6 theme selectors present in src/app/globals.css` (exit 0)

- [ ] **Step 5: typecheck を確認**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add src/app/globals.css
git commit -m "feat(theme): add --focus-ring tokens for a11y focus redesign"
```

---

## Task 2: mantine-theme.ts に 9 component の defaultProps 追加

**Files:**
- Modify: `tastile-web/src/lib/theme/mantine-theme.ts`（`components` プロパティに 9 component 追加）
- Modify: `tastile-web/src/lib/theme/__tests__/mantine-theme.test.ts`（pin test 追加）

**Interfaces:**
- Consumes: 既存 P1 で設定された Card / Paper / Modal / Drawer / Divider / Button / ActionIcon / Input の defaultProps
- Produces: Menu / Popover / Tooltip / HoverCard / Notification / Select / Combobox / Pills / Chip の defaultProps

- [ ] **Step 1: 既存 mantine-theme.ts を確認**

Run: `cd tastile-web && cat src/lib/theme/mantine-theme.ts`
Expected: 既存 `components` ブロックに 8 component の defaultProps が定義済み

- [ ] **Step 2: 既存 import に 9 component を追加**

`src/lib/theme/mantine-theme.ts` の import ブロックに追加:

```typescript
import {
  ActionIcon,
  Button,
  Card,
  Chip,
  Combobox,
  Divider,
  Drawer,
  HoverCard,
  Input,
  Menu,
  Modal,
  Notification,
  Paper,
  Pills,
  Popover,
  Select,
  Tooltip,
  createTheme,
} from '@mantine/core';
```

- [ ] **Step 3: 失敗する test を追加**

`src/lib/theme/__tests__/mantine-theme.test.ts` の末尾に以下を追加:

```typescript
describe('P2 Menu defaultProps', () => {
  it('Menu.Dropdown has withBorder false and shadow undefined', () => {
    expect((mantineTheme.components?.Menu?.Dropdown?.defaultProps as AnyProps)?.withBorder).toBe(false);
    expect((mantineTheme.components?.Menu?.Dropdown?.defaultProps as AnyProps)?.shadow).toBeUndefined();
    expect((mantineTheme.components?.Menu?.Dropdown?.defaultProps as AnyProps)?.radius).toBe('md');
  });
});

describe('P2 Popover defaultProps', () => {
  it('Popover.Dropdown has withBorder false and shadow undefined', () => {
    expect((mantineTheme.components?.Popover?.Dropdown?.defaultProps as AnyProps)?.withBorder).toBe(false);
    expect((mantineTheme.components?.Popover?.Dropdown?.defaultProps as AnyProps)?.shadow).toBeUndefined();
    expect((mantineTheme.components?.Popover?.Dropdown?.defaultProps as AnyProps)?.radius).toBe('md');
  });
});

describe('P2 Tooltip defaultProps', () => {
  it('Tooltip has withBorder false and shadow undefined', () => {
    expect((mantineTheme.components?.Tooltip?.defaultProps as AnyProps)?.withBorder).toBe(false);
    expect((mantineTheme.components?.Tooltip?.defaultProps as AnyProps)?.shadow).toBeUndefined();
    expect((mantineTheme.components?.Tooltip?.defaultProps as AnyProps)?.radius).toBe('sm');
  });
});

describe('P2 HoverCard defaultProps', () => {
  it('HoverCard.Dropdown has withBorder false and shadow undefined', () => {
    expect((mantineTheme.components?.HoverCard?.Dropdown?.defaultProps as AnyProps)?.withBorder).toBe(false);
    expect((mantineTheme.components?.HoverCard?.Dropdown?.defaultProps as AnyProps)?.shadow).toBeUndefined();
  });
});

describe('P2 Notification defaultProps', () => {
  it('Notification has withBorder false and shadow undefined', () => {
    expect((mantineTheme.components?.Notification?.defaultProps as AnyProps)?.withBorder).toBe(false);
    expect((mantineTheme.components?.Notification?.defaultProps as AnyProps)?.shadow).toBeUndefined();
    expect((mantineTheme.components?.Notification?.defaultProps as AnyProps)?.radius).toBe('md');
  });
});

describe('P2 Select defaultProps', () => {
  it('Select has withBorder false', () => {
    expect((mantineTheme.components?.Select?.defaultProps as AnyProps)?.withBorder).toBe(false);
  });
});

describe('P2 Combobox defaultProps', () => {
  it('Combobox has withBorder false and shadow undefined', () => {
    expect((mantineTheme.components?.Combobox?.defaultProps as AnyProps)?.withBorder).toBe(false);
    expect((mantineTheme.components?.Combobox?.defaultProps as AnyProps)?.shadow).toBeUndefined();
  });
});

describe('P2 Pills defaultProps', () => {
  it('Pill has radius full', () => {
    expect((mantineTheme.components?.Pill?.defaultProps as AnyProps)?.radius).toBe('full');
  });
});

describe('P2 Chip defaultProps', () => {
  it('Chip has withBorder false and variant light', () => {
    expect((mantineTheme.components?.Chip?.defaultProps as AnyProps)?.withBorder).toBe(false);
    expect((mantineTheme.components?.Chip?.defaultProps as AnyProps)?.variant).toBe('light');
  });
});
```

- [ ] **Step 4: test を走らせ、FAIL を確認**

Run: `cd tastile-web && bun test src/lib/theme/__tests__/mantine-theme.test.ts`
Expected: 9 件 FAIL（`Menu` / `Popover` / `Tooltip` / `HoverCard` / `Notification` / `Select` / `Combobox` / `Pill` / `Chip` defaultProps が undefined）

- [ ] **Step 5: mantine-theme.ts の components ブロックに 9 component を追加**

`src/lib/theme/mantine-theme.ts` の `components: { ... }` ブロックの末尾に以下を追加（既存 Card / Paper / Modal / Drawer / Divider / Button / ActionIcon / Input の defaultProps はそのまま）:

```typescript
    Menu: Menu.extend({
      defaultProps: { withBorder: false, shadow: undefined, radius: 'md' },
    }),
    Popover: Popover.extend({
      defaultProps: { withBorder: false, shadow: undefined, radius: 'md' },
    }),
    Tooltip: Tooltip.extend({
      defaultProps: { withBorder: false, shadow: undefined, radius: 'sm' },
    }),
    HoverCard: HoverCard.extend({
      defaultProps: { withBorder: false, shadow: undefined, radius: 'md' },
    }),
    Notification: Notification.extend({
      defaultProps: { withBorder: false, shadow: undefined, radius: 'md' },
    }),
    Select: Select.extend({
      defaultProps: { withBorder: false, radius: 'md' },
    }),
    Combobox: Combobox.extend({
      defaultProps: { withBorder: false, shadow: undefined },
    }),
    Pill: Pills.Pill.extend({
      defaultProps: { radius: 'full' },
    }),
    Chip: Chip.extend({
      defaultProps: { withBorder: false, variant: 'light' },
    }),
```

注意: Mantine v9 の `Menu` / `Popover` / `HoverCard` は compound component (`.Dropdown`) で defaultProps を継承する。`Menu.extend({ defaultProps: ... })` は `Menu.Dropdown` にも伝播するため、上記で OK（Mantine の内部 default merge 機能を利用）。

- [ ] **Step 6: test を走らせ、PASS を確認**

Run: `cd tastile-web && bun test src/lib/theme/__tests__/mantine-theme.test.ts`
Expected: 26 pass (P1: 17 + P2: 9), 0 fail

- [ ] **Step 7: typecheck を確認**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error

- [ ] **Step 8: コミット**

```bash
cd tastile-web
git add src/lib/theme/mantine-theme.ts src/lib/theme/__tests__/mantine-theme.test.ts
git commit -m "feat(theme): extend Mantine defaultProps for 9 internal surfaces (Menu/Popover/Tooltip/HoverCard/Notification/Select/Combobox/Pill/Chip)"
```

---

## Task 3: `no-mantine-shadow` ESLint rule + test

**Files:**
- Create: `tastile-web/eslint-local-rules/no-mantine-shadow.mjs`
- Create: `tastile-web/eslint-local-rules/__tests__/no-mantine-shadow.test.mjs`

**Interfaces:**
- Consumes: ESLint 9 flat-config の Rule context
- Produces: AST visitor で `JSXAttribute` の name が `shadow` の場合に report（P1 の `no-inline-css-var-override.mjs` の AST 構造を踏襲）

- [ ] **Step 1: ディレクトリ確認**

Run: `cd tastile-web && ls eslint-local-rules/`
Expected: `no-unknown-css-var-in-tokens.mjs` と `no-inline-css-var-override.mjs` と `__tests__/` が存在

- [ ] **Step 2: rule ファイルを作成**

`eslint-local-rules/no-mantine-shadow.mjs`:

```javascript
import { RuleTester } from 'eslint';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Mantine `shadow="..."` prop (DS v2: no shadows allowed). Use surface elevation tokens instead.',
    },
    schema: [],
    messages: {
      shadowProp:
        'Mantine `shadow` prop is forbidden in DS v2. Use bg-surface-X tokens for visual hierarchy instead.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.name !== 'shadow') return;
        context.report({ node, messageId: 'shadowProp' });
      },
    };
  },
};

export default rule;

// Self-test via node --test
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new RuleTester({
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });

  tester.run('no-mantine-shadow', rule, {
    valid: [
      { code: '<Card>hello</Card>' },
      { code: '<Button radius="md">click</Button>' },
    ],
    invalid: [
      {
        code: '<Card shadow="lg">hello</Card>',
        errors: [{ messageId: 'shadowProp' }],
      },
      {
        code: '<Paper shadow={undefined}>hello</Paper>',
        errors: [{ messageId: 'shadowProp' }],
      },
    ],
  });
  console.log('no-mantine-shadow: OK');
}
```

- [ ] **Step 3: fixture test を作成**

`eslint-local-rules/__tests__/no-mantine-shadow.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleTester } from 'eslint';
import rule from '../no-mantine-shadow.mjs';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test('no-mantine-shadow: valid cases', () => {
  tester.run('no-mantine-shadow', rule, {
    valid: [
      { code: '<Card>hello</Card>' },
      { code: '<Button radius="md">click</Button>' },
    ],
    invalid: [],
  });
});

test('no-mantine-shadow: invalid cases (shadow prop)', () => {
  tester.run('no-mantine-shadow', rule, {
    valid: [],
    invalid: [
      {
        code: '<Card shadow="lg">hello</Card>',
        errors: [{ messageId: 'shadowProp' }],
      },
      {
        code: '<Paper shadow={undefined}>hello</Paper>',
        errors: [{ messageId: 'shadowProp' }],
      },
    ],
  });
});
```

- [ ] **Step 4: rule を直接実行し PASS を確認**

Run: `cd tastile-web && node eslint-local-rules/no-mantine-shadow.mjs`
Expected: `no-mantine-shadow: OK` (exit 0)

- [ ] **Step 5: fixture test を実行し PASS を確認**

Run: `cd tastile-web && node --test eslint-local-rules/__tests__/no-mantine-shadow.test.mjs`
Expected: 2 pass, 0 fail

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add eslint-local-rules/no-mantine-shadow.mjs eslint-local-rules/__tests__/no-mantine-shadow.test.mjs
git commit -m "feat(eslint): add no-mantine-shadow rule for DS v2"
```

---

## Task 4: `no-mantine-border` ESLint rule + test

**Files:**
- Create: `tastile-web/eslint-local-rules/no-mantine-border.mjs`
- Create: `tastile-web/eslint-local-rules/__tests__/no-mantine-border.test.mjs`

**Interfaces:**
- Produces: AST visitor で `JSXAttribute` の name が `withBorder` の場合に report（`shadow` rule と同じ構造）

- [ ] **Step 1: rule ファイルを作成**

`eslint-local-rules/no-mantine-border.mjs`:

```javascript
import { RuleTester } from 'eslint';

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Mantine `withBorder={true}` prop (DS v2: no borders allowed). Use surface elevation tokens instead.',
    },
    schema: [],
    messages: {
      withBorderProp:
        'Mantine `withBorder` prop is forbidden in DS v2. Use bg-surface-X tokens for visual hierarchy instead.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.name !== 'withBorder') return;
        context.report({ node, messageId: 'withBorderProp' });
      },
    };
  },
};

export default rule;

if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new RuleTester({
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });

  tester.run('no-mantine-border', rule, {
    valid: [
      { code: '<Card>hello</Card>' },
    ],
    invalid: [
      {
        code: '<Card withBorder>hello</Card>',
        errors: [{ messageId: 'withBorderProp' }],
      },
      {
        code: '<Card withBorder={true}>hello</Card>',
        errors: [{ messageId: 'withBorderProp' }],
      },
    ],
  });
  console.log('no-mantine-border: OK');
}
```

- [ ] **Step 2: fixture test を作成**

`eslint-local-rules/__tests__/no-mantine-border.test.mjs`:

```javascript
import test from 'node:test';
import { RuleTester } from 'eslint';
import rule from '../no-mantine-border.mjs';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test('no-mantine-border: valid cases', () => {
  tester.run('no-mantine-border', rule, {
    valid: [{ code: '<Card>hello</Card>' }],
    invalid: [],
  });
});

test('no-mantine-border: invalid cases (withBorder prop)', () => {
  tester.run('no-mantine-border', rule, {
    valid: [],
    invalid: [
      {
        code: '<Card withBorder>hello</Card>',
        errors: [{ messageId: 'withBorderProp' }],
      },
      {
        code: '<Card withBorder={true}>hello</Card>',
        errors: [{ messageId: 'withBorderProp' }],
      },
    ],
  });
});
```

- [ ] **Step 3: rule を直接実行し PASS を確認**

Run: `cd tastile-web && node eslint-local-rules/no-mantine-border.mjs`
Expected: `no-mantine-border: OK` (exit 0)

- [ ] **Step 4: fixture test を実行し PASS を確認**

Run: `cd tastile-web && node --test eslint-local-rules/__tests__/no-mantine-border.test.mjs`
Expected: 2 pass, 0 fail

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add eslint-local-rules/no-mantine-border.mjs eslint-local-rules/__tests__/no-mantine-border.test.mjs
git commit -m "feat(eslint): add no-mantine-border rule for DS v2"
```

---

## Task 5: `no-token-violations` ESLint rule + test

**Files:**
- Create: `tastile-web/eslint-local-rules/no-token-violations.mjs`
- Create: `tastile-web/eslint-local-rules/__tests__/no-token-violations.test.mjs`

**Interfaces:**
- Produces: AST visitor で `JSXAttribute` の name が `className` の場合に、文字列を regex scan し、`border-(?!0\b|collapse\b|spacing\b|transparent\b)` / `shadow-(sm|md|lg|xl|inner|none)` / `bg-surface-elevated` を検出

- [ ] **Step 1: rule ファイルを作成**

`eslint-local-rules/no-token-violations.mjs`:

```javascript
import { RuleTester } from 'eslint';

const BORDER_REGEX = /\bborder-(?!0\b|collapse\b|spacing\b|transparent\b)[a-z0-9./-]+/g;
const SHADOW_REGEX = /\bshadow-(?:sm|md|lg|xl|inner|none)\b/g;
const BG_SURFACE_ELEVATED = /\bbg-surface-elevated\b/g;

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Tailwind border-* (except 0/collapse/spacing/transparent), shadow-*, bg-surface-elevated classes (DS v2).',
    },
    schema: [],
    messages: {
      borderClass:
        'Tailwind `border-*` class is forbidden in DS v2 (except `border-0` / `border-collapse` / `border-spacing` / `border-transparent`). Use surface elevation tokens or `<Divider />` instead.',
      shadowClass:
        'Tailwind `shadow-*` class is forbidden in DS v2. Use bg-surface-X tokens for visual hierarchy instead.',
      surfaceElevatedClass:
        '`bg-surface-elevated` is not in the DS v2 token map. Use `bg-surface-1` / `bg-surface-2` / `bg-surface-3` instead.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.name !== 'className') return;
        if (node.value?.type !== 'Literal' && node.value?.type !== 'JSXExpressionContainer') return;
        const className =
          node.value?.type === 'Literal'
            ? String(node.value.value)
            : String(node.value?.expression?.value ?? '');
        if (!className) return;
        const sourceCode = context.getSourceCode();
        const baseOffset = node.value.range[0];
        for (const match of className.matchAll(BORDER_REGEX)) {
          context.report({
            node,
            loc: {
              start: sourceCode.getLocFromIndex(baseOffset + match.index),
              end: sourceCode.getLocFromIndex(baseOffset + match.index + match[0].length),
            },
            messageId: 'borderClass',
          });
        }
        for (const match of className.matchAll(SHADOW_REGEX)) {
          context.report({
            node,
            loc: {
              start: sourceCode.getLocFromIndex(baseOffset + match.index),
              end: sourceCode.getLocFromIndex(baseOffset + match.index + match[0].length),
            },
            messageId: 'shadowClass',
          });
        }
        for (const match of className.matchAll(BG_SURFACE_ELEVATED)) {
          context.report({
            node,
            loc: {
              start: sourceCode.getLocFromIndex(baseOffset + match.index),
              end: sourceCode.getLocFromIndex(baseOffset + match.index + match[0].length),
            },
            messageId: 'surfaceElevatedClass',
          });
        }
      },
    };
  },
};

export default rule;

if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new RuleTester({
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });

  tester.run('no-token-violations', rule, {
    valid: [
      { code: '<div className="bg-surface-1">x</div>' },
      { code: '<div className="border-0 border-collapse">x</div>' },
      { code: '<div className="border-transparent">x</div>' },
    ],
    invalid: [
      {
        code: '<div className="border-border">x</div>',
        errors: [{ messageId: 'borderClass' }],
      },
      {
        code: '<div className="border-border/30">x</div>',
        errors: [{ messageId: 'borderClass' }],
      },
      {
        code: '<div className="shadow-lg">x</div>',
        errors: [{ messageId: 'shadowClass' }],
      },
      {
        code: '<div className="bg-surface-elevated">x</div>',
        errors: [{ messageId: 'surfaceElevatedClass' }],
      },
    ],
  });
  console.log('no-token-violations: OK');
}
```

- [ ] **Step 2: fixture test を作成**

`eslint-local-rules/__tests__/no-token-violations.test.mjs`:

```javascript
import test from 'node:test';
import { RuleTester } from 'eslint';
import rule from '../no-token-violations.mjs';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test('no-token-violations: valid (whitelisted) cases', () => {
  tester.run('no-token-violations', rule, {
    valid: [
      { code: '<div className="bg-surface-1">x</div>' },
      { code: '<div className="border-0 border-collapse">x</div>' },
      { code: '<div className="border-transparent">x</div>' },
    ],
    invalid: [],
  });
});

test('no-token-violations: invalid border-* classes', () => {
  tester.run('no-token-violations', rule, {
    valid: [],
    invalid: [
      { code: '<div className="border-border">x</div>', errors: [{ messageId: 'borderClass' }] },
      { code: '<div className="border-border/30">x</div>', errors: [{ messageId: 'borderClass' }] },
    ],
  });
});

test('no-token-violations: invalid shadow-* classes', () => {
  tester.run('no-token-violations', rule, {
    valid: [],
    invalid: [
      { code: '<div className="shadow-lg">x</div>', errors: [{ messageId: 'shadowClass' }] },
    ],
  });
});

test('no-token-violations: invalid bg-surface-elevated', () => {
  tester.run('no-token-violations', rule, {
    valid: [],
    invalid: [
      { code: '<div className="bg-surface-elevated">x</div>', errors: [{ messageId: 'surfaceElevatedClass' }] },
    ],
  });
});
```

- [ ] **Step 3: rule を直接実行し PASS を確認**

Run: `cd tastile-web && node eslint-local-rules/no-token-violations.mjs`
Expected: `no-token-violations: OK` (exit 0)

- [ ] **Step 4: fixture test を実行し PASS を確認**

Run: `cd tastile-web && node --test eslint-local-rules/__tests__/no-token-violations.test.mjs`
Expected: 4 pass, 0 fail

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add eslint-local-rules/no-token-violations.mjs eslint-local-rules/__tests__/no-token-violations.test.mjs
git commit -m "feat(eslint): add no-token-violations rule for DS v2 Tailwind discipline"
```

---

## Task 6: eslint.config.mts に 3 新 rules を 'error' で登録

**Files:**
- Modify: `tastile-web/eslint.config.mts`（`localRules` プラグインに 3 新 rule を追加、適用設定）

**Interfaces:**
- Consumes: P1 で登録された `localRules` プラグイン（`no-unknown-css-var-in-tokens`, `no-inline-css-var-override`）
- Produces: 3 新 rule が `src/**` ブロックで 'error' で発火

- [ ] **Step 1: 既存 eslint.config.mts を確認**

Run: `cd tastile-web && cat eslint.config.mts`
Expected: P1 で `localRules` プラグインが registered、2 rule が `src/**` ブロックで適用済み

- [ ] **Step 2: localRules プラグイン定義に 3 rule を追加**

`eslint.config.mts` の `localRules` 定義ブロック（`plugins: { localRules: { rules: { ... } } }` 内）に以下を追加:

```typescript
      'no-mantine-shadow': (await import('./eslint-local-rules/no-mantine-shadow.mjs')).default,
      'no-mantine-border': (await import('./eslint-local-rules/no-mantine-border.mjs')).default,
      'no-token-violations': (await import('./eslint-local-rules/no-token-violations.mjs')).default,
```

- [ ] **Step 3: src/** ブロックの rules に 3 新 rule を追加**

既存 P1 で `'no-unknown-css-var-in-tokens': 'error'` と `'no-inline-css-var-override': 'error'` が設定されている箇所に以下を追加:

```typescript
        'localRules/no-mantine-shadow': 'error',
        'localRules/no-mantine-border': 'error',
        'localRules/no-token-violations': 'error',
```

- [ ] **Step 4: lint を走らせ、P2a-introduced file で 0 違反を確認**

Run: `cd tastile-web && bun run lint 2>&1 | grep -E "(error|warning).*localRules" | head -20`
Expected: P2a-introduced file（`src/lib/theme/mantine-theme.ts` の Task 2 変更、`src/app/globals.css` の Task 1 変更）では 0 違反（globals.css は ESLint 対象外、mantine-theme.ts には shadow / withBorder / border-* / bg-surface-elevated がないため）

- [ ] **Step 5: typecheck を確認**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add eslint.config.mts
git commit -m "chore(eslint): register no-mantine-shadow / no-mantine-border / no-token-violations"
```

---

## Task 7: `check-ds-coverage.mts` + package.json wiring

**Files:**
- Create: `tastile-web/scripts/check-ds-coverage.mts`
- Modify: `tastile-web/package.json`（`lint:ds` script 追加）

**Interfaces:**
- Consumes: P1 で作成された `check-theme-coverage.mts`（`src/app/globals.css` の 6 theme selector 検証）
- Produces: `src/widgets/**` `src/features/**` `src/views/**` `src/app/**` の全 tsx に禁止 pattern（`shadow=` Mantine prop / `withBorder` Mantine prop / Tailwind `border-*` whitelist 外 / Tailwind `shadow-*` / `bg-surface-elevated`）がないことを静的解析

- [ ] **Step 1: 既存 check-theme-coverage.mts を確認**

Run: `cd tastile-web && cat scripts/check-theme-coverage.mts`
Expected: 48 行程度の静的解析スクリプト

- [ ] **Step 2: check-ds-coverage.mts を作成**

`scripts/check-ds-coverage.mts`:

```typescript
#!/usr/bin/env bun
/**
 * DS v2 token discipline static checker.
 *
 * Scans all tsx/tsx in src/widgets, src/features, src/views, src/app for
 * forbidden patterns introduced by P2 ESLint rules. This is the runtime
 * fallback for editors that don't run ESLint, and the CI gate that runs
 * even if ESLint is disabled.
 *
 * Forbidden patterns:
 *   - Mantine `shadow="..."` / `shadow={...}` props (jsx className-like)
 *   - Mantine `withBorder` / `withBorder={true}` props
 *   - Tailwind `border-*` (whitelist: border-0, border-collapse, border-spacing, border-transparent)
 *   - Tailwind `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-inner`, `shadow-none`
 *   - Tailwind `bg-surface-elevated`
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/widgets', 'src/features', 'src/views', 'src/app'];
const EXTS = ['.tsx'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'src/lib/vendored']);

const BORDER_REGEX = /\bborder-(?!0\b|collapse\b|spacing\b|transparent\b)[a-z0-9./-]+/g;
const SHADOW_REGEX = /\bshadow-(?:sm|md|lg|xl|inner|none)\b/g;
const BG_SURFACE_ELEVATED = /\bbg-surface-elevated\b/g;
const MANTINE_SHADOW = /\bshadow=(?:"|\{)/g;
const MANTINE_WITHBORDER = /\bwithBorder(?:=\{true\}|>|\s)/g;

interface Violation {
  file: string;
  line: number;
  column: number;
  match: string;
  rule: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (EXTS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

function findViolations(filePath: string): Violation[] {
  const content = readFileSync(filePath, 'utf8');
  const violations: Violation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const match of line.matchAll(BORDER_REGEX)) {
      violations.push({ file: filePath, line: i + 1, column: match.index! + 1, match: match[0], rule: 'no-border-class' });
    }
    for (const match of line.matchAll(SHADOW_REGEX)) {
      violations.push({ file: filePath, line: i + 1, column: match.index! + 1, match: match[0], rule: 'no-shadow-class' });
    }
    for (const match of line.matchAll(BG_SURFACE_ELEVATED)) {
      violations.push({ file: filePath, line: i + 1, column: match.index! + 1, match: match[0], rule: 'no-bg-surface-elevated' });
    }
    for (const match of line.matchAll(MANTINE_SHADOW)) {
      violations.push({ file: filePath, line: i + 1, column: match.index! + 1, match: match[0], rule: 'no-mantine-shadow-prop' });
    }
    for (const match of line.matchAll(MANTINE_WITHBORDER)) {
      violations.push({ file: filePath, line: i + 1, column: match.index! + 1, match: match[0], rule: 'no-mantine-withborder-prop' });
    }
  }
  return violations;
}

const allViolations: Violation[] = [];
for (const scanDir of SCAN_DIRS) {
  const fullDir = join(ROOT, scanDir);
  try {
    statSync(fullDir);
  } catch {
    continue;
  }
  const files = walk(fullDir);
  for (const f of files) allViolations.push(...findViolations(f));
}

if (allViolations.length === 0) {
  console.log(`OK: 0 DS v2 token violations across ${SCAN_DIRS.join(', ')}`);
  process.exit(0);
}

console.error(`FAIL: ${allViolations.length} DS v2 token violations found`);
for (const v of allViolations.slice(0, 50)) {
  console.error(`  ${relative(ROOT, v.file)}:${v.line}:${v.column}  ${v.rule}  ${v.match}`);
}
if (allViolations.length > 50) console.error(`  ... and ${allViolations.length - 50} more`);
process.exit(1);
```

- [ ] **Step 3: スクリプトを実行し、現状の違反数を計測**

Run: `cd tastile-web && bun scripts/check-ds-coverage.mts`
Expected: 100+ 違反（既存 P2b 前の状態）。これは正常 — P2b sweep で 0 にする。出力は Baseline として記録。

- [ ] **Step 4: package.json に `lint:ds` を追加**

`package.json` の `scripts` セクションに以下を追加:

```json
    "lint:ds": "bun scripts/check-ds-coverage.mts",
```

- [ ] **Step 5: typecheck を確認**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error

- [ ] **Step 6: コミット**

```bash
cd tastile-web
git add scripts/check-ds-coverage.mts package.json
git commit -m "feat(scripts): add check-ds-coverage for DS v2 token discipline gate"
```

注意: `package.json` は P2 開始時点（HEAD = `2fe12684`）で pre-existing uncommitted diff に含まれる可能性あり。`git status --short package.json` で確認し、uncommitted なら reviewer に相談してから commit。uncommitted でない場合はそのまま commit。

---

## Task 8: Playwright `ds-v2-compliance.spec.ts`

**Files:**
- Create: `tastile-web/tests/e2e/ds-v2-compliance.spec.ts`

**Interfaces:**
- Consumes: 既存 `tests/e2e/` 配下の helper（auth bypass / page navigation）
- Produces: 主要 page（dashboard, timeline, create tile, app shell）で `box-shadow === 'none'` / `border-width === '0px'` を computed style で assertion

- [ ] **Step 1: 既存 E2E helper を確認**

Run: `cd tastile-web && ls tests/e2e/ && cat tests/e2e/playwright.config.ts 2>/dev/null | head -30`
Expected: `playwright.config.ts` と helper script

- [ ] **Step 2: spec を作成**

`tests/e2e/ds-v2-compliance.spec.ts`:

```typescript
import { test, expect, type Page } from '@playwright/test';

/**
 * DS v2 compliance E2E: asserts that no element in the rendered shell
 * has a visible shadow or non-zero border. Per DS v2 design rules:
 *   - shadows are forbidden (visual hierarchy via surface elevation only)
 *   - borders are forbidden except Mantine Divider color (which still
 *     produces no border-width on the Divider element itself)
 *
 * Strategy: navigate to each major route, query a representative set
 * of Card / Paper / Menu.Dropdown / Popover.Dropdown / Tooltip elements,
 * and assert computed style. If a violation is found, fail with the
 * element's selector + computed values.
 */

async function assertNoShadowOrBorder(page: Page, selector: string) {
  const elements = page.locator(selector);
  const count = await elements.count();
  for (let i = 0; i < count; i++) {
    const el = elements.nth(i);
    const boxShadow = await el.evaluate((e) => getComputedStyle(e).boxShadow);
    const borderTopWidth = await el.evaluate((e) => getComputedStyle(e).borderTopWidth);
    expect(boxShadow, `${selector} box-shadow`).toBe('none');
    expect(borderTopWidth, `${selector} border-top-width`).toBe('0px');
  }
}

test.describe('DS v2 compliance', () => {
  test('dashboard renders with no shadows or borders on surface elements', async ({ page }) => {
    await page.goto('/dashboard');
    await assertNoShadowOrBorder(page, '[data-testid="dashboard-card"]');
    await assertNoShadowOrBorder(page, 'main > div');
  });

  test('timeline view renders with no shadows or borders', async ({ page }) => {
    await page.goto('/dashboard/timeline/day');
    await assertNoShadowOrBorder(page, '[data-testid="timeline-tile"]');
  });

  test('app shell containers have no shadows or borders', async ({ page }) => {
    await page.goto('/dashboard');
    await assertNoShadowOrBorder(page, 'header[role="banner"]');
    await assertNoShadowOrBorder(page, 'aside');
    await assertNoShadowOrBorder(page, 'nav');
  });
});
```

注意: 各 page の selector は実装時に実際の DOM 構造に合わせて refine する。P2a では placeholder selector で commit し、P2b の各 batch で selector を確定していく。

- [ ] **Step 3: typecheck を確認**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error

- [ ] **Step 4: コミット（E2E は CI gate で実行。P2a では placeholder selector のため fail 想定）**

```bash
cd tastile-web
git add tests/e2e/ds-v2-compliance.spec.ts
git commit -m "test(e2e): add ds-v2-compliance Playwright spec"
```

注意: P2a commit 後、`bun run test:e2e` は placeholder selector のため FAIL する可能性がある。これは想定内 — P2b 各 batch の implementer が selector を確定 + page を実際に sweep した時点で green する。Task 9 の P2a 最終 verification では `test:e2e` を SKIP して OK とする（gate として有効化するのは P2b Batch 1 完了後）。

---

## Task 9: P2a 最終 verification

**Files:** なし（read-only）

- [ ] **Step 1: typecheck を確認**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error

- [ ] **Step 2: lint を確認（新 3 rules + P1 2 rules）**

Run: `cd tastile-web && bun run lint`
Expected: 0 error（P2a は新規 tsx を追加しないため firing 対象なし）

- [ ] **Step 3: check-theme-coverage (P1) を確認**

Run: `cd tastile-web && bun scripts/check-theme-coverage.mts`
Expected: `OK: all 6 theme selectors present`

- [ ] **Step 4: mantine-theme.test を確認**

Run: `cd tastile-web && bun test src/lib/theme/__tests__/mantine-theme.test.ts`
Expected: 26 pass (P1: 17 + P2: 9), 0 fail

- [ ] **Step 5: ESLint fixture test を確認**

Run: `cd tastile-web && node --test eslint-local-rules/__tests__/`
Expected: 8 pass (P1: 4 + P2: 4), 0 fail

- [ ] **Step 6: check-ds-coverage の baseline を記録**

Run: `cd tastile-web && bun scripts/check-ds-coverage.mts 2>&1 | tee /tmp/p2a-baseline.txt`
Expected: 100+ 違反。この baseline を `.superpowers/sdd/p2-ds-v2-application/p2a-baseline.txt` に保存（P2b で各 batch が 0 に向けた進捗を計測する）。

- [ ] **Step 7: 16 pre-existing uncommitted diff が unchanged であることを確認**

Run: `cd tastile-web && git status --short | grep -E "^ M|^ D" | wc -l`
Expected: 16（pre-existing diff が変わっていないことの sanity check）

- [ ] **Step 8: ledger 更新**

`/c/Users/rebui/Desktop/tastile/.superpowers/sdd/p2-ds-v2-application/progress.md` を新規作成し、Task 1-9 の結果（commit SHA、test count、baseline violation count）を記録。

- [ ] **Step 9: P2a done 報告**

Run: `echo "P2a complete: 9 commits, 26+8 tests pass, baseline violations recorded"`

---

## Task 10-30: P2b sweep

各 task は「DS v2 Sweep 変換パターン」セクションのパターンに従う。各 task implementer は:

1. 対象 file の list を受け取る
2. 各 file に対して変換ルールを適用（`shadow=*` 削除 / `withBorder` 削除 / `border-*` whitelist 外 削除 / `bg-surface-elevated` → `bg-surface-1`）
3. 構造分離が必要な場合は「構造分離のフォールバック」セクション参照
4. 各 file commit（per-file commit が望ましいが、widget 単位でも OK）
5. batch 末で `bun scripts/check-ds-coverage.mts` を実行し、違反数が baseline から減少していることを確認

### Task 10: ActivityBar sweep

**Files:**
- Modify: `tastile-web/src/widgets/activity-bar/ui/ActivityBar.tsx`
- Modify: `tastile-web/src/widgets/activity-bar/ui/ActivityBar.test.tsx`（test 内で border / shadow を assertion している箇所があれば除去）

**変換対象:**
- `<Divider className="mx-2 my-2 shrink-0 border-border" />` → border-border 削除
- `<Menu shadow="lg">` → shadow 削除
- `<Menu.Dropdown className="border-border bg-surface-elevated">` → `bg-surface-1`、border-border 削除

### Task 11: AppShell + 7 sub-components sweep

**Files:**
- Modify: `tastile-web/src/widgets/app-shell/ui/AppShell.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/Header.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/LeftTabs.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/MobileBottomTabs.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/RightSidebar.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/TimelineAxis.tsx`

注意: `AppShell.tsx` とその sub-components は P2 開始時点（HEAD = `2fe12684`）で pre-existing uncommitted diff に含まれる。`git diff src/widgets/app-shell/` で現状を確認し、sweep 対象行が uncommitted diff 部分に重なる場合は reviewer に相談。

**変換対象:**
- `bg-surface-elevated` → `bg-surface-1`（containers / header / sidebar）
- `rounded-xl` 維持（DS v2 許容）
- border / shadow がない file は noop

### Task 12: Header + AccountMenu/ActiveExecutionBar/GlobalPromptBanner sweep

**Files:**
- Modify: `tastile-web/src/widgets/app-shell/ui/Header.tsx`（Task 11 で touch 済みなら skip）
- Modify: `tastile-web/src/widgets/app-shell/ui/AccountMenu.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/ActiveExecutionBar.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/GlobalPromptBanner.tsx`

**変換対象:**
- `bg-surface-elevated` → `bg-surface-1`
- `soft: "bg-surface-elevated"` in GlobalPromptBanner variants → `bg-surface-1`
- AccountMenu の `focus:outline-none focus:ring-2 focus:ring-foreground/20` は **P2c** で扱う（Task 31）。Task 12 では touch しない。

### Task 13: LeftTabs/MobileBottomTabs/RightSidebar/TimelineAxis sweep

**Files:**
- Modify: `tastile-web/src/widgets/app-shell/ui/LeftTabs.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/MobileBottomTabs.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/RightSidebar.tsx`
- Modify: `tastile-web/src/widgets/app-shell/ui/TimelineAxis.tsx`

**変換対象:**
- `bg-surface-elevated` → `bg-surface-1`
- border なし（task 11 で完了済み想定）

### Task 14: Batch 1 verification

- [ ] `bun run lint` → 0
- [ ] `bun run typecheck` → 0
- [ ] `bun test src/widgets/activity-bar/` → pass
- [ ] `bun test src/widgets/app-shell/` → pass
- [ ] `bun scripts/check-ds-coverage.mts` → 前 baseline から違反数が減少
- [ ] `bun run test:e2e` → placeholder selector が AppShell に match する範囲で green

### Task 15: FloatingHeader + ExecutionControls sweep

**Files:**
- Modify: `tastile-web/src/widgets/floating-header/ui/FloatingHeader.tsx`
- Modify: `tastile-web/src/widgets/floating-header/ui/ExecutionControls.tsx`

**変換対象:**
- `bg-surface-0 border-b border-border` → `bg-surface-0`（border 削除、surface の段差で分離）
- `border-b border-border` → 削除
- FloatingHeader 内 `bg-surface-elevated` があれば → `bg-surface-1`

### Task 16: SideToolPanel sweep

**Files:**
- Modify: `tastile-web/src/widgets/side-tool-panel/ui/SideToolPanel.tsx`

**変換対象:**
- `"border-r border-border bg-surface-0"` → `"bg-surface-0"` + 親要素に `bg-surface-1` を追加し構造分離
- もしくは `"bg-surface-1"` に統一（surface 段差で右サイドバーであることを示す）

### Task 17: Batch 2 verification

- [ ] `bun run lint` → 0
- [ ] `bun run typecheck` → 0
- [ ] `bun test src/widgets/floating-header/` → pass
- [ ] `bun test src/widgets/side-tool-panel/` → pass
- [ ] `bun scripts/check-ds-coverage.mts` → 違反数減少
- [ ] `bun run test:e2e` → green（FloatingHeader / SideToolPanel の selector が spec に追加されていれば）

### Task 18: create-tile sub-panels sweep (6 files)

**Files:**
- Modify: `tastile-web/src/features/create-tile/ui/CompletionSubPanel.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/ConditionPanel.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/DurationSubPanel.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/EventDetailsSubPanel.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/IntentSubPanel.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/MetaSubPanel.tsx`

### Task 19: create-tile components sweep (7 files)

**Files:**
- Modify: `tastile-web/src/features/create-tile/ui/BehaviorPreview.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/ConditionEditor.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/EssentialRow.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/FieldRow.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/PanelErrorBanner.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/ProjectPicker.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/QuickCreate.tsx`

**変換対象:**
- `border-border` → 削除（BehaviorPreview で多用）
- `border-border/30` `border-border/50` → 削除
- `border-l border-border/20` → 削除（timeline progress 表示）

### Task 20: create-tile modals + flow + remaining sweep

**Files:**
- Modify: `tastile-web/src/features/create-tile/ui/CreateProjectModal.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/FlowSequencePanel.tsx`
- Modify: `tastile-web/src/features/create-tile/ui/PlacementRulesPanel.tsx`
- その他 create-tile/ui/ 配下の残り file

### Task 21: Batch 3 verification

- [ ] `bun run lint` → 0
- [ ] `bun run typecheck` → 0
- [ ] `bun test src/features/create-tile/` → pass
- [ ] `bun scripts/check-ds-coverage.mts` → 違反数減少（target: 50% 以下）
- [ ] `bun run test:e2e` → create-tile page で green

### Task 22: manage-projects sweep (~10 files)

**Files:** `src/features/manage-projects/ui/*.tsx` 全 file

### Task 23: manage-schedule sweep (~15 files)

**Files:** `src/features/manage-schedule/ui/*.tsx` 全 file

### Task 24: manage-tasks sweep (~15 files)

**Files:** `src/features/manage-tasks/ui/*.tsx` 全 file

### Task 25: manage-settings sweep (~10 files)

**Files:** `src/features/manage-settings/ui/*.tsx` 全 file

### Task 26: marketing sweep (~15 files)

**Files:** `src/features/marketing/**/*.tsx` 全 file

### Task 27: execute-tile sweep (~10 files)

**Files:** `src/features/execute-tile/**/*.tsx` 全 file

### Task 28: view-notifications sweep (~5 files)

**Files:** `src/features/view-notifications/**/*.tsx` 全 file

### Task 29: views/dashboard sweep (~25 files)

**Files:** `src/views/dashboard/**/*.tsx` 全 file（page-client.tsx, components, etc.）

注意: `src/app/dashboard/**`（P2 開始時点で pre-existing uncommitted diff）は触らない。`src/views/dashboard/**` のみ。

### Task 30: Batch 4 verification — STRICT 0-violation gate

- [ ] `bun run lint` → **0** (strict, no warn)
- [ ] `bun run typecheck` → 0
- [ ] `bun run knip` → 0
- [ ] `bun test src/features/` → pass
- [ ] `bun scripts/check-ds-coverage.mts` → **OK: 0 violations**
- [ ] `bun run test:e2e` → green（全 page で box-shadow === 'none', border-width === '0px'）
- [ ] `bun run check:release` → 0 error / 0 warning

---

## Task 31: `:focus-visible` + `--focus-ring` を全 interactive に適用

**Files:**
- Modify: 既存 `focus:ring-2 focus:ring-foreground/20` 等の focus utility を含む全 file
- 主な対象: `src/widgets/app-shell/ui/AccountMenu.tsx` 等

**Interfaces:**
- Consumes: Task 1 で追加した `--focus-ring` / `--focus-ring-offset` / `--focus-ring-color` token
- Produces: 全 interactive element が `:focus-visible` で `outline: 2px var(--focus-ring-color); outline-offset: var(--focus-ring-offset);` を表示

- [ ] **Step 1: `focus:ring` を含む file を grep**

Run: `cd tastile-web && grep -rlE "focus:ring" src/widgets src/features src/views --include="*.tsx"`
Expected: 数 file（AccountMenu 等）

- [ ] **Step 2: 各 file を `focus:outline-none focus:ring-2 focus:ring-foreground/20` から `focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-[var(--focus-ring-offset)]` に置換**

例: `AccountMenu.tsx` の button className 内の focus utility を置換。

- [ ] **Step 3: tailwind.config で `focus-visible` variant が enabled であることを確認**

Tailwind v4 は `focus-visible` を native サポート。追加設定不要。

- [ ] **Step 4: typecheck を確認**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 error

- [ ] **Step 5: コミット**

```bash
cd tastile-web
git add src/widgets/app-shell/ui/AccountMenu.tsx ... (該当 file 一覧)
git commit -m "feat(focus): apply :focus-visible + --focus-ring to interactive elements"
```

---

## Task 32: Playwright focus assertion

**Files:**
- Modify: `tastile-web/tests/e2e/ds-v2-compliance.spec.ts`（focus assertion 追加）

- [ ] **Step 1: focus assertion を spec に追加**

`tests/e2e/ds-v2-compliance.spec.ts` に以下を追加:

```typescript
test.describe('DS v2 focus indicator', () => {
  test('Tab navigation produces visible :focus-visible outline', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus-visible').first();
    const outlineWidth = await focused.evaluate((e) => getComputedStyle(e).outlineWidth);
    const outlineColor = await focused.evaluate((e) => getComputedStyle(e).outlineColor);
    expect(outlineWidth).toBe('2px');
    expect(outlineColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('Button receives :focus-visible outline on Tab', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('button').first().focus();
    const outlineWidth = await page.locator('button').first().evaluate((e) => getComputedStyle(e).outlineWidth);
    expect(outlineWidth).toBe('2px');
  });
});
```

- [ ] **Step 2: test:e2e を実行**

Run: `cd tastile-web && bun run test:e2e -- ds-v2-compliance`
Expected: 5 pass (P2a: 3 + P2c: 2), 0 fail

- [ ] **Step 3: コミット**

```bash
cd tastile-web
git add tests/e2e/ds-v2-compliance.spec.ts
git commit -m "test(e2e): add focus-visible outline assertions to ds-v2-compliance"
```

---

## Task 33: P2c + P2 最終 verification

**Files:** なし（read-only）

- [ ] **Step 1: 全 gate を最終確認**

| Gate | Command | Expected |
|---|---|---|
| typecheck | `bun run typecheck` | 0 error |
| lint (P1 + P2 全 5 rules) | `bun run lint` | 0 error |
| lint:theme (P1) | `bun scripts/check-theme-coverage.mts` | OK |
| lint:ds (P2) | `bun scripts/check-ds-coverage.mts` | OK: 0 violations |
| mantine-theme.test | `bun test src/lib/theme/__tests__/mantine-theme.test.ts` | 26 pass |
| knip | `bun run knip` | 0 error |
| test:unit | `bun run test:unit` | pass (P2 関連 test 全て green) |
| test:e2e | `bun run test:e2e` | ds-v2-compliance 5 pass |
| check:release | `bun run check:release` | 0 error / 0 warning |

- [ ] **Step 2: 16 pre-existing uncommitted diff が unchanged であることを確認**

Run: `cd tastile-web && git status --short | grep -E "^ M|^ D" | wc -l`
Expected: 16

- [ ] **Step 3: P2 done 報告**

ledger に P2 完了記録を追加。`/c/Users/rebui/Desktop/tastile/.superpowers/sdd/p2-ds-v2-application/progress.md` の最終エントリ。

- [ ] **Step 4: ship-ready 判定**

全 gate が PASS の場合、P2 は ship-ready。`bun run check:release` の最終 exit 0 が完了基準。

---

## Self-Review Checklist

実装着手前（P2 plan 作成完了時点）に以下を確認:

- [x] **Spec coverage**: 5 goal (DS v2 sweep / CI gate / Mantine override / focus redesign / Playwright E2E) → Task 1-33 で全てカバー
- [x] **Placeholder scan**: "TBD" / "TODO" なし。`*` で示された file は grep で確認可能な範囲
- [x] **Type consistency**: Task 2 の `Menu.extend` / `Popover.extend` の構造は Mantine v9 の compound component API に整合（P1 でも `Card.extend` を使用、同一パターン）
- [x] **File ownership disjointness**: Task 1-9 は ESLint rule / theme file / script を disjoint に touch。Task 10-30 は widget / feature / views の surface を disjoint に touch。Task 31-32 は focus redesign の surface を touch。
- [x] **pre-existing uncommitted diff への非干渉**: `src/widgets/app-shell/**` `src/shared/**` `src/app/dashboard/**` 等の pre-existing file は touch しない方針（Task 11/29 に注意書きあり）
