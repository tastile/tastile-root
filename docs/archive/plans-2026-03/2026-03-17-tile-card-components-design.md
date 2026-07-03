# Tile Card Components Design

**Date:** 2026-03-17
**Status:** Approved for Implementation

## Overview

Tastile用の統一感のあるタイルカードコンポーネントシステムの設計。Pomodoroomでは1つのコンポーネントに全機能を詰め込んでいたが、Tastileでは用途ごとに独立したコンポーネントとして分離する。

## Design Principles

1. **用途ごとに独立したコンポーネント** - 複雑なprops分岐を避ける
2. **シンプルさ優先** - 必要最小限の情報表示
3. **バックエンド処理** - フロント側は薄く、ロジックはコアに任せる
4. **ステータスアイコン駆動** - アイコンクリックで主要アクションを実行

## Component Architecture

### 3つの独立コンポーネント

```
components/tiles/
├── TileCardCompact.tsx       # シンプル表示（サイドバー、ダッシュボード）
├── TileCardExpandable.tsx    # 展開可能（一覧表示）
├── TileCardDetailed.tsx      # 詳細表示（プロンプト融合）
├── shared/
│   ├── TileStatusIcon.tsx    # ステータスアイコン（共通）
│   ├── TileActionButtons.tsx # アクションボタン（共通）
│   └── LoadingCard.tsx       # ローディング表示
└── dialogs/
    ├── StartTileDialog.tsx   # 開始プロンプト
    ├── DeferTileDialog.tsx   # 先送り/中断ダイアログ
    └── DeleteTileDialog.tsx  # 削除確認
```

## Component Specifications

### 1. TileStatusIcon (共通)

**責務:** Tileのlifecycleに応じたアイコン表示とクリック処理

**Props:**
```typescript
interface TileStatusIconProps {
  lifecycle: TileLifecycle  // 'ready' | 'started' | 'done'
  onClick?: () => void
  disabled?: boolean
  size?: number
}
```

**アイコンマッピング (lucide-react):**
- `ready` → `Circle` (グレー)
- `started` → `CircleDot` (緑)
- `done` → `CheckCircle2` (プライマリカラー)

**動作:**
- `ready`: クリック → StartTileDialog表示 → 開始確認
- `started`: クリック → 無効（アクションボタンから操作）
- `done`: クリック → 無効

### 2. TileActionButtons (共通)

**責務:** Tileのlifecycleに応じたアクションボタン表示

**Props:**
```typescript
interface TileActionButtonsProps {
  tile: Tile
  variant: 'compact' | 'full'
  onStart?: (tileId: TileId) => void
  onComplete?: (tileId: TileId) => void
  onDefer?: (tileId: TileId) => void
  onInterrupt?: (tileId: TileId) => void  // 中断して先送り
  onEdit?: (tileId: TileId) => void
  onDelete?: (tileId: TileId) => void
}
```

**アクション構成:**

**Ready状態:**
- 開始（プライマリ）
- 先送り（次の開始時刻を設定）
- 編集
- 削除

**Started状態:**
- 完了（プライマリ）
- 中断して先送り（次の開始時刻を設定 + 新タスク生成）
- 編集
- 削除

**Done状態:**
- 削除のみ

**重要仕様:** 「一時停止」は存在しない。中断時は必ず次の開始時刻を定義し、内部的には新タスク生成と同義。

### 3. TileCardCompact

**用途:** サイドバー、ダッシュボード

**特徴:**
- 1行表示
- ステータスアイコン + タイトル + 時間のみ
- カード全体クリックで詳細遷移可能
- ステータスアイコンクリックでready→start

**Props:**
```typescript
interface TileCardCompactProps {
  tile: Tile
  loading?: boolean
  onStart?: (tileId: TileId) => void
  onClick?: (tile: Tile) => void
}
```

### 4. TileCardExpandable

**用途:** Tiles一覧、Execute一覧

**特徴:**
- クリックで展開/折りたたみ
- 閉じた状態：シンプル表示
- 展開状態：nextAction、タグ、フルアクションボタン
- ステータスアイコンクリックは展開を妨げない

**Props:**
```typescript
interface TileCardExpandableProps {
  tile: Tile
  loading?: boolean
  defaultExpanded?: boolean
  onStart?: (tileId: TileId) => void
  onComplete?: (tileId: TileId) => void
  onDefer?: (tileId: TileId) => void
  onInterrupt?: (tileId: TileId) => void
  onEdit?: (tileId: TileId) => void
  onDelete?: (tileId: TileId) => void
}
```

### 5. TileCardDetailed

**用途:** 詳細表示、プロンプト融合

**特徴:**
- 常に詳細を表示（展開不要）
- nextAction、doneDefinition、タグ、時間情報を表示
- プロジェクトとタグを視覚的に区別
- フルアクションボタンが常に表示
- 編集はQuickTileCreateパネルを呼び出し

