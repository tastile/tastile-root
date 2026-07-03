# Android QuickCreateSheet Complete Redesign

**Date:** 2026-03-18
**Status:** Approved for Implementation
**Priority:** Highest

## Overview

Web版QuickTileCreate.tsxの洗練されたUXをAndroid版に完全移植する。Material 3コンポーネントを最大限活用し、Web版と同等の使いやすさを実現する。

## Design Principles

1. **Web版の完全移植** - すべてのUX要素を忠実に再現
2. **Material 3ネイティブ活用** - TabRow, TimePicker, DatePicker, SegmentedButton等を使用
3. **モノクロ3色テーマ** - Light/Gray/Dark の3テーマ展開（Web版準拠）
4. **タスク作成パネル最優先** - 最も重要なUXコンポーネント

## Component Architecture

### File Structure

```
app/src/main/java/app/tastile/android/ui/
├── theme/
│   ├── Color.kt              # 3テーマのカラー定義（完全書き換え）
│   ├── Theme.kt              # テーマシステム（完全書き換え）
│   └── Type.kt               # タイポグラフィ（既存維持）
├── dashboard/
│   ├── QuickCreateSheet.kt   # メインコンポーネント（完全書き換え）
│   └── components/
│       ├── SectionBlock.kt          # セクション区切り + タイトル + ヘルプ
│       ├── HelpBadge.kt             # ?アイコン + ツールチップ
│       ├── DurationInput.kt         # 時間入力（HH:MM + ピッカー）
│       ├── DurationPickerDialog.kt  # 時間選択ダイアログ
│       └── AutoCompleteTextField.kt # オートコンプリート入力
└── util/
    ├── DateTimeUtils.kt      # 日時パース・フォーマット
    ├── DurationUtils.kt      # 時間計算ユーティリティ
    └── ValidationUtils.kt    # バリデーションロジック
```

## Theme System (Web準拠モノクロ3色)

### Color Definitions

**Light Theme:**
- Background: `#F5F5F5`
- Surface 0: `#FAFAFA`
- Surface 1: `#EFEFEF`
- Surface 2: `#FFFFFF`
- Foreground: `#0A0A0A`
- Primary: `#0A0A0A` (モノクロ)
- On Primary: `#FFFFFF`

**Gray Theme (Dark Gray):**
- Background: `#171717`
- Surface 0: `#1F1F1F`
- Surface 1: `#141414`
- Surface 2: `#262626`
- Foreground: `#FAFAFA`
- Primary: `#FAFAFA` (モノクロ)
- On Primary: `#0A0A0A`

**Dark Theme (True Black):**
- Background: `#000000`
- Surface 0: `#0A0A0A`
- Surface 1: `#050505`
- Surface 2: `#171717`
- Foreground: `#FFFFFF`
- Primary: `#FFFFFF` (モノクロ)
- On Primary: `#000000`

### Implementation

```kotlin
// ui/theme/Color.kt
object TastileColors {
    // Light Theme
    val LightBackground = Color(0xFFF5F5F5)
    val LightSurface0 = Color(0xFFFAFAFA)
    val LightSurface1 = Color(0xFFEFEFEF)
    val LightSurface2 = Color(0xFFFFFFFF)
    val LightForeground = Color(0xFF0A0A0A)
    val LightForegroundMuted = Color(0xFF525252)
    val LightPrimary = Color(0xFF0A0A0A)
    val LightOnPrimary = Color(0xFFFFFFFF)

    // Gray Theme
    val GrayBackground = Color(0xFF171717)
    val GraySurface0 = Color(0xFF1F1F1F)
    val GraySurface1 = Color(0xFF141414)
    val GraySurface2 = Color(0xFF262626)
    val GrayForeground = Color(0xFFFAFAFA)
    val GrayForegroundMuted = Color(0xFFD4D4D4)
    val GrayPrimary = Color(0xFFFAFAFA)
    val GrayOnPrimary = Color(0xFF0A0A0A)

    // Dark Theme
    val DarkBackground = Color(0xFF000000)
    val DarkSurface0 = Color(0xFF0A0A0A)
    val DarkSurface1 = Color(0xFF050505)
    val DarkSurface2 = Color(0xFF171717)
    val DarkForeground = Color(0xFFFFFFFF)
    val DarkForegroundMuted = Color(0xFFD4D4D4)
    val DarkPrimary = Color(0xFFFFFFFF)
    val DarkOnPrimary = Color(0xFF000000)
}

// ui/theme/Theme.kt
@Composable
fun TastileTheme(
    themeMode: ThemeMode = ThemeMode.LIGHT,
    content: @Composable () -> Unit
) {
    val colorScheme = when (themeMode) {
        ThemeMode.LIGHT -> lightColorScheme(...)
        ThemeMode.GRAY -> darkColorScheme(...)
        ThemeMode.DARK -> darkColorScheme(...)
    }
    MaterialTheme(colorScheme = colorScheme, content = content)
}
```

