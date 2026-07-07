# tastile-android メインキャンバス実装 Design

> Date: 2026-07-07
> Status: Design — awaiting user approval
> Scope: `tastile-android` のメインキャンバス 4タブ (Execute / Tiles / Integrations / Settings) の中身実装 + `MobileBottomBar` デッドコード削除 + `SidePanelSheet` の section 内容修正
> ソース正本: `tastile-core/v1/02-core-entities.md`, `tastile-android/app/src/main/java/app/tastile/android/`

---

## Goal

`tastile-android` の現状:

- ナビゲーション構造 (MobileScaffold + NavHost + OverlayLayer + SidePanelSheet) は **Web の main canvas / sidebar / side panel に対応** しており、構造変更は不要。
- メインキャンバスのうち、`Timeline` のみが実装されている。**`Execute` / `Tiles` / `Integrations` / `Settings` はほぼ stub** (行が `Text` のみで操作不能、または固定値で操作不能)。
- `MobileBottomBar.kt` (110行) は **grep 1件のみ (自身の定義行)** で呼出元なし → デッドコード。
- `SidePanelSheet` の "Schedule / References / Preferences" セクションは placeholder テキストのみ。

本 spec のゴールは:

1. メインキャンバス 4タブを **VM action を発火できる中身のある画面** にする。
2. `MobileBottomBar.kt` と関連 string resource を削除する (構造の正本化)。
3. `SidePanelSheet` の section 4〜5 を実データで埋める。

検証は **実 API 検証を主**。`tastile-core` のエンドポイントは既に wired (`V1ApiClient`, `V1CommandDispatcher`)。Android 側の責務は VM action → API call の結線と UI レンダリング。

---

## Non-Goals (本 spec で扱わない)

- Web の `/execute` ページ実装 (11行 stub) は対象外。tastile-web 側の別 spec。
- ナビゲーション構造の redesign (Bottom bar → side rail 化など)。
- Timeline の改善 (v36 で完了済み)。
- 通知 / ロック画面 / フルスクリーン alarm の OS レイヤ (既に wired、`SettingsScreen` の通知セクションは維持)。
- BiometricPrompt の UI 実装 (Security Lock は `setSecurityLockEnabled` の wiring まで)。
- 新規統合 (Outlook / Slack 等)。**Google Calendar のみを connected として扱う**。Available セクションのサンプル行はスタティックな「近日追加予定」テキストでよい。

---

## Architecture (不変)

```
MobileScaffold
├── MobileTopBar           (タイトル / スケール / メニュー / 通知 / アバター)
└── Box(fillMaxSize)
    ├── NavHost  ── メインキャンバス
    │   ├── "timeline"        → TimelineScreen     ✓ 完了 (v36)
    │   ├── "execute"         → ExecuteScreen      ← 本 spec で実装
    │   ├── "tiles"           → TilesScreen        ← 本 spec で実装
    │   ├── "integrations"    → IntegrationsScreen ← 本 spec で実装 (誤誘導タップ修正含む)
    │   └── "settings"        → SettingsScreen     ← 本 spec で実装
    └── OverlayLayer (既存)
        ├── Overlay.SidePanel(section)   → SidePanelSheet (2-page pager) ← section 内容を修正
        ├── Overlay.QuickCreate          → QuickCreateSheetMobile
        ├── Overlay.TileEdit(tileId)     → TileEditSheet
        ├── Overlay.Search               → SearchOverlaySheet
        ├── Overlay.Notifications        → NotificationsSheet
        └── Overlay.AccountMenu          → AccountMenuSheet
```

- `DashboardViewModel` の `StateFlow` / action は既に充足。本 spec は **UI から呼ぶだけ**。
- `Overlay` sealed class への追加は `Overlay.IntegrationConfig(integrationId)` の 1種類のみ (Integrations 誤誘導タップ修正のため)。

---

## 削除対象

### File

`app/src/main/java/app/tastile/android/ui/mobile/MobileBottomBar.kt` (110行)

確認: `rg "MobileBottomBar" app/src` の結果は **1 hit (定義行のみ)**。呼出元なし。

### Resources

`app/src/main/res/values/strings.xml` (および `-ja`):

- `mobile_bottom_timeline`
- `mobile_bottom_execute`
- `mobile_bottom_quick_create`
- `mobile_bottom_tiles`
- `mobile_bottom_settings`

これらは `MobileBottomBar.kt` からのみ参照。削除して安全。

---

## タブ別設計

