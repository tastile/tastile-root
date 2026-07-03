# tastile-web v7 → v1 Dashboard 完全移行設計

- **Status**: Draft (awaiting user review)
- **Date**: 2026-06-27
- **Author**: brainstorming session with user
- **Scope**: `tastile-web` のダッシュボード全体（22 ディレクトリ / 24 page.tsx ファイル：`api/`, `billing/`, `breaks/`, `calendar/[view]/`, `calendar/`, `events/`, `execute/`, `history/`, `integrations/`, `preferences/account/`, `preferences/general/`, `preferences/`, `projects/`, `prompts/`, `quota/`, `references/`, `runtime/`, `schedule/`, `tasks/`, `tiles/`, `timeline/`, root `page.tsx`）および付随するページを `tastile-core` v1 API に完全対応させ、v7 系の condition vectors モデル・`/commands/*` 旧エンドポイント・`lib/core/*` event-sourcing reducer・`lib/domain/tile.ts` を全面削除する。v1 4 Aggregate（Tile / Plan / Placement / Execution）+ 82 数値定数を UI から完全に制御可能にする。
- **Out of scope**: TileEdit ダイアログ（既存タイルの編集）/ Read Model 同期（derived views）/ Push 配送 UI / Decision Session UI / Mobile (`/app/*`) ルート / Billing & Stripe / Desktop installer manifest。

## 1. 背景と目的

`tastile-core` は 2026-06-24 に v1 era へ移行し、4 つの Aggregate、数値定数のみ、Window 第一級、ChangeSet の Key 構造、Condition AST、3 レイヤー解決を採用した。`tastile-web` のダッシュボードは依然として v7 系の以下を多用している：

- `src/lib/domain/tile.ts`（condition vectors 7 層モデル、30+ importer）
- `src/lib/api/endpoints.ts`（`/commands/tile/create` 等、13+ importer）
- `src/lib/core/{command,event,state,validate,handler,reducer}/*`（event-sourcing reducer 群）
- `src/lib/hooks/use-execution-engine.ts`（存在しない import を参照する stub）
- `src/components/tiles/QuickTileCreate.tsx` 以外の UI コンポーネント（v7 スキーマ前提）

これにより、v1 で獲得した Window 第一級化・ChangeSet・Condition AST の表現力をダッシュボードから触れず、v7 と v1 が二重に並ぶ形になっている。CLAUDE.md が絶対禁止する `_old/` ディレクトリ・`kind` discriminator・derived state の保存も各所で残っている。

本設計は、v1 のみが動く状態にダッシュボードを完全移行し、旧 v7 ファイルを一切残さないことを目的とする。フラグ分岐・並行運用・旧版への切替は一切作らない。

### 設計の絶対条件

1. **v1 のみ動作**。v7 系のエンドポイント・型・モデル・ファイルを残さない。フラグ分岐・並行運用・旧版への切替は **一切作らない**（CLAUDE.md / CORE_POLICY 整合）
2. **ダッシュボード全 22 ディレクトリ / 24 page.tsx + 関連ページ（landing / login / billing / downloads）を v1 に統一**
3. **TanStack Query + Server Components 設計**（P-1）。Server Component で初期データ取得、Client Component は Query 経由で再取得
4. **Single shared zustand Store**（`QuickCreateStore` at `src/lib/stores/quick-create-store.ts`）を継続使用。新規追加の Slice は作らない。TanStack Query はキャッシュ専用、フォーム入力状態は zustand 側に集約
5. **`tastile-core` との通信層は v1 envelope に統一**（`expectedRevision` / `idempotencyKey` / `occurredAt` / `payload`）。`actor` はサーバ側決定
6. **数値定数のみ**。UI 内部で文字列 enum・kind discriminator を発散させない。`src/lib/api/v1-constants.ts` に集約
7. **アイコン + 最小ラベル** 原則（lucide-react）。画面内の説明文・ラベルは極小に抑え、placeholder・色・構造で状態を伝える
8. **キャンセル/保存ボタンは存在しない**。編集はライブで単一 Store に書き戻し、永続化は Layer 0 の [作成] ボタンのみが担う
9. **Next.js App Router 標準のエラーバウンダリ**（`error.tsx` / `not-found.tsx`）を使う。自前の Error コンポーネントは作らない
10. **本設計は `_old/` にファイルを退避させない**。削除する

