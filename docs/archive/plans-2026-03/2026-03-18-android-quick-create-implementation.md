# Android QuickCreateSheet Complete Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Web版QuickTileCreate.tsxの洗練されたUXをAndroid版に完全移植し、Material 3コンポーネントを活用した最高品質のタスク作成パネルを実装する

**Architecture:** Web版の状態管理パターンを踏襲しつつ、Material 3のTimePicker、DatePicker、SegmentedButton等のネイティブコンポーネントを活用。3色テーマ（Light/Gray/Dark）をMaterial 3 ColorSchemeで実装し、すべてのコンポーネントでテーマ対応する

**Tech Stack:** Kotlin, Jetpack Compose, Material 3, rememberSaveable (状態管理)

---

## Task 1: 3色テーマシステム実装（Light/Gray/Dark）

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/theme/Color.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/theme/Theme.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/data/repository/UserSettingsRepository.kt`

**Step 1: Grayテーマのカラー定義を追加**

`Color.kt`を修正:

```kotlin
package app.tastile.android.ui.theme

import androidx.compose.ui.graphics.Color

// Light Theme (既存を維持)
val LightBackground = Color(0xFFF5F5F5)
val LightSurface = Color(0xFFFAFAFA)
val LightSurfaceContainer = Color(0xFFEFEFEF)
val LightSurfaceContainerLow = Color(0xFFFFFFFF)
val LightSurfaceContainerHigh = Color(0xFFFFFFFF)
val LightOnSurface = Color(0xFF0A0A0A)
val LightOnSurfaceVariant = Color(0xFF525252)
val LightOutline = Color(0xFFD4D4D4)
val LightPrimary = Color(0xFF0A0A0A)
val LightOnPrimary = Color(0xFFFFFFFF)

// Gray Theme (新規追加)
val GrayBackground = Color(0xFF171717)
val GraySurface = Color(0xFF1F1F1F)
val GraySurfaceContainer = Color(0xFF141414)
val GraySurfaceContainerLow = Color(0xFF262626)
val GraySurfaceContainerHigh = Color(0xFF262626)
val GrayOnSurface = Color(0xFFFAFAFA)
val GrayOnSurfaceVariant = Color(0xFFD4D4D4)
val GrayOutline = Color(0xFF525252)
val GrayPrimary = Color(0xFFFAFAFA)
val GrayOnPrimary = Color(0xFF0A0A0A)

// Dark Theme (True Black)
val DarkBackground = Color(0xFF000000)
val DarkSurface = Color(0xFF0A0A0A)
val DarkSurfaceContainer = Color(0xFF050505)
val DarkSurfaceContainerLow = Color(0xFF171717)
val DarkSurfaceContainerHigh = Color(0xFF171717)
val DarkOnSurface = Color(0xFFFFFFFF)
val DarkOnSurfaceVariant = Color(0xFFD4D4D4)
val DarkOutline = Color(0xFF404040)
val DarkPrimary = Color(0xFFFFFFFF)
val DarkOnPrimary = Color(0xFF000000)

// Additional app colors
val ProPlanColor = Color(0xFFFFD700)
```

**Step 2: ThemeModeをLIGHT/GRAY/DARKの3色に拡張**

`UserSettingsRepository.kt`内のThemeMode enumを確認・修正:

```kotlin
enum class ThemeMode {
    LIGHT,
    GRAY,
    DARK
}
```

**Step 3: TastileTheme関数を3色対応に修正**

`Theme.kt`を修正:

```kotlin
package app.tastile.android.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import app.tastile.android.data.repository.ThemeMode

private val LightColorScheme = lightColorScheme(
    primary = LightPrimary,
    onPrimary = LightOnPrimary,
    background = LightBackground,
    surface = LightSurface,
    surfaceContainer = LightSurfaceContainer,
    surfaceContainerLow = LightSurfaceContainerLow,
    surfaceContainerHigh = LightSurfaceContainerHigh,
    onSurface = LightOnSurface,
    onSurfaceVariant = LightOnSurfaceVariant,
    outline = LightOutline
)

private val GrayColorScheme = darkColorScheme(
    primary = GrayPrimary,
    onPrimary = GrayOnPrimary,
    background = GrayBackground,
    surface = GraySurface,
    surfaceContainer = GraySurfaceContainer,
    surfaceContainerLow = GraySurfaceContainerLow,
    surfaceContainerHigh = GraySurfaceContainerHigh,
    onSurface = GrayOnSurface,
    onSurfaceVariant = GrayOnSurfaceVariant,
    outline = GrayOutline
)

private val DarkColorScheme = darkColorScheme(
    primary = DarkPrimary,
    onPrimary = DarkOnPrimary,
    background = DarkBackground,
    surface = DarkSurface,
    surfaceContainer = DarkSurfaceContainer,
    surfaceContainerLow = DarkSurfaceContainerLow,
    surfaceContainerHigh = DarkSurfaceContainerHigh,
    onSurface = DarkOnSurface,
    onSurfaceVariant = DarkOnSurfaceVariant,
    outline = DarkOutline
)

