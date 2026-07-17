# Timeline Header Menu Design (2026-07-17)

## 1. Background / problem

The mobile timeline currently stacks two header strips above the Day/Week/Month
canvas:

1. The `MobileTopBar` already exposes the scale picker (Day / Week / Month / List)
   via a pill-shaped `DropdownMenu` (`app/src/main/java/app/tastile/android/ui/mobile/MobileTopBar.kt`).
2. A separate `CalendarToolbar` is overlaid on top of the timeline body in
   `app/src/main/java/app/tastile/android/ui/mobile/tabs/TimelineScreen.kt:213-237`.
   It renders a duplicate "‹  Today  ›" navigation row plus a "Scope / Around /
   Future" mode row and a "Min Any 5m 15m 30m" filter row.

The two strips share a fixed `+ 76.dp` offset and visually collide with the
title row of the top bar. Per feedback, the duplicate row is redundant; the
controls should live inside the existing top-bar batch menu so that the header
mirrors the web calendar side panel header (one place, one affordance).

## 2. Goals & non-goals

### Goals

- Remove the duplicate row above the timeline canvas.
- Fold the previous `CalendarToolbar` affordances (Today / Prev / Next /
  CalendarMode / minimum duration) into the existing
  `MobileTopBar.ScaleDropdown` `DropdownMenu`.
- Keep `DashboardViewModel` and the `CalendarFilterPanel` (mini calendar +
  Projects tree) untouched so we do not have to revisit calendar filtering
  semantics.
- Keep all menu actions working with the same `ViewModel` setters as today;
  this is a UI relocation, not a logic change.

### Non-goals

- No changes to the `CalendarFilterPanel` (mini-calendar + projects tree).
- No changes to `DashboardViewModel` API surface.
- No i18n / l10n churn beyond the new menu labels (English literals; the
  existing top bar already mixes labelled and unlabelled English controls).
- No changes to the desktop or web clients.

## 3. UX behavior

### Top bar trigger (unchanged)

The existing pill labelled with the current `TimelineScale` (`Day` / `Week` /
`Month` / `List`) remains the only visible affordance.

### DropdownMenu contents (top-to-bottom)

1. **Scale section** — existing four rows:
   - `Day`
   - `Week`
   - `Month`
   - `List`
2. `HorizontalDivider` (rendered only when at least one of the lower sections
   is present).
3. **Navigation section** (rendered when `onToday` or `onPrevious` is non-null):
   - `‹ Previous` (`onPrevious`), disabled when `canNavigate == false`
   - `Today` (`onToday`)
   - `Next ›` (`onNext`), disabled when `canNavigate == false`
4. `HorizontalDivider` (rendered only when the mode section follows).
5. **Mode section** (rendered when `calendarMode != null`):
   - `Scope`
   - `Around`
   - `Future`
   Active value is bolded exactly like the existing scale rows.
6. `HorizontalDivider` (rendered only when the minimum duration section
   follows).
7. **Minimum duration section** (rendered when `minimumDuration != null`):
   - `Any` (renders when `mins == 0`)
   - `5m`
   - `15m`
   - `30m`
   Active value is bolded.

Selecting any item dismisses the menu the same way the existing scale row
does. The trigger pill continues to display only the current scale name; the
other active values (mode, minimum duration) are surfaced through the menu
but not echoed back to the pill (matches existing scale-only pill design).

## 4. Component changes

### `app/src/main/java/app/tastile/android/ui/mobile/MobileTopBar.kt`

- Add optional parameters to `MobileTopBar`:
  - `calendarMode: CalendarMode? = null`
  - `onCalendarModeChange: ((CalendarMode) -> Unit)? = null`
  - `onToday: (() -> Unit)? = null`
  - `onPrevious: (() -> Unit)? = null`
  - `onNext: (() -> Unit)? = null`
  - `canNavigate: Boolean = true`
  - `minimumDuration: Int? = null`
  - `onMinimumDurationChange: ((Int) -> Unit)? = null`
- Pass the new parameters to `ScaleDropdown`. Keep all existing parameters and
  semantics identical so non-timeline routes (execute / tiles / integrations /
  settings) keep working unchanged (they pass nothing extra).
- Extend `ScaleDropdown` to render the sections described in §3 inside the
  same `DropdownMenu`. Sections that should not appear (parameter is `null`
  for that section) are skipped, including their preceding `HorizontalDivider`,
  so the menu stays clean on routes that opt out.
- Add `testTag` attributes on the new `DropdownMenuItem` rows so future UI
  tests can target them without coupling to the English text:
  - `dropdown-nav-prev`, `dropdown-today`, `dropdown-nav-next`
  - `dropdown-mode-{name.lowercase()}`
  - `dropdown-min-{minutes}`

### `app/src/main/java/app/tastile/android/ui/mobile/MobileScaffold.kt`

- In the `Scaffold(topBar = { ... })` block for the timeline route, collect
  the new ViewModel state needed for the menu and pass it down:
  - `calendarMode` from `dashboardViewModel.calendarMode`
  - `calendarMinimumDurationMinutes` from the existing
    `dashboardViewModel.calendarMinimumDurationMinutes`
  - `canNavigate` from `app.tastile.android.ui.dashboard.canNavigateCalendar(calendarMode)`
- Wire callbacks to the existing ViewModel methods:
  - `onCalendarModeChange = dashboardViewModel::setCalendarMode`
  - `onToday = dashboardViewModel::goToCalendarToday`
  - `onPrevious = { dashboardViewModel.moveCalendar(-1) }`
  - `onNext = { dashboardViewModel.moveCalendar(1) }`
  - `onMinimumDurationChange = dashboardViewModel::setCalendarMinimumDuration`
