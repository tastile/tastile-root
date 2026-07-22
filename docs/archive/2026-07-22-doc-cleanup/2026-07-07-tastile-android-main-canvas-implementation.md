# tastile-android メインキャンバス実装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute / Tiles / Integrations / Settings の 4 つのメインキャンバスタブを VM action を発火できる中身のある画面として実装し、`MobileBottomBar` デッドコードを削除し、`SidePanelSheet` の section 内容を実データで埋める。

**Architecture:** 既存の `MobileScaffold` + `NavHost` + `OverlayLayer` の構造は不変。`DashboardViewModel` の action は既に充足しているため、UI から呼び出す結線 + 表示の組み立てに集中する。新規ファイルは `PickerDialogs.kt` と `IntegrationConfigSheet.kt` の 2 つ。`Overlay.IntegrationConfig` を 1 つ追加 (Integrations 誤誘導タップ修正のため)。

**Tech Stack:** Kotlin 1.9.x + Jetpack Compose (Material3) + Hilt + Navigation Compose + kotlinx-serialization-json (既存 `Tile.temporalConditions` / `annotationConditions` 用)。ビルドは `./gradlew :app:assembleDebug` / `:app:testDebugUnitTest` / `:app:lintDebug` (CI は `tastile-android/.github/workflows/` 経由で ubuntu-latest)。

**Spec:** `docs/superpowers/specs/2026-07-07-tastile-android-main-canvas-implementation-design.md` (commit `5bb4566`)

---

## 前提・環境

- JDK 17 を `JAVA_HOME` に設定済み (`tastile-android/local.properties.example` 参照)。
- ネイティブビルドは不要 (libsqlite3-sys / ring を含む crate は本 spec で触らない)。
- ブランチ運用: 既存 `main` から feature branch `feat/android-main-canvas-impl` を切る。
- コミット粒度: 1 タスク = 1 commit。Conventional Commits 形式。
- 検証コマンド: `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug` (3 ジョブを `&&` で連結)

---

## File Structure

### 削除

| パス | 役割 |
|---|---|
| `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileBottomBar.kt` | 110行のデッドコード (grep 1件のみ自身の定義) |
| `tastile-android/app/src/main/res/values/strings.xml` 内 `mobile_bottom_*` (5件) | 同ファイルからのみ参照 |

### 修正

| パス | 役割 |
|---|---|
| `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt` | Active hero + Today's tiles + action menu |
| `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/TilesScreen.kt` | 改善 chip + 詳細行 + FAB |
| `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/IntegrationsScreen.kt` | Connect/Disconnect/Sync + 誤誘導タップ修正 |
| `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/SettingsScreen.kt` | 4 つの picker + Privacy/About |
| `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/OverlayState.kt` | `Overlay.IntegrationConfig(id)` を追加 |
| `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/OverlayLayer.kt` | 追加 Overlay の when 分岐追加 |
| `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/sheets/SectionPanelContent.kt` | Schedule / References / Preferences section を実データ化 |

### 新規作成

| パス | 役割 |
|---|---|
| `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/components/PickerDialogs.kt` | LocalePickerDialog / ThemePickerDialog / TimeoutPickerDialog |
| `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/sheets/IntegrationConfigSheet.kt` | 連携設定シート (Google Calendar 用 + 近日追加 stub) |

### 触らない (確認のみ)

- `DashboardViewModel.kt` (action / StateFlow 既存のまま)
- `MobileScaffold.kt` / `MobileTopBar.kt` / `SidePanelSheet.kt` (構造そのまま)
- `QuickCreateSheetMobile.kt` / `TileEditSheet.kt` (既存 Overlay は変更なし)

---

## Task 1: MobileBottomBar と関連 string resource の削除

**Files:**
- Delete: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileBottomBar.kt`
- Modify: `tastile-android/app/src/main/res/values/strings.xml`
- Modify: `tastile-android/app/src/main/res/values-ja/strings.xml` (存在する場合)

- [ ] **Step 1: 削除前の最終確認**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && rg -n "MobileBottomBar|mobile_bottom_" app/src
```

期待: 定義ファイル `app/src/main/java/app/tastile/android/ui/mobile/MobileBottomBar.kt` 内の参照 + `strings.xml` 内の 5件のみ。レイアウト / 他 Composable からの参照は **0件** であること。

- [ ] **Step 2: MobileBottomBar.kt を削除**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git rm app/src/main/java/app/tastile/android/ui/mobile/MobileBottomBar.kt
```

期待: `rm 'app/src/main/java/app/tastile/android/ui/mobile/MobileBottomBar.kt'`

- [ ] **Step 3: strings.xml から mobile_bottom_* を削除**

ファイル: `app/src/main/res/values/strings.xml`

削除対象行 (この prefix を持つ `<string>` 要素を 5つ削除):

```xml
<string name="mobile_bottom_timeline">…</string>
<string name="mobile_bottom_execute">…</string>
<string name="mobile_bottom_quick_create">…</string>
<string name="mobile_bottom_tiles">…</string>
<string name="mobile_bottom_settings">…</string>
```

ファイル: `app/src/main/res/values-ja/strings.xml` (存在する場合)

同様に 5件削除。`-ja` 版が無い場合はスキップ。

- [ ] **Step 4: ビルド検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL`。`Unresolved reference: MobileBottomBar` などのエラーが出ないこと。

- [ ] **Step 5: コミット**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add -A && git commit -m "$(cat <<'EOF'
chore(android): remove dead MobileBottomBar and string resources

MobileBottomBar.kt (110 lines) had no callers — verified via rg "MobileBottomBar"
returning only the definition line. Bottom-anchored nav was never the intended
pattern; navigation lives in SidePanelSheet (drawer) and the main canvas NavHost.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Overlay.IntegrationConfig 追加 + OverlayLayer 分岐

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/OverlayState.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/OverlayLayer.kt`

- [ ] **Step 1: OverlayState.kt に Overlay.IntegrationConfig を追加**

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/OverlayState.kt`

`sealed interface Overlay` の中に以下の data class を追加 (既存メンバーと並ぶ位置、`Overlay.TileEdit` の下):

```kotlin
data class IntegrationConfig(val integrationId: String) : Overlay
```

