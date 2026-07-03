# tastile-android モバイル UI 設計

- **Status**: Draft (awaiting user review)
- **Date**: 2026-06-24
- **Author**: brainstorming session with user
- **Scope**: Compose UI レイヤの刷新(ナビゲーション、BottomBar、TopBar、6 種のオーバーレイ、画面レイアウト再設計)。`tastile-core` の native bridge と既存 `DashboardViewModel` の API は無変更。

## 1. 背景と目的

`tastile-web` のダッシュボードは、モバイルブレイクポイントで **BottomBar 5 タブ + TopBar + ModalBottomSheet オーバーレイ** という階層型 UI に切り替わる。`tastile-android` は現状 `ModalNavigationDrawer` ベースの 9 ルートで、モバイル密度と合わない。本仕様では、tastile-web のモバイルモードに準拠して Android ネイティブへ移植する。

### 設計の絶対条件

1. `tastile-web/src/app/dashboard/layout-client.tsx` の構成を Android ネイティブに写像する
2. 現状 9 ルートの Compose NavHost を撤廃し、BottomBar 4 ルートに縮退する
3. 6 種の UI パネル(`QuickCreate / TileEdit / Search / Notifications / AccountMenu / SidePanel`)は **`ModalBottomSheet`** で下から出現させる
4. **ラベル文字列を画面上に出さない**。アイコンと入力フィールドで意味を伝える(PRODUCT.md「Density over decoration」原則)
5. `tastile-core` との通信層には触らない(`./gradlew verify` 通過のみ保証)
6. モバイルアプリ独自の拡張(4 テーマ切替等)は本フェーズでは行わない

## 2. アーキテクチャ

### 2.1 全体構造

```
TastileAppRoot (Application class + TastileTheme)
└─ AuthGate                       // 未認証 = LoginScreen
   └─ TastileMobileNavGraph
      └─ MobileScaffold           // 単一の Material3 Scaffold
         ├─ TopBar                // MobileTopBar(FloatingHeader 相当)
         ├─ content               // NavHost(4 タブ)
         ├─ BottomBar             // MobileBottomBar(5 スロット)
         └─ OverlayLayer          // 6 種の ModalBottomSheet を出し分け
```

### 2.2 単一 Scaffold 集約

`TastileNavGraph.kt` 内の `MainAppScaffold` と `ModalNavigationDrawer` は **削除**。代わりに `MobileScaffold` に集約する。Scaffold は **1 個**。

### 2.3 NavHost の内部ルート

| BottomBar タブ | ルート | Composable | 中身 |
|---|---|---|---|
| Execute | `execute` | `ExecuteScreen` | ActiveExecutionBar + TimelineScreen(Day) + Prompt バナー |
| Tiles | `tiles` | `TilesScreen` | FilterChip 行 + TileCompactCard / TileExpandableCard のリスト |
| +(QuickCreate) | (ルートなし) | (オーバーレイ) | BottomBar タップで `Overlay.QuickCreate` を `show` |
| Integrations | `integrations` | `IntegrationsScreen` | 接続済み / 未接続のリスト |
| Settings | `settings` | `SettingsScreen` | 行アイコン + 値 or chevron |

NavHost の `startDestination = "execute"`。+ はオーバーレイのため NavHost に登録しない。

### 2.4 オーバーレイ状態モデル

```kotlin
sealed interface Overlay {
    data object Hidden : Overlay
    data object QuickCreate : Overlay
    data class TileEdit(val tileId: String) : Overlay
    data object Search : Overlay
    data object Notifications : Overlay
    data object AccountMenu : Overlay
    data class SidePanel(val section: SidePanelSection) : Overlay
}

enum class SidePanelSection { Calendar, Schedule, Projects, References, Preferences }
```

`OverlayViewModel`(`@HiltViewModel`、`@ActivityRetainedScoped`):

```kotlin
private val _current = MutableStateFlow<Overlay>(Overlay.Hidden)
val current: StateFlow<Overlay> = _current.asStateFlow()
fun show(o: Overlay) { _current.value = o }
fun dismiss() { _current.value = Overlay.Hidden }
```

複数同時表示は禁止。`show()` を呼ぶと前の Overlay を上書きする。

## 3. ナビゲーション & オーバーレイトリガー