@Composable
fun TastileTheme(
    themeMode: ThemeMode = ThemeMode.LIGHT,
    content: @Composable () -> Unit
) {
    val colorScheme = when (themeMode) {
        ThemeMode.LIGHT -> LightColorScheme
        ThemeMode.GRAY -> GrayColorScheme
        ThemeMode.DARK -> DarkColorScheme
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        @Suppress("DEPRECATION")
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.surface.toArgb()
            val isDark = themeMode != ThemeMode.LIGHT
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !isDark
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
```

**Step 4: MainActivityとTastileAppでテーマ適用を確認**

`MainActivity.kt`と`TastileApp.kt`を確認し、ViewModelからthemeModeを取得してTastileThemeに渡していることを確認:

```kotlin
val themeMode by viewModel.themeMode.collectAsStateWithLifecycle()
TastileTheme(themeMode = themeMode) {
    // content
}
```

**Step 5: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/theme/Color.kt \
        app/src/main/java/app/tastile/android/ui/theme/Theme.kt
git commit -m "feat(theme): add Gray theme for 3-color system (Light/Gray/Dark)"
```

---

## Task 2: 基本コンポーネント - SectionBlock

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/ui/components/SectionBlock.kt`

**Step 1: SectionBlock実装**

```kotlin
package app.tastile.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun SectionBlock(
    title: String? = null,
    helpText: String? = null,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (title != null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                if (helpText != null) {
                    HelpBadge(text = helpText)
                }
            }
        }
        content()
    }
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/components/SectionBlock.kt
git commit -m "feat(ui): add SectionBlock component"
```

---

## Task 3: 基本コンポーネント - HelpBadge

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/ui/components/HelpBadge.kt`

**Step 1: HelpBadge実装**

```kotlin
package app.tastile.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun HelpBadge(text: String) {
    var showTooltip by remember { mutableStateOf(false) }

    Box {
        IconButton(
            onClick = { showTooltip = !showTooltip },
            modifier = Modifier.size(20.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(16.dp)
                    .background(
                        MaterialTheme.colorScheme.surfaceVariant,
                        CircleShape
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "?",
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        DropdownMenu(
            expanded = showTooltip,
            onDismissRequest = { showTooltip = false }
        ) {
            Text(
                text = text,
                modifier = Modifier.padding(12.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/components/HelpBadge.kt
git commit -m "feat(ui): add HelpBadge component with tooltip"
```

---

## Task 4: 基本コンポーネント - AutoCompleteTextField

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/ui/components/AutoCompleteTextField.kt`

**Step 1: AutoCompleteTextField実装**

```kotlin
package app.tastile.android.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

@Composable
fun AutoCompleteTextField(
    value: String,
    onValueChange: (String) -> Unit,
    suggestions: List<String>,
    placeholder: String,
    onSuggestionSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded && suggestions.isNotEmpty(),
        onExpandedChange = { expanded = it }
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                onValueChange(it)
                expanded = true
            },
            placeholder = { Text(placeholder) },
            modifier = modifier
                .fillMaxWidth()
                .menuAnchor(),
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surface,
                unfocusedContainerColor = MaterialTheme.colorScheme.surface
            )
        )

        ExposedDropdownMenu(
            expanded = expanded && suggestions.isNotEmpty(),
            onDismissRequest = { expanded = false }
        ) {
            suggestions.forEach { suggestion ->
                DropdownMenuItem(
                    text = {
                        Text(
                            suggestion,
                            style = MaterialTheme.typography.bodySmall
                        )
                    },
                    onClick = {
                        onSuggestionSelected(suggestion)
                        expanded = false
                    }
                )
            }
        }
    }
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/components/AutoCompleteTextField.kt
git commit -m "feat(ui): add AutoCompleteTextField component"
```

---

## Task 5: DurationInput - メインコンポーネント

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/ui/components/DurationInput.kt`

**Step 1: DurationInput実装**

```kotlin
package app.tastile.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

@Composable
fun DurationInput(
    hours: String,
    minutes: String,
    onHoursChange: (String) -> Unit,
    onMinutesChange: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var showPicker by remember { mutableStateOf(false) }
    val parsedHours = hours.toIntOrNull()?.coerceIn(0, 99) ?: 0
    val parsedMinutes = minutes.toIntOrNull()?.coerceIn(0, 59) ?: 0
    val displayValue = String.format("%02d:%02d", parsedHours, parsedMinutes)

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        OutlinedTextField(
            value = displayValue,
            onValueChange = {},
            readOnly = true,
            modifier = Modifier.weight(1f),
            textStyle = MaterialTheme.typography.bodyLarge.copy(
                textAlign = TextAlign.Center,
                fontFeatureSettings = "tnum"
            ),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surface,
                unfocusedContainerColor = MaterialTheme.colorScheme.surface
            )
        )
        IconButton(onClick = { showPicker = true }) {
            Icon(Icons.Default.Schedule, contentDescription = "時間選択")
        }
    }

    if (showPicker) {
        DurationPickerDialog(
            initialHours = parsedHours,
            initialMinutes = parsedMinutes,
            onConfirm = { h, m ->
                onHoursChange(h.toString())
                onMinutesChange(m.toString())
                showPicker = false
            },
            onDismiss = { showPicker = false }
        )
    }
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/components/DurationInput.kt
git commit -m "feat(ui): add DurationInput component"
```