### 触って良いファイル / 触らないファイル

| 区分 | ファイル |
| --- | --- |
| 書き換え | `src/app/dashboard/**`（全 22 ディレクトリ）, `src/app/page.tsx`（landing）, `src/app/login/**`, `src/app/auth/**`, `src/app/billing/**`, `src/app/downloads/**`, `src/components/tiles/**`（v7 schema 残骸）, `src/components/tiles/QuickTileCreate.tsx`（既存 v1 化済み）, `src/components/dashboard/**`, `src/components/dialogs/**`, `src/components/execution/**`（ActiveExecutionBadge / Bar / GlobalPromptBanner / TimelineAxis / TileEditPanel）, `src/components/layout/**`（AppShell / Header / RightSidebar）, `src/components/projects/**`（ProjectsMain）, `src/components/tasks/**`, `src/components/schedule/**`, `src/components/calendar/**`, `src/components/panels/**`, `src/components/search/**`, `src/components/shell/**`, `src/lib/api/v1-endpoints.ts`（既存, 全面 v1 化確認）, `src/lib/api/error-mapper.ts`（v1 ApiErrorKind → UI メッセージ）, `src/lib/hooks/use-execution-engine.ts`（TanStack Query 化）, `src/lib/hooks/use-daemon-execution.ts`, `src/lib/hooks/use-active-tile.ts`, `src/lib/hooks/use-calendar-projection.ts`, `src/lib/hooks/use-placements.ts`, `src/lib/hooks/use-recurring-templates.ts`, `src/lib/hooks/use-sse-sync.ts`, `src/lib/hooks/use-tile-list.ts`, `src/lib/stores/**`（zustand store を TanStack Query 併用へ） |
| 削除 | `src/lib/domain/tile.ts`（v7 condition vectors）, `src/lib/domain/actor.ts`（v7 Actor）, `src/lib/domain/execution.ts`（v7 Execution）, `src/lib/domain/ids.ts`（v7 IDs → `lib/api/v1-types.ts` へ統合）, `src/lib/core/**`（event-sourcing reducer 群）, `src/lib/scheduler/**`（v7 scheduler）, `src/lib/projection/**`（v7 projection）, `src/lib/notifications/**`（v7）, `src/lib/account/**`（v7）, `src/lib/security/**`（v7）, `src/lib/storage/**`（v7 event-store）, `src/lib/api/endpoints.ts`（v7 → v1-endpoints.ts で置換）, `src/components/dashboard/breaks/`（v7 break-as-category 禁止）, `src/app/dashboard/breaks/`（同様）, `src/app/dashboard/prompts/`（v7 旧 prompts） |
| 新規 | `src/lib/state/`（TanStack Query 関連, 並列ディレクトリ）, `src/lib/state/query-client.ts`（QueryClient singleton）, `src/lib/state/v1-hooks.ts`（useTiles / usePlacements / useExecutions 等）, `src/lib/state/v1-keys.ts`（query keys factory）, `src/lib/realtime/sse.ts`（EventSource wrapper）, `src/lib/realtime/poll.ts`（10s poll fallback）, `src/lib/realtime/broadcast.ts`（BroadcastChannel）, `src/app/providers.tsx`（QueryClientProvider + Hydrate）, `next.config.ts` rewrite 設定（`/api/v1/:path* → /api/proxy/v1/:path*`） |
| 触らない | `src/lib/domain/v1/**`（既存 v1 数値定数 + 型）, `src/lib/stores/quick-create-store.ts`（既存 QuickCreateStore, 維持）, `src/lib/api/v1-endpoints.ts`（既存, 全面 v1 化済み）, `src/components/ui/**`（FormRow / RowInput / RowSegmented / RowToggle / RowSubPanel は無変更で流用）, `src/components/tiles/sub-panels/**`（既存 v1 化済み）, `src/lib/cognito/**`（auth 層）, `src/lib/i18n/**`（キー追加のみ）, `src/lib/daemon/id-token-client.ts` |

## 2. アーキテクチャ

### 2.1 全体像