## Material 3 Components Usage

### 1. TabRow (繰り返し頻度選択)

```kotlin
TabRow(selectedTabIndex = selectedTabIndex) {
    Tab(
        selected = recurrenceFrequency == "daily",
        onClick = { setRecurrenceFrequency("daily") },
        text = { Text(t("毎日", "Daily")) }
    )
    Tab(
        selected = recurrenceFrequency == "weekly",
        onClick = { setRecurrenceFrequency("weekly") },
        text = { Text(t("毎週", "Weekly")) }
    )
    Tab(
        selected = recurrenceFrequency == "monthly",
        onClick = { setRecurrenceFrequency("monthly") },
        text = { Text(t("毎月", "Monthly")) }
    )
}
```

### 2. SegmentedButton (種類・目標選択)

```kotlin
SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
    SegmentedButton(
        selected = tileKind == "work",
        onClick = { setTileKind("work") },
        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2)
    ) {
        Text(t("作業", "Work"))
    }
    SegmentedButton(
        selected = tileKind == "label",
        onClick = { setTileKind("label") },
        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2)
    ) {
        Text(t("ラベル", "Label"))
    }
}
```

### 3. DatePicker (日付選択)

```kotlin
val datePickerState = rememberDatePickerState()
DatePickerDialog(
    onDismissRequest = { showDatePicker = false },
    confirmButton = {
        TextButton(onClick = {
            datePickerState.selectedDateMillis?.let { millis ->
                val date = Instant.ofEpochMilli(millis)
                    .atZone(ZoneId.systemDefault())
                    .toLocalDate()
                setStartDate(date.toString())
            }
            showDatePicker = false
        }) { Text(t("OK", "OK")) }
    }
) {
    DatePicker(state = datePickerState)
}
```

### 4. TimePicker (時刻選択)

```kotlin
val timePickerState = rememberTimePickerState()
AlertDialog(
    onDismissRequest = { showTimePicker = false },
    confirmButton = {
        TextButton(onClick = {
            val time = String.format(
                "%02d:%02d",
                timePickerState.hour,
                timePickerState.minute
            )
            setStartTime(time)
            showTimePicker = false
        }) { Text(t("OK", "OK")) }
    }
) {
    TimePicker(state = timePickerState)
}
```

## Component Specifications

### 1. SectionBlock

セクションごとにコンテンツを区切り、タイトルとヘルプバッジを表示する。

```kotlin
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
                    fontWeight = FontWeight.SemiBold
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

### 2. HelpBadge

?アイコンをクリックするとヘルプテキストをツールチップで表示。

```kotlin
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
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}
```

### 3. DurationInput + DurationPickerDialog

HH:MM形式で時間を表示し、時計アイコンをタップするとカスタムピッカーを表示。プリセットボタン（15m, 25m, 45m, 1h）も提供。

```kotlin
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
                focusedContainerColor = MaterialTheme.colorScheme.surface
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