---

## Task 6: DurationPickerDialog - 時間選択ダイアログ

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/components/DurationInput.kt`

**Step 1: DurationPickerDialog実装を追加**

`DurationInput.kt`の末尾に追加:

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.TextButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight

@Composable
private fun DurationPickerDialog(
    initialHours: Int,
    initialMinutes: Int,
    onConfirm: (Int, Int) -> Unit,
    onDismiss: () -> Unit
) {
    var hours by remember { mutableStateOf(initialHours) }
    var minutes by remember { mutableStateOf(initialMinutes) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("作業時間") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                // Display current value
                Text(
                    String.format("%02d:%02d", hours, minutes),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(16.dp))

                // Hour/Minute picker
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    // Hours
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        IconButton(onClick = { hours = (hours + 1).coerceIn(0, 99) }) {
                            Icon(Icons.Default.KeyboardArrowUp, contentDescription = null)
                        }
                        Text(
                            String.format("%02d", hours),
                            style = MaterialTheme.typography.titleLarge
                        )
                        IconButton(onClick = { hours = (hours - 1).coerceIn(0, 99) }) {
                            Icon(Icons.Default.KeyboardArrowDown, contentDescription = null)
                        }
                    }

                    Text(":", style = MaterialTheme.typography.headlineMedium)

                    // Minutes
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        IconButton(onClick = { minutes = (minutes + 5).coerceIn(0, 59) }) {
                            Icon(Icons.Default.KeyboardArrowUp, contentDescription = null)
                        }
                        Text(
                            String.format("%02d", minutes),
                            style = MaterialTheme.typography.titleLarge
                        )
                        IconButton(onClick = { minutes = (minutes - 5).coerceIn(0, 59) }) {
                            Icon(Icons.Default.KeyboardArrowDown, contentDescription = null)
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))

                // Preset buttons
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(
                        15 to "15m",
                        25 to "25m",
                        45 to "45m",
                        60 to "1h"
                    ).forEach { (totalMinutes, label) ->
                        FilterChip(
                            selected = false,
                            onClick = {
                                hours = totalMinutes / 60
                                minutes = totalMinutes % 60
                            },
                            label = { Text(label) }
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(hours, minutes) }) {
                Text("OK")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("キャンセル")
            }
        }
    )
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/components/DurationInput.kt
git commit -m "feat(ui): add DurationPickerDialog with presets"
```

---