### ExecuteScreen

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt` (現状 101行)

**構造**:

```
Column (verticalScroll)
├── ActiveTileHero            (started タイルがあれば表示)
│   ├── title (titleMedium)
│   ├── nextAction (bodySmall)
│   └── Row
│       ├── Button "Complete" → completeTile(id)
│       └── Button "Defer"    → deferTile(id)
├── Label "Today's tiles"
└── Column
    └── Today'sTileRow × N
        ├── lifecycle glyph
        ├── title + nextAction
        └── IconButton (overflow) → ActionMenu (Start/Complete/Defer/Delete)
```

**ロジック**:

- `viewModel.tiles` から `isStarted()` で 1件目を Active とする (既存)。
- "Today's tiles" のフィルタ:
  - `viewModel.selectedDay.value == LocalDate.now()` のときは `READY` + `STARTED` の全件。
  - それ以外は `viewModel.timeline` の items から `startAt` が `selectedDay` と一致する placement を取得し、紐づく `tileId` で逆引き。
  - 暫定実装: 常に「全 READY + STARTED」を表示し、UI タイトルを「Today and ready」にして意味的に正しいラベルにする。날짜絞り込みは次フェーズ。
- **注**: `Tile` データクラスに `dueAt` / `startAt` / `recurrence` トップレベルフィールドは **存在しない** (`app/src/main/java/app/tastile/android/data/model/Tile.kt` 参照)。時刻系は `temporalConditions` (JsonObject)、ラベル・プロジェクト等は `annotationConditions` (JsonObject) に格納される。本 spec では `temporalConditions` / `annotationConditions` の JSON パースは最小限とし、詳細スキーマ解析は次フェーズ。
- 空状態: "No tiles for today" + "Create" ボタン → `Overlay.QuickCreate`。

**VM wiring**:

- `viewModel.completeTile(id)` ← Complete ボタン
- `viewModel.deferTile(id)` ← Defer ボタン
- `viewModel.startTile(id)` ← overflow menu Start
- `viewModel.deleteTile(id)` ← overflow menu Delete (確認 dialog)
- `viewModel.selectTile(id)` + `overlay.show(Overlay.TileEdit(id))` ← 行タップ

### TilesScreen

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/tabs/TilesScreen.kt` (現状 127行)

**構造**:

```
Box (fillMaxSize)
├── Column (verticalScroll)
│   ├── FilterChipRow (All / Active / Done)
│   └── TileRow × N
│       ├── lifecycle glyph
│       ├── title + project + due date + 再帰バッジ
│       └── chevron
└── FAB (+)
```

**行の情報源**:

- `tile.title` — 必須
- `tile.project` — `tile.annotationConditions?.get("project")` から抽出 (SectionPanelContent.extractProjects と同方式)
- `tile.dueAt` 表示 — `tile.temporalConditions?.get("due_at")` または `tile.annotationConditions?.get("due_at")` から文字列抽出。`null` の場合は非表示。
- 再帰バッジ — `tile.annotationConditions?.containsKey("recurrence") == true` または `tile.temporalConditions?.containsKey("recurrence") == true` で表示。

**VM wiring**:

- 行タップ → `viewModel.selectTile(id)` + `overlay.show(Overlay.TileEdit(id))`
- FAB → `overlay.show(Overlay.QuickCreate)`

**filter chip 改善**: 現状の `Text("[○]")` を Material3 `FilterChip` に置換。選択状態の a11y を維持。

### IntegrationsScreen (誤誘導タップ修正)

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/tabs/IntegrationsScreen.kt` (現状 84行)

**現状の問題**: 行タップが `Overlay.SidePanel(Preferences)` に遷移している (誤誘導)。

**修正後の構造**:

```
Column (verticalScroll)
├── Section header "Connected"
│   └── IntegrationRow (Google Calendar)
│       ├── name + status "Connected" + ⚙ icon
│       ├── Inline button "Sync now"   → syncGoogleCalendarNow()
│       └── Inline button "Disconnect" → disconnectGoogleCalendar() + 確認 dialog
├── Section header "Available"
│   └── IntegrationRow × N (stub: "Outlook Calendar", "Apple Calendar" 等)
│       └── Inline button "Connect" → connectGoogleCalendar() (Google のみ実動、他は toast "近日追加予定")
```

**VM wiring**:

- `viewModel.syncGoogleCalendarNow()`
- `viewModel.disconnectGoogleCalendar()`
- `viewModel.connectGoogleCalendar()`

**Overlay 追加**:

`OverlayState.kt` の `sealed interface Overlay` に:

```kotlin
data class IntegrationConfig(val integrationId: String) : Overlay
```

`OverlayViewModel` は `current: StateFlow<Overlay>` のヘルパー関数で対応 (新規 action 不要、show / dismiss の既存メソッドを使用)。

行タップは **`Overlay.IntegrationConfig(it.id)`** を `overlay.show(...)` で表示。`OverlayLayer.kt` でこの Overlay をハンドル (Google Calendar の場合は設定項目リスト; それ以外は "近日追加予定")。

**注意**: 本 spec のスコープ外として「`IntegrationConfigSheet` の詳細 UI 作成」は minimal 実装でよい。Google Calendar 用の項目は `updateGoogleCalendarPolicy(syncMode, selectedCalendarId)` の呼び出しポイントのみ用意し、選択 UI は次フェーズ。

### SettingsScreen

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/tabs/SettingsScreen.kt` (現状 289行)