@Composable
fun DurationPickerDialog(
    initialHours: Int,
    initialMinutes: Int,
    onConfirm: (Int, Int) -> void,
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
                            Icon(Icons.Default.KeyboardArrowUp, null)
                        }
                        Text(
                            String.format("%02d", hours),
                            style = MaterialTheme.typography.titleLarge
                        )
                        IconButton(onClick = { hours = (hours - 1).coerceIn(0, 99) }) {
                            Icon(Icons.Default.KeyboardArrowDown, null)
                        }
                    }

                    Text(":", style = MaterialTheme.typography.headlineMedium)

                    // Minutes
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        IconButton(onClick = { minutes = (minutes + 5).coerceIn(0, 59) }) {
                            Icon(Icons.Default.KeyboardArrowUp, null)
                        }
                        Text(
                            String.format("%02d", minutes),
                            style = MaterialTheme.typography.titleLarge
                        )
                        IconButton(onClick = { minutes = (minutes - 5).coerceIn(0, 59) }) {
                            Icon(Icons.Default.KeyboardArrowDown, null)
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

### 4. AutoCompleteTextField

プロジェクト・タグ入力用のオートコンプリート。

```kotlin
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

## QuickCreateSheet Main Component

### State Management

すべての状態を`rememberSaveable`で管理（Web版と同じパターン）:

```kotlin
var title by rememberSaveable { mutableStateOf("") }
var titleEdited by rememberSaveable { mutableStateOf(false) }
var tileKind by rememberSaveable { mutableStateOf("work") }
var objectiveMode by rememberSaveable { mutableStateOf("finish_once") }
var useStartAt by rememberSaveable { mutableStateOf(false) }
var useEndAt by rememberSaveable { mutableStateOf(false) }
var startDate by rememberSaveable { mutableStateOf("") }
var startTime by rememberSaveable { mutableStateOf("") }
// ... 他の状態も同様
```

### Derived Values

Web版と同じロジックで派生値を計算:

```kotlin
val workTargetMin = parseDurationToMinutes(workHours, workMinutes)
val boundedDurationMin = parseBoundedDurationMinutes(startDate, startTime, endDate, endTime)
val effectiveDurationMin = /* Web版と同じロジック */
val suggestedTitle = /* Web版と同じロジック */
val doneDefinition = /* Web版と同じロジック */
```

### UI Structure

```kotlin
@Composable
fun QuickCreateSheet(
    viewModel: DashboardViewModel,
    onClose: () -> Unit
) {
    val locale by viewModel.locale.collectAsStateWithLifecycle()
    fun t(ja: String, en: String): String = if (locale == AppLocale.JA) ja else en

    // ... 状態定義 ...

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
                Icon(Icons.Default.Close, contentDescription = "閉じる")
            }
        }

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
                placeholder = { Text(suggestedTitle) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
        }

        // Kind
        SectionBlock {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = tileKind == "work",
                    onClick = { tileKind = "work" },
                    shape = SegmentedButtonDefaults.itemShape(0, 2)
                ) { Text(t("作業", "Work")) }
                SegmentedButton(
                    selected = tileKind == "label",
                    onClick = { tileKind = "label" },
                    shape = SegmentedButtonDefaults.itemShape(1, 2)
                ) { Text(t("ラベル", "Label")) }
            }
        }

        // Objective Mode
        SectionBlock {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = objectiveMode == "finish_once",
                    onClick = { objectiveMode = "finish_once" },
                    shape = SegmentedButtonDefaults.itemShape(0, 2)
                ) { Text(t("単発", "Finish once")) }
                SegmentedButton(
                    selected = objectiveMode == "recurring",
                    onClick = { objectiveMode = "recurring" },
                    shape = SegmentedButtonDefaults.itemShape(1, 2)
                ) { Text(t("繰返し", "Recurring")) }
            }
        }

        // Recurrence settings (if recurring)
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
                // ... 繰り返し詳細設定 ...
            }
        }

        // Schedule
        SectionBlock(
            title = t("スケジュール", "Schedule"),
            helpText = t("開始・終了日時を設定", "Set start/end times")
        ) {
            // DatePicker + TimePicker integration
            // ... 実装詳細 ...
        }

        // Duration (if work)
        if (tileKind == "work") {
            SectionBlock(
                title = t("作業時間", "Work duration"),
                helpText = t("目標作業時間を設定", "Set target work duration")
            ) {
                DurationInput(
                    hours = workHours,
                    minutes = workMinutes,
                    onHoursChange = { workHours = it },
                    onMinutesChange = { workMinutes = it }
                )
            }
        }

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
                        shape = SegmentedButtonDefaults.itemShape(0, 2)
                    ) { Text(t("分割する", "Allow split")) }
                    SegmentedButton(
                        selected = !breakSplitsWork,
                        onClick = { breakSplitsWork = false },
                        shape = SegmentedButtonDefaults.itemShape(1, 2)
                    ) { Text(t("継続", "Keep continuous")) }
                }
            }
        }

        // Meta: Project + Tags
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
                minLines = 3
            )
        }

        // Error display
        if (error != null) {
            Text(
                error!!,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall
            )
        }

        // Submit buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            TextButton(onClick = onClose) {
                Text(t("キャンセル", "Cancel"))
            }
            Button(
                onClick = { /* create tile */ },
                enabled = canSubmit && !submitting
            ) {
                Text(t("作成", "Create"))
            }
        }
    }
}
```

## Validation & Error Handling

Web版と同じバリデーションロジックを実装:

```kotlin
val temporalOrderValid = if (objectiveMode == "recurring") {
    recurrenceWindowValid
} else {
    startDate.isEmpty() || endDate.isEmpty() ||
    parseDateTime(endDate, endTime) > parseDateTime(startDate, startTime)
}