### 3.1 オーバーレイトリガー対応表

| トリガー | Overlay |
|---|---|
| BottomBar 中央 + タップ | `Overlay.QuickCreate` |
| TopBar 検索アイコン / ハードウェア `Ctrl+K` | `Overlay.Search` |
| TopBar ベルアイコン | `Overlay.Notifications` |
| TopBar アバター | `Overlay.AccountMenu` |
| TileCompactCard / TileExpandableCard 行タップ | `Overlay.TileEdit(id)` |
| TopBar ハンバーガー または context FAB | `Overlay.SidePanel(section)` |
| `Back` 押下 / システムジェスチャー | `dismiss()` 優先、無ければ `popBackStack()` |

### 3.2 Back 優先順位

```kotlin
BackHandler(enabled = overlay.current.value !is Overlay.Hidden) {
    overlay.dismiss()
}
BackHandler(enabled = navController.previousBackStackEntry != null) {
    navController.popBackStack()
}
// それ以外 = Activity finish(システム既定)
```

Overlay を閉じてから Nav バック、最後に Activity 終了の順。

## 4. データフロー & ViewModel 構成

### 4.1 ソース・オブ・トゥルース 2 つ

| ViewModel | 状態 | スコープ |
|---|---|---|
| `DashboardViewModel`(既存・無変更) | `tiles`, `loading`, `profile`, `email`, `avatarUrl`, `integrations`, `locale`, `activeExecution` | Singleton(Hilt 経由、各 Composable で `hiltViewModel()`) |
| `OverlayViewModel`(新規) | `current: StateFlow<Overlay>` | `@ActivityRetainedScoped` |

各タブの Screen と各 Sheet は `hiltViewModel<DashboardViewModel>()` で同一インスタンスを取得。タブ遷移でデータは失われない。

### 4.2 各タブのデータ取得元

| タブ | 既存 ViewModel | 取得 State |
|---|---|---|
| Execute | `DashboardViewModel` | `tiles`, `loading`, `locale`, `activeExecution`(派生) |
| Tiles | `DashboardViewModel` | `tiles`(全件), `locale` |
| Integrations | `DashboardViewModel` | `integrations`, `loading` |
| Settings | `DashboardViewModel` | `profile`, `email`, `avatarUrl`, `locale` |

### 4.3 オーバーレイのデータ取得

| Overlay | 取得元 | 備考 |
|---|---|---|
| `QuickCreate` | 既存 `QuickCreateViewModel`(無変更) | シートが自立 |
| `TileEdit(id)` | `DashboardViewModel.selectedTile`(`tiles` + `selectTile(id)` の派生) | 新規セレクタ追加 |
| `Search` | `EndpointsCatalog`(static const、22 エンドポイント)+ `RecentCommandsStore`(in-memory、永続化は将来) | `Cmd+K` 相当 |
| `Notifications` | 既存 `notifications/` パッケージの `NotificationRepository` | トリガ時刻 + 配信履歴 |
| `AccountMenu` | `DashboardViewModel.profile` | email + avatar 表示 |
| `SidePanel(section)` | section ごとに分岐。Calendar → `TimelineScreen(WEEK/MONTH)`、Schedule → `DashboardViewModel.placements`(将来) | コンテキスト依存 |

### 4.4 DashboardViewModel への追加

```kotlin
private val _selectedTileId = MutableStateFlow<String?>(null)
val selectedTile: StateFlow<Tile?> = combine(tiles, _selectedTileId) { list, id ->
    id?.let { tid -> list.firstOrNull { it.id == tid } }
}.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

fun selectTile(id: String) { _selectedTileId.value = id }
fun clearSelectedTile() { _selectedTileId.value = null }
```

呼び出し元:
- `selectTile(id)`: `OverlayViewModel.show(Overlay.TileEdit(id))` と同じ `MobileScaffold` 内の handler から呼ぶ(`MobileScaffold` は両 ViewModel を保持する)
- `clearSelectedTile()`: `OverlayViewModel.dismiss()` が呼ばれると同時に `MobileScaffold` 内の `LaunchedEffect(overlay.current)` で発火する。`current` が `Hidden` に戻った瞬間にクリアする

既存メソッド・既存フィールドは **変更しない**。