```
Browser (tastile-web, Next.js 15 App Router)
│
├─ Server Components (RSC)
│   ├─ Layout 構造 / 静的メタ / OG / sitemap
│   └─ 初期データ prefetch → dehydrate してクライアントへ
│
├─ Client Components
│   ├─ TanStack Query（useQuery / useMutation）
│   │   ├─ query keys → キャッシュ / invalidation キー
│   │   ├─ optimistic updates (onMutate / onError rollback)
│   │   └─ 5 秒以内の同一キー dedupe
│   ├─ zustand（QuickCreateStore, UI 専用 Slice）
│   └─ BroadcastChannel（タブ間同期）
│
└─ Realtime
    ├─ SSE（EventSource） → invalidateQueries のみ（state を mutate しない）
    └─ Poll fallback（10 秒間隔、SSE エラー時自動切替）

        │
        ▼ HTTPS (via /api/proxy/[...path] rewrite)

tastile-core (v1 API)
├─ /v1/sync（cursored）
├─ /v1/timeline（range）
├─ /v1/tiles（POST/GET by id）
├─ /v1/placements（POST/GET by id）
└─ /v1/executions（POST/GET by id）
```

### 2.2 モジュール構造（新規・変更）

```
src/
├── app/
│   ├── layout.tsx                              (Providers 追加)
│   ├── providers.tsx                            (QueryClientProvider + Hydrate, NEW)
│   ├── dashboard/                              (22 ディレクトリ / 24 page.tsx)
│   │   ├── layout.tsx                          (dashboard 用 layout, 認証必須)
│   │   ├── page.tsx                            (Server Component, 初期データ prefetch)
│   │   ├── tiles/page.tsx                      (Tile 一覧 + QuickTileCreate 起動)
│   │   ├── tiles/[id]/page.tsx                 (NEW: Tile 詳細 + execution control)
│   │   ├── tasks/page.tsx                      (Plan 一覧, 旧 tasks)
│   │   ├── tasks/[id]/page.tsx                 (NEW: Plan 詳細)
│   │   ├── schedule/page.tsx                   (Placement 一覧, 旧 schedule)
│   │   ├── schedule/[id]/page.tsx              (NEW: Placement 詳細 + timeline)
│   │   ├── events/page.tsx                     (Execution 一覧, 旧 events)
│   │   ├── events/[id]/page.tsx                (NEW: Execution 詳細)
│   │   ├── execute/page.tsx                    (実行中タイル一覧)
│   │   ├── timeline/page.tsx                   (timeline ビュー)
│   │   ├── calendar/page.tsx                   (calendar ビュー)
│   │   ├── calendar/[view]/page.tsx            (calendar 動的ルート)
│   │   ├── history/page.tsx                    (履歴ビュー)
│   │   ├── runtime/page.tsx                    (runtime 状態)
│   │   ├── projects/page.tsx                   (recurring tiles, 旧 projects)
│   │   ├── preferences/page.tsx                (設定, 旧 settings)
│   │   ├── preferences/account/page.tsx        (アカウント設定)
│   │   ├── preferences/general/page.tsx        (一般設定)
│   │   ├── quota/page.tsx                      (アカウントクォータ, 旧 account)
│   │   ├── references/page.tsx                 (リファレンス一覧)
│   │   ├── integrations/page.tsx               (インテグレーション)
│   │   ├── billing/page.tsx                    (課金)
│   │   ├── api/page.tsx                        (API key 管理, 維持)
│   │   ├── breaks/page.tsx                     (削除対象: v7 break-as-category)
│   │   ├── prompts/page.tsx                    (削除対象: v7 prompts)
│   │   └── error.tsx                           (NEW: Next.js Error Boundary)
│   ├── page.tsx                                (landing, v1 schema で server-rendered)
│   ├── login/, auth/, billing/, downloads/     (既存構造維持, v1 化のみ)
├── components/
│   ├── tiles/                                  (既存 v1 化済み)
│   │   ├── QuickTileCreate.tsx
│   │   ├── build-command.ts, submit-quick-create.ts
│   │   ├── sub-panels/                         (v1 化済み, 維持)
│   │   ├── shared/icons.tsx                    (lucide-react ラッパ)
│   │   └── dialogs/                            (v1 化済み)
│   ├── dashboard/                              (TileGrid / StatsCard 等)
│   ├── execution/                              (ActiveExecutionBadge / Bar / GlobalPromptBanner / TimelineAxis / TileEditPanel を v1 化)
│   ├── layout/                                 (AppShell / Header / RightSidebar を v1 化)
│   ├── projects/, tasks/, schedule/, calendar/ (v1 化)
│   ├── panels/, search/, shell/                (v1 化)
│   └── ui/                                     (無変更)
├── lib/
│   ├── api/
│   │   ├── v1-endpoints.ts                     (既存, V1Client + Result<T> 維持)
│   │   ├── error-mapper.ts                     (既存, v1 ApiErrorKind → UI メッセージ)
│   │   └── endpoints.ts                        (削除対象: v7)
│   ├── domain/
│   │   ├── v1/                                 (既存 v1 数値定数 + 型, 維持)
│   │   ├── tile.ts, actor.ts, execution.ts, ids.ts (削除対象: v7)
│   ├── state/                                  (NEW: TanStack Query 関連)
│   │   ├── query-client.ts                     (QueryClient singleton)
│   │   ├── v1-hooks.ts                         (useTiles / useCreateTile / usePlacements / useExecutions / ...)
│   │   └── v1-keys.ts                          (query keys factory)
│   ├── stores/                                 (既存: 維持)
│   │   ├── quick-create-store.ts               (QuickCreateStore, 維持)
│   │   └── ... (dialog/labels/locale/projects/reference-overlay/shell/theme/tile-edit stores, 維持)
│   ├── realtime/                               (NEW)
│   │   ├── sse.ts                              (EventSource wrapper)
│   │   ├── poll.ts                             (10s poll fallback)
│   │   └── broadcast.ts                        (BroadcastChannel)
│   ├── hooks/                                  (削除対象: use-active-tile, use-calendar-projection, use-daemon-execution, use-execution-engine, use-placements, use-recurring-templates, use-sse-sync, use-tile-list)
│   ├── core/                                   (削除対象: event-sourcing reducer)
│   ├── scheduler/                              (削除対象)
│   ├── projection/                             (削除対象)
│   ├── notifications/                          (削除対象)
│   ├── account/                                (削除対象)
│   ├── security/                               (削除対象)
│   ├── storage/                                (削除対象: v7 event-store)
│   ├── cognito/                                (無変更)
│   └── i18n/                                   (キー追加のみ)
└── proxy.ts (middleware, NextRequest, 既存維持)

next.config.ts (NEW: rewrite `/api/v1/:path*` → `/api/proxy/v1/:path*`)
```