## Task 7: ユーティリティ - DateTimeUtils

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/util/DateTimeUtils.kt`

**Step 1: DateTimeUtils実装**

```kotlin
package app.tastile.android.util

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object DateTimeUtils {
    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    fun getCurrentLocalDate(): String {
        return LocalDate.now().format(dateFormatter)
    }

    fun getCurrentLocalTime(): String {
        return LocalDateTime.now().format(timeFormatter)
    }

    fun getLocalTimeAfterMinutes(minutes: Int): String {
        return LocalDateTime.now().plusMinutes(minutes.toLong()).format(timeFormatter)
    }

    fun parseDateTimeParts(datePart: String, timePart: String): LocalDateTime? {
        if (datePart.isBlank() || timePart.isBlank()) return null
        return try {
            LocalDateTime.parse("${datePart}T${timePart}")
        } catch (e: Exception) {
            null
        }
    }

    fun formatDateTime(dateTime: LocalDateTime): String {
        return "${dateTime.format(dateFormatter)} ${dateTime.format(timeFormatter)}"
    }

    fun millisToLocalDate(millis: Long): String {
        val date = Instant.ofEpochMilli(millis)
            .atZone(ZoneId.systemDefault())
            .toLocalDate()
        return date.format(dateFormatter)
    }
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/util/DateTimeUtils.kt
git commit -m "feat(util): add DateTimeUtils for date/time formatting"
```

---

## Task 8: ユーティリティ - DurationUtils

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/util/DurationUtils.kt`

**Step 1: DurationUtils実装**

```kotlin
package app.tastile.android.util

import app.tastile.android.data.repository.AppLocale
import java.time.LocalDateTime

object DurationUtils {
    fun parseDurationToMinutes(hoursValue: String, minutesValue: String): Int? {
        val hours = hoursValue.toIntOrNull()
        val minutes = minutesValue.toIntOrNull()
        if (hours == null && minutes == null) return null
        val total = (hours ?: 0) * 60 + (minutes ?: 0)
        if (total <= 0) return null
        return total
    }

    fun parseBoundedDurationMinutes(
        startDate: String,
        startTime: String,
        endDate: String,
        endTime: String
    ): Int? {
        val start = DateTimeUtils.parseDateTimeParts(startDate, startTime) ?: return null
        val end = DateTimeUtils.parseDateTimeParts(endDate, endTime) ?: return null
        val diff = java.time.Duration.between(start, end).toMinutes()
        if (diff <= 0) return null
        return diff.toInt()
    }

    fun formatDuration(totalMinutes: Int, locale: AppLocale): String {
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60

        return if (locale == AppLocale.JA) {
            when {
                hours > 0 && minutes > 0 -> "${hours}時間${minutes}分"
                hours > 0 -> "${hours}時間"
                else -> "${minutes}分"
            }
        } else {
            when {
                hours > 0 && minutes > 0 -> "${hours}h ${minutes}m"
                hours > 0 -> "${hours}h"
                else -> "${minutes}m"
            }
        }
    }

    fun minutesToHourMinuteStrings(totalMinutes: Int): Pair<String, String> {
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60
        return hours.toString() to minutes.toString()
    }
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/util/DurationUtils.kt
git commit -m "feat(util): add DurationUtils for time calculations"
```

---

## Task 9: QuickCreateSheet - 状態管理セットアップ

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: QuickCreateSheet基本構造を書き換え**

既存の`QuickCreateSheet.kt`を以下に置き換え:

```kotlin
package app.tastile.android.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.tastile.android.data.repository.AppLocale
import app.tastile.android.util.DateTimeUtils

@Composable
fun QuickCreateSheet(
    viewModel: DashboardViewModel,
    onClose: () -> Unit
) {
    val locale by viewModel.locale.collectAsStateWithLifecycle()
    fun t(ja: String, en: String): String = if (locale == AppLocale.JA) ja else en

    // State variables (Web版と同じ)
    var title by rememberSaveable { mutableStateOf("") }
    var titleEdited by rememberSaveable { mutableStateOf(false) }
    var tileKind by rememberSaveable { mutableStateOf("work") }
    var objectiveMode by rememberSaveable { mutableStateOf("finish_once") }
    var useStartAt by rememberSaveable { mutableStateOf(false) }
    var useEndAt by rememberSaveable { mutableStateOf(false) }
    var startDate by rememberSaveable { mutableStateOf(DateTimeUtils.getCurrentLocalDate()) }
    var startTime by rememberSaveable { mutableStateOf(DateTimeUtils.getCurrentLocalTime()) }
    var endDate by rememberSaveable { mutableStateOf(DateTimeUtils.getCurrentLocalDate()) }
    var endTime by rememberSaveable { mutableStateOf(DateTimeUtils.getLocalTimeAfterMinutes(60)) }
    var recurrenceFrequency by rememberSaveable { mutableStateOf("daily") }
    var recurrenceInterval by rememberSaveable { mutableStateOf("1") }
    var recurrenceWeekdays by rememberSaveable { mutableStateOf("") }
    var recurrenceMonthlyWeek by rememberSaveable { mutableStateOf("1") }
    var recurrenceMonthlyWeekday by rememberSaveable { mutableStateOf("0") }
    var recurrenceUseStartAt by rememberSaveable { mutableStateOf(true) }
    var recurrenceUseEndAt by rememberSaveable { mutableStateOf(true) }
    var recurrenceStartTime by rememberSaveable { mutableStateOf(DateTimeUtils.getCurrentLocalTime()) }
    var recurrenceEndTime by rememberSaveable { mutableStateOf(DateTimeUtils.getLocalTimeAfterMinutes(60)) }
    var recurrenceValidFromEnabled by rememberSaveable { mutableStateOf(false) }
    var recurrenceValidToEnabled by rememberSaveable { mutableStateOf(false) }
    var recurrenceValidFromDate by rememberSaveable { mutableStateOf(DateTimeUtils.getCurrentLocalDate()) }
    var recurrenceValidToDate by rememberSaveable { mutableStateOf(DateTimeUtils.getCurrentLocalDate()) }
    var workHours by rememberSaveable { mutableStateOf("0") }
    var workMinutes by rememberSaveable { mutableStateOf("25") }
    var durationManuallyEdited by rememberSaveable { mutableStateOf(false) }
    var breakSplitsWork by rememberSaveable { mutableStateOf(true) }
    var project by rememberSaveable { mutableStateOf("") }
    var tagDraft by rememberSaveable { mutableStateOf("") }
    var selectedTags by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var memo by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                t("クイック作成", "Quick Create"),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            IconButton(onClick = onClose) {
                Icon(Icons.Default.Close, contentDescription = t("閉じる", "Close"))
            }
        }

        // TODO: 次のタスクでセクションを追加していく

        // Footer buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)
        ) {
            TextButton(onClick = onClose) {
                Text(t("キャンセル", "Cancel"))
            }
            Button(
                onClick = { /* TODO: 実装 */ },
                enabled = title.trim().isNotEmpty()
            ) {
                Text(t("作成", "Create"))
            }
        }
    }
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "refactor(ui): rewrite QuickCreateSheet with Web parity state management"
```

---

## Task 10: QuickCreateSheet - タイトルセクション

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: import文を追加**

```kotlin
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import app.tastile.android.ui.components.SectionBlock
```

**Step 2: "// TODO: 次のタスクでセクションを追加していく"の直後に追加**

```kotlin
        // Title
        SectionBlock(
            title = t("タイトル", "Title"),
            helpText = t("タスク名を入力してください", "Enter task title")
        ) {
            OutlinedTextField(
                value = title,
                onValueChange = {
                    title = it
                    titleEdited = true
                },
                placeholder = { Text(t("作業タスク", "Task")) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
```

**Step 3: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): add title section to QuickCreateSheet"
```

---

## Task 11: QuickCreateSheet - 種類選択（SegmentedButton）

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: import文を追加**

```kotlin
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
```

**Step 2: タイトルセクションの直後に追加**

```kotlin
        // Kind
        SectionBlock {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = tileKind == "work",
                    onClick = { tileKind = "work" },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2)
                ) {
                    Text(t("作業", "Work"))
                }
                SegmentedButton(
                    selected = tileKind == "label",
                    onClick = { tileKind = "label" },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2)
                ) {
                    Text(t("ラベル", "Label"))
                }
            }
        }