### 4.5 Hilt モジュール

```kotlin
@Module
@InstallIn(ActivityRetainedComponent::class)
object MobileOverlayModule {
    @Provides
    @ActivityRetainedScoped
    fun provideOverlayViewModel(): OverlayViewModel = OverlayViewModel()
}
```

## 5. 画面レイアウト(アイコン + 入力中心)

### 5.1 設計原則(全画面共通)

- **画面内ラベル文字列ゼロ**。入力欄は `OutlinedTextField` の `label`(フローティング時のみ表示)+ `placeholder` で表現
- **アイコンが視覚アンカー**。Material Symbols Outlined 24dp 統一
- **ボタンは icon-only**。テキスト併記禁止。意味は Tooltip か下方の micro-copy 1 行で伝える
- **タブ / ナビ項目は icon-only が望ましい**。ただし QuickCreateSheet の sub-panel タブ(`base / repeat / wait / auto / meta`)など、5 種以上のカテゴリを区別する必要があり、アイコン単体では曖昧になる箇所は **icon + 1 ワード** を許可する(Web の `QuickTileCreate.tsx` 準拠)
- **見出し語を使わない**。「Settings」「General」「Connected」 等のヘッダ文字列は廃止
- **ステータス色は文字/アイコンと冗長化**(`○ ▶ ✓ ·`)で色覚多様性対応

### 5.2 ExecuteScreen

```
☰  Execute        🔍 🔔 👤
┌── ▶ コードレビュー ────────┐
│ Started 14:32 · PR 作成     │
└──────────────────────────┘
▶ 14:00  #TS-04  API 設計
▶ 15:00  #TS-09  レビュー
○ 16:30  #TS-15  PR 作成
┌── ⚠ Prompt ────────────────┐
│ Reply required by 15:30     │
└──────────────────────────┘
─────────────────────────────────
 ⚡   ☷   ＋   🔌   ⚙
```

### 5.3 TilesScreen

```
☰  Tiles            🔍 🔔 👤
[⏱] [⏳] [✓] [⋯]            ← icon-only FilterChip
─────────────────────────────
▸ ⏱ #TS-09  レビュー     15:30
▸ ⏱ #TS-12  朝会         09:00
─────────────────────────────
▸ ⏳ #TS-15  PR 作成      -
```

### 5.4 QuickCreateSheet(Mobile 時)

```
┌─ QuickTileCreate ──────── [×] ┐
│ ┌──────────────────────────┐ │
│ │ Title                     │ │
│ └──────────────────────────┘ │
│ 🧭 base  🔁 repeat  ⏸ wait  🤖 auto  ⚙ meta │
│ ┌──────────────────────────┐ │
│ │ 🏷 tag1, tag2 +           │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ ⏱ 25m                     │ │
│ └──────────────────────────┘ │
│ ☐ ○ ✓ ⏱                      │
│                          [▶] │
└─────────────────────────────┘
```

`RowInput / RowSegmented / RowToggle` 系の素の行を使う。ラベル文字列なし。

### 5.5 IntegrationsScreen

```
☰  Integrations     🔍 🔔 👤
●  Slack       ⚙
●  Calendar    ⚙
●  GitHub      ⚙
─────────────────────────────
○  Linear      +
○  Notion      +
```

### 5.6 SettingsScreen

```
☰  Settings        🔍 🔔 👤
🌐  Locale        ja ›
🎨  Theme         gray ›
🔔  Notifications ›
🔒  Privacy       ›
ℹ   About         ›
```

各行は `Icon + 値 or chevron`。値は画面外注釈(ローカライズキー)で、画面には値だけが目立つ。

### 5.7 AccountMenuSheet

```
┌─ ──────────────────── [×] ┐
│ 👤 operator@example.com    │
│ ─────────────────────────  │
│ 👤 Account                 │
│ 💳 Subscription            │
│ 📝 Memo                    │
│ 💬 Prompt history          │
│ 💵 Billing                 │
│ ─────────────────────────  │
│ ⏏ Sign out                 │
└─────────────────────────────┘
```

### 5.8 SidePanelSheet

