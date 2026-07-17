# Timeline Header Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicate calendar toolbar row above the mobile timeline canvas and fold its Today / navigation / mode / minimum-duration controls into the existing `MobileTopBar` scale-picker `DropdownMenu`.

**Architecture:** Keep all calendar state and `ViewModel` APIs unchanged. The `MobileTopBar.ScaleDropdown` is extended with optional, route-gated parameters so other tabs continue to render a scale-only menu. The duplicate `CalendarToolbar` composable, its caller, the `CalendarFilterPanel` invocation, and the `+ 76.dp` offset are deleted from `TimelineScreen`. The `CalendarFilterPanel` composable itself is left on disk for a separate cleanup PR (out of scope here).

**Tech Stack:** Kotlin, Jetpack Compose, Material 3, Hilt, JUnit4 + Compose UI test, Gradle (Kotlin DSL).

**Working directory:** `tastile-android/` (sub-project of `tastile-root`). The plan assumes the engineer is on a branch derived from `main`; do all work in that branch.

**Spec:** `docs/superpowers/specs/2026-07-17-timeline-header-menu-design.md` (commit `53cd2f4`).

---

## File Structure

### Files modified in this plan

| File | Responsibility |
| --- | --- |
| `app/src/main/java/app/tastile/android/ui/mobile/MobileTopBar.kt` | Add optional calendar menu parameters; render the new sections inside `ScaleDropdown` `DropdownMenu`. |
| `app/src/main/java/app/tastile/android/ui/mobile/MobileScaffold.kt` | Collect the new ViewModel state on the timeline route and pass it into `MobileTopBar`. |
| `app/src/main/java/app/tastile/android/ui/mobile/tabs/TimelineScreen.kt` | Delete `CalendarToolbar` invocation, `CalendarFilterPanel` invocation, the `+ 76.dp` offset, the `CalendarToolbar` private composable, and the now-unused imports / parameters. |
| `app/src/test/java/app/tastile/android/ui/mobile/MobileTopBarTest.kt` | Add a regression test that exercises the new menu sections through the testTags introduced in the spec. |

### Files intentionally left untouched in this plan

- `app/src/main/java/app/tastile/android/ui/mobile/tabs/CalendarFilterPanel.kt` — composable and its tests are kept on disk; flagged for separate cleanup PR.
- `app/src/main/java/app/tastile/android/ui/dashboard/DashboardViewModel.kt` — no API changes required.
- `app/src/main/java/app/tastile/android/ui/dashboard/CalendarNavigation.kt` — `CalendarMode` and `canNavigateCalendar` are referenced as-is.

---

## Task 1: Extend `MobileTopBar` with optional calendar menu parameters

**Files:**
- Modify: `app/src/main/java/app/tastile/android/ui/mobile/MobileTopBar.kt:60-152`

- [ ] **Step 1: Add the new imports to `MobileTopBar.kt`**

Locate the existing `import` block (top of the file, around lines 19–58). Add the following three lines in alphabetical order with the other `androidx.compose.material3` imports, and the `CalendarMode` import next to the existing `TimelineScale` import:

```kotlin
// m2-allow: m3-component
import androidx.compose.material3.HorizontalDivider
import app.tastile.android.ui.dashboard.CalendarMode
```

