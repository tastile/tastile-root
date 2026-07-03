# Windows Native UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `tastile-desktop` feel native on Windows 11 by following each user's actual PC settings for theme, accent, transparency, animation, accessibility, title bar, iconography, and layout conventions.

**Architecture:** Split the work into two layers. First, build a `SystemAppearanceService` that reads Windows user preferences and raises change notifications. Second, refactor the WinUI layer to consume system-driven design tokens instead of the current hard-coded palette, and rebuild the shell around standard Windows patterns such as `NavigationView`, `AppWindowTitleBar`, system backdrop, and semantic theme resources.

**Tech Stack:** WinUI 3, Windows App SDK 1.7, `AppWindow`/`AppWindowTitleBar`, `SystemBackdrop`, `UISettings`, `AccessibilitySettings`, `Application.RequestedTheme`, WinRT theme resources, Windows Registry fallback, CommunityToolkit.Mvvm.

---

## Research Summary

- Current app state:
  - `MainWindow.xaml` and `SettingsWindow.xaml` are custom card layouts and do not resemble standard Windows shell structure.
  - `ThemeManager.cs` uses a hand-written light/dark palette with no Windows preference integration.
  - `SettingsService.cs` exposes a manual theme selector, which conflicts with a system-driven target.
- Current machine settings snapshot:
  - `AppsUseLightTheme=0`
  - `SystemUsesLightTheme=0`
  - `EnableTransparency=0`
  - `ColorPrevalence=0`
  - `TaskbarAlignment=1`
  - `MinAnimate=0`
  - `HighContrast.Flags=126`
- Product direction confirmed:
  - Windows user preferences are the source of truth.
  - The app should adapt to the current PC before exposing any app-owned visual override.
  - Native behavior matters more than brand styling.
- Microsoft guidance to align with:
  - Use system light/dark theme and theme resources by default.
  - Use accent color sparingly for interaction and emphasis.
  - Prefer system backdrop APIs (`Window.SystemBackdrop`) instead of custom fake translucency.
  - Detect high contrast through `AccessibilitySettings` and avoid defeating default contrast adjustments.
  - Use standard Windows typography, spacing, control states, and Segoe Fluent icons.

## Scope Definition

This plan treats Windows user preferences as the primary source of truth. Any app-specific override should be advanced-only and absent from the default flow.

This plan targets the desktop shell and core windows first:

- `MainWindow`
- `SettingsWindow`
- shared title bar and chrome behavior
- shared resource dictionaries and theme infrastructure

Secondary windows should be restyled only after the shared shell is proven:

- `TilesWindow`
- `TimelineWindow`
- `ExecuteWindow`
- `CreateTileWindow`
- `InterventionWindow`
- auth windows

## Task 1: Audit Current UI Entry Points

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/App.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/MainWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/SettingsWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Services/ThemeManager.cs`

**Step 1: Inventory current resource keys**

List every `App*Brush` key currently used by shared windows.

**Step 2: Inventory current layout primitives**

Document where custom rounded cards, title bars, and button styles are manually applied.

**Step 3: Mark replacement candidates**

Identify what should become system resources, semantic resources, or default WinUI controls.

**Step 4: Commit**

```bash
git add docs/plans/2026-03-19-windows-native-ui-plan.md
git commit -m "docs: add windows native ui plan"
```

## Task 2: Build System Appearance Service

**Files:**
- Create: `tastile-desktop/src/TastileDesktop/Services/SystemAppearanceService.cs`
- Modify: `tastile-desktop/src/TastileDesktop/Services/ThemeManager.cs`
- Modify: `tastile-desktop/src/TastileDesktop/App.xaml.cs`
- Test: `tastile-desktop/tests/TastileDesktop.Tests/SystemAppearanceServiceTests.cs`

**Step 1: Write failing tests**

Cover mapping for:

- app theme (`light`/`dark`)
- accent color
- transparency enabled
- animation enabled
- high contrast enabled

**Step 2: Implement minimal system snapshot model**

Introduce a record such as:

```csharp
public sealed record SystemAppearanceSnapshot(
    ElementTheme AppTheme,
    bool TransparencyEnabled,
    bool AnimationsEnabled,
    bool HighContrastEnabled,
    Windows.UI.Color AccentColor,
    bool UseAccentOnSurfaces,
    bool UseCenteredTaskbar);