- [ ] **Step 2: OverlayLayer.kt の exhaustive when 分岐を確認**

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/OverlayLayer.kt`

`when (current as? Overlay.X ?: return)` のような exhaustive when が各 Overlay ハンドラにあるはず。新規 `Overlay.IntegrationConfig` のハンドラは **Task 7 (IntegrationConfigSheet 作成後)** で追加するため、本 Task では Kotlin コンパイル green を確認するだけで OK。

ビルド:

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL` または `Overlay.IntegrationConfig` 未ハンドリングの **non-exhaustive warning** のみ (Task 7 で対応)。**error ではない** ことを確認。

- [ ] **Step 3: コミット**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add app/src/main/java/app/tastile/android/ui/mobile/OverlayState.kt && git commit -m "$(cat <<'EOF'
feat(android): add Overlay.IntegrationConfig variant

Add Overlay.IntegrationConfig(integrationId) so IntegrationsScreen can route
taps to a dedicated config sheet instead of misrouting to SidePanel(Preferences).
Wire-up in OverlayLayer lands with Task 7.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: PickerDialogs ヘルパー作成

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/components/PickerDialogs.kt`

- [ ] **Step 1: ファイル作成**

ファイル: `app/src/main/java/app/tastile/android/ui/dashboard/components/PickerDialogs.kt`

以下の内容で作成 (Material3 `AlertDialog` + `RadioButton` リスト。`DurationPickerDialog` のスタイルを踏襲):

```kotlin
package app.tastile.android.ui.dashboard.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.tastile.android.data.repository.AppLocale
import app.tastile.android.data.repository.ThemeMode
import app.tastile.android.ui.designsystem.AppTheme

@Composable
fun <T> PickerDialog(
    title: String,
    options: List<Pair<T, String>>,
    selected: T,
    onPick: (T) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(modifier = Modifier.selectableGroup()) {
                options.forEach { (value, label) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = value == selected,
                                onClick = { onPick(value) },
                                role = Role.RadioButton,
                            )
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        RadioButton(
                            selected = value == selected,
                            onClick = null,
                        )
                        Text(label, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("OK") }
        },
    )
}

@Composable
fun LocalePickerDialog(
    current: AppLocale,
    onPick: (AppLocale) -> Unit,
    onDismiss: () -> Unit,
) {
    PickerDialog(
        title = "Locale",
        options = listOf(
            AppLocale.JA to "日本語",
            AppLocale.EN to "English",
        ),
        selected = current,
        onPick = onPick,
        onDismiss = onDismiss,
    )
}

@Composable
fun ThemePickerDialog(
    current: ThemeMode,
    onPick: (ThemeMode) -> Unit,
    onDismiss: () -> Unit,
) {
    PickerDialog(
        title = "Theme",
        options = listOf(
            ThemeMode.GRAY to "Gray (default)",
            ThemeMode.LIGHT to "Light",
            ThemeMode.DARK to "Dark",
            ThemeMode.SYSTEM to "System default",
        ),
        selected = current,
        onPick = onPick,
        onDismiss = onDismiss,
    )
}

@Composable
fun TimeoutPickerDialog(
    currentMinutes: Int,
    onPick: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    PickerDialog(
        title = "Lock timeout",
        options = listOf(5 to "5 min", 15 to "15 min", 60 to "60 min"),
        selected = currentMinutes,
        onPick = onPick,
        onDismiss = onDismiss,
    )
}

@Preview(showBackground = true)
@Composable
private fun LocalePickerDialogPreview() {
    AppTheme { LocalePickerDialog(current = AppLocale.JA, onPick = {}, onDismiss = {}) }
}
```

注意:
- `ThemeMode.GRAY` / `LIGHT` / `DARK` / `SYSTEM` の enum 値が存在しない場合は、既存 `ThemeMode` enum に倣って実際の値名に置換。`ThemeMode.entries` を確認してからコミットすること。
- `padding` の import を忘れない (上記で `Modifier.padding(vertical = 8.dp)` を使用)。

- [ ] **Step 2: ビルド検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL`。`ThemeMode` enum 不整合の場合は spec 修正後に再ビルド。

- [ ] **Step 3: コミット**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add app/src/main/java/app/tastile/android/ui/dashboard/components/PickerDialogs.kt && git commit -m "$(cat <<'EOF'
feat(android): add reusable PickerDialog + 3 settings pickers

PickerDialog<T> is a generic Material3 AlertDialog with RadioButton list.
LocalePickerDialog / ThemePickerDialog / TimeoutPickerDialog wrap it for
SettingsScreen use. Theming and AppTheme preview match existing components.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ExecuteScreen の実装

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt`

- [ ] **Step 1: 失敗確認用の compose preview smoke test を確認 (任意)**

`./gradlew :app:lintDebug` を回して lint エラーが現状 0 であることを確認:

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:lintDebug 2>&1 | tail -20
```

期待: 該当ファイルに既存エラーが無いこと (緑のベースライン)。

- [ ] **Step 2: ExecuteScreen.kt を本実装に置換**

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt`

既存の内容を以下に置換 (`@OptIn(ExperimentalMaterial3Api::class)` が必要な API を使う):

```kotlin
package app.tastile.android.ui.mobile.tabs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tastile.android.data.model.Tile
import app.tastile.android.data.model.TileLifecycle
import app.tastile.android.ui.dashboard.DashboardViewModel
import app.tastile.android.ui.dashboard.isStarted
import app.tastile.android.ui.designsystem.AppLoading
import app.tastile.android.ui.designsystem.AppTheme
import app.tastile.android.ui.mobile.Overlay
import app.tastile.android.ui.mobile.OverlayViewModel