```

**Step 3: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): add tile kind selection with SegmentedButton"
```

---

## Task 12: QuickCreateSheet - 目標選択

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: 種類選択の直後に追加**

```kotlin
        // Objective
        SectionBlock {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = objectiveMode == "finish_once",
                    onClick = { objectiveMode = "finish_once" },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2)
                ) {
                    Text(t("単発", "Finish once"))
                }
                SegmentedButton(
                    selected = objectiveMode == "recurring",
                    onClick = { objectiveMode = "recurring" },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2)
                ) {
                    Text(t("繰返し", "Recurring"))
                }
            }
        }
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): add objective mode selection"
```

---

## Task 13: QuickCreateSheet - 繰り返し設定（TabRow）

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: import文を追加**

```kotlin
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
```

**Step 2: 目標選択の直後に追加**

```kotlin
        // Recurrence settings
        if (objectiveMode == "recurring") {
            SectionBlock(
                title = t("繰り返し設定", "Recurrence"),
                helpText = t("繰り返しの頻度を設定", "Set recurrence frequency")
            ) {
                TabRow(
                    selectedTabIndex = when (recurrenceFrequency) {
                        "daily" -> 0
                        "weekly" -> 1
                        "monthly" -> 2
                        else -> 0
                    }
                ) {
                    Tab(
                        selected = recurrenceFrequency == "daily",
                        onClick = { recurrenceFrequency = "daily" },
                        text = { Text(t("毎日", "Daily")) }
                    )
                    Tab(
                        selected = recurrenceFrequency == "weekly",
                        onClick = { recurrenceFrequency = "weekly" },
                        text = { Text(t("毎週", "Weekly")) }
                    )
                    Tab(
                        selected = recurrenceFrequency == "monthly",
                        onClick = { recurrenceFrequency = "monthly" },
                        text = { Text(t("毎月", "Monthly")) }
                    )
                }

                // Interval input
                OutlinedTextField(
                    value = recurrenceInterval,
                    onValueChange = { recurrenceInterval = it.filter { c -> c.isDigit() } },
                    placeholder = { Text(t("間隔 (例: 1)", "Interval (e.g. 1)")) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surface,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surface
                    )
                )

                // TODO: Weekly/Monthly specific inputs
            }
        }
```

**Step 3: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): add recurrence frequency selection with TabRow"
```

---

## Task 14: QuickCreateSheet - 作業時間（DurationInput統合）

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: import文を追加**

```kotlin
import app.tastile.android.ui.components.DurationInput
```

**Step 2: 繰り返し設定の直後（ifブロック外）に追加**

```kotlin
        // Work duration
        if (tileKind == "work") {
            SectionBlock(
                title = t("作業時間", "Work duration"),
                helpText = t("目標作業時間を設定", "Set target work duration")
            ) {
                DurationInput(
                    hours = workHours,
                    minutes = workMinutes,
                    onHoursChange = {
                        workHours = it
                        durationManuallyEdited = true
                    },
                    onMinutesChange = {
                        workMinutes = it
                        durationManuallyEdited = true
                    }
                )
            }
        }
```

**Step 3: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): integrate DurationInput for work duration"
```

---

## Task 15: QuickCreateSheet - 休憩の扱い

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: 作業時間セクションの直後に追加**