```
┌─ Details ──────────────── [×] ┐
│ 📅 Calendar                  │
│   [Day] [Week] [Month]        │
│   ┌────────────────────┐     │
│   │ 月グリッド           │     │
│   └────────────────────┘     │
│ ─────────────────────────────  │
│ 📂 Schedule                    │
│   終日 / 時間付き              │
└────────────────────────────┘
```

## 6. デザイントークン

### 6.1 既存トークン(流用)

| トークン | 値 | 用途 |
|---|---|---|
| `AppSpacing.sm/md/lg` | 8/12/16dp | 標準余白 |
| `AppShape.panelRadius` | 6dp | パネル角丸 |
| `AppShape.chipRadius` | 8dp | Chip 角丸 |
| `AppComponentSize.buttonMinHeight` | 48dp | WCAG タッチターゲット |
| `AppComponentSize.iconButton` | 40dp | IconButton サイズ |

### 6.2 新規トークン(MobileTokens.kt)

```kotlin
object MobileTokens {
    val topBarHeight = 56.dp
    val bottomBarHeight = 64.dp

    val sheetCornerRadius = 12.dp
    val sheetScrimAlpha = 0.45f
    val sheetMaxHeightFraction = 0.92f

    val iconHitTarget = 48.dp
    val iconVisualSize = 24.dp

    object Status {
        val ready = Color(0xFFC08A2B)
        val started = Color(0xFF0D8A72)
        val done = Color(0xFF6E6E6E)
        val interruption = Color(0xFFC34141)
        val primary = Color(0xFF5E6AD2)
    }
}
```

`Theme.kt` は無変更(L/D 2 値のまま)。4 テーマ化は将来フェーズ。

## 7. アクセシビリティ(WCAG 2.2 AA)

| 項目 | 実装方針 |
|---|---|
| コントラスト比 | 本文 4.5:1、UI 3:1 を `MobileTokens.Status.*` で担保 |
| タッチターゲット | `MobileTokens.iconHitTarget = 48dp`、`IconButton` modifier で明示 |
| TalkBack | すべての icon-only ボタンに `contentDescription = stringResource(R.string.xxx)`(i18n キー経由) |
| 意味的役割 | icon-only BottomBar タブに `Modifier.semantics { role = Role.Button }` |
| フォーカス順序 | TopBar → コンテンツ → BottomBar の順 |
| `prefers-reduced-motion` | sheet offset と BottomBar インジケータの transition を 0 に縮退 |
| ハードウェアキーボード | `Ctrl + K` で `Overlay.Search` 表示 |

## 8. テスト戦略

### 8.1 ユニット(JVM, `./gradlew testDebugUnitTest`)

| 対象 | 確認内容 |
|---|---|
| `OverlayViewModel` | `Hidden → QuickCreate → TileEdit("abc") → Hidden` の遷移、最後の `show` が勝つ |
| `OverlayViewModel` | `Hidden` 初期状態、型保持 |
| `DashboardViewModel.selectedTile` | tile id セレクタが list 更新で同期 |
| `EndpointsCatalog` | 22 エンドポイント全件定義済み |

### 8.2 Compose UI

| テスト | 確認内容 |
|---|---|
| `MobileScaffold` | TopBar の 🔍 🔔 👤 3 アイコン、BottomBar の 5 スロット |
| `ExecuteScreen` | ActiveExecutionBar の表示/非表示(Started/Done) |
| `TilesScreen` | FilterChip タップで selected 切り替え、行タップで `Overlay.TileEdit(id)` |
| `IntegrationsScreen` | `Connected` / `Available` 2 セクション |
| `SettingsScreen` | 行タップで `Overlay.SidePanel(section)` |
| `QuickCreateSheet` | sub-panel タブ 5 種(base/recurrence/interrupt/automation/meta) |
| `TileEditSheet` | `tileId` ごとに別データで描画 |
| `SearchOverlaySheet` | `Ctrl+K` で表示、入力で結果絞り込み、`Enter` でコマンド実行 |
| `NotificationsSheet` | 空状態 / 件数バッジ |
| `AccountMenuSheet` | email 表示 + Sign out 行 |
| `SidePanelSheet` | section=Calendar で `TimelineScreen(WEEK)` |
| `BackHandler` | Overlay 表示中は `dismiss` 優先、非表示中は `popBackStack` |

### 8.3 ナビゲーション結合テスト

