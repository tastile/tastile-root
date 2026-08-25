# P2: Design System v2 Application — Design

| | |
|---|---|
| 日付 | 2026-08-25 |
| 親プロジェクト | UI 徹底改善（A〜E 全範囲） |
| 位置 | ロードマップ 8 フェーズ中の **Phase 2 (Sweep)** — P1 の上に乗る |
| スコープ | `tastile-web` リポジトリのみ |
| Repository 状態 | main ブランチ、P1 で 12 commits stacked済み、uncommitted diff 16 files（他タスク由来、本 PR では触らない） |
| 完了基準 | `bun run check:release` を 0 error / 0 actionable warning で通過。新 ESLint 3 rules と Playwright DS assertion suite が CI gate として機能 |

## Background / Motivation

P1 で DS v2 token plumbing は敷設済み（`designTokens` map、Mantine 8 component の defaultProps、6 テーマセレクタ、ESLint 2 custom rules、29 P1-introduced tests）。一方、`src/widgets/**` `src/features/**` `src/views/**` の 150 tsx ファイルは依然として:

- `shadow="lg"` 等の Mantine `shadow` prop を直接指定（97 件 / 41 files）
- `border-border` / `border-border/30` 等の Tailwind border utility を多用（DS v2 違反）
- `bg-surface-elevated` という P1 token map に存在しない非 token クラスを多用
- focus indicator に `focus:ring-2 focus:ring-foreground/20`（DS v2 は「ring も境界」、a11y 緊張）

→ P1 で token が整流されても、consumer 層が旧表記のままなので **DS v2 の視覚的アウトプットは実現していない**。P2 で consumer 層を一掃し、strict 0-violation gate を敷設する。

加えて DS v2 の「no border」は a11y と緊張する。`focus:ring-2` 自体が ring であり、ring を消すと keyboard user が focus を失う。WCAG 2.2 SC 2.4.11 (Focus Not Obscured) と SC 2.4.7 (Focus Visible) は **focus indicator の存在と可読性を要求**する。P2 はこの緊張を `:focus-visible` + `--focus-ring` token で解消する。

## 目標 (Goals)

1. **全 UI surface を DS v2 化** — `src/widgets/**` `src/features/**` `src/views/**` の 150 tsx から `shadow=*` `withBorder` `border-*`（whitelist 除く） `bg-surface-elevated` を全廃
2. **Strict 0-violation CI gate** — 新 ESLint 3 rules + `check-ds-coverage.mts` を `bun run check` に組み込み、違反 1 件で release gate fail
3. **Mantine 内部 surface の全面 override** — Menu / Popover / Tooltip / HoverCard / Notification / Select / Combobox / Pills / Chip 等、P1 で未着手だった Mantine v9 内部 component の defaultProps を拡張
4. **focus indicator の DS v2 整合 redesign** — `:focus-visible` + `--focus-ring` token（`outline: 2px var(--primary); outline-offset: 2px`）を全 interactive element に適用
5. **Playwright E2E で computed-style assertion** — 主要 page で `box-shadow === 'none'` `border-width === '0px'` `outline-width === '2px'` を検証

## 非目標 (Non-Goals)

- 新規 page / widget 追加
- i18n 関連（**P3 / C スコープ**）
- アクセシビリティ監査の網羅（focus / focus-visible のみ。ARIA / screen reader / contrast は P7）
- パフォーマンス改善（**P7**）
- Mantine バージョン bump
- Visual regression 基盤（snapshot diff は P3 以降の選択肢。本 P2 は computed-style assertion のみ）
- `src/lib/vendored/mantine-schedule` への介入（Knip ガード対象）
- 16 pre-existing uncommitted diff の file への介入

## Architecture

### 3 sub-phase decomposition