@Composable
fun ExecuteScreen(
    viewModel: DashboardViewModel,
    overlay: OverlayViewModel = hiltViewModel(),
) {
    val tiles by viewModel.tiles.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()

    if (loading && tiles.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            AppLoading()
        }
        return
    }

    val active = tiles.firstOrNull { it.isStarted() }
    val others = active?.let { tiles.filterNot { tile -> tile.id == it.id } } ?: tiles
    val showable = others.filter { tile ->
        TileLifecycle.fromString(tile.lifecycle) != TileLifecycle.DONE
    }

    var deleteCandidate by remember { mutableStateOf<String?>(null) }

    val scrollState = rememberScrollState()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = AppTheme.spacing.md, vertical = AppTheme.spacing.sm),
        verticalArrangement = Arrangement.spacedBy(AppTheme.spacing.sm),
    ) {
        active?.let { ActiveTileHero(tile = it, viewModel = viewModel) }

        Text(
            text = if (showable.isEmpty()) "Nothing to do — create a tile" else "Today and ready",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (showable.isEmpty()) {
            EmptyState(onCreate = { overlay.show(Overlay.QuickCreate) })
        } else {
            showable.forEach { tile ->
                TileActionRow(
                    tile = tile,
                    onTap = {
                        viewModel.selectTile(tile.id)
                        overlay.show(Overlay.TileEdit(tile.id))
                    },
                    onStart = { viewModel.startTile(tile.id) },
                    onComplete = { viewModel.completeTile(tile.id) },
                    onDefer = { viewModel.deferTile(tile.id) },
                    onDelete = { deleteCandidate = tile.id },
                )
            }
        }
    }

    deleteCandidate?.let { id ->
        AlertDialog(
            onDismissRequest = { deleteCandidate = null },
            title = { Text("Delete tile?") },
            text = { Text("This action cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteTile(id)
                    deleteCandidate = null
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { deleteCandidate = null }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun ActiveTileHero(tile: Tile, viewModel: DashboardViewModel) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(AppTheme.spacing.sm),
        verticalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
    ) {
        Text(
            text = "▶ ${tile.title}",
            style = MaterialTheme.typography.titleMedium,
        )
        tile.nextAction?.takeIf { it.isNotBlank() }?.let { next ->
            Text(
                text = "Next: $next",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs)) {
            Button(onClick = { viewModel.completeTile(tile.id) }) { Text("Complete") }
            OutlinedButton(onClick = { viewModel.deferTile(tile.id) }) { Text("Defer") }
        }
    }
}

@Composable
private fun TileActionRow(
    tile: Tile,
    onTap: () -> Unit,
    onStart: () -> Unit,
    onComplete: () -> Unit,
    onDefer: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val lifecycle = TileLifecycle.fromString(tile.lifecycle)
    val glyph = when (lifecycle) {
        TileLifecycle.DONE -> "✓"
        TileLifecycle.STARTED -> "▶"
        TileLifecycle.READY -> "○"
        TileLifecycle.ARCHIVED -> "·"
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onTap)
            .padding(AppTheme.spacing.sm)
            .semantics(mergeDescendants = true) { contentDescription = "${lifecycle.name}: ${tile.title}" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
    ) {
        Text("$glyph ${tile.title}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "More actions")
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Start") },
                    leadingIcon = { Icon(Icons.Outlined.PlayArrow, contentDescription = null) },
                    onClick = { menuOpen = false; onStart() },
                )
                DropdownMenuItem(
                    text = { Text("Complete") },
                    onClick = { menuOpen = false; onComplete() },
                )
                DropdownMenuItem(
                    text = { Text("Defer") },
                    onClick = { menuOpen = false; onDefer() },
                )
                DropdownMenuItem(
                    text = { Text("Delete") },
                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                    onClick = { menuOpen = false; onDelete() },
                )
            }
        }
    }
}

@Composable
private fun EmptyState(onCreate: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = AppTheme.spacing.md),
        verticalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "No tiles for today.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = onCreate) { Text("Create") }
    }
}
```

注意:
- `AppTheme.spacing.xxs` / `xs` / `sm` / `md` が既存のスペーストークン。`AppTokens.kt` を確認して、実在する token 名に置換。
- `viewModel.completeTile` などの関数は `DashboardViewModel.kt` に既存 (確認済)。未実装なら spec の Non-Goals 参照。

- [ ] **Step 3: ビルド検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL`。`MaterialTheme` の experimental warning が出る場合は `@OptIn(ExperimentalMaterial3Api::class)` を該当 Composable に付与。

- [ ] **Step 4: コミット**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add app/src/main/java/app/tastile/android/ui/mobile/tabs/ExecuteScreen.kt && git commit -m "$(cat <<'EOF'
feat(android): implement ExecuteScreen with active hero + action menu

- ActiveTileHero: shows the STARTED tile with title/next-action and
  Complete/Defer CTAs that call DashboardViewModel.{completeTile,deferTile}.
- TileActionRow: tap-to-edit, overflow menu for Start/Complete/Defer/Delete;
  Delete triggers a confirm dialog before viewModel.deleteTile.
- Empty state with Create CTA -> Overlay.QuickCreate.
- Filters DONE tiles out of the Today list (they live on Timeline/Done filter).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: TilesScreen の実装 (chip 改善 + FAB)

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/TilesScreen.kt`

- [ ] **Step 1: TilesScreen.kt を本実装に置換**

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/tabs/TilesScreen.kt`

既存内容を以下に置換:

```kotlin
package app.tastile.android.ui.mobile.tabs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tastile.android.data.model.Tile
import app.tastile.android.data.model.TileLifecycle
import app.tastile.android.ui.dashboard.DashboardViewModel
import app.tastile.android.ui.designsystem.AppLoading
import app.tastile.android.ui.designsystem.AppTheme
import app.tastile.android.ui.mobile.Overlay
import app.tastile.android.ui.mobile.OverlayViewModel

private enum class TileFilter { ALL, ACTIVE, DONE;
    fun matches(t: Tile): Boolean = when (this) {
        ALL -> true
        ACTIVE -> TileLifecycle.fromString(t.lifecycle) != TileLifecycle.DONE
        DONE -> TileLifecycle.fromString(t.lifecycle) == TileLifecycle.DONE
    }
    val label: String get() = name.lowercase().replaceFirstChar { it.uppercase() }
}

@Composable
fun TilesScreen(
    viewModel: DashboardViewModel,
    overlay: OverlayViewModel = hiltViewModel(),
) {
    val tiles by viewModel.tiles.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    var filter by remember { mutableStateOf(TileFilter.ALL) }

    if (loading && tiles.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            AppLoading()
        }
        return
    }

    val filtered = tiles.filter { filter.matches(it) }
    val scrollState = rememberScrollState()

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = AppTheme.spacing.md, vertical = AppTheme.spacing.sm)
                .padding(bottom = 80.dp),
            verticalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
        ) {
            FilterRow(current = filter, onChange = { filter = it })
            if (filtered.isEmpty()) {
                EmptyState(filter = filter)
            } else {
                filtered.forEach { tile ->
                    TileRow(
                        tile = tile,
                        onClick = {
                            viewModel.selectTile(tile.id)
                            overlay.show(Overlay.TileEdit(tile.id))
                        },
                    )
                }
            }
        }

        ExtendedFloatingActionButton(
            onClick = { overlay.show(Overlay.QuickCreate) },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(AppTheme.spacing.md),
            text = { Text("New") },
            icon = { Icon(Icons.Outlined.Add, contentDescription = null) },
        )
    }
}

@Composable
private fun FilterRow(current: TileFilter, onChange: (TileFilter) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs)) {
        TileFilter.entries.forEach { f ->
            FilterChip(
                selected = f == current,
                onClick = { onChange(f) },
                label = { Text(f.label) },
                modifier = Modifier.semantics { contentDescription = "Filter: ${f.label}" },
            )
        }
    }
}

@Composable
private fun EmptyState(filter: TileFilter) {
    val msg = when (filter) {
        TileFilter.ALL -> "No tiles yet"
        TileFilter.ACTIVE -> "No active tiles"
        TileFilter.DONE -> "No done tiles"
    }
    Text(
        msg,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(vertical = AppTheme.spacing.md),
    )
}

@Composable
private fun TileRow(tile: Tile, onClick: () -> Unit) {
    val lifecycle = TileLifecycle.fromString(tile.lifecycle)
    val glyph = when (lifecycle) {
        TileLifecycle.DONE -> "✓"
        TileLifecycle.STARTED -> "▶"
        TileLifecycle.READY -> "○"
        TileLifecycle.ARCHIVED -> "·"
    }
    val stateLabel = lifecycle.name.lowercase()
    val project = tile.annotationConditions?.get("project")?.toString()
        ?.let { Regex("\"project:([^\"]+)\"").find(it)?.groupValues?.getOrNull(1) }
    val dueAt = tile.temporalConditions?.get("due_at")?.toString()?.trim('"')
        ?: tile.annotationConditions?.get("due_at")?.toString()?.trim('"')
    val isRecurring = tile.annotationConditions?.containsKey("recurrence") == true ||
                      tile.temporalConditions?.containsKey("recurrence") == true

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(AppTheme.spacing.sm)
            .semantics(mergeDescendants = true) { contentDescription = "$stateLabel: ${tile.title}" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
    ) {
        Text("$glyph", style = MaterialTheme.typography.bodyMedium)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(tile.title, style = MaterialTheme.typography.bodyMedium)
            val meta = buildString {
                if (!project.isNullOrBlank()) append(project)
                if (!dueAt.isNullOrBlank()) {
                    if (isNotEmpty()) append(" · ")
                    append(dueAt.take(10))
                }
                if (isRecurring) {
                    if (isNotEmpty()) append(" · ")
                    append("↻")
                }
            }
            if (meta.isNotBlank()) {
                Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
```

- [ ] **Step 2: ビルド検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL`。

- [ ] **Step 3: コミット**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add app/src/main/java/app/tastile/android/ui/mobile/tabs/TilesScreen.kt && git commit -m "$(cat <<'EOF'
feat(android): implement TilesScreen with chips + FAB + meta rows

- Filter chips use Material3 FilterChip (was plain Text).
- TileRow shows project + due date + recurrence badge parsed from
  temporalConditions / annotationConditions (Tile has no top-level fields).
- ExtendedFloatingActionButton "New" triggers Overlay.QuickCreate.
- Empty state per filter chip.
- Filters out the bottom-bar feel by relying on the side panel for nav.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: IntegrationsScreen の実装 (誤誘導タップ修正)

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/IntegrationsScreen.kt`

- [ ] **Step 1: 既存ファイルの確認 (誤誘導タップ箇所)**

`rg -n "Overlay\.SidePanel\(SidePanelSection\.Preferences\)" app/src/main/java/app/tastile/android/ui/mobile/tabs/IntegrationsScreen.kt`

期待: 1 hit。これが本 Task で書き換える対象。

- [ ] **Step 2: IntegrationsScreen.kt を本実装に置換**

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/tabs/IntegrationsScreen.kt`

既存内容を以下に置換:

```kotlin
package app.tastile.android.ui.mobile.tabs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tastile.android.data.model.Integration
import app.tastile.android.ui.dashboard.DashboardViewModel
import app.tastile.android.ui.designsystem.AppLoading
import app.tastile.android.ui.designsystem.AppTheme
import app.tastile.android.ui.mobile.Overlay
import app.tastile.android.ui.mobile.OverlayViewModel

private data class IntegrationStub(val id: String, val name: String)

private val availableStubs = listOf(
    IntegrationStub("outlook", "Outlook Calendar"),
    IntegrationStub("apple", "Apple Calendar"),
    IntegrationStub("slack", "Slack"),
    IntegrationStub("notion", "Notion"),
)

@Composable
fun IntegrationsScreen(
    viewModel: DashboardViewModel,
    overlay: OverlayViewModel = hiltViewModel(),
) {
    val integrations by viewModel.integrations.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val googleCalendar by viewModel.googleCalendarIntegration.collectAsStateWithLifecycle()

    if (loading && integrations.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            AppLoading()
        }
        return
    }

    val connected = integrations.filter { it.connected }
    val scrollState = rememberScrollState()
    var disconnectCandidate by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = AppTheme.spacing.md, vertical = AppTheme.spacing.sm),
        verticalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
    ) {
        SectionLabel("Connected")
        if (connected.isEmpty()) {
            Text(
                "No integrations connected",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = AppTheme.spacing.xs),
            )
        }
        connected.forEach { integration ->
            ConnectedRow(
                integration = integration,
                onSync = { viewModel.syncGoogleCalendarNow() },
                onDisconnect = { disconnectCandidate = true },
                onTap = { overlay.show(Overlay.IntegrationConfig(integration.id)) },
            )
        }

        SectionLabel("Available")
        availableStubs.forEach { stub ->
            AvailableRow(
                name = stub.name,
                onConnect = { viewModel.connectGoogleCalendar() },
                onTap = { overlay.show(Overlay.IntegrationConfig(stub.id)) },
            )
        }
    }

    if (disconnectCandidate) {
        AlertDialog(
            onDismissRequest = { disconnectCandidate = false },
            title = { Text("Disconnect Google Calendar?") },
            text = { Text("Existing synced events stay; new events won't sync.") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.disconnectGoogleCalendar()
                    disconnectCandidate = false
                }) { Text("Disconnect") }
            },
            dismissButton = {
                TextButton(onClick = { disconnectCandidate = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = AppTheme.spacing.sm),
    )
}