**Props:**
```typescript
interface TileCardDetailedProps {
  tile: Tile
  loading?: boolean
  onStart?: (tileId: TileId) => void
  onComplete?: (tileId: TileId) => void
  onDefer?: (tileId: TileId) => void
  onInterrupt?: (tileId: TileId) => void
  onEdit?: (tileId: TileId) => void
  onDelete?: (tileId: TileId) => void
}
```

## Dialogs

### StartTileDialog

開始前のタスクをステータスアイコンクリックで開始する際のプロンプト。

**表示内容:**
- タイトル
- nextAction（存在する場合）
- キャンセル/開始ボタン

### DeferTileDialog

先送り・中断時に次の開始時刻を設定するダイアログ。

**Props:**
```typescript
interface DeferTileDialogProps {
  tile: Tile
  mode: 'defer' | 'interrupt'
  open: boolean
  onConfirm: (nextStartAt: Date) => void
  onCancel: () => void
}
```

**表示内容:**
- タイトル
- 次の開始時刻（日付 + 時刻入力）
- キャンセル/確認ボタン

## Utilities

### Formatters

```typescript
// lib/utils/tile-formatters.ts

function formatDuration(minutes: number | null, locale: 'ja' | 'en'): string
function formatDateTime(date: Date | null, locale: 'ja' | 'en'): string
```

### Style Constants

```typescript
export const TILE_CARD_STYLES = {
  base: "rounded-xl bg-surface-1 border border-surface-2 transition-colors",
  hover: "hover:bg-surface-2",
  padding: { compact: "p-3", comfortable: "p-3", detailed: "p-4" },
  gap: { compact: "gap-2", comfortable: "gap-3", detailed: "gap-4" },
  statusIcon: { size: { compact: 20, comfortable: 20, detailed: 24 } }
}

export const TILE_STATUS_COLORS = {
  ready: "text-foreground-muted",
  started: "text-green-500",
  done: "text-primary",
}
```

## Usage Examples

### RightSidebar (Next Tile)

```tsx
import { TileCardCompact } from '@/components/tiles/TileCardCompact'

<TileCardCompact
  tile={nextTile}
  loading={loading}
  onStart={onStartSuggested}
/>
```

### Tiles一覧ページ

```tsx
import { TileCardExpandable } from '@/components/tiles/TileCardExpandable'

{tiles.map(tile => (
  <TileCardExpandable
    key={tile.core.id}
    tile={tile}
    onStart={handleStart}
    onComplete={handleComplete}
    onDefer={handleDefer}
    onEdit={handleEdit}
    onDelete={handleDelete}
  />
))}
```

### Execute画面 (Ready Tiles)

```tsx
import { TileCardExpandable } from '@/components/tiles/TileCardExpandable'

{readyTiles.map(tile => (
  <TileCardExpandable
    key={tile.core.id}
    tile={tile}
    defaultExpanded={false}
    {...actions}
  />
))}
```

### タイル詳細画面（将来用）

```tsx
import { TileCardDetailed } from '@/components/tiles/TileCardDetailed'

<TileCardDetailed
  tile={tile}
  {...actions}
/>
```

## Translations

```typescript
tiles: {
  actions: {
    start: 'Start' | '開始',
    complete: 'Complete' | '完了',
    defer: 'Defer' | '先送り',
    interrupt: 'Interrupt' | '中断',
    edit: 'Edit' | '編集',
    delete: 'Delete' | '削除',
  },
  dialogs: {
    startTitle: 'Start Task' | 'タスクを開始',
    deferTitle: 'Defer Task' | 'タスクを先送り',
    interruptTitle: 'Interrupt Task' | 'タスクを中断',
    nextStartAt: 'Next start time' | '次の開始時刻',
    deleteConfirm: 'Are you sure?' | '本当に削除しますか？',
  },
  doneDefinition: 'Done when' | '完了条件',
  startAt: 'Start' | '開始',
  endAt: 'End' | '終了',
}
```

## Implementation Priority

1. **Phase 1:** 共通コンポーネント（TileStatusIcon, TileActionButtons, LoadingCard）
2. **Phase 2:** TileCardCompact（最小実装）
3. **Phase 3:** TileCardExpandable（一覧表示の主力）
4. **Phase 4:** ダイアログ（StartTileDialog, DeferTileDialog）
5. **Phase 5:** TileCardDetailed（詳細表示）
6. **Phase 6:** 既存コンポーネント置き換え（NextTileCard → TileCardCompact等）

## Success Criteria

- [ ] 3つのカードコンポーネントが独立して動作
- [ ] ステータスアイコンから開始・完了が実行可能
- [ ] 先送り・中断時に次の開始時刻を設定可能
- [ ] 既存のNextTileCard, tiles/page.tsx, execute/page.tsxを新カードで置き換え
- [ ] 日英両言語対応
- [ ] Tailwind v4スタイルで統一感のあるデザイン