```kotlin
        // Break splits work
        if (tileKind == "work") {
            SectionBlock(
                title = t("休憩の扱い", "Break handling"),
                helpText = t("休憩で作業を分割するか", "Split work on break")
            ) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(
                        selected = breakSplitsWork,
                        onClick = { breakSplitsWork = true },
                        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2)
                    ) {
                        Text(t("分割する", "Allow split"))
                    }
                    SegmentedButton(
                        selected = !breakSplitsWork,
                        onClick = { breakSplitsWork = false },
                        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2)
                    ) {
                        Text(t("継続", "Keep continuous"))
                    }
                }
            }
        }
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): add break splits work toggle"
```

---

## Task 16: QuickCreateSheet - メタ情報（プロジェクト・タグ）

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: import文を追加**

```kotlin
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.FilterChip
import app.tastile.android.ui.components.AutoCompleteTextField
```

**Step 2: 既存データからプロジェクト・タグを取得（暫定で空リスト）**

Column内の先頭（状態定義の直後）に追加:

```kotlin
    // TODO: ViewModelから既存プロジェクト・タグを取得
    val existingProjects = emptyList<String>()
    val existingTags = emptyList<String>()
```

**Step 3: 休憩の扱いセクションの直後に追加**

```kotlin
        // Meta: Project + Tags
        @OptIn(ExperimentalLayoutApi::class)
        SectionBlock(
            title = t("メタ情報", "Meta"),
            helpText = t("プロジェクトとタグ", "Project and tags")
        ) {
            AutoCompleteTextField(
                value = project,
                onValueChange = { project = it },
                suggestions = existingProjects.filter {
                    it.contains(project, ignoreCase = true)
                },
                placeholder = t("プロジェクト", "Project"),
                onSuggestionSelected = { project = it }
            )

            AutoCompleteTextField(
                value = tagDraft,
                onValueChange = { tagDraft = it },
                suggestions = existingTags.filter {
                    it.contains(tagDraft, ignoreCase = true) &&
                    !selectedTags.contains(it)
                },
                placeholder = t("タグ", "Tags"),
                onSuggestionSelected = {
                    selectedTags = selectedTags + it
                    tagDraft = ""
                }
            )

            // Selected tags display
            if (selectedTags.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    selectedTags.forEach { tag ->
                        FilterChip(
                            selected = true,
                            onClick = { selectedTags = selectedTags - tag },
                            label = { Text("#$tag ×") }
                        )
                    }
                }
            }
        }
```