```

**Step 3: Read live Windows settings**

Primary reads:

- `UISettings`
- `AccessibilitySettings`
- `Application.Current.RequestedTheme`

Fallback reads:

- `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize`
- `HKCU\\Software\\Microsoft\\Windows\\DWM`
- `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced`
- `HKCU\\Control Panel\\Desktop\\WindowMetrics`

**Step 4: Add change notifications**

Raise one app-level event when system theme or accessibility changes.

**Step 5: Run tests**

```bash
dotnet test tastile-desktop/tests/TastileDesktop.Tests/TastileDesktop.Tests.csproj
```

**Step 6: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Services/SystemAppearanceService.cs tastile-desktop/src/TastileDesktop/Services/ThemeManager.cs tastile-desktop/src/TastileDesktop/App.xaml.cs tastile-desktop/tests/TastileDesktop.Tests/SystemAppearanceServiceTests.cs
git commit -m "feat: add windows system appearance service"
```

## Task 3: Replace Hard-Coded Theme Model With Semantic Tokens

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/App.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Services/ThemeManager.cs`
- Create: `tastile-desktop/src/TastileDesktop/Resources/Theme/SystemTokens.xaml`
- Create: `tastile-desktop/src/TastileDesktop/Resources/Theme/ControlOverrides.xaml`

**Step 1: Define semantic tokens**

Create tokens for:

- window background
- page background
- surface/subtle surface/elevated surface
- text primary/secondary/disabled
- stroke default/strong
- accent fill/accent text
- icon primary/secondary

**Step 2: Map tokens from system snapshot**

Use neutral Windows-aligned values and accent only for selected states.

**Step 3: Remove manual theme modes**

Delete `Light`, `DarkGray`, `DarkBlack` as user-facing modes and keep only:

- system
- optional future override, disabled by default

**Step 4: Add high-contrast behavior**

In high contrast mode, stop custom color composition and rely on system brushes.

**Step 5: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/App.xaml tastile-desktop/src/TastileDesktop/Services/ThemeManager.cs tastile-desktop/src/TastileDesktop/Resources/Theme/SystemTokens.xaml tastile-desktop/src/TastileDesktop/Resources/Theme/ControlOverrides.xaml
git commit -m "feat: introduce windows semantic theme tokens"
```

## Task 4: Standardize Window Chrome And Backdrop

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/MainWindow.xaml.cs`
- Modify: `tastile-desktop/src/TastileDesktop/Views/SettingsWindow.xaml.cs`
- Modify: `tastile-desktop/src/TastileDesktop/Services/FloatingWindowHelper.cs`
- Create: `tastile-desktop/src/TastileDesktop/Services/WindowChromeService.cs`

**Step 1: Implement standard title bar configuration**

Use `AppWindowTitleBar` for:

- caption button color integration
- drag region
- icon/title spacing
- dark/light sync

**Step 2: Apply system backdrop**

Use `Window.SystemBackdrop` with:

- `Mica` when transparency is enabled
- solid surface fallback when disabled

**Step 3: Normalize corner radius and border behavior**

Match Windows 11 defaults instead of custom large-pill chrome.

**Step 4: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/MainWindow.xaml.cs tastile-desktop/src/TastileDesktop/Views/SettingsWindow.xaml.cs tastile-desktop/src/TastileDesktop/Services/FloatingWindowHelper.cs tastile-desktop/src/TastileDesktop/Services/WindowChromeService.cs
git commit -m "feat: align window chrome with windows shell"
```

## Task 5: Rebuild Main Window As Native Shell

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/MainWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/MainWindow.xaml.cs`
- Modify: `tastile-desktop/src/TastileDesktop/ViewModels/MainViewModel.cs`

**Step 1: Replace custom launch panel**

Use a native shell pattern:

- `NavigationView`
- standard header area
- content region
- optional command bar

**Step 2: Rework account entry**

Use a standard profile affordance in the header or footer pane.

**Step 3: Align spacing and typography**

Use Windows-style header hierarchy and section spacing instead of dense card stacks.

**Step 4: Add iconography**

Use Segoe Fluent Icons or WinUI icon controls, not custom visual metaphors.

**Step 5: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/MainWindow.xaml tastile-desktop/src/TastileDesktop/MainWindow.xaml.cs tastile-desktop/src/TastileDesktop/ViewModels/MainViewModel.cs
git commit -m "feat: redesign main window with native shell structure"
```