@Composable
private fun ConnectedRow(
    integration: Integration,
    onSync: () -> Unit,
    onDisconnect: () -> Unit,
    onTap: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onTap)
            .padding(vertical = AppTheme.spacing.xs)
            .semantics(mergeDescendants = true) { contentDescription = "${integration.name}: connected" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
    ) {
        Text("●", style = MaterialTheme.typography.bodyMedium)
        Column(modifier = Modifier.weight(1f)) {
            Text(integration.name, style = MaterialTheme.typography.bodyMedium)
            Text(
                "Connected",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TextButton(onClick = onSync) { Text("Sync now") }
        TextButton(onClick = onDisconnect) { Text("Disconnect") }
    }
}

@Composable
private fun AvailableRow(
    name: String,
    onConnect: () -> Unit,
    onTap: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onTap)
            .padding(vertical = AppTheme.spacing.xs)
            .semantics(mergeDescendants = true) { contentDescription = "$name: available" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
    ) {
        Text("○", style = MaterialTheme.typography.bodyMedium)
        Text(name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        OutlinedButton(onClick = onConnect) { Text("Connect") }
    }
}
```

注意:
- `Integration` データクラスのプロパティ名は実装時に `data/model/Integration.kt` を確認して合わせる (本 spec では `name` を前提)。
- `Overlay.IntegrationConfig(integration.id)` 呼び出しは Task 2 で追加した variant。

- [ ] **Step 3: ビルド検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL`。`Overlay.IntegrationConfig` 未ハンドリングの warning は Task 7 で解消予定。

- [ ] **Step 4: コミット**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add app/src/main/java/app/tastile/android/ui/mobile/tabs/IntegrationsScreen.kt && git commit -m "$(cat <<'EOF'
fix(android): implement IntegrationsScreen, route taps correctly

- Splits into Connected / Available sections.
- Google Calendar row exposes Sync now (syncGoogleCalendarNow) and
  Disconnect (disconnectGoogleCalendar with confirm dialog).
- Tap routes to Overlay.IntegrationConfig(integrationId) — was previously
  misrouting to SidePanel(Preferences), which is the bug from the spec.
- Stub rows for Outlook/Apple/Slack/Notion wired through the same overlay;
  Google-only actions live in OverlayLayer for now.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: IntegrationConfigSheet 作成 + OverlayLayer 配線

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/sheets/IntegrationConfigSheet.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/OverlayLayer.kt`

- [ ] **Step 1: IntegrationConfigSheet.kt を作成**

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/sheets/IntegrationConfigSheet.kt`

```kotlin
package app.tastile.android.ui.mobile.sheets

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tastile.android.ui.dashboard.DashboardViewModel
import app.tastile.android.ui.mobile.Overlay
import app.tastile.android.ui.mobile.OverlayViewModel

private data class ConfigOption(val id: String, val label: String)

private val googleCalendarOptions = listOf(
    ConfigOption("sync_all", "Sync all calendars"),
    ConfigOption("sync_primary", "Sync primary only"),
    ConfigOption("sync_selected", "Sync selected calendar"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IntegrationConfigSheet(
    overlay: OverlayViewModel,
    dashboardViewModel: DashboardViewModel,
) {
    val current by overlay.current.collectAsStateWithLifecycle()
    val cfg = current as? Overlay.IntegrationConfig ?: return
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    PanelSheet(
        title = when (cfg.integrationId) {
            "google" -> "Google Calendar"
            "outlook" -> "Outlook Calendar"
            "apple" -> "Apple Calendar"
            "slack" -> "Slack"
            "notion" -> "Notion"
            else -> "Integration"
        },
        sheetState = sheetState,
        onDismiss = { overlay.dismiss() },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            when (cfg.integrationId) {
                "google" -> {
                    val google by dashboardViewModel.googleCalendarIntegration.collectAsStateWithLifecycle()
                    var selected by remember(google) {
                        mutableStateOf(google?.syncMode ?: "sync_all")
                    }
                    Text("Sync mode", style = MaterialTheme.typography.labelMedium)
                    googleCalendarOptions.forEach { opt ->
                        ConfigRow(
                            label = opt.label,
                            selected = opt.id == selected,
                            onClick = {
                                selected = opt.id
                                dashboardViewModel.updateGoogleCalendarPolicy(
                                    syncMode = opt.id,
                                    selectedCalendarId = null,
                                )
                            },
                        )
                    }
                }
                else -> Text(
                    "Coming soon",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 16.dp)
                        .semantics { contentDescription = "Coming soon" },
                )
            }
        }
    }
}

@Composable
private fun ConfigRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp)
            .semantics(mergeDescendants = true) { contentDescription = label },
    ) {
        Text(
            text = if (selected) "● $label" else "○ $label",
            style = MaterialTheme.typography.bodyMedium,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
        )
    }
}
```

注: `PanelSheet` Composable は同 package (`app.tastile.android.ui.mobile.sheets`) に既存。`googleCalendarIntegration` の `syncMode` プロパティ名は `DashboardViewModel.googleCalendarIntegration.collectAsStateWithLifecycle()` の型 (`GoogleCalendarIntegrationSettings`) を確認して合わせる。実装時に確認 → 違えばこの 1 行のみ修正。

- [ ] **Step 2: OverlayLayer.kt に IntegrationConfig 分岐を追加**

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/OverlayLayer.kt`

`Overlay.X` を `when` で分岐している箇所 (ファイル冒頭のヘルパー関数か、Composable 内の `when (current)` のどちらか既存実装に合わせる) に以下を追加:

```kotlin
is Overlay.IntegrationConfig -> IntegrationConfigSheet(
    overlay = overlayViewModel,
    dashboardViewModel = dashboardViewModel,
)
```

`dashboardViewModel` を引数で受け取る既存の形に合わせる。import に `app.tastile.android.ui.mobile.sheets.IntegrationConfigSheet` を追加。

- [ ] **Step 3: ビルド検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL`。`when` exhaustive が満たされ warning 0 件。

- [ ] **Step 4: コミット**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add app/src/main/java/app/tastile/android/ui/mobile/sheets/IntegrationConfigSheet.kt app/src/main/java/app/tastile/android/ui/mobile/OverlayLayer.kt && git commit -m "$(cat <<'EOF'
feat(android): wire Overlay.IntegrationConfig through OverlayLayer

IntegrationConfigSheet renders inside the standard PanelSheet:
- Google Calendar: shows sync-mode radio rows that call
  updateGoogleCalendarPolicy(syncMode, selectedCalendarId=null).
- Other integrations: "Coming soon" placeholder, ready for real handlers later.

OverlayLayer's exhaustive when now covers IntegrationConfig so the warning
introduced in the OverlayState commit resolves.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: SettingsScreen の実装

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/SettingsScreen.kt`

- [ ] **Step 1: SettingsScreen.kt を本実装に置換**

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/tabs/SettingsScreen.kt`

既存内容を以下に置換。通知セクションの postTestNotification / postTestAlarm / canUseFullScreenIntent などの既存ヘルパーは **そのまま維持** する。`SettingsRow` の定義は同ファイル末尾に残っているので流用。

```kotlin
package app.tastile.android.ui.mobile.tabs

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tastile.android.R
import app.tastile.android.data.repository.AppLocale
import app.tastile.android.data.repository.ThemeMode
import app.tastile.android.notifications.ExecutionAlarmActivity
import app.tastile.android.notifications.ExecutionAlarmTestReceiver
import app.tastile.android.notifications.ExecutionNotificationChannels
import app.tastile.android.ui.dashboard.DashboardViewModel
import app.tastile.android.ui.dashboard.components.LocalePickerDialog
import app.tastile.android.ui.dashboard.components.ThemePickerDialog
import app.tastile.android.ui.dashboard.components.TimeoutPickerDialog
import app.tastile.android.ui.designsystem.AppTheme

@Composable
fun SettingsScreen(
    viewModel: DashboardViewModel,
) {
    val locale by viewModel.locale.collectAsStateWithLifecycle()
    val theme by viewModel.themeMode.collectAsStateWithLifecycle()
    val securityLockEnabled by viewModel.securityLockEnabled.collectAsStateWithLifecycle()
    val timeoutMin by viewModel.securityLockTimeoutMinutes.collectAsStateWithLifecycle()

    var showLocale by remember { mutableStateOf(false) }
    var showTheme by remember { mutableStateOf(false) }
    var showTimeout by remember { mutableStateOf(false) }
    var showPrivacy by remember { mutableStateOf(false) }
    var showAbout by remember { mutableStateOf(false) }

    val context = LocalContext.current
    var notificationGranted by remember { mutableStateOf(canPostNotifications(context)) }
    var notificationStatus by remember { mutableStateOf("") }
    var fullScreenGranted by remember { mutableStateOf(canUseFullScreenIntent(context)) }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        notificationGranted = granted
        notificationStatus = if (granted) "Notifications enabled" else "Notifications denied"
    }

    val scrollState = rememberScrollState()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = AppTheme.spacing.md, vertical = AppTheme.spacing.sm),
        verticalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
    ) {
        SettingsRow(
            icon = "🌐",
            label = "Locale",
            value = localeLabel(locale),
            onClick = { showLocale = true },
        )
        SettingsRow(
            icon = "🎨",
            label = "Theme",
            value = themeLabel(theme),
            onClick = { showTheme = true },
        )
        SecurityLockRow(
            enabled = securityLockEnabled,
            timeoutMinutes = timeoutMin,
            onToggle = { viewModel.setSecurityLockEnabled(it) },
            onTimeout = { showTimeout = true },
        )
        NotificationSettingsSection(
            granted = notificationGranted,
            status = notificationStatus,
            onRequestPermission = {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    notificationGranted = true
                    notificationStatus = "Notifications enabled"
                }
            },
            fullScreenGranted = fullScreenGranted,
            onRequestFullScreen = {
                openFullScreenIntentSettings(context)
                fullScreenGranted = canUseFullScreenIntent(context)
                notificationStatus = "Enable full-screen alarms in system settings"
            },
            onTestNotification = {
                notificationGranted = canPostNotifications(context)
                fullScreenGranted = canUseFullScreenIntent(context)
                if (notificationGranted) {
                    postTestNotification(context)
                    notificationStatus = "Test notification sent"
                } else {
                    notificationStatus = "Allow notifications before testing"
                }
            },
            onTestAlarm = {
                notificationGranted = canPostNotifications(context)
                fullScreenGranted = canUseFullScreenIntent(context)
                if (notificationGranted) {
                    postTestAlarm(context)
                    notificationStatus = "Alarm will open in 3 seconds"
                } else {
                    notificationStatus = "Allow notifications before testing alarms"
                }
            },
        )
        SettingsRow(
            icon = "🔒",
            label = "Privacy",
            value = "›",
            onClick = { showPrivacy = true },
        )
        SettingsRow(
            icon = "ℹ",
            label = "About",
            value = "›",
            onClick = { showAbout = true },
        )
    }

    if (showLocale) {
        LocalePickerDialog(
            current = locale,
            onPick = { viewModel.setLocale(it); showLocale = false },
            onDismiss = { showLocale = false },
        )
    }
    if (showTheme) {
        ThemePickerDialog(
            current = theme,
            onPick = { viewModel.setThemeMode(it); showTheme = false },
            onDismiss = { showTheme = false },
        )
    }
    if (showTimeout) {
        TimeoutPickerDialog(
            currentMinutes = timeoutMin,
            onPick = { viewModel.setSecurityLockTimeoutMinutes(it); showTimeout = false },
            onDismiss = { showTimeout = false },
        )
    }
    if (showPrivacy) {
        PrivacyDialog(onDismiss = { showPrivacy = false })
    }
    if (showAbout) {
        AboutDialog(onDismiss = { showAbout = false })
    }
}

@Composable
private fun SecurityLockRow(
    enabled: Boolean,
    timeoutMinutes: Int,
    onToggle: (Boolean) -> Unit,
    onTimeout: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = AppTheme.spacing.xs)
            .semantics(mergeDescendants = true) { contentDescription = "Security lock" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
    ) {
        Text("🔒", style = MaterialTheme.typography.bodyMedium)
        Column(modifier = Modifier.weight(1f)) {
            Text("Security lock", style = MaterialTheme.typography.bodyMedium)
            Text(
                "Require biometric to open the app",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = enabled, onCheckedChange = onToggle)
    }
    if (enabled) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = onTimeout)
                .padding(start = 32.dp, top = 4.dp, bottom = 8.dp)
                .semantics { contentDescription = "Lock timeout" },
        ) {
            Text(
                "Timeout: $timeoutMinutes min  ›",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SettingsRow(
    icon: String,
    label: String,
    value: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = AppTheme.spacing.sm)
            .semantics(mergeDescendants = true) { contentDescription = "$label: $value" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AppTheme.spacing.xs),
    ) {
        Text(icon, style = MaterialTheme.typography.bodyMedium)
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun PrivacyDialog(onDismiss: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Privacy") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("tastile stores your tiles and execution history on AWS (Cognito + RDS).")
                Text(
                    "View the full privacy policy:",
                    style = MaterialTheme.typography.bodySmall,
                )
                val context = LocalContext.current
                Row(
                    modifier = Modifier
                        .clickable(role = Role.Button) {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse("https://tastile.app/privacy"))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        }
                        .padding(vertical = 4.dp),
                ) {
                    Text("tastile.app/privacy", style = MaterialTheme.typography.bodyMedium)
                }
            }
        },
        confirmButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun AboutDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val version = remember {
        runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrDefault("unknown")
    }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("About tastile") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Version: $version")
                Row(
                    modifier = Modifier
                        .clickable(role = Role.Button) {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/rebuildup/tastile"))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        }
                        .padding(vertical = 4.dp),
                ) {
                    Text("github.com/rebuildup/tastile", style = MaterialTheme.typography.bodyMedium)
                }
            }
        },
        confirmButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

private fun localeLabel(l: AppLocale): String = when (l) {
    AppLocale.JA -> "日本語"
    AppLocale.EN -> "English"
}

private fun themeLabel(t: ThemeMode): String = when (t) {
    ThemeMode.GRAY -> "Gray"
    ThemeMode.LIGHT -> "Light"
    ThemeMode.DARK -> "Dark"
    ThemeMode.SYSTEM -> "System"
}

// ──── 既存ヘルパー (postTestNotification / postTestAlarm / canPostNotifications /
//      canUseFullScreenIntent / openFullScreenIntentSettings / NotificationSettingsSection) ────
// これらは既存ファイル末尾に残し、削除しない。
// ファイル末尾が現状の `private fun canPostNotifications`, `NotificationSettingsSection` などの
// ヘルパー群なので、そのまま維持する。

// required imports already present:
// android.content.Context, androidx.compose.ui.unit.dp, etc.
```

注意:
- `import androidx.compose.ui.unit.dp` を必ず含める (`32.dp`, `8.dp`, `4.dp` のため)。
- `NotificationSettingsSection` は既存ファイル末尾に残っているので保持。
- `setLocale` / `setThemeMode` / `setSecurityLockEnabled` / `setSecurityLockTimeoutMinutes` は `DashboardViewModel` に既存 (確認済)。
- `ThemeMode.GRAY` 等は Task 3 注記と同様、実 enum 値に合わせて修正。

- [ ] **Step 2: ビルド検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL`。

- [ ] **Step 3: コミット**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add app/src/main/java/app/tastile/android/ui/mobile/tabs/SettingsScreen.kt && git commit -m "$(cat <<'EOF'
feat(android): implement SettingsScreen with picker dialogs

- Locale row -> LocalePickerDialog -> setLocale
- Theme row -> ThemePickerDialog -> setThemeMode
- Security lock Switch + TimeoutPicker -> setSecurityLockEnabled +
  setSecurityLockTimeoutMinutes
- Privacy dialog with external link to tastile.app/privacy
- About dialog with package version + GitHub link
- NotificationSettingsSection kept intact (OS permission flow)

Each picker call goes through DashboardViewModel so settings persist via the
existing UserSettingsRepository.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: SidePanelSheet section 内容修正 (Schedule / References / Preferences)

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/mobile/sheets/SectionPanelContent.kt`

- [ ] **Step 1: ScheduleSectionContent を実データ化**

ファイル: `app/src/main/java/app/tastile/android/ui/mobile/sheets/SectionPanelContent.kt`

`ScheduleSectionContent()` (現状 lines 237-247) を以下に置換:

```kotlin
@Composable
private fun ScheduleSectionContent(viewModel: DashboardViewModel) {
    val tiles by viewModel.tiles.collectAsStateWithLifecycle()
    val recurring = tiles.filter { tile ->
        tile.annotationConditions?.containsKey("recurrence") == true ||
        tile.temporalConditions?.containsKey("recurrence") == true
    }
    val now = LocalDate.now()
    val upcoming = tiles.filter { tile ->
        val dueStr = tile.temporalConditions?.get("due_at")?.toString()?.trim('"')
            ?: tile.annotationConditions?.get("due_at")?.toString()?.trim('"')
        dueStr?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?.let { it in now..now.plusDays(7) } ?: false
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "Recurring",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (recurring.isEmpty()) {
            Text("No recurring tiles", style = MaterialTheme.typography.bodySmall)
        } else {
            recurring.take(10).forEach { tile ->
                Text(
                    "↻ ${tile.title}",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { viewModel.selectTile(tile.id) }
                        .padding(vertical = 4.dp)
                        .semantics { contentDescription = "Recurring: ${tile.title}" },
                )
            }
        }
        Spacer(Modifier.size(12.dp))
        Text(
            "Upcoming (7 days)",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (upcoming.isEmpty()) {
            Text("No upcoming deadlines", style = MaterialTheme.typography.bodySmall)
        } else {
            upcoming.take(10).forEach { tile ->
                Text(
                    tile.title,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { viewModel.selectTile(tile.id) }
                        .padding(vertical = 4.dp)
                        .semantics { contentDescription = "Upcoming: ${tile.title}" },
                )
            }
        }
    }
}
```

import に `androidx.compose.foundation.clickable`、`androidx.compose.ui.semantics.semantics`、`androidx.compose.ui.semantics.contentDescription`、`androidx.compose.foundation.layout.Spacer`、`androidx.compose.foundation.layout.size`、`androidx.compose.ui.unit.dp` を追加 (既存の `clickable` import が無い場合は追加)。

- [ ] **Step 2: ReferencesSectionContent を実データ化**

`ReferencesSectionContent()` (現状 lines 272-277) を以下に置換:

```kotlin
@Composable
private fun ReferencesSectionContent() {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        ReferenceLink("Help", "https://tastile.app/help", context)
        ReferenceLink("Changelog", "https://tastile.app/changelog", context)
        ReferenceLink("GitHub", "https://github.com/rebuildup/tastile", context)
        ReferenceLink("Send feedback", "https://github.com/rebuildup/tastile/issues", context)
    }
}

@Composable
private fun ReferenceLink(label: String, url: String, context: android.content.Context) {
    Text(
        "$label ›",
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button) {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
            .padding(vertical = 8.dp)
            .semantics { contentDescription = label },
    )
}
```

import に `android.content.Intent`、`android.net.Uri`、`androidx.compose.ui.platform.LocalContext`、`androidx.compose.ui.semantics.Role` を追加 (不足分のみ)。

- [ ] **Step 3: PreferencesSectionContent を実データ化**

`PreferencesSectionContent()` (現状 lines 280-285) を以下に置換:

```kotlin
@Composable
private fun PreferencesSectionContent(viewModel: DashboardViewModel) {
    val locale by viewModel.locale.collectAsStateWithLifecycle()
    val theme by viewModel.themeMode.collectAsStateWithLifecycle()
    val lock by viewModel.securityLockEnabled.collectAsStateWithLifecycle()
    val timeout by viewModel.securityLockTimeoutMinutes.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        PreferenceSummaryRow(label = "Locale", value = locale.toString())
        PreferenceSummaryRow(label = "Theme", value = theme.toString())
        PreferenceSummaryRow(label = "Lock", value = if (lock) "On (${timeout}m)" else "Off")
        Text(
            "Open Settings tab to change.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun PreferenceSummaryRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
```

`PreferencesSectionContent` の関数シグネチャを変更するため、`SectionPanelContent` の when 分岐 (line 65) を `PreferencesSectionContent(viewModel)` に修正。

- [ ] **Step 4: ビルド検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL`。

- [ ] **Step 5: コミット**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add app/src/main/java/app/tastile/android/ui/mobile/sheets/SectionPanelContent.kt && git commit -m "$(cat <<'EOF'
feat(android): fill SidePanelSheet sections with real data

- Schedule section: Recurring + Upcoming(7d) lists parsed from
  tiles' temporalConditions/annotationConditions, tap selects tile.
- References section: 4 external links (Help, Changelog, GitHub, Feedback).
- Preferences section: read-only summary of Locale / Theme / Lock state
  to mirror what the dedicated Settings tab holds.

Tile-row taps call viewModel.selectTile so Overlay.TileEdit is reachable
from the side panel too.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 全体検証

**Files:**
- (none, verification only)

- [ ] **Step 1: Lint 検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:lintDebug 2>&1 | tail -30
```

期待: 既存の lint ベースラインから増えない。新規 lint 警告があれば個別に対応する (主原因は Material3 experimental API、未使用 import、Modifier ordering)。

- [ ] **Step 2: Unit test 検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:testDebugUnitTest 2>&1 | tail -20
```

期待: 全 unit test が PASS。新規 helper 関数 (`extractProjects` 等) は既存テストが通れば OK。

- [ ] **Step 3: アセンブリ検証**

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && ./gradlew :app:assembleDebug
```

期待: `BUILD SUCCESSFUL`。

- [ ] **Step 4: spec チェックリスト照合**

spec の「検証チェックリスト」全項目に目を通し、本 plan の各 Task と対応付ける。

| Spec 項目 | 実装 Task |
|---|---|
| `ExecuteScreen`: started + Complete/Defer | Task 4 |
| `TilesScreen`: chip + TileEdit + QuickCreate | Task 5 |
| `IntegrationsScreen`: Sync/Disconnect + IntegrationConfig | Task 6, 7 |
| `SettingsScreen`: 4つの picker | Task 8 |
| `MobileBottomBar` 削除 | Task 1 |
| `SidePanelSheet`: Schedule/References/Preferences | Task 9 |
| `Overlay.IntegrationConfig` exhaustive | Task 2, 7 |

全項目 ✓。不足があれば追加 Task を切る。

- [ ] **Step 5: コミット (なければ)**

検証のみで diff が出なければ commit 不要。lint 修正の diff があれば:

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git add -A && git commit -m "$(cat <<'EOF'
chore(android): lint fixes from main-canvas implementation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## ロールバック手順

各 Task は独立 commit。問題が出たら:

```bash
cd "C:/Users/rebui/Desktop/tastile/tastile-android" && git revert <commit-hash>
```

で当該 Task のみ巻き戻し可能。`Overlay.IntegrationConfig` を撤回すると Task 4, 6 がビルドエラーになるので、撤回時は **Task 6 → 4 → 7 → 2** の順で revert。

---

## Definition of Done

- 全 Task のチェックボックスが埋まっている。
- `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug` が green。
- spec の検証チェックリスト全項目に対応する Task が完了済み。
- 1 PR (or 1 連続 commit 列) で `main` にマージ可能な状態。