### 2.3 Data Flow（リードパス）

```
1. User → /dashboard
2. RSC: QueryClient.prefetchQuery(['tiles', 'list'])
3. RSC: QueryClient.prefetchQuery(['placements', 'list'])
4. RSC: QueryClient.prefetchQuery(['executions', 'list'])
5. RSC: dehydrate → <Hydrate state={dehydratedState}>
6. Client: useQuery → 即座にキャッシュ表示（TTI < 500ms）
7. Client: SSE 接続開始 → invalidateQueries on event
8. User 操作 → useMutation → onMutate optimistic update → invalidate on settle
```

### 2.4 Data Flow（ライトパス = QuickTileCreate）

```
1. User: QuickTileCreate 起動 → QuickCreateStore（zustand）にライブ編集
2. User: [作成] クリック → useMutation.mutate({ payload, expectedRevision, idempotencyKey })
3. onMutate: cache に optimistic tile を追加 → snapshot 保存
4. POST /v1/tiles → server が ApplyCommand → 201 Created
5. onSuccess: optimistic tile を server response で置換 → invalidate ['tiles', 'list']
6. SSE → invalidate ['tiles', tileId] → 全 mount で再フェッチ
7. BroadcastChannel → 他タブへ invalidate 通知 → 他タブも再フェッチ
8. onError (StaleRevision): snapshot から rollback → server state 再フェッチ → 1 回 retry
9. onError (Validation): snapshot rollback → 422 を inline error に表示
```

## 3. リアルタイム + 同期戦略

### 3.1 SSE（第一優先）

- エンドポイント: `GET /v1/sync/stream`（tastile-core 提供）
- 接続: Client Component mount 時に `new EventSource('/api/v1/sync/stream')`
- メッセージ: `{ kind: 'tile'|'placement'|'execution', id: string, revision: number }` の軽量イベント
- ハンドラ: `queryClient.invalidateQueries({ queryKey: ['tiles', id] })` を呼ぶだけ。**state は mutate しない**
- 切断: `eventSource.close()` → 5 秒後 poll fallback 起動

