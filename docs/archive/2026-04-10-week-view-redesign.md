# Week View Redesign Design

**Date**: 2026-04-10
**Status**: Approved

## Overview

Redesign the Week view to display 7 parallel vertical timelines (one per day) with detailed card-style tile blocks, similar to Day view but arranged horizontally across the week.

## Requirements

1. **Layout**: 7 columns (Monday to Sunday) arranged horizontally
2. **Header**: Date + Day of week (e.g., "4/7（月）")
3. **Timeline**: 0:00-24:00 vertical timeline for each day
4. **Blocks**: Day-view style detailed cards with title, time, icon buttons
5. **Scrolling**: Synchronized vertical scrolling across all 7 columns
6. **Zooming**: Synchronized zooming across all 7 columns
7. **Time markers**: Grid lines with labels (same as Day view), per column
8. **Now indicator**: Only shows in today's column

## Components

### WeekTimelineRoot (Grid)
- Contains 7 WeekTimelineColumn items
- Each column: minimum width 180px, scales to fill available width
- No horizontal scroll (columns expand to fit)

### WeekTimelineScrollViewer (ScrollViewer)
- Wraps the entire week timeline
- VerticalScrollBarVisibility: Auto
- HorizontalScrollBarVisibility: Disabled
- Synchronized scrolling for all columns

### WeekTimelineColumnsHost (ItemsControl)
- 7 WeekTimelineColumn items arranged horizontally
- ItemsPanel: StackPanel with Orientation="Horizontal"

### WeekTimelineColumn (per day)
- **Header (Border)**: Date + Day label
- **Timeline (Grid)**:
  - HourMarkers (ItemsControl): Time labels on grid lines (0:00, 1:00, ...)
  - TimelineBlocks (ItemsControl + Canvas): Tile blocks positioned by time
  - NowIndicator (Canvas): Current time marker (only in today's column)

## Data Model

### TimelineWeekColumnViewModel (existing, extended)
```csharp
public sealed class TimelineWeekColumnViewModel : ObservableObject
{
    public int DayOfWeekIndex { get; set; }
    public string DayLabel { get; set; } = string.Empty;  // "Mon", "Tue", ...
    public string DayNumber { get; set; } = string.Empty;  // "4/7", "4/8", ...
    public IReadOnlyList<TimelineAbsoluteBlockViewModel> Blocks { get; set; } = [];
    public bool IsToday { get; set; }  // For showing NowIndicator
}
```

## Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│ [Toolbar: Prev/Today/Next] [Day/Week/Month/Year] [...]│
├─────────────────────────────────────────────────────────┤
│ ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐           │
│ │4/7  │4/8  │4/9  │4/10 │4/11 │4/12 │4/13 │           │
│ │(月) │(火) │(水) │(木) │(金) │(土) │(日) │           │
│ ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤           │
│ │0:00─┼─────┼─────┼─────┼─────┼─────┼─────┤           │
│ │     │     │     │     │     │     │     │           │
│ │     │ ┌───┐│     │ ┌───┐│     │     │           │
│ │     │ │Task││     │ │Task││     │     │           │
│ │     │ └───┘│     │ └───┘│     │     │           │
│ │1:00─┼─────┼─────┼─────┼─────┼─────┼─────┤           │
│ │     │     │ ┌───┐│     │     │ ┌───┐│           │
│ │     │     │ │Task││     │     │ │Task││           │
│ │2:00─┼─────┼ └───┘┼─────┼─────┼ └───┘┼─────┤           │
│ ... │ ... │ ... │ ... │ ... │ ... │ ... │           │
│ │24:00┴─────┴─────┴─────┴─────┴─────┴─────┘           │
└─────────────────────────────────────────────────────────┘
```

## Implementation Notes

1. **Time markers**: Each column has its own HourMarkers, identical to Day view
2. **Now indicator**: Calculated per column, but only visible where `IsToday == true`
3. **Block positioning**: Use Canvas with TranslateTransform (Top/Height based on time)
4. **Sync behavior**: Single ScrollViewer handles all columns, ensuring synchronized scrolling
5. **Zoom**: Update `HoursPerPixel` in TimelineViewport, all columns respond to same zoom level

## Files to Modify

- `TimelineWindow.xaml`: Replace WeekCalendarHost with new WeekTimeline structure
- `TimelineWindow.xaml.cs`: Update bindings and event handlers
- `MainViewModel.cs`: Extend WeekTimelineColumns with IsToday property
- `MonthCalendarResolver.cs`: Ensure BuildWeekTimelineColumns sets IsToday correctly

## Success Criteria

1. All 7 days display in columns that expand to fill available width
2. Time markers (0:00-24:00) show on each column with grid lines
3. Tile blocks display as detailed cards (same as Day view)
4. Vertical scrolling is synchronized across all columns
5. Zoom in/out affects all columns uniformly
6. Now indicator only appears in today's column
7. Headers show correct date + day of week
