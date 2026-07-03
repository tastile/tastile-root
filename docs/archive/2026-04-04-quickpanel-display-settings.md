# Quick Panel Display Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add settings to control quick panel display position - allow display selection and vertical position switching (top/bottom).

**Architecture:** Add settings to TastileSettings, update FloatingWindowHelper.PlaceQuickPanel() to respect settings, add UI controls in SettingsWindow.

**Tech Stack:** C# / WinUI 3 / .NET 10

---

## Task 1: Add QuickPanel display settings to TastileSettings

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Services/SettingsService.cs:104-133`

**Step 1: Add new settings properties**

In `TastileSettings` record, add these properties after line 122 (after QuickPanelOrientation):

```csharp
public string QuickPanelDisplayMode { get; set; } = PromptToastDisplayModes.PrimaryDisplay;
public string QuickPanelVerticalPosition { get; set; } = QuickPanelVerticalPositions.Top;
```

**Step 2: Add new constants class**

Create new file `tastile-desktop/src/TastileDesktop/Services/QuickPanelVerticalPositions.cs`:

```csharp
namespace TastileDesktop.Services;

public static class QuickPanelVerticalPositions
{
    public const string Top = "top";
    public const string Bottom = "bottom";
}
```

**Step 3: Commit**

---

## Task 2: Update FloatingWindowHelper.PlaceQuickPanel() to respect settings

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Services/FloatingWindowHelper.cs:76-104`

**Step 1: Update PlaceQuickPanel method**

Replace the current PlaceQuickPanel method (lines 76-104) to use settings:

```csharp
public static void PlaceQuickPanel(Window window, TastileSettings settings)
{
    var appWindow = GetAppWindow(window);
    if (appWindow is null)
    {
        return;
    }

    var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);
    if (hwnd == IntPtr.Zero)
    {
        return;
    }

    // Get monitor based on display mode setting
    var displays = PromptToastDisplayEnumerator.GetDisplays();
    var preferredDisplayId = string.Equals(settings.QuickPanelDisplayMode, PromptToastDisplayModes.ActiveWindowDisplay, StringComparison.Ordinal)
        ? PromptToastForegroundDisplayResolver.GetCurrentDisplayId(displays)
        : null;
    var fallback = displays.FirstOrDefault(static display => display.IsPrimary)?.WorkArea ?? new RectInt32(0, 0, 1920, 1080);
    var workArea = QuickPanelPlacementResolver.ResolveWorkArea(displays, settings.QuickPanelDisplayMode, preferredDisplayId, fallback);

    // 892×88px
    var width = 892;
    var height = 88;
    var x = workArea.X + (workArea.Width - width) / 2;
    
    // Support top/bottom vertical position
    var y = string.Equals(settings.QuickPanelVerticalPosition, QuickPanelVerticalPositions.Bottom, StringComparison.Ordinal)
        ? workArea.Bottom - height - 24  // 24px from bottom
        : workArea.Y + 24;               // 24px from top
    
    System.Diagnostics.Debug.WriteLine($"[PlaceQuickPanel] Monitor work area: L={workArea.X}, T={workArea.Y}, R={workArea.Right}, B={workArea.Bottom}");
    System.Diagnostics.Debug.WriteLine($"[PlaceQuickPanel] Position: X={x}, Y={y}, W={width}, H={height}");
    
    appWindow.Resize(new SizeInt32(width, height));
    appWindow.Move(new Windows.Graphics.PointInt32(x, y));
}
```

**Step 2: Commit**

---

## Task 3: Add UI controls to SettingsWindow.xaml

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Views/SettingsWindow.xaml:278-302`

**Step 1: Add Quick Panel section in SettingsWindow.xaml**

After the "Breaks" section (line 301), add new section:

```xml
                <StackPanel Spacing="12">
                    <TextBlock Text="Quick Panel" Style="{StaticResource SectionTitleTextStyle}" Foreground="{StaticResource AppForegroundBrush}" />
                    <Rectangle Height="1" Fill="{StaticResource AppBorderBrush}" />

                    <Grid ColumnSpacing="12">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="240" />
                        </Grid.ColumnDefinitions>
                        <TextBlock Text="Display" VerticalAlignment="Center" />
                        <ComboBox Grid.Column="1" Width="160" SelectedValuePath="Tag" SelectedValue="{x:Bind ViewModel.QuickPanelDisplayMode, Mode=TwoWay}" HorizontalAlignment="Right">
                            <ComboBoxItem Content="Primary display" Tag="primary-display" />
                            <ComboBoxItem Content="Display with active window" Tag="active-window-display" />
                        </ComboBox>
                    </Grid>
                    <TextBlock Text="Which display shows the quick panel" Foreground="{StaticResource AppForegroundSubtleBrush}" FontSize="12" Margin="0,-8,0,0" />

                    <Grid ColumnSpacing="12" Margin="0,8,0,0">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*" />
                            <ColumnDefinition Width="240" />
                        </Grid.ColumnDefinitions>
                        <TextBlock Text="Vertical position" VerticalAlignment="Center" />
                        <ComboBox Grid.Column="1" Width="160" SelectedValuePath="Tag" SelectedValue="{x:Bind ViewModel.QuickPanelVerticalPosition, Mode=TwoWay}" HorizontalAlignment="Right">
                            <ComboBoxItem Content="Top" Tag="top" />
                            <ComboBoxItem Content="Bottom" Tag="bottom" />
                        </ComboBox>
                    </Grid>
                    <TextBlock Text="Position relative to the display edge" Foreground="{StaticResource AppForegroundSubtleBrush}" FontSize="12" Margin="0,-8,0,0" />
                </StackPanel>
```

**Step 2: Commit**

---

## Task 4: Add ViewModel bindings

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/ViewModels/SettingsViewModel.cs`

**Step 1: Add properties to SettingsViewModel**

Read the file first to find the appropriate location, then add:

```csharp
public string QuickPanelDisplayMode
{
    get => _settings.QuickPanelDisplayMode;
    set { if (_settings.QuickPanelDisplayMode != value) { _settings = _settings with { QuickPanelDisplayMode = value }; OnPropertyChanged(nameof(QuickPanelDisplayMode)); } }
}

public string QuickPanelVerticalPosition
{
    get => _settings.QuickPanelVerticalPosition;
    set { if (_settings.QuickPanelVerticalPosition != value) { _settings = _settings with { QuickPanelVerticalPosition = value }; OnPropertyChanged(nameof(QuickPanelVerticalPosition)); } }
}
```

**Step 2: Commit**

---

## Task 5: Build and verify

**Step 1: Build the project**

Run: `dotnet build -r win-x64`

**Step 2: Fix any compilation errors**

**Step 3: Commit**

---

## Task 6: Create design document

**Files:**
- Create: `docs/plans/2026-04-04-quickpanel-display-settings-design.md`

Save the design decisions.