### 3.2 Poll fallback

- `useRealtime()` カスタムフックが SSE 接続状態を持つ
- SSE error / close 3 回連続 → 10 秒間隔で `GET /v1/sync?cursor=...` を実行
- レスポンスに `next_cursor` が含まれる → 次の poll で使用
- SSE 再接続成功 → poll 停止

### 3.3 BroadcastChannel（タブ間）

- キー: `tastile-${userSub}` で他タブと分離
- メッセージ: `{ type: 'invalidate', keys: string[][] }`
- 受信側: `queryClient.invalidateQueries({ queryKey: keys })`
- 用途: タブ A で mutation → タブ B も即座に再フェッチ（SSE 経由より速い）

### 3.4 Sync（初期ロード）

- `GET /v1/sync` で cursor なし → 全 aggregate id 取得
- 各 id を `GET /v1/tiles/{id}` 等で取得（並列 Promise.all、max 10 concurrency）
- ローカルストレージに cursor + 最終同期時刻を保存
- 次回: `GET /v1/sync?cursor=...` で差分のみ

## 4. エラーハンドリング

### 4.1 ApiErrorKind（v1 仕様）

| Kind | HTTP | クライアント挙動 |
| --- | --- | --- |
| `VALIDATION` | 422 | フィールド別 inline error、フォーム維持 |
| `FORBIDDEN` | 403 | toast "Permission denied"、cache 変更なし |
| `STALE_REVISION` | 409 | snapshot rollback → server state 再フェッチ → 1 回 retry |
| `IDEMPOTENCY_KEY_REUSED` | 409 | silent success（既に応答済み） |
| `NOT_FOUND` | 404 | 該当 tile を cache から除去、404 ページへ |
| `CONFLICT` | 409 | snapshot rollback、ユーザへ "Conflict" toast |
| `BLOCKED` | 423 | toast "Locked by another session"、15 秒後に retry |
| `RETRYABLE` | 503 | exponential backoff（1s, 2s, 4s, cap 30s）、3 回まで |

### 4.2 mapApiErrorToMessage

`src/lib/api/v1-errors.ts` に集約：

```ts
export function mapApiErrorToMessage(err: ApiError): { field?: string; toast: string } {
  switch (err.kind) {
    case 'VALIDATION':
      return { field: err.field, toast: err.message };
    case 'FORBIDDEN':
      return { toast: 'You don\'t have permission for this action.' };
    case 'STALE_REVISION':
      return { toast: 'Another device updated this. Refreshing…' };
    case 'IDEMPOTENCY_KEY_REUSED':
      return { toast: '' }; // silent success
    case 'NOT_FOUND':
      return { toast: 'Tile not found.' };
    case 'CONFLICT':
      return { toast: 'Conflict with current state.' };
    case 'BLOCKED':
      return { toast: 'Locked by another session. Retrying…' };
    case 'RETRYABLE':
      return { toast: 'Server unavailable. Retrying…' };
  }
}
```

### 4.3 Next.js Error Boundary

- `src/app/dashboard/error.tsx`（Client Component、`'use client'`）
- `error.tsx` 内で `reset()` 呼び出し → 再フェッチ
- 未分類エラーは Error Boundary でキャッチ → 500 ページ表示

## 5. テスト戦略

### 5.1 Unit（vitest）

- `src/lib/state/v1-keys.ts`: query key 生成ロジック
- `src/lib/api/v1-errors.ts`: ApiErrorKind → メッセージマッピング全 8 種
- `src/lib/realtime/sse.ts`: 接続 / 切断 / エラー / 再接続の 4 状態
- `src/lib/realtime/broadcast.ts`: post / receive の双方向

カバレッジ目標: `src/lib/api/**` / `src/lib/state/**` / `src/lib/realtime/**` で line coverage 80% 以上

### 5.2 Integration（MSW）

- `src/lib/api/v1-client.test.ts`: V1Client に対する MSW サーバで canned v1 レスポンス
- 全 8 ApiErrorKind のハンドリング確認
- Retry / exponential backoff / idempotency key reuse 確認