## Task 6: Rebuild Settings Window To Match Windows Settings Pattern

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Views/SettingsWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/SettingsWindow.xaml.cs`
- Modify: `tastile-desktop/src/TastileDesktop/ViewModels/SettingsViewModel.cs`
- Modify: `tastile-desktop/src/TastileDesktop/Services/SettingsService.cs`

**Step 1: Remove manual theme picker from primary UI**

Replace it with:

- “Use Windows appearance” summary
- read-only indicators for theme, transparency, accent
- no visible theme override in the default settings experience

**Step 2: Use settings page sections**

Adopt a Windows Settings-inspired structure:

- page title
- section headers
- row-based settings cards
- inline descriptions
- standard toggles and number inputs

**Step 3: Surface detected system values**

Show:

- app theme
- system theme
- transparency
- accent color preview
- animation state
- high contrast state

**Step 4: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Views/SettingsWindow.xaml tastile-desktop/src/TastileDesktop/Views/SettingsWindow.xaml.cs tastile-desktop/src/TastileDesktop/ViewModels/SettingsViewModel.cs tastile-desktop/src/TastileDesktop/Services/SettingsService.cs
git commit -m "feat: rebuild settings window with windows-native patterns"
```

## Task 7: Propagate Native Styling To Secondary Windows

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Views/TilesWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/TimelineWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/ExecuteWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/CreateTileWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/InterventionWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/AuthWindow.xaml`
- Modify: `tastile-desktop/src/TastileDesktop/Views/LoginWindow.xaml`

**Step 1: Apply shared shell resources**

Replace custom local brushes and radii.

**Step 2: Standardize icons, buttons, list rows, and empty states**

Reuse shared styles only.

**Step 3: Verify compact windows**

Ensure small utility windows still feel native and do not look like shrunk cards.

**Step 4: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Views/*.xaml
git commit -m "feat: restyle secondary windows to match native shell"
```

## Task 8: Accessibility And Motion Pass

**Files:**
- Modify: shared XAML styles and window files touched above
- Test: `tastile-desktop/tests/TastileDesktop.Tests/AccessibilityThemeTests.cs`

**Step 1: Verify high contrast**

Ensure app remains legible with custom theme logic disabled or minimized.

**Step 2: Verify reduced motion**

Disable non-essential transitions when system animation is off.

**Step 3: Verify keyboard and narrator basics**

Check focus visuals, tab order, accessible names, and title bar controls.

**Step 4: Commit**

```bash
git add tastile-desktop/src/TastileDesktop tastile-desktop/tests/TastileDesktop.Tests/AccessibilityThemeTests.cs
git commit -m "fix: respect windows accessibility and motion settings"
```

## Task 9: Verification Matrix

**Files:**
- Create: `docs/plans/2026-03-19-windows-native-ui-verification.md`

**Step 1: Verify these modes manually**

- dark theme + transparency off
- dark theme + transparency on
- light theme + transparency off
- high contrast
- accent change while app is running
- animation off

**Step 2: Capture screenshots**

Collect before/after screenshots for:

- main window
- settings window
- one compact utility window

**Step 3: Commit**

```bash
git add docs/plans/2026-03-19-windows-native-ui-verification.md
git commit -m "docs: add windows native ui verification matrix"
```

## Recommended Delivery Order

1. System appearance service
2. Semantic theme tokens
3. Window chrome and backdrop
4. Main window shell
5. Settings window
6. Secondary windows
7. Accessibility and verification

## Risks To Watch

- Over-customization that fights WinUI defaults and breaks high contrast.
- Reading registry only once instead of subscribing to runtime changes.
- Reusing accent color too aggressively and ending up unlike Windows shell.
- Using Mica/Acrylic when transparency is disabled.
- Leaving a manual theme mode in settings and creating conflicting sources of truth.