- 5 タブ循環で `OverlayViewModel.current` が維持される
- 画面回転(`configChange`)で `OverlayViewModel.current` が保持される

### 8.4 ビジュアル確認

- ローカル: `./gradlew assembleDebug` → `adb install` → 実機/エミュレータ
- 4 状態(active/idle/done/interruption)のスクリーンショットを `docs/superpowers/specs/screenshots/mobile/` に保存

## 9. ビルド / CI 整合

| コマンド | 用途 | 影響 |
|---|---|---|
| `./gradlew verify` | 既存ユニットテスト | 既存パス + 新規テストで通過 |
| `./gradlew testDebugUnitTest` | ユニットのみ | 同上 |
| `./gradlew assembleDebug` | デバッグ APK | 既存ビルドスクリプトで通る想定 |
| `./gradlew bundleRelease` | リリース APK | 既存 signing 設定で通る |

**Native(`./tastile-core` 由来) は触らない**。Compose 層のみの変更。

## 10. ファイル変更計画

### 10.1 削除

| ファイル / シンボル | 処分 |
|---|---|
| `ui/navigation/TastileNavGraph.kt` 全体 | **削除** |
| `MainAppScaffold`(同ファイル内) | **削除** |
| `ModalNavigationDrawer`(同ファイル内) | **削除** |
| `Screen` sealed class 9 ルート | **削除** |
| `sidePanelSections()` | **削除** |

### 10.2 新規

```
app/src/main/java/app/tastile/android/ui/
  mobile/
    MobileScaffold.kt
    MobileTopBar.kt
    MobileBottomBar.kt
    OverlayLayer.kt
    OverlayViewModel.kt
    OverlayState.kt                 // sealed Overlay + SidePanelSection
    designsystem/
      MobileTokens.kt
    sheets/
      QuickCreateSheetMobile.kt     // 既存 QuickCreateSheet を ModalBottomSheet wrap
      TileEditSheet.kt
      SearchOverlaySheet.kt
      NotificationsSheet.kt
      AccountMenuSheet.kt
      SidePanelSheet.kt
    tabs/
      ExecuteScreen.kt
      TilesScreen.kt
      IntegrationsScreen.kt
      SettingsScreen.kt
    di/
      MobileOverlayModule.kt        // Hilt モジュール
```

### 10.3 変更

| ファイル | 変更内容 |
|---|---|
| `app/build.gradle.kts` | `androidx.compose.material:material-icons-extended` を依存に追加(必要なら) |
| `data/repository/DashboardViewModel.kt` | `selectedTile`, `selectTile(id)`, `clearSelectedTile()` を追加 |
| `ui/dashboard/QuickCreateSheet.kt` | 既存ロジックは残し、`QuickCreateSheetMobile` から `ModalBottomSheet` 経由で利用 |

## 11. リスク TOP 3

| リスク | 緩和 |
|---|---|
| `ModalNavigationDrawer` 削除で `Screen` sealed class の 9 ルート参照箇所が残る | `grep -r "Screen\\." app/src` で全箇所確認 → 個別置換。テストフェーズで再走 |
| `DashboardViewModel.buildExecuteCards()` / `buildTileCards()` が NavHost 外で呼ばれロジックが孤立 | 既存ロジックを viewmodel 側に残し、各タブ Screen から再利用。削除しない |
| `QuickCreateSheet` の full-screen → BottomSheet 移行でキーボード挙動が変わる | 既存の `KeyboardActions` / `imePadding()` を残し、`ModalBottomSheet(windowInsets = WindowInsets.ime)` で調整 |

### ロールバック

- **Git**: `git revert <merge-commit>` 一発で 9 ルート drawer 状態へ戻せる
- **機能フラグ**: 導入しない(モバイル機能フラグ未整備、影響範囲が UI のみ)

## 12. オープン項目(将来フェーズ)

- 4 テーマ切替(Light / Gray / Dark / Dark Black)
- ハードウェアキーボード拡張(Ctrl+N で QuickCreate 等)
- RecentCommandsStore の SharedPreferences 永続化
- `SidePanel.Schedule` の `placements` データソース実装
- タブレット対応(`sw >= 600dp` で BottomBar → NavigationRail)
- 通知タップで対象 TileEditSheet を直接開く deep link