### 5.3 E2E（chrome-devtools MCP）

- 22 ディレクトリ / 24 page.tsx × happy path（一覧表示 + 詳細遷移）
- QuickTileCreate 作成フロー（実 docker core 接続）
- Negative: 401（ログアウト状態）/ 409 stale revision / 503 server down
- 既存 `bun x vitest run <file>` パターン継続

## 6. Rollout / Sequencing

| Phase | 内容 | 検証 |
| --- | --- | --- |
| **A** Infra | `next.config.ts` rewrite, `v1-client.ts`（既存 `v1-endpoints.ts` を活用 + Result<T> 統一確認）, `v1-types.ts`（v1 Aggregate 型）, `v1-keys.ts`, `query-client.ts`, `sse.ts`, `poll.ts`, `broadcast.ts`, `app/providers.tsx` | `curl /api/v1/tiles` が cloud daemon に届くこと |
| **B** Hooks | `v1-hooks.ts`（useTiles / useTile / useCreateTile / useUpdateTile / usePlacements / usePlacement / useCreatePlacement / useExecutions / useExecution / useStartExecution / useCompleteExecution） | MSW で全 hook が 200 を返すこと |
| **C** v7 削除 | `domain/{tile,actor,execution,ids}.ts`, `core/**`, `scheduler/**`, `projection/**`, `notifications/**`, `account/**`, `security/**`, `storage/**`, `api/endpoints.ts`, `hooks/use-(active-tile\|calendar-projection\|daemon-execution\|execution-engine\|placements\|recurring-templates\|sse-sync\|tile-list).ts`, `app/dashboard/{breaks,prompts}/` を削除 | `grep` で v7 import が 0 件 |
| **D** Components | `TileCard.tsx` / `TileList.tsx` / `DashboardShell.tsx` / `ExecutionPanel.tsx` / `StatsCard.tsx` 等を v1 スキーマに置換 | chrome-devtools でレンダリング確認 |
| **E** Dialogs | `ConfirmDialog.tsx` / `DeleteTileDialog.tsx` 等を v1 mutation 経由に置換 | mutation → optimistic update → server confirm |
| **F** Pages | `dashboard/**` 22 ディレクトリ / 24 page.tsx + `landing/login/billing/downloads/auth` | 全ページ 200 + happy path |
| **G** Auth + E2E | `proxy.ts`（既存）/ `cognito/` / middleware | 認証必須ページの 401 ハンドリング、E2E テスト |
| **H** Acceptance | § 7 全項目 PASS | chrome-devtools で docker core 接続 E2E |

推定セッション: 7 回（Phase A〜H）

## 7. Acceptance Criteria

### 7.1 Wire verification（静的）

- `grep -rE "from ['\"]@/lib/(domain/(tile|actor|execution|ids)|core|scheduler|projection|notifications|account|security|storage|hooks/use-(active-tile|calendar-projection|daemon-execution|execution-engine|placements|recurring-templates|sse-sync|tile-list))" src/app/dashboard src/components` returns **ZERO** matches
- `grep -rE "from ['\"]@/lib/api/endpoints['\"]" src/app src/components` returns **ZERO** matches（v1-endpoints.ts への置換完了確認）
- `find src -type d -name "_old"` returns **ZERO** matches
- All 22 dashboard directories import from `@/lib/api/v1-*`, `@/lib/state/v1-*`, `@/lib/domain/v1/*`, `@/lib/stores/*` only

### 7.2 Behavioral verification（docker core + chrome-devtools）

- `docker compose up -d tastile-core` → `curl localhost:31400/health` returns 200
- Login flow reaches `/dashboard` with valid idToken cookie
- `/dashboard` initial load: TanStack Query issues parallel `/v1/tiles`, `/v1/placements`, `/v1/executions` fetches via sync → all return 200 within 2s
- Open `QuickTileCreate` → fill required fields → submit → response id appears in tile list within 1s (optimistic) and confirmed via SSE within 5s
- Reload `/dashboard` in second tab → first tab reflects new state within 1s (BroadcastChannel)
- Kill SSE server-side → client falls back to poll within 10s → resumes SSE on reconnect
- Submit QuickTileCreate with stale `expectedRevision` → user sees "Another device updated this. Refreshing…" → auto-retry succeeds