```
P2a (Foundation: Gates before sweep)
  ├─ mantine-theme.ts: Menu/Popover/Tooltip/HoverCard/Notification/Select/Combobox/Pills/Chip を defaultProps 拡張
  ├─ globals.css: --focus-ring token を :root + 6 theme override に追加
  ├─ eslint-local-rules/no-mantine-shadow.mjs: 新規
  ├─ eslint-local-rules/no-mantine-border.mjs: 新規
  ├─ eslint-local-rules/no-token-violations.mjs: 新規
  ├─ eslint.config.mts: 3 rules を 'error' で登録
  ├─ scripts/check-ds-coverage.mts: 新規
  ├─ tests/e2e/ds-v2-compliance.spec.ts: 新規
  └─ package.json: lint:ds / test:e2e 登録

P2b (Sweep: 150 tsx を 4 batch で掃討)
  ├─ Batch 1: Shell (AppShell, Header, AccountMenu, ActiveExecutionBar,
  │            GlobalPromptBanner, LeftTabs, MobileBottomTabs,
  │            RightSidebar, TimelineAxis, ActivityBar) — ~10 files
  ├─ Batch 2: Floating widgets (FloatingHeader, ExecutionControls,
  │            SideToolPanel) — ~5 files
  ├─ Batch 3: Create tile feature — ~30 files
  └─ Batch 4: Remaining (manage-projects, manage-schedule, manage-tasks,
               manage-settings, marketing, execute-tile, view-notifications,
               views/dashboard/*) — ~105 files

P2c (Focus: A11y redesign)
  ├─ :focus-visible + --focus-ring を全 interactive に適用
  ├─ Playwright assertion: Tab 後の outline-width === '2px'
  └─ Optional: prefer-focus-visible ESLint rule
```

### Token / class mapping table（P2b で使用）

| 旧表記 | 新表記 | 備考 |
|---|---|---|
| `bg-surface-elevated` (AppShell containers) | `bg-surface-1` | container layer |
| `bg-surface-elevated` (FloatingHeader) | `bg-surface-1` | container layer |
| `bg-surface-elevated` (RightSidebar) | `bg-surface-1` | container layer |
| `border-border` | 削除 | DS v2 = no border |
| `border-border/30` `border-border/50` `border-border/20` | 削除 | DS v2 = no border |
| `border-b border-border` (section divider) | 削除 → spacing のみ | 構造分離 |
| `border-r border-border` (LeftTabs sidebar) | 削除 → surface-1 bg + 影なし | 構造分離 |
| `border-border` on inputs | 削除 → bg contrast | DS v2 哲学 |
| `border-l border-border/20` (timeline axis) | 削除 → bg-surface-2 | surface elevation |
| `shadow="lg"` (Menu/Popover) | 削除（P2a で defaultProps nullify 済み） | グローバル |
| `shadow="xl"` (modal) | 削除 | P2a で nullify |
| `shadow` (任意) | 削除 | 新 ESLint rule |
| `withBorder` / `withBorder={true}` | 削除 | 新 ESLint rule |
| `focus:ring-2 focus:ring-foreground/20` | `focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2` | P2c で適用 |
| `border-0` `border-collapse` `border-spacing` `border-transparent` | **保持** | whitelist（reset / table 用途） |

### Mantine 内部 surface override（P2a で拡張）

P1 で defaultProps を設定したのは:
Card / Paper / Modal / Drawer / Divider / Button / ActionIcon / Input（8 component）

P2a で追加:
- **Menu** → `Menu.Dropdown`: `withBorder: false, shadow: undefined, radius: 'md'`
- **Popover** → `Popover.Dropdown`: 同上
- **Tooltip** → `Tooltip`: `withBorder: false, shadow: undefined, radius: 'sm'`
- **HoverCard** → `HoverCard.Dropdown`: 同上
- **Notification** → `Notification`: `withBorder: false, shadow: undefined, radius: 'md'`
- **Select** → `Select`: `withBorder: false`（Select は内部 input を持つため shadow なし、radius md）
- **Combobox** → `Combobox`: `withBorder: false, shadow: undefined`
- **Pills** → `Pills.Pill`: `radius: 'full'`（既存維持）
- **Chip** → `Chip`: `withBorder: false, variant: 'light'`（DS v2 = light variant）