- Only pass the new arguments when `currentRoute == "timeline"` and
  `showScale = true`, so other routes are unaffected.

### `app/src/main/java/app/tastile/android/ui/mobile/tabs/TimelineScreen.kt`

- Delete the `CalendarToolbar(...)` invocation block
  (`TimelineScreen.kt:213-224`).
- Delete the `CalendarFilterPanel` `+ 76.dp` offset and the panel call
  itself (`TimelineScreen.kt:226-237`); the `CalendarFilterPanel` and its
  composable are kept untouched in case future work needs them. The
  composition here is fully removed because the user explicitly asked to
  remove the duplicate controls above the timeline.
- Delete the now-unused `CalendarToolbar` private composable
  (`TimelineScreen.kt:262-308`).
- Remove unused imports (e.g. `clickable`, `Column`, `Row`, `MaterialTheme`,
  `CalendarMode`, `canNavigateCalendar`) and the now-unused parameters
  (`calendarMode`, `minimumDuration`, `tileFilter`, `projectsViewModel`,
  `selectedDay`, `onPrevious`, `onNext`, `onMode`, `onMinimumDuration`).

> Note: `CalendarFilterPanel` is also no longer composed from
> `TimelineScreen`. The composable and its tests in
> `app/src/test/.../tabs/CalendarFilterPanelTest.kt` (if any) remain
> unchanged on disk; if no caller exists after this change, the file is
> flagged as dead code in a follow-up and removed separately. This keeps
> the surgical diff under the user's "remove the duplicate header"
> request and avoids the risk of deleting test coverage that the user
> did not ask to remove.

## 5. Data flow & view model surface

No new state. The `DropdownMenu` items call the same ViewModel methods that
the removed `CalendarToolbar` used:

| Menu item | ViewModel call |
| --- | --- |
| `Day` / `Week` / `Month` / `List` | `dashboardViewModel.setScale(...)` |
| `‹ Previous` / `Next ›` | `dashboardViewModel.moveCalendar(±1)` (gated by `canNavigateCalendar(mode)`) |
| `Today` | `dashboardViewModel.goToCalendarToday()` |
| `Scope` / `Around` / `Future` | `dashboardViewModel.setCalendarMode(...)` |
| `Any` / `5m` / `15m` / `30m` | `dashboardViewModel.setCalendarMinimumDuration(...)` |

Selecting a new value triggers the same reactive path that the toolbar used
(`combine(_selectedDay, _scale, _calendarMode) { ... }` in
`DashboardViewModel`) so the timeline range recomputes identically.

## 6. Test & verification

### Unit / Robolectric tests

- `MobileTopBarTest` (`app/src/test/.../mobile/MobileTopBarTest.kt`):
  - The two existing tests continue to pass because `ScaleDropdown` still
    renders the scale rows and the top-bar icons.
  - Add a new test `dropdown menu exposes today, navigation, mode, and
    minimum-duration sections when configured`. The test passes the full set
    of new parameters, taps the trigger pill, then asserts that the new
    `testTag`-prefixed menu rows are displayed, and that selecting
    `dropdown-today` calls the supplied `onToday` callback. Selecting
    `dropdown-mode-future` and `dropdown-min-15` is verified the same way.
- `TimelineScreenLayoutTest` does not reference `CalendarToolbar` and is
  expected to remain green.

### Manual / device verification

- Build: `cd tastile-android && ./gradlew :app:assembleDebug` (CI is the
  source of truth for the green/red; the local `cc1.exe` block applies).
- Verify in chrome-devtools MCP against a running emulator:
  1. Open the Timeline tab. Only the existing top bar should be visible
     above the calendar canvas.
  2. Tap the scale pill. The menu shows four scale rows, then the new
     nav / mode / minimum-duration sections in order.
  3. Pick `Scope` from the mode section, then pick `15m` from the
     minimum-duration section. Verify the timeline re-fetches the
     expected range.
  4. Tap `‹ Previous`, then `Today`, then `Next ›`. The pager page index
     updates as before.
  5. Switch the mode to `Future`. `‹ Previous` / `Next ›` rows in the menu
     are visibly disabled.

### Test plan check

- [ ] Unit tests updated
- [ ] `./gradlew :app:assembleDebug` passes
- [ ] Chrome-devtools MCP verification completed
- [ ] No new lint warnings introduced

## 7. Risks / open questions

- **Discoverability of the moved actions.** Today / Previous / Next / Mode /
  Minimum duration disappear from the always-visible header and move behind
  the scale pill. Mitigation: the menu sections are visually labelled
  (Today / Previous / Next / Mode / Min) and grouped with dividers; the
  menu is one tap away on the same control users already use to switch
  scales.
- **`CalendarFilterPanel` left on disk after this change.** The composable
  and any tests for it are no longer wired in by `TimelineScreen` after
  this PR, but the file is **not** removed in this commit. The user's
  request was to remove the duplicate header row, not to delete the
  filter panel; the file is flagged for a separate cleanup PR so the
  diff stays surgical.
- **No design impact on other top-bar surfaces.** `MobileTopBar` is
  shared with `execute` / `tiles` / `integrations` / `settings` routes.
  New parameters default to `null` / no-op, so the non-timeline menu stays
  a scale-only dropdown.

## 8. Rollback plan

- Revert the single commit that lands these changes; no migrations,
  no schema changes, and no data dependencies.
- The `MobileTopBar` parameter additions are backwards compatible
  (all default to `null` / no-op), so leaving them in place after a
  rollback of the menu sections only re-introduces a redundant parameter
  set without breaking other routes.