**現状**: Locale が読み取り専用、Theme が固定 "gray"、Privacy/About が no-op、通知セクションのみ実動。

**修正後の構造**:

```
Column (verticalScroll)
├── SettingsRow "Locale"   (現在値 + chevron) タップ → LocalePickerDialog
│       └── Picker: ja / en / system → setLocale(...)
├── SettingsRow "Theme"    (現在値 + chevron) タップ → ThemePickerDialog
│       └── Picker: gray / dark / light / system → setThemeMode(...)
├── SettingsRow "Security lock" (Switch + chevron)
│       └── トグル → setSecurityLockEnabled(...)
│       └── サブ行: "Timeout: 5 min" → TimeoutPickerDialog (5/15/60) → setSecurityLockTimeoutMinutes(...)
├── NotificationSettingsSection (既存) 維持
├── SettingsRow "Privacy"  → Overlay に外部 URL or テキスト表示
└── SettingsRow "About"    → バージョン + ライセンス + GitHub リンク
```

**Picker dialogs**:

新規ファイル: `app/src/main/java/app/tastile/android/ui/dashboard/components/PickerDialogs.kt`

- `LocalePickerDialog(current: AppLocale, onPick: (AppLocale) -> Unit, onDismiss: () -> Unit)`
- `ThemePickerDialog(current: ThemeMode, onPick: (ThemeMode) -> Unit, onDismiss: () -> Unit)`
- `TimeoutPickerDialog(currentMinutes: Int, onPick: (Int) -> Unit, onDismiss: () -> Unit)`

Material3 `AlertDialog` + `RadioButton` list。既存 `DurationPickerDialog` のスタイルに合わせる。

**現在値の取得**:

- `viewModel.locale.collectAsStateWithLifecycle()` (既存)
- `viewModel.themeMode.collectAsStateWithLifecycle()` (既存)
- `viewModel.securityLockEnabled.collectAsStateWithLifecycle()` (既存)
- `viewModel.securityLockTimeoutMinutes.collectAsStateWithLifecycle()` (既存)

**Privacy / About**:

- `Privacy`: `Overlay.Privacy` を追加し、外部 URL (本番のプライバシーポリシーが未定義なら "tastile.app/privacy" プレースホルダで OK) を `Intent.ACTION_VIEW` で開くボタン + 短い説明文。
- `About`: ハードコードの `versionName` (BuildConfig.VERSION_NAME) と GitHub リンク (`https://github.com/.../tastile-android` プレースホルダ可)。

---