**Step 4: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): add project and tags input with autocomplete"
```

---

## Task 17: QuickCreateSheet - メモ

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: メタ情報セクションの直後に追加**

```kotlin
        // Memo
        SectionBlock(
            title = t("メモ", "Memo"),
            helpText = t("次のアクションを記載", "Note next action")
        ) {
            OutlinedTextField(
                value = memo,
                onValueChange = { memo = it },
                placeholder = { Text(t("メモを入力", "Enter memo")) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
```

**Step 2: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): add memo input section"
```

---

## Task 18: QuickCreateSheet - エラー表示とバリデーション

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: メモセクションの直後、Footer buttonsの前に追加**

```kotlin
        // Error display
        if (error != null) {
            Text(
                error!!,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall
            )
        }
```

**Step 2: Button enabled条件を更新**

```kotlin
            Button(
                onClick = {
                    // TODO: create tile
                    error = null
                },
                enabled = title.trim().isNotEmpty() && error == null
            ) {
                Text(t("作成", "Create"))
            }
```

**Step 3: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): add error display and validation"
```

---

## Task 19: DashboardViewModelにcreateタイル処理を追加

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/DashboardViewModel.kt`

**Step 1: CreateTileDraft data classを追加**

`DashboardViewModel.kt`の末尾に追加:

```kotlin
data class CreateTileDraft(
    val title: String,
    val nextAction: String,
    val doneDefinition: String,
    val tileKind: String,
    val objectiveMode: String,
    val useStartAt: Boolean,
    val useEndAt: Boolean,
    val startAtIso: String?,
    val endAtIso: String?,
    val recurrenceFrequency: String,
    val recurrenceInterval: Int,
    val recurrenceWeekdays: List<Int>,
    val recurrenceMonthlyWeek: Int,
    val recurrenceMonthlyWeekday: Int,
    val recurrenceStartTime: String,
    val recurrenceEndTime: String,
    val recurrenceValidFromIso: String?,
    val recurrenceValidToIso: String?,
    val breakSplitsWork: Boolean,
    val project: String,
    val labels: List<String>,
    val memo: String,
    val targetWorkMin: Int?
)
```

**Step 2: 既存のcreateTile関数をCreateTileDraftベースに書き換え**

既存の`createTile`関数を探し、以下のシグネチャに変更:

```kotlin
fun createTile(draft: CreateTileDraft) {
    viewModelScope.launch {
        try {
            val tile = Tile(
                id = generateTileId(),
                userId = authRepository.currentUser.value?.id ?: return@launch,
                title = draft.title,
                lifecycle = "ready",
                tileKind = draft.tileKind,
                objectiveMode = draft.objectiveMode,
                startAt = draft.startAtIso,
                endAt = draft.endAtIso,
                targetWorkMin = draft.targetWorkMin,
                breakSplitsWork = draft.breakSplitsWork,
                project = draft.project.takeIf { it.isNotBlank() },
                labels = draft.labels,
                nextAction = draft.memo.takeIf { it.isNotBlank() },
                doneDefinition = draft.doneDefinition.takeIf { it.isNotBlank() },
                createdAt = System.currentTimeMillis().toString(),
                updatedAt = System.currentTimeMillis().toString()
            )
            tileRepository.createTile(tile)
            loadTiles()
        } catch (e: Exception) {
            // TODO: エラーハンドリング
        }
    }
}
```

**Step 3: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/DashboardViewModel.kt
git commit -m "refactor(vm): update createTile to accept CreateTileDraft"
```

---

## Task 20: QuickCreateSheet - タイル作成ロジック統合

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: combineDateTime helper関数を追加**

`QuickCreateSheet.kt`の末尾に追加:

```kotlin
private fun combineDateTime(date: String, time: String): String? {
    if (date.isBlank() || time.isBlank()) return null
    return "${date}T${time}:00Z"
}
```

**Step 2: Button onClickを実装**

```kotlin
            Button(
                onClick = {
                    val workTargetMin = app.tastile.android.util.DurationUtils.parseDurationToMinutes(
                        workHours,
                        workMinutes
                    )

                    viewModel.createTile(
                        CreateTileDraft(
                            title = title,
                            nextAction = memo,
                            doneDefinition = "", // TODO: 自動生成
                            tileKind = tileKind,
                            objectiveMode = objectiveMode,
                            useStartAt = useStartAt,
                            useEndAt = useEndAt,
                            startAtIso = if (useStartAt) combineDateTime(startDate, startTime) else null,
                            endAtIso = if (useEndAt) combineDateTime(endDate, endTime) else null,
                            recurrenceFrequency = recurrenceFrequency,
                            recurrenceInterval = recurrenceInterval.toIntOrNull() ?: 1,
                            recurrenceWeekdays = emptyList(),
                            recurrenceMonthlyWeek = recurrenceMonthlyWeek.toIntOrNull() ?: 1,
                            recurrenceMonthlyWeekday = recurrenceMonthlyWeekday.toIntOrNull() ?: 0,
                            recurrenceStartTime = recurrenceStartTime,
                            recurrenceEndTime = recurrenceEndTime,
                            recurrenceValidFromIso = if (recurrenceValidFromEnabled) combineDateTime(recurrenceValidFromDate, "00:00") else null,
                            recurrenceValidToIso = if (recurrenceValidToEnabled) combineDateTime(recurrenceValidToDate, "23:59") else null,
                            breakSplitsWork = breakSplitsWork,
                            project = project,
                            labels = selectedTags,
                            memo = memo,
                            targetWorkMin = if (tileKind == "work") workTargetMin else null
                        )
                    )
                    onClose()
                },
                enabled = title.trim().isNotEmpty() && error == null
            ) {
                Text(t("作成", "Create"))
            }
```

**Step 3: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): integrate tile creation logic in QuickCreateSheet"
```

---

## Task 21: スケジュール設定（DatePicker/TimePicker統合）

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt`

**Step 1: import文を追加**

```kotlin
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import java.time.Instant
import java.time.ZoneId
```

**Step 2: 繰り返し設定の前に追加（目標選択の直後）**

```kotlin
        // Schedule
        @OptIn(ExperimentalMaterial3Api::class)
        SectionBlock(
            title = t("スケジュール", "Schedule"),
            helpText = t("開始・終了日時を設定", "Set start/end times")
        ) {
            var showStartDatePicker by remember { mutableStateOf(false) }
            var showStartTimePicker by remember { mutableStateOf(false) }
            var showEndDatePicker by remember { mutableStateOf(false) }
            var showEndTimePicker by remember { mutableStateOf(false) }

            if (!isRecurring) {
                // Start/End toggles
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilterChip(
                        modifier = Modifier.weight(1f),
                        selected = useStartAt,
                        onClick = {
                            useStartAt = !useStartAt
                            if (useStartAt && startDate.isBlank()) {
                                startDate = DateTimeUtils.getCurrentLocalDate()
                                startTime = DateTimeUtils.getCurrentLocalTime()
                            }
                        },
                        label = { Text(t("開始日時", "Start at")) }
                    )
                    FilterChip(
                        modifier = Modifier.weight(1f),
                        selected = useEndAt,
                        onClick = {
                            useEndAt = !useEndAt
                            if (useEndAt && endDate.isBlank()) {
                                endDate = startDate.ifBlank { DateTimeUtils.getCurrentLocalDate() }
                                endTime = DateTimeUtils.getLocalTimeAfterMinutes(60)
                            }
                        },
                        label = { Text(t("終了日時", "End at")) }
                    )
                }

                // Start date/time inputs
                if (useStartAt) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = startDate,
                            onValueChange = {},
                            readOnly = true,
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("YYYY-MM-DD") },
                            trailingIcon = {
                                IconButton(onClick = { showStartDatePicker = true }) {
                                    Icon(Icons.Default.DateRange, null)
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surface
                            )
                        )
                        OutlinedTextField(
                            value = startTime,
                            onValueChange = {},
                            readOnly = true,
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("HH:mm") },
                            trailingIcon = {
                                IconButton(onClick = { showStartTimePicker = true }) {
                                    Icon(Icons.Default.Schedule, null)
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surface
                            )
                        )
                    }
                }

                // End date/time inputs
                if (useEndAt) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = endDate,
                            onValueChange = {},
                            readOnly = true,
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("YYYY-MM-DD") },
                            trailingIcon = {
                                IconButton(onClick = { showEndDatePicker = true }) {
                                    Icon(Icons.Default.DateRange, null)
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surface
                            )
                        )
                        OutlinedTextField(
                            value = endTime,
                            onValueChange = {},
                            readOnly = true,
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("HH:mm") },
                            trailingIcon = {
                                IconButton(onClick = { showEndTimePicker = true }) {
                                    Icon(Icons.Default.Schedule, null)
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surface
                            )
                        )
                    }
                }
            }

            // DatePicker dialogs
            if (showStartDatePicker) {
                val datePickerState = rememberDatePickerState()
                DatePickerDialog(
                    onDismissRequest = { showStartDatePicker = false },
                    confirmButton = {
                        TextButton(onClick = {
                            datePickerState.selectedDateMillis?.let { millis ->
                                startDate = DateTimeUtils.millisToLocalDate(millis)
                            }
                            showStartDatePicker = false
                        }) { Text("OK") }
                    }
                ) {
                    DatePicker(state = datePickerState)
                }
            }

            if (showEndDatePicker) {
                val datePickerState = rememberDatePickerState()
                DatePickerDialog(
                    onDismissRequest = { showEndDatePicker = false },
                    confirmButton = {
                        TextButton(onClick = {
                            datePickerState.selectedDateMillis?.let { millis ->
                                endDate = DateTimeUtils.millisToLocalDate(millis)
                            }
                            showEndDatePicker = false
                        }) { Text("OK") }
                    }
                ) {
                    DatePicker(state = datePickerState)
                }
            }

            // TimePicker dialogs
            if (showStartTimePicker) {
                val timePickerState = rememberTimePickerState()
                AlertDialog(
                    onDismissRequest = { showStartTimePicker = false },
                    confirmButton = {
                        TextButton(onClick = {
                            startTime = String.format(
                                "%02d:%02d",
                                timePickerState.hour,
                                timePickerState.minute
                            )
                            showStartTimePicker = false
                        }) { Text("OK") }
                    }
                ) {
                    TimePicker(state = timePickerState)
                }
            }

            if (showEndTimePicker) {
                val timePickerState = rememberTimePickerState()
                AlertDialog(
                    onDismissRequest = { showEndTimePicker = false },
                    confirmButton = {
                        TextButton(onClick = {
                            endTime = String.format(
                                "%02d:%02d",
                                timePickerState.hour,
                                timePickerState.minute
                            )
                            showEndTimePicker = false
                        }) { Text("OK") }
                    }
                ) {
                    TimePicker(state = timePickerState)
                }
            }
        }

        val isRecurring = objectiveMode == "recurring"
```

**Step 3: import忘れを追加**

```kotlin
import androidx.compose.material.icons.filled.DateRange
```

**Step 4: Commit**

```bash
git add app/src/main/java/app/tastile/android/ui/dashboard/QuickCreateSheet.kt
git commit -m "feat(ui): add schedule section with DatePicker and TimePicker"
```

---

## Summary

全21タスクで以下を実装:

1. **テーマシステム**: Light/Gray/Darkの3色対応
2. **基本コンポーネント**: SectionBlock, HelpBadge, AutoCompleteTextField
3. **DurationInput**: カスタムピッカー + プリセット
4. **ユーティリティ**: DateTimeUtils, DurationUtils
5. **QuickCreateSheet**: Web版完全移植（Material 3コンポーネント活用）
6. **統合**: ViewModelとの連携、タイル作成ロジック

各タスクは2-5分で完了可能な粒度に分割され、頻繁なコミットでDRY/YAGNI/TDDの原則に従います

---

## Next Steps

実装完了後:
- タイトル自動サジェストの実装
- 完了条件の自動生成
- プロジェクト・タグの既存データ取得
- スタイル微調整とテーマ最適化