これにより P2b で個別 component から shadow / withBorder を指定する必要がなくなる。

### `--focus-ring` token（P2a で追加）

```css
:root {
  /* ... existing tokens ... */
  --focus-ring: 2px;       /* outline-width */
  --focus-ring-offset: 2px; /* outline-offset */
  --focus-ring-color: var(--primary);
}

.dark,
.theme-dark,
.theme-dark-black,
.theme-dark-gray,
.theme-gray {
  --focus-ring-color: var(--primary);  /* 同一色: contrast は primary 自身の dark variant で確保 */
}
```

Tailwind v4 は `focus-visible:outline-[var(--focus-ring)]` 等で参照可能（`@theme inline` ブロックへの露出は P1 パターン踏襲）。

### 触る / 作成するファイル

#### 新規

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
| `tastile-web/src/lib/theme/__tests__/mantine-theme.test.ts` (拡張) | P2a 追加分の defaultProps pin |

#### 編集

| ファイル | 変更内容 |
|---|---|
| `tastile-web/src/lib/theme/mantine-theme.ts` | Menu / Popover / Tooltip / HoverCard / Notification / Select / Combobox / Pills / Chip を defaultProps 追加 |
| `tastile-web/src/app/globals.css` | `--focus-ring` / `--focus-ring-offset` / `--focus-ring-color` token 追加、6 theme override |
| `tastile-web/eslint.config.mts` | 3 新 rules を 'error' で登録 |
| `tastile-web/package.json` | `lint:ds`, `test:e2e` script 登録（既存 test:e2e を拡張） |
| `tastile-web/tests/e2e/ds-v2-compliance.spec.ts` | 主要 page (dashboard, timeline view, create tile, app shell) で `box-shadow === 'none'` `border-width === '0px'` を assertion |
| `tastile-web/src/widgets/**/*.tsx` (Batch 1) | DS v2 適用 |
| `tastile-web/src/widgets/floating-header/ui/*.tsx` (Batch 2) | DS v2 適用 |
| `tastile-web/src/widgets/side-tool-panel/ui/*.tsx` (Batch 2) | DS v2 適用 |
| `tastile-web/src/features/create-tile/ui/*.tsx` (Batch 3) | DS v2 適用 |
| `tastile-web/src/features/manage-*/ui/*.tsx` (Batch 4) | DS v2 適用 |
| `tastile-web/src/features/marketing/**/*.tsx` (Batch 4) | DS v2 適用 |
| `tastile-web/src/features/execute-tile/**/*.tsx` (Batch 4) | DS v2 適用 |
| `tastile-web/src/features/view-notifications/**/*.tsx` (Batch 4) | DS v2 適用 |
| `tastile-web/src/views/dashboard/**` (Batch 4) | DS v2 適用 |

## Global Constraints

P1 Global Constraints を継承（AGENTS.md invariants / `main` のみ / worktree 禁止 / 他タスク由来 uncommitted diff に触らない / 依存追加禁止 / i18n literal 追加禁止 / `src/lib/vendored/mantine-schedule` 不可触 / `eslint.config.mts` の `ignore` に新規 directory 追加禁止 / 完了基準 `bun run check:release` 0 error / 0 actionable warning）。

P2 固有の追加制約:

- **3 batch の独立性** — P2b Batch 1〜4 はそれぞれ独立 commit / 独立 ship-ready を維持。各 batch 末で ESLint 0 / typecheck 0 / Playwright DS assertion green を満たす
- **新 ESLint rule は既存 P1 パターン踏襲** — `eslint-local-rules/*.mjs` + `__tests__/*.test.mjs` 形式で `node --test` で unit test する。`no-unknown-css-var-in-tokens` / `no-inline-css-var-override` の構造を踏襲
- **whitelist は最小限** — `border-0` / `border-collapse` / `border-spacing` / `border-transparent` のみ許可。whitelist の追加は spec amendment 扱い
- **focus redesign は P2c で独立 phase** — P2b の sweep 中に focus を触らない。P2b は shadow / border / bg のみ
- **batch 内の commit message は英語** — `feat(shell): remove borders from app-shell containers` 等

## Verification

各 sub-phase 末で以下を満たす:

| Gate | P2a | P2b (各 batch) | P2c |
|---|---|---|---|
| 新 ESLint 3 rules firing | 0 in own files | 0 in all tsx | 0 in all tsx |
| `bun run typecheck` | 0 error | 0 error | 0 error |
| `bun run lint:ds` (`check-ds-coverage.mts`) | OK | OK | OK |
| `bun run lint:theme` (P1 script) | OK | OK | OK |
| `bun test src/lib/theme/__tests__/mantine-theme.test.ts` | pass (新 component 含む) | pass | pass |
| `bun run test:e2e` (`ds-v2-compliance.spec.ts`) | green | green | green |
| `bun run check:release` | 0 error / 0 warning | 0 error / 0 warning | 0 error / 0 warning |

加えて:

- 各 batch 末で main branch の `git status --short` を確認し、16 pre-existing modified files が unchanged であることを verify
- Playwright visual smoke: dashboard / timeline / create-tile 各 page の screenshot を manual で確認（visual regression 基盤は P3 以降）

## Known Risks

1. **Surface token mapping の文脈依存** — `bg-surface-elevated` → surface-1/2/3 の mapping は file-by-file で判断が必要。mapping table は initial draft、batch 進行中に refine する
2. **Dark mode parity** — 6 テーマセレクタ全てに `--focus-ring` 等が cascade されることを `check-theme-coverage.mts` (P1) + `check-ds-coverage.mts` (P2) で guarantee
3. **Mantine 未監査 component** — Accordion / Tabs / Slider / Stepper / ScrollArea が内部 shadow を持つ可能性。P2a implementer が survey し、必要なら defaultProps 追加
4. **150 files の一括 churn** — batch 分割で緩和するが、batch 4 (105 files) は大きい。途中で ESLint 違反が累積しないよう、各 batch 内は per-file commit + per-batch gate とする
5. **focus-visible の browser 互換** — 主要 browser は `:focus-visible` を native サポート（Safari 15.4+ / Chrome 86+ / Firefox 85+）。Mantine 9 はこれを採用。問題あれば `:focus` に fallback（ただし mouse click 時に focus ring が一瞬出る a11y regression を受容）
6. **Playwright `border-width === '0px'`** — `border-width` shorthand は computed style で `'0px'` を返す。`getComputedStyle(el).borderWidth === '0px'` で assertion する

## Out of Scope (Reaffirmed)

- `src/lib/vendored/mantine-schedule` (Knip guard)
- 16 pre-existing uncommitted files (別タスク由来)
- i18n literals (P3)
- 既存 focus ring を除く a11y 監査 (P7)
- Visual regression snapshot diff 基盤 (P3 以降)

## Done Criteria (再掲)

`bun run check:release` が 0 error / 0 actionable warning で通過し、以下の gate が全て green:

- `bun run lint` (新 ESLint 3 rules 含む): 0
- `bun run lint:ds` (check-ds-coverage.mts): OK
- `bun run lint:theme` (check-theme-coverage.mts, P1): OK
- `bun run typecheck`: 0 error
- `bun run knip`: 0 error（新 exports が全て used と判定）
- `bun run test:unit`: P2 関連 test 全 pass
- `bun run test:e2e` (`ds-v2-compliance.spec.ts` 含む): green
- `bun run build:prod`: success
- `bun audit --production --ignore=...`: 0 vulnerability (P1 の 4 ignore list 維持)