(If a `// m2-allow:` comment is already present on neighbouring imports, mirror that style; otherwise the two imports above are sufficient. The `HorizontalDivider` is an m3 component, so the marker is required by this codebase's lint policy.)

- [ ] **Step 2: Extend the `MobileTopBar` signature**

In `MobileTopBar.kt`, change the `MobileTopBar` composable signature (lines 60–71) to:

```kotlin
@Composable
fun MobileTopBar(
    title: String,
    scale: TimelineScale,
    onScaleChange: (TimelineScale) -> Unit,
    onMenu: () -> Unit,
    onNotifications: () -> Unit,
    modifier: Modifier = Modifier,
    avatarUrl: String? = null,
    avatarFallback: String = "U",
    showScale: Boolean = true,
    calendarMode: CalendarMode? = null,
    onCalendarModeChange: ((CalendarMode) -> Unit)? = null,
    onToday: (() -> Unit)? = null,
    onPrevious: (() -> Unit)? = null,
    onNext: (() -> Unit)? = null,
    canNavigate: Boolean = true,
    minimumDuration: Int? = null,
    onMinimumDurationChange: ((Int) -> Unit)? = null,
) {
```

- [ ] **Step 3: Forward the new parameters to `ScaleDropdown`**

In the same composable, replace the existing call site (around lines 103–106):

```kotlin
        if (showScale) {
            ScaleDropdown(
                scale = scale,
                onScaleChange = onScaleChange,
                calendarMode = calendarMode,
                onCalendarModeChange = onCalendarModeChange,
                onToday = onToday,
                onPrevious = onPrevious,
                onNext = onNext,
                canNavigate = canNavigate,
                minimumDuration = minimumDuration,
                onMinimumDurationChange = onMinimumDurationChange,
            )
            Spacer(Modifier.width(4.dp))
        }
```

- [ ] **Step 4: Update the `ScaleDropdown` composable to accept the new parameters**

In `MobileTopBar.kt`, replace the existing `ScaleDropdown` definition (lines 120–152) with:

```kotlin
@Composable
private fun ScaleDropdown(
    scale: TimelineScale,
    onScaleChange: (TimelineScale) -> Unit,
    calendarMode: CalendarMode?,
    onCalendarModeChange: ((CalendarMode) -> Unit)?,
    onToday: (() -> Unit)?,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
    canNavigate: Boolean,
    minimumDuration: Int?,
    onMinimumDurationChange: ((Int) -> Unit)?,
) {
    var expanded by remember { mutableStateOf(false) }
    val hasNav = onToday != null || onPrevious != null || onNext != null
    val hasMode = calendarMode != null && onCalendarModeChange != null
    val hasMin = minimumDuration != null && onMinimumDurationChange != null
    Box {
        CompactPickerButton(
            label = scale.name,
            onClick = { expanded = true },
            modifier = Modifier.semantics { contentDescription = "Scale: ${scale.name}" },
        )
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            TimelineScale.entries.forEach { entry ->
                DropdownMenuItem(
                    text = {
                        Text(
                            text = entry.name,
                            fontWeight = if (entry == scale) FontWeight.SemiBold else FontWeight.Normal,
                        )
                    },
                    onClick = {
                        onScaleChange(entry)
                        expanded = false
                    },
                )
            }
            if (hasNav || hasMode || hasMin) {
                HorizontalDivider()
            }
            if (hasNav) {
                onPrevious?.let {
                    DropdownMenuItem(
                        text = { Text("‹ Previous") },
                        enabled = canNavigate,
                        modifier = Modifier.testTag("dropdown-nav-prev"),
                        onClick = { it(); expanded = false },
                    )
                }
                onToday?.let {
                    DropdownMenuItem(
                        text = { Text("Today") },
                        modifier = Modifier.testTag("dropdown-today"),
                        onClick = { it(); expanded = false },
                    )
                }
                onNext?.let {
                    DropdownMenuItem(
                        text = { Text("Next ›") },
                        enabled = canNavigate,
                        modifier = Modifier.testTag("dropdown-nav-next"),
                        onClick = { it(); expanded = false },
                    )
                }
            }
            if (hasMode) {
                HorizontalDivider()
                CalendarMode.entries.forEach { mode ->
                    DropdownMenuItem(
                        text = {
                            Text(
                                text = mode.name,
                                fontWeight = if (mode == calendarMode) FontWeight.SemiBold else FontWeight.Normal,
                            )
                        },
                        modifier = Modifier.testTag("dropdown-mode-${mode.name.lowercase()}"),
                        onClick = {
                            onCalendarModeChange?.invoke(mode)
                            expanded = false
                        },
                    )
                }
            }
            if (hasMin) {
                HorizontalDivider()
                listOf(0, 5, 15, 30).forEach { minutes ->
                    DropdownMenuItem(
                        text = {
                            Text(
                                text = if (minutes == 0) "Any" else "${minutes}m",
                                fontWeight = if (minutes == minimumDuration) FontWeight.SemiBold else FontWeight.Normal,
                            )
                        },
                        modifier = Modifier.testTag("dropdown-min-$minutes"),
                        onClick = {
                            onMinimumDurationChange?.invoke(minutes)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}
```

- [ ] **Step 5: Verify the file compiles locally**

Run (in the WSL Ubuntu distribution per project memory — Windows Defender blocks `cc1.exe`):

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-android
./gradlew :app:compileDebugKotlin
```

Expected: BUILD SUCCESSFUL. (CI on `ubuntu-latest` is the source of truth; local compile is a sanity check only.)

- [ ] **Step 6: Commit**

```bash
cd C:/Users/rebui/Desktop/tastile
git add tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileTopBar.kt
git commit -m "feat(mobile-top-bar): add optional calendar menu sections"
```

---

## Task 2: Wire the new parameters from `MobileScaffold` on the timeline route

**Files:**
- Modify: `app/src/main/java/app/tastile/android/ui/mobile/MobileScaffold.kt:50-112`

- [ ] **Step 1: Add the new state collections in `MobileScaffold`**

Inside `MobileScaffold`, immediately after the existing `val scale by dashboardViewModel.scale.collectAsStateWithLifecycle()` line (around line 54), add:

```kotlin
    val calendarMode by dashboardViewModel.calendarMode.collectAsStateWithLifecycle()
    val calendarMinimumDurationMinutes by dashboardViewModel.calendarMinimumDurationMinutes.collectAsStateWithLifecycle()
    val canNavigateCalendar = app.tastile.android.ui.dashboard.canNavigateCalendar(calendarMode)
```

- [ ] **Step 2: Pass the new parameters to `MobileTopBar` only on the timeline route**

Replace the `MobileTopBar` call inside the `if (currentRoute != "settings") { ... }` block (lines 99–112). The replacement should keep all existing parameters identical and append the new ones only when `currentRoute == "timeline"`:

```kotlin
                if (currentRoute != "settings") {
                    MobileTopBar(
                        title = title,
                        scale = scale,
                        onScaleChange = { dashboardViewModel.setScale(it) },
                        onMenu = { coroutineScope.launch { drawerState.open() } },
                        onNotifications = { overlayViewModel.show(Overlay.Notifications) },
                        avatarUrl = avatarUrl,
                        avatarFallback = profile?.displayName?.firstOrNull()?.toString()
                            ?: email.firstOrNull()?.toString()
                            ?: "U",
                        showScale = currentRoute == "timeline",
                        calendarMode = if (currentRoute == "timeline") calendarMode else null,
                        onCalendarModeChange = if (currentRoute == "timeline") dashboardViewModel::setCalendarMode else null,
                        onToday = if (currentRoute == "timeline") dashboardViewModel::goToCalendarToday else null,
                        onPrevious = if (currentRoute == "timeline") ({ dashboardViewModel.moveCalendar(-1) }) else null,
                        onNext = if (currentRoute == "timeline") ({ dashboardViewModel.moveCalendar(1) }) else null,
                        canNavigate = canNavigateCalendar,
                        minimumDuration = if (currentRoute == "timeline") calendarMinimumDurationMinutes else null,
                        onMinimumDurationChange = if (currentRoute == "timeline") dashboardViewModel::setCalendarMinimumDuration else null,
                    )
                }
```

> **Note on `mobile/tabs/TimelineScreen.kt`:** After Task 3 deletes the `CalendarToolbar` and `CalendarFilterPanel` calls, `TimelineScreen` will no longer need `calendarMode` or `calendarMinimumDurationMinutes` from the ViewModel. The `MobileScaffold` is the only remaining consumer of those flows, so the `collectAsStateWithLifecycle` calls added in this task are not orphans.

- [ ] **Step 3: Verify the file compiles locally**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-android
./gradlew :app:compileDebugKotlin
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/rebui/Desktop/tastile
git add tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileScaffold.kt
git commit -m "feat(mobile-scaffold): pipe calendar menu state to top bar"
```

---

## Task 3: Remove the duplicate toolbar and filter panel from `TimelineScreen`

**Files:**
- Modify: `app/src/main/java/app/tastile/android/ui/mobile/tabs/TimelineScreen.kt:18-24, 60-99, 213-237, 262-308`

- [ ] **Step 1: Delete unused imports**

Remove the following lines from the import block (the line numbers match the current file as of the spec commit):

```kotlin
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.filled.Add
import app.tastile.android.core.designsystem.component.NiaFloatingActionButton
// m2-allow: primitive
import androidx.compose.material3.Icon
// m2-allow: primitive
import androidx.compose.material3.Text
// m2-allow: theme-bridge
import androidx.compose.material3.MaterialTheme
```

Do **not** remove:
- `import androidx.compose.runtime.LaunchedEffect` (still used by pager effects)
- `import androidx.compose.runtime.getValue` / `setValue` (still used by `mutableFloatStateOf`)
- `import app.tastile.android.ui.dashboard.TimelineScale` (still used by `onOpenDay`)
- `import app.tastile.android.ui.mobile.calendar.DayView` etc. (still used by the pager content lambdas)

- [ ] **Step 2: Remove unused `TimelineScreen` parameters and locals**

In the `TimelineScreen` composable body (lines 60–99), delete:

- The lines that read `val calendarMode by viewModel.calendarMode.collectAsStateWithLifecycle()` and `val minimumDuration by viewModel.calendarMinimumDurationMinutes.collectAsStateWithLifecycle()`.
- The lines that read `val tileFilter by viewModel.tileFilter.collectAsStateWithLifecycle()` and `val projectsState by projectsViewModel.state.collectAsStateWithLifecycle()`.
- The `val today = remember { LocalDate.now() }` line **only if** removing it does not break the pager math. (Check the file: the `today` is used in the pager offset calculations at lines 121–142, so leave it in place.)
- The `onEditEvent: (CoreTimelineItem) -> Unit = { ... }` block **only if** it is no longer referenced after the toolbar/filter removals. (Trace: `onEditEvent` is used in the `DayView` / `WeekView` calls. Leave it in place.)
- The `hiltViewModel` import for `ProjectsViewModel` and the `projectsViewModel: ProjectsViewModel = hiltViewModel()` parameter once the filter panel is gone (Task 3 Step 3 removes the last caller).

After deletion, the top of the composable body should look like:

```kotlin
@Composable
fun TimelineScreen(
    viewModel: DashboardViewModel,
    overlay: OverlayViewModel,
) {
    val timeline by viewModel.timeline.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val selectedDay by viewModel.selectedDay.collectAsStateWithLifecycle()
    val scale by viewModel.scale.collectAsStateWithLifecycle()
    val today = remember { LocalDate.now() }
    val zone = remember { ZoneId.systemDefault() }
    val activeTimeline = remember(timeline) { timeline }

    val onOpenDay: (LocalDate) -> Unit = { day ->
        viewModel.setSelectedDay(day)
        viewModel.setScale(TimelineScale.Day)
    }
    val onEditEvent: (CoreTimelineItem) -> Unit = { item ->
        when (val target = calendarEventTarget(item)) {
            is CalendarEventTarget.RecurringTile -> {
                viewModel.selectTile(target.tileId)
                overlay.show(Overlay.TileEdit(tileId = target.tileId))
            }
            is CalendarEventTarget.Placement -> {
                target.tileId?.let(viewModel::selectTile)
                overlay.show(Overlay.TileEdit(tileId = target.tileId, placementId = target.placementId))
            }
        }
    }
```

- [ ] **Step 3: Remove the `CalendarToolbar` and `CalendarFilterPanel` invocations and the `+ 76.dp` offset**

Replace the lines currently numbered 213–237 (the `CalendarToolbar(...)` call followed by the `CalendarFilterPanel(...)` call) with a single blank line so the `Box` only contains the pager and the FAB:

```kotlin
        // Quick-create FAB: bottom-right round + button. Sits on top of every
        // scale (Day / Week / Month) so the entry point is always discoverable
        // regardless of which view the user is on. `navigationBarsPadding` keeps
        // it clear of the system gesture bar on Android 15.
        NiaFloatingActionButton(
            onClick = { overlay.show(Overlay.QuickCreate) },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .navigationBarsPadding()
                .padding(end = 16.dp, bottom = 16.dp),
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            shape = CircleShape,
        ) {
            Icon(
                imageVector = Icons.Filled.Add,
                contentDescription = "Create",
                modifier = Modifier.size(24.dp),
            )
        }
```

Because the FAB still uses `MaterialTheme`, `Icon`, `Icons.Filled.Add`, and `NiaFloatingActionButton`, **revert** the import removals for those four entries from Step 1. Only the imports consumed exclusively by `CalendarToolbar` / `CalendarFilterPanel` / their now-removed `Box(Modifier...)` shell should be deleted:

- `androidx.compose.foundation.background` — only used by the `CalendarToolbar` `Column`; safe to delete.
- `androidx.compose.foundation.clickable` — only used by `CalendarToolbar` rows; safe to delete.

(If lint complains about an unused import for any other symbol — for example `Column` or `Row` — delete it as part of this step, not in Step 1.)

- [ ] **Step 4: Delete the `CalendarToolbar` private composable**

Remove the entire `private fun CalendarToolbar(...)` block (lines 262–308 in the pre-change file). It is no longer referenced.

- [ ] **Step 5: Verify the file compiles locally**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-android
./gradlew :app:compileDebugKotlin
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Run the layout test that must remain green**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-android
./gradlew :app:testDebugUnitTest --tests "app.tastile.android.ui.dashboard.TimelineScreenLayoutTest"
```

Expected: BUILD SUCCESSFUL with 3 tests passing (`parseInstant_parsesIsoWithOffset`, `arrangeVisibleBlocks_keepsItemsOutsideCurrentDay`, `arrangeVisibleBlocks_assignsDifferentLanesForOverlap`).

- [ ] **Step 7: Commit**

```bash
cd C:/Users/rebui/Desktop/tastile
git add tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/TimelineScreen.kt
git commit -m "refactor(timeline): drop duplicate calendar toolbar"
```

---

## Task 4: Add a regression test for the new menu sections

**Files:**
- Modify: `app/src/test/java/app/tastile/android/ui/mobile/MobileTopBarTest.kt:24-88`

- [ ] **Step 1: Add the new imports**

In the import block of `MobileTopBarTest.kt`, add:

```kotlin
import androidx.compose.ui.test.onNodeWithTag
import app.tastile.android.ui.dashboard.CalendarMode
import java.util.concurrent.atomic.AtomicReference
```

(`AtomicReference` is used because we need to capture lambdas; `AtomicInteger` cannot store a value type other than `int`.)

- [ ] **Step 2: Add the regression test**

Append the following test inside the `MobileTopBarTest` class, after the existing `scale picker opens and selects new scale` test:

```kotlin
    @Test
    fun `dropdown exposes nav, mode, and minimum-duration sections when configured`() {
        val today = AtomicReference<Unit>()
        val previous = AtomicReference<Unit>()
        val next = AtomicReference<Unit>()
        val modeRef = AtomicReference<CalendarMode?>(null)
        val minRef = AtomicReference<Int?>(null)
        val currentScale = mutableStateOf(TimelineScale.Day)

        rule.setContent {
            MobileTopBar(
                title = "Timeline",
                scale = currentScale.value,
                onScaleChange = { currentScale.value = it },
                onMenu = {},
                onNotifications = {},
                calendarMode = CalendarMode.Scope,
                onCalendarModeChange = { modeRef.set(it) },
                onToday = { today.set(Unit) },
                onPrevious = { previous.set(Unit) },
                onNext = { next.set(Unit) },
                canNavigate = true,
                minimumDuration = 0,
                onMinimumDurationChange = { minRef.set(it) },
            )
        }

        rule.onNodeWithContentDescription("Scale: Day").performClick()

        rule.onNodeWithTag("dropdown-today").assertIsDisplayed()
        rule.onNodeWithTag("dropdown-nav-prev").assertIsDisplayed()
        rule.onNodeWithTag("dropdown-nav-next").assertIsDisplayed()
        rule.onNodeWithTag("dropdown-mode-scope").assertIsDisplayed()
        rule.onNodeWithTag("dropdown-mode-around").assertIsDisplayed()
        rule.onNodeWithTag("dropdown-mode-future").assertIsDisplayed()
        rule.onNodeWithTag("dropdown-min-0").assertIsDisplayed()
        rule.onNodeWithTag("dropdown-min-5").assertIsDisplayed()
        rule.onNodeWithTag("dropdown-min-15").assertIsDisplayed()
        rule.onNodeWithTag("dropdown-min-30").assertIsDisplayed()

        rule.onNodeWithTag("dropdown-today").performClick()
        rule.onNodeWithTag("dropdown-mode-future").performClick()
        rule.onNodeWithTag("dropdown-min-15").performClick()

        assertEquals(Unit, today.get())
        assertEquals(CalendarMode.Future, modeRef.get())
        assertEquals(15, minRef.get())
    }

    @Test
    fun `dropdown hides nav, mode, and minimum sections when no callbacks are configured`() {
        val currentScale = mutableStateOf(TimelineScale.Day)

        rule.setContent {
            MobileTopBar(
                title = "Execute",
                scale = currentScale.value,
                onScaleChange = { currentScale.value = it },
                onMenu = {},
                onNotifications = {},
            )
        }

        rule.onNodeWithContentDescription("Scale: Day").performClick()

        rule.onNodeWithTag("dropdown-today").assertDoesNotExist()
        rule.onNodeWithTag("dropdown-nav-prev").assertDoesNotExist()
        rule.onNodeWithTag("dropdown-nav-next").assertDoesNotExist()
        rule.onNodeWithTag("dropdown-mode-scope").assertDoesNotExist()
        rule.onNodeWithTag("dropdown-min-0").assertDoesNotExist()
    }
```

- [ ] **Step 3: Run the new tests**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-android
./gradlew :app:testDebugUnitTest --tests "app.tastile.android.ui.mobile.MobileTopBarTest"
```

Expected: BUILD SUCCESSFUL with 4 tests passing (the original 2 plus the 2 new ones).

- [ ] **Step 4: Run the full mobile unit test suite to catch regressions**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-android
./gradlew :app:testDebugUnitTest
```

Expected: BUILD SUCCESSFUL. Investigate any failure that mentions `TimelineScreen`, `MobileTopBar`, or `MobileScaffold`; they are the only files touched by this plan.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/rebui/Desktop/tastile
git add tastile-android/app/src/test/java/app/tastile/android/ui/mobile/MobileTopBarTest.kt
git commit -m "test(mobile-top-bar): cover calendar menu sections"
```

---

## Task 5: Build verification and end-to-end smoke check

**Files:** none — verification only.

- [ ] **Step 1: Run the full debug build**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-android
./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 2: Run the Android lint target**

```bash
cd /mnt/c/Users/rebui/Desktop/tastile/tastile-android
./gradlew :app:lintDebug
```

Expected: BUILD SUCCESSFUL. Address any **new** warnings introduced by the changes (unused imports, missing `testTag`s on the new menu items, etc.). Pre-existing warnings are out of scope.

- [ ] **Step 3: Smoke check the menu in chrome-devtools MCP**

If an Android emulator is reachable from this host, install the freshly built APK and exercise the menu:

1. Open the Timeline tab. Confirm the duplicate row above the calendar canvas is gone and only the existing `MobileTopBar` is visible.
2. Tap the scale pill (`Day` / `Week` / `Month` / `List`).
3. Verify the menu shows the four scale rows followed by `‹ Previous`, `Today`, `Next ›`, then `Scope / Around / Future`, then `Any / 5m / 15m / 30m`, separated by dividers.
4. Tap `Today` — the timeline jumps to today.
5. Tap `Future` — confirm `‹ Previous` and `Next ›` become disabled (the menu re-opens to the same state).
6. Tap `15m` — confirm the menu closes and the timeline re-fetches.

If no emulator is reachable (this Windows host frequently lacks one), document the limitation in the PR description and rely on the test pass from Task 4 plus the manual device QA the user performs on their hardware.

- [ ] **Step 4: Final commit if lint required fixes**

If Step 2 surfaced new lint errors, commit the fix in a follow-up commit:

```bash
cd C:/Users/rebui/Desktop/tastile
git add tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileTopBar.kt \
        tastile-android/app/src/main/java/app/tastile/android/ui/mobile/MobileScaffold.kt \
        tastile-android/app/src/main/java/app/tastile/android/ui/mobile/tabs/TimelineScreen.kt
git commit -m "fix(mobile-top-bar): address lint findings from menu refactor"
```

If no fix is required, skip this step.

---

## Self-Review

### Spec coverage

| Spec section | Covered by |
| --- | --- |
| §3 DropdownMenu contents (scale, nav, mode, min) | Task 1 Steps 1–4 |
| §4 `MobileTopBar.kt` parameter additions and `testTag` | Task 1 Steps 2–4 |
| §4 `MobileScaffold.kt` wiring of state and callbacks | Task 2 Steps 1–2 |
| §4 `TimelineScreen.kt` deletion of `CalendarToolbar`, `CalendarFilterPanel`, `+ 76.dp`, unused imports | Task 3 Steps 1–4 |
| §4 `CalendarFilterPanel` left on disk | Task 3 Step 3 (no removal) |
| §5 Data flow / ViewModel call map | Task 1 Step 4 (calls into existing ViewModel methods) |
| §6 Unit test for new sections | Task 4 Steps 1–2 |
| §6 `TimelineScreenLayoutTest` stays green | Task 3 Step 6 |
| §6 Build / lint / chrome-devtools verification | Task 5 Steps 1–3 |
| §7 Discoverability of moved actions | Mitigated by the section labels in Task 1 Step 4 |
| §7 `CalendarFilterPanel` left in tree unused | Task 3 Step 3 (preserved on disk) |
| §7 No design impact on other top-bar surfaces | Task 1 Step 2 (default `null` parameters) |
| §8 Rollback plan | Implicit: every change is in a single file per commit, all commits are independent. |

### Placeholder scan

- No "TBD", "TODO", or "implement later" markers in the plan.
- No "Add appropriate error handling" generic steps; the menu inherits the existing `DropdownMenu` behavior.
- No "Similar to Task N" — every test code block is fully spelled out.
- No vague steps; every step shows the exact code or the exact command.

### Type / signature consistency

- `MobileTopBar` parameter list in Task 1 Step 2 matches the call site in Task 2 Step 2 and matches the default-`null`/`true` contract used in Task 4.
- `ScaleDropdown` parameter list in Task 1 Step 4 matches the forwarding call in Task 1 Step 3.
- `testTag` strings in Task 1 Step 4 (`dropdown-today`, `dropdown-mode-future`, `dropdown-min-15`, etc.) match the assertions in Task 4 Step 2.
- `CalendarMode.entries` and `CalendarMode.Scope / Around / Future` are used consistently across Task 1 Step 4 and Task 2 Step 2 / Task 4 Step 2.
- `canNavigateCalendar(calendarMode)` is referenced in Task 2 Step 1 with the fully-qualified function name because the import path (`app.tastile.android.ui.dashboard`) is added lazily only in this step.

No inconsistencies found.