val durationReady = if (tileKind != "work") {
    true
} else if (objectiveMode == "recurring") {
    (workTargetMin ?: 0) > 0
} else {
    !hasAnyTemporalConstraint || (workTargetMin ?: 0) > 0
}

val recurrenceReady = objectiveMode != "recurring" || recurrenceInterval > 0

val canSubmit = title.trim().isNotEmpty() &&
                temporalOrderValid &&
                durationReady &&
                recurrenceReady
```

## Auto-suggestion Logic

### Title Auto-suggestion

```kotlin
val suggestedTitle = derivedStateOf {
    when {
        tileKind == "label" -> t("期間ラベル", "Period label")
        objectiveMode == "recurring" && workTargetText != null ->
            t("定期タスク $workTargetText", "Recurring task $workTargetText")
        objectiveMode == "recurring" ->
            t("定期タスク", "Recurring task")
        objectiveMode == "maximize_within_interval" && showFocusUntilEnd ->
            t("できる限り進める", "Maximize progress")
        workTargetText != null ->
            t("作業 $workTargetText", "Task $workTargetText")
        else ->
            t("作業タスク", "Task")
    }
}.value

LaunchedEffect(suggestedTitle) {
    if (!titleEdited) {
        title = suggestedTitle
    }
}
```

### Done Definition Auto-generation

```kotlin
val doneDefinition = derivedStateOf {
    when {
        tileKind == "label" ->
            t("指定した期間のラベル付けを完了", "Complete labeling for the selected period")
        objectiveMode == "recurring" ->
            t("1サイクル実行したら完了（定期）", "Complete one cycle (recurring)")
        objectiveMode == "maximize_within_interval" ->
            t("できる限り進める", "Maximize progress")
        workTargetText != null ->
            t("${workTargetText}の実行を完了", "Complete $workTargetText of work")
        else ->
            t("1回の実行を完了", "Complete one run")
    }
}.value
```

## Implementation Phases

### Phase 1: Theme System Rewrite
- [ ] `Color.kt` - 3テーマのカラー定義
- [ ] `Theme.kt` - TastileTheme関数実装
- [ ] ThemeMode enum (LIGHT/GRAY/DARK)

### Phase 2: Basic Components
- [ ] `SectionBlock.kt`
- [ ] `HelpBadge.kt`
- [ ] `AutoCompleteTextField.kt`

### Phase 3: Duration Input (最重要UX)
- [ ] `DurationInput.kt`
- [ ] `DurationPickerDialog.kt`
- [ ] Duration utilities

### Phase 4: QuickCreateSheet Complete Rewrite
- [ ] 既存QuickCreateSheet.ktを完全書き換え
- [ ] すべてのセクション実装
- [ ] Material 3コンポーネント統合

### Phase 5: Validation & Error Handling
- [ ] ValidationUtils.kt
- [ ] エラー表示UI
- [ ] バリデーションロジック統合

### Phase 6: Auto-suggestion
- [ ] タイトル自動サジェスト
- [ ] 完了条件自動生成
- [ ] 時間の自動計算

### Phase 7: Project/Tag Autocomplete
- [ ] 既存プロジェクト・タグの取得
- [ ] オートコンプリート機能統合

## Success Criteria

- [ ] Web版QuickTileCreateのすべての機能をAndroid版で再現
- [ ] Material 3コンポーネントを最大限活用
- [ ] 3色テーマ（Light/Gray/Dark）が完全動作
- [ ] DurationInputが直感的で使いやすい
- [ ] プロジェクト・タグのオートコンプリートが動作
- [ ] タイトル・完了条件の自動サジェストが動作
- [ ] バリデーションが適切に機能
- [ ] 日英両言語対応

## References

- Web版実装: `tastile-web/src/components/tiles/QuickTileCreate.tsx`
- Web版カラー: `tastile-web/src/app/globals.css`
- Material 3 Components: https://developer.android.com/jetpack/compose/designsystems/material3