## SidePanelSheet section 内容修正

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/sheets/SectionPanelContent.kt` (現状 384行)

### 現状と修正

| Section | 現状 | 修正後 |
|---|---|---|
| Calendar | MiniMonthCalendar + ScalePicker + ProjectsCheckboxSection ✓ | 維持 |
| Schedule | 2行の `ScheduleRow` (Recurring / Upcoming Deadlines) — いずれも dead label | `viewModel.tiles` から実データ: <br>・Recurring = `tiles.filter { it.recurrence != null }` のリスト<br>・Upcoming = `tiles.filter { (it.dueAt ?: it.startAt) != null && it.dueAt が 7日以内 }` |
| Projects | `ProjectsCheckboxSection` ✓ | 維持 |
| References | `SectionPlaceholder` | 4行の `SettingsRow`-style リンク:<br>・Help / Changelog / GitHub / Send feedback (いずれも Intent.ACTION_VIEW 起動) |
| Preferences | `SectionPlaceholder` | サマリ + リンク:<br>・Theme: 現在値表示 → Settings タブへ遷移<br>・Locale: 現在値表示 → Settings タブへ遷移<br>・Security lock: トグル (Settings と同期) |

### Schedule section の具体実装

```kotlin
@Composable
private fun ScheduleSectionContent(viewModel: DashboardViewModel) {
    val tiles by viewModel.tiles.collectAsStateWithLifecycle()
    val recurring = tiles.filter { it.annotationConditions?.containsKey("recurrence") == true
                                 || it.temporalConditions?.containsKey("recurrence") == true }
    // "Upcoming (7 days)" は暫定: due_at フィールドが 7日以内。null なら全件 (フィルタなし)。
    val upcoming = tiles.filter { tile ->
        val due = tile.temporalConditions?.get("due_at")?.jsonPrimitive?.contentOrNull
                  ?: tile.annotationConditions?.get("due_at")?.jsonPrimitive?.contentOrNull
        due?.let { runCatching { LocalDate.parse(it.substringBefore('T')) }.getOrNull() }
            ?.let { it in LocalDate.now()..LocalDate.now().plusDays(7) } ?: true
    }

    Column(...) {
        SectionLabel("Recurring")
        if (recurring.isEmpty()) {
            Text("No recurring tiles")
        } else {
            recurring.take(10).forEach { tile ->
                ScheduleTileRow(tile = tile, onClick = { /* open TileEdit */ })
            }
        }
        SectionLabel("Upcoming (7 days)")
        if (upcoming.isEmpty()) {
            Text("No upcoming deadlines")
        } else {
            upcoming.take(10).forEach { tile ->
                ScheduleTileRow(tile = tile, onClick = { /* open TileEdit */ })
            }
        }
    }
}
```

---

## リスクとロールバック

| リスク | 影響 | 対策 | ロールバック |
|---|---|---|---|
| `MobileBottomBar` 削除で layout 参照が浮く | 低 (grep で0件確認) | 削除前に最終 grep 再実行 | git revert で復活 |
| `Overlay.IntegrationConfig` 追加で `OverlayViewModel` の exhaustive when が壊れる | 中 | 該当 `when` を全箇所確認 + コンパイル green | `OverlayState.kt` の data class を撤回 |
| `Tile` model に `dueAt` / `recurrence` トップレベルが無い (確認済: `temporalConditions` / `annotationConditions` 配下) | 中 | JSON キーは暫定的に `"due_at"` / `"recurrence"` を期待。実 API レスポンスと違えば spec を修正 | 該当タブのフィールドを fallback で optional 化 |
| Picker dialog の Theme picker が `ThemeMode` enum の値を網羅しない | 低 | `ThemeMode.entries` をループ (ハードコード禁止) | enum 拡張時に同時修正 |
| Security lock の biometric UI を本 spec で扱う必要が出た | 中 | **本 spec では wiring のみ**。UI は次フェーズ | toggle を off にして release |

**ロールバック単位**: 各タブは独立 diff + 独立 commit。`git revert <hash>` で個別取り消し。

---

## 実装順序 (1 PR = 1 タブを基本、ただし MobileBottomBar 削除と SidePanel 修正は別 PR)

1. **PR1**: `MobileBottomBar.kt` + 関連 strings 削除。レイアウト regression がないことを gradle assembleDebug で確認。
2. **PR2**: `SidePanelSheet` の section 内容修正 (Schedule / References / Preferences)。
3. **PR3**: `ExecuteScreen` 実装。
4. **PR4**: `TilesScreen` 実装 (FAB + 改善 chip)。
5. **PR5**: `IntegrationsScreen` 実装 (誤誘導タップ修正 + Overlay 追加)。
6. **PR6**: `SettingsScreen` 実装 (Locale / Theme / Security / Privacy / About)。

各 PR は `app/src/main/java/.../{該当ファイル}` のみを主変更とし、共通 helper (PickerDialogs 等) は初出の PR で導入。

---

## 検証

各 PR 完了時に必ず実行:

- `./gradlew :app:lintDebug :app:lintRelease` (Android lint)
- `./gradlew :app:assembleDebug` (build green)
- `./gradlew :app:testDebugUnitTest` (unit test green)
- Android Studio の Compose preview で目視確認 (新規 Composable には必ず preview を付ける)
- 可能なら `./gradlew :app:installDebug` で実機 / エミュレータ install → 該当タブを表示して目視

CI は `tastile-android/.github/workflows/` の release.yml / pr-check.yml が走るので、`main` push 前にこれらが green であることを確認。

### 検証チェックリスト

- [ ] `ExecuteScreen`: started タイル表示、Complete / Defer ボタンが API call を発火
- [ ] `TilesScreen`: フィルタ chip 動作、行タップで `Overlay.TileEdit` 起動、FAB で `Overlay.QuickCreate` 起動
- [ ] `IntegrationsScreen`: Google Calendar "Sync now" / "Disconnect" がそれぞれ API call 発火、行タップが `Overlay.IntegrationConfig` を show
- [ ] `SettingsScreen`: Locale / Theme / Security lock の各 picker が `setLocale` / `setThemeMode` / `setSecurityLockEnabled` / `setSecurityLockTimeoutMinutes` を発火
- [ ] `MobileBottomBar` 削除後、Bottom に UI がない (clean)
- [ ] `SidePanelSheet`: Schedule / References / Preferences の各 section が実データを表示
- [ ] `Overlay.IntegrationConfig` の `when` exhaustive が全箇所で成立

---

## Open Questions

なし (本 spec のスコープ内で確定)。