### 7.3 Error surface

- 401（no token）→ middleware redirects to `/login`
- 403（FORBIDDEN）→ toast "Permission denied", tile not added to cache
- 409（STALE_REVISION）→ refetch + retry once
- 409（IDEMPOTENCY_KEY_REUSED）→ silent success
- 422（VALIDATION）→ field-level inline error, form stays open
- 503（RETRYABLE）→ exponential backoff (1s, 2s, 4s, cap 30s)

### 7.4 Test coverage

- Unit: reducers, validators, query keys, optimistic update logic → **80%+ line coverage** on `src/lib/state/v1-*` and `src/lib/api/v1-*`
- Integration: V1Client against MSW server with canned v1 responses → covers **all 8 ApiErrorKind paths**
- E2E (chrome-devtools): one happy path per dashboard page (22 directories / 24 pages) + 3 negative paths (auth fail, stale revision, server down)

### 7.5 Performance budgets

- Dashboard TTI < **1.5s** on Fast 3G (verified via Lighthouse)
- Query cache hit ratio > **60%** on second page mount (TanStack Query devtools)
- Bundle size delta vs. v7: < **5%** increase (dashboard pages only)

### 7.6 Operational

- `bun run build` succeeds with **zero warnings**
- `bun x biome lint src/app/dashboard src/components src/lib/api src/lib/state` returns clean
- `bun x vitest run`（targeted v1 files）all green
- `next.config.ts` rewrite confirmed: `curl /api/v1/tiles` resolves to cloud daemon via proxy

### 7.7 Out of scope（explicit non-goals）

- TileEdit dialog（separate spec）
- Read Model migration of derived views（separate spec）
- Push delivery UI（separate spec）
- Decision Session UI（separate spec）
- Mobile（`/app/*`）— desktop only this iteration
- Billing/Stripe flows — unchanged

## 8. Risks / Open Questions

**R1 — Sync cursor semantics**

v1 sync endpoint may not support filtering by aggregate type. Mitigation: fetch all aggregate ids, then GET each. If 10K+ tiles, paginate via cursor tokens. Open: confirm with core team what `since` filter accepts.

**R2 — SSE availability on cloud API**

If cloud `tastile.app` blocks SSE（proxy buffering）, client falls back to poll-only（10s interval）. Mitigation: client degrades gracefully; dashboard still functional. Performance budget relaxed to TTI < 2.5s in poll-only mode.

**R3 — Pre-existing merge conflicts**

Working tree has unresolved conflicts in `proxy.ts`, `login/page.tsx`, `Header.tsx`, `use-daemon-execution.ts`. These are NOT in dashboard migration scope but block `bun test`/`bun run lint`. Mitigation: this spec only touches dashboard subtree + new `lib/api/v1-*` + `lib/state/v1-*` + new `next.config.ts` rewrite. Out-of-scope conflicts handled separately.

**R4 — TileKind enum**

CLAUDE.md forbids `kind` enums（anti-pattern: type enum instead of condition vector）. v1 API requires `TileKind` in payload. Mitigation: this is the API contract, not a domain modeling choice. We pass it through; the UI doesn't branch on kind for behavior — only for icon/label.

**R5 — QuickCreateStore state survives navigation**

Single zustand store with slice reset on close. If user navigates mid-form, state lost. Mitigation: store lives at module scope, persists for session; explicit "Discard" button in footer. Not auto-saved（avoid phantom drafts in tile list）.

**R6 — Optimistic update rollback**

Tile created optimistically then 422 → must remove from cache + show field error. TanStack Query `onError` rollback is standard. Open: confirm QuickTileCreate callers handle rollback（test coverage）.

**R7 — v1 numeric constants drift**

Spec references 82 numeric constants. If core rev's constants, client crashes. Mitigation: constants live in `src/lib/api/v1-constants.ts` mirror of core's `domain/values.rs`. Open: how often does this drift? If weekly, need automated codegen（out of scope here）.

**R8 — Cognito token refresh during long SSE session**

30-min SSE session may outlive id_token（1h default）. Mitigation: middleware refreshes on next navigation; SSE stays open since EventSource doesn't depend on cookies for re-auth. Edge case: server-side token revocation during SSE — accepted risk, SSE disconnects, client falls back to poll which uses middleware-refreshed cookies.