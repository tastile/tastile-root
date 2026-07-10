# FloatingMenu リデザイン計画

## 概要

既存の `DropdownMenu.tsx`（Radix不使用の純React版）を廃止し、Web Componentパターンを模倣した
新しい `FloatingMenu` コンポーネントシステムで全フローティングメニューを置き換える。

## 対象コンポーネント

| 既存ファイル | 移行先 | 影響範囲 |
|---|---|---|
| `components/ui/DropdownMenu.tsx` | `components/ui/floating-menu/FloatingMenu.tsx` | 廃止・置き換え |
| `components/shell/FloatingHeader.tsx` | 同上（内部参照を更新） | アバターメニュー |
| `app/app/account-menu.tsx` | 同上（内部参照を更新） | PWAアカウントメニュー |
| `components/notifications/NotificationsDropdown.tsx` | 同上（内部参照を更新） | 通知ドロップダウン |

## 新コンポーネント構成

```
src/components/ui/floating-menu/
├── FloatingMenu.tsx          # 複合コンポーネント本体
├── FloatingMenu.module.css   # スコープ付きスタイル
└── index.ts                  # バーレルエクスポート
```

## コンポーネントAPI

```tsx
import {
  FloatingMenu,
  FloatingMenuTrigger,
  FloatingMenuContent,
  FloatingMenuItem,
  FloatingMenuLabel,
  FloatingMenuSeparator,
} from "@/components/ui/floating-menu";

// 使い方
<FloatingMenu>
  <FloatingMenuTrigger asChild>
    <button>メニュー</button>
  </FloatingMenuTrigger>
  <FloatingMenuContent align="end">
    <FloatingMenuLabel>ユーザーメニュー</FloatingMenuLabel>
    <FloatingMenuSeparator />
    <FloatingMenuItem onSelect={() =>}>設定</FloatingMenuItem>
    <FloatingMenuItem onSelect={() =>}>ログアウト</FloatingMenuItem>
  </FloatingMenuContent>
</FloatingMenu>
```

## DOM構成（Web Componentパターン）

### Trigger
```html
<button
  data-floating-menu-trigger
  data-state="open|closed"
  aria-haspopup="menu"
  aria-expanded="true|false"
>
  {children}
</button>
```

### Content（Portal → document.body）
```html
<div
  data-floating-menu-content
  data-state="open|closed"
  data-align="start|end|center"
  role="menu"
  style="position: absolute; top: ...px; left: ...px;"
>
  {children}
</div>
```

### Item
```html
<button
  data-floating-menu-item
  data-disabled
  role="menuitem"
  tabindex="0|-1"
>
  {children}
</button>
```

### Label / Separator
```html
<div data-floating-menu-label>...</div>
<hr data-floating-menu-separator />
```

## CSS Module設計

```css
/* FloatingMenu.module.css */

/* Content: ポータル内のフローティングパネル */
.content {
  position: absolute;
  z-index: 50;
  min-width: 8rem;
  overflow: hidden;
  border-radius: var(--radius-xl);
  background: var(--surface-elevated);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-control-compact);
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
  transition: opacity 150ms ease, transform 150ms ease;
  pointer-events: none;
}

.content[data-state="open"] {
  opacity: 1;
  transform: scale(1) translateY(0);
  pointer-events: auto;
}

/* Item: メニュー項目 */
.item {
  display: flex;
  width: 100%;
  cursor: default;
  align-items: center;
  gap: 0.5rem;
  border-radius: var(--radius-sm);
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  color: var(--foreground);
  outline: none;
  transition: background-color 100ms ease;
  user-select: none;
}

.item:hover,
.item[data-focus] {
  background: var(--surface-2);
}

.item[data-disabled] {
  pointer-events: none;
  opacity: 0.5;
}

/* Label */
.label {
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  color: var(--foreground-muted);
}

/* Separator */
.separator {
  margin: 0.25rem 0;
  height: 1px;
  border: none;
  background: var(--border);
}
```

## キーボードナビゲーション

| キー | アクション |
|---|---|
| `Enter` / `Space` | フォーカス中の項目を選択 |
| `Escape` | メニューを閉じる |
| `ArrowDown` | 次の項目にフォーカス移動 |
| `ArrowUp` | 前の項目にフォーカス移動 |
| `Home` | 最初の項目にフォーカス |
| `End` | 最後の項目にフォーカス |

## ビューポート境界検出

Content の表示前に trigger の `getBoundingClientRect()` と
ビューポートサイズ (`window.innerWidth`, `window.innerHeight`) を比較し、
はみ出す場合は配置を反転させる。

```ts
function computePlacement(
  trigger: DOMRect,
  content: DOMRect,
  align: "start" | "end" | "center",
  sideOffset: number
): { top: number; left: number }
```

## 移行手順

1. `FloatingMenu.tsx` + `FloatingMenu.module.css` + `index.ts` を作成
2. `FloatingHeader.tsx` の `DropdownMenu` → `FloatingMenu` に変更
3. `account-menu.tsx` の DOM を `FloatingMenu` ベースに書き換え
4. `NotificationsDropdown.tsx` を `FloatingMenu` ベースに書き換え
5. `DropdownMenu.tsx` を削除
6. 他のDropdownMenu参照を洗い出し移行
7. ビルド・テスト確認
