# QuickTileCreate: icon-driven base panel

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the text-heavy base panel with a Google Calendar-style, icon + placeholder-driven form. Inputs are inert when empty; tiles still serialize the full condition set.

**Architecture:** Strip every `SectionBlock` heading in the base panel. Each input is wrapped with a leading icon. Empty fields show a placeholder like "Add project" and become editable only on focus. Date/Time is one inline row that expands on click. Duration is a compact pill that opens the existing time picker. Memo is collapsed by default ("Add a note") and expands to a textarea on click. All `handleCreate` wiring and submit semantics stay unchanged — this is a layout refactor, not a data-model change.

**Tech Stack:** Next.js 15 + React 19 + TypeScript, lucide-react icons, existing `Input` UI primitive, vitest + jsdom.

---

## Task 1: Title — icon + placeholder, no heading

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (base panel Title section)
- Modify: `src/components/tiles/QuickTileCreate.test.tsx` (locator updates)

**Step 1: Write failing test**

Add a test that asserts the title input is reachable by its `placeholder` (not by an aria-label from a section heading), and that no `quickCreate.titleTitle` heading appears in the base panel.

```tsx
it("title input shows placeholder and no section heading", () => {
  render(<QuickTileCreate />);
  expect(
    screen.getByRole("textbox", { name: /quickCreate\.titlePlaceholder/ }),
  ).toBeTruthy();
  expect(screen.queryByRole("heading", { name: /quickCreate\.titleTitle/ })).toBeNull();
});
```

**Step 2: Add the missing i18n key** to both `ja` and `en` in `translations.ts`:
- `quickCreate.titlePlaceholder`: "タイトルを追加" / "Add a title"

**Step 3: Implement**

Replace the current `SectionBlock` for title with an icon-prefixed Input. The `<Input>` UI primitive already supports a `leading` slot.

```tsx
<Input
  leading={<Type className="h-4 w-4" />}
  value={title}
  onChange={...}
  placeholder={t("quickCreate.titlePlaceholder")}
  aria-label={t("quickCreate.titlePlaceholder")}
  size="large"
/>
```

**Step 4: Verify** `bun run test:unit` — new test passes, "title input has aria-required='true' and an accessible name" still passes.

**Step 5: Commit** with message `feat(quick-tile): title field becomes icon + placeholder, no section heading`.

---

## Task 2: Duration — pill with leading ⏱ icon

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (Estimated duration section)

**Step 1: Write failing test**

```tsx
it("duration is a pill with a leading icon (no 'Estimated duration' heading)", () => {
  render(<QuickTileCreate />);
  expect(screen.queryByRole("heading", { name: /quickCreate\.workTargetTitle/ })).toBeNull();
  // DurationInput is reachable by its aria-label or its textbox
  const duration = screen.getByRole("textbox", { name: /hours/i });
  expect(duration).toBeTruthy();
});
```

**Step 2: Implement**

Wrap the existing `DurationInput` in a compact pill-shaped row. Add a leading clock icon, remove the "Estimated duration" heading. The picker dropdown below stays as-is.

```tsx
<div className="flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1.5">
  <Timer className="h-4 w-4 text-foreground-muted" />
  <DurationInput ... />  {/* keep existing implementation */}
</div>
```

**Step 3: Verify** `bun run test:unit` — both new and existing tests pass.

**Step 4: Commit** with message `feat(quick-tile): duration becomes icon-prefixed pill, no heading`.

---

## Task 3: DoneRule — icon-row, no heading

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (Completion trigger section)

**Step 1: Write failing test**

```tsx
it("DoneRule row has no section heading; 3 options remain", () => {
  render(<QuickTileCreate />);
  expect(screen.queryByRole("heading", { name: /quickCreate\.doneRuleTitle/ })).toBeNull();
  expect(screen.getByRole("button", { name: /quickCreate\.doneRuleManual/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /quickCreate\.doneRuleTimeReached/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /quickCreate\.doneRuleIntervalEnd/ })).toBeTruthy();
});
```

**Step 2: Implement**

Replace the `SectionBlock` wrapper for DoneRule with a bare 3-button row. Each button gets a leading emoji-style icon (use lucide's `CircleDot`, `Clock4`, `StopCircle`).

```tsx
<div className="grid grid-cols-3 gap-1 rounded-full border border-border bg-surface-1 p-1">
  <DoneRuleButton icon={<CircleDot className="h-3.5 w-3.5" />} active={...} onClick={...}>
    {t("quickCreate.doneRuleManual")}
  </DoneRuleButton>
  ...
</div>
```

**Step 3: Verify** tests pass.

**Step 4: Commit** with message `feat(quick-tile): DoneRule becomes a 3-icon pill row, no heading`.

---

## Task 4: Date/Time — single inline row, click to expand

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (Execution timing section)

**Step 1: Write failing test**

```tsx
it("date/time is a single inline row that expands on Start click", () => {
  render(<QuickTileCreate />);
  expect(screen.queryByRole("heading", { name: /quickCreate\.scheduleTitle/ })).toBeNull();
  // Collapsed: only Start/End buttons are visible
  const start = screen.getByRole("button", { name: /quickCreate\.startAt/ });
  fireEvent.click(start);
  // After click, date+time inputs are revealed inline (not in a sub-panel)
  expect(screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/).length).toBeGreaterThan(0);
});
```

**Step 2: Implement**

Replace the existing SectionBlock with a single row that:
- Always shows the calendar icon + the current date/time range as a pill (e.g., "📅 6/23 14:00 - 15:00") OR a placeholder ("📅 Anytime")
- Clicking the pill toggles the existing date+time input grid below

The existing `useStartAt` / `useEndAt` toggle logic stays. We just replace the heading + Start/End toggle buttons with a single clickable pill.

**Step 3: Verify** tests pass.

**Step 4: Commit** with message `feat(quick-tile): date/time becomes single inline pill, expands on click`.

---

## Task 5: Project — icon + dropdown, no heading

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (Project/Tags section)

**Step 1: Write failing test**

```tsx
it("project input has leading icon and no section heading", () => {
  render(<QuickTileCreate />);
  expect(screen.queryByRole("heading", { name: /quickCreate\.metaTitle/ })).toBeNull();
  // Project input still has a recognizable aria-label
  expect(
    screen.getByRole("textbox", { name: /quickCreate\.projectPlaceholder/ }),
  ).toBeTruthy();
});
```

**Step 2: Implement**

Replace the SectionBlock with a bare input that has a `Tag` icon as the leading element. The existing autocomplete dropdown logic stays.

```tsx
<div className="relative">
  <Input
    leading={<Tag className="h-4 w-4" />}
    value={projectDraft}
    onChange={...}
    placeholder={t("quickCreate.projectPlaceholder")}
    aria-label={t("quickCreate.projectPlaceholder")}
  />
  {/* existing dropdown */}
</div>
```

When a project is selected, render it as a colored chip (use the project's color from existingProjects metadata, fallback to a neutral primary tint).

**Step 3: Verify** tests pass.

**Step 4: Commit** with message `feat(quick-tile): project becomes icon-driven input, no section heading`.

---

## Task 6: Tags — chip input with leading + icon

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (tag input)

**Step 1: Write failing test**

```tsx
it("tag input is icon-driven and addable via Enter", () => {
  render(<QuickTileCreate />);
  const tagInput = screen.getByRole("textbox", { name: /quickCreate\.tagsPlaceholder/ });
  fireEvent.change(tagInput, { target: { value: "important" } });
  fireEvent.keyDown(tagInput, { key: "Enter" });
  // Chip is rendered with the tag
  expect(screen.getByText("#important")).toBeTruthy();
});
```

**Step 2: Implement**

Replace the bare tag input with an `Input` that has a `Plus` icon as the leading element. Selected tags render as compact chips below. Pressing Enter on the input adds the typed value as a chip and clears the input. The existing suggestions dropdown stays.

**Step 3: Verify** tests pass.

**Step 4: Commit** with message `feat(quick-tile): tags become icon-driven chip input`.

---

## Task 7: Memo — collapsed by default, expands on click

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (Memo section)

**Step 1: Write failing test**

```tsx
it("memo is collapsed by default; clicking 'Add note' reveals a textarea", () => {
  render(<QuickTileCreate />);
  // When empty, only a "Add note" placeholder button is visible, not a textarea
  expect(
    screen.queryByRole("textbox", { name: /quickCreate\.memoPlaceholder/ }),
  ).toBeNull();
  // Click the placeholder to expand
  const addNote = screen.getByRole("button", { name: /quickCreate\.memoPlaceholder/ });
  fireEvent.click(addNote);
  expect(
    screen.getByRole("textbox", { name: /quickCreate\.memoPlaceholder/ }),
  ).toBeTruthy();
});
```

**Step 2: Add i18n key** `quickCreate.memoAdd` ("メモを追加" / "Add a note").

**Step 3: Implement**

Replace the always-visible textarea with a placeholder button when memo is empty:

```tsx
{memoInput.trim().length === 0 ? (
  <button onClick={...} className="flex items-center gap-2 ...">
    <MessageSquare className="h-4 w-4" />
    <span>{t("quickCreate.memoAdd")}</span>
  </button>
) : (
  <Textarea value={memoInput} onChange={...} ... />
)}
```

When expanded, the textarea is the same as before. When the user types, it stays expanded. When the user clears the text, the placeholder button returns.

**Step 4: Verify** tests pass. Update any existing memo-related tests to use the new selectors.

**Step 5: Commit** with message `feat(quick-tile): memo is collapsed by default, expands on click`.

---

## Task 8: Period label — toggle switch (icon-only)

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (Period label section)

**Step 1: Write failing test**

```tsx
it("period label is a toggle switch with no section heading", () => {
  render(<QuickTileCreate />);
  expect(screen.queryByRole("heading", { name: /quickCreate\.labelOnlyTitle/ })).toBeNull();
  // Checkbox still present, reachable by its accessible name
  expect(screen.getByRole("checkbox", { name: /quickCreate\.labelOnly/ })).toBeTruthy();
});
```

**Step 2: Implement**

Replace the `SectionBlock` for the period label with a bare row: icon (`Tag` or `Bookmark`) + a small switch component or a styled checkbox. No heading.

**Step 3: Verify** tests pass.

**Step 4: Commit** with message `feat(quick-tile): period label becomes icon-driven toggle, no heading`.

---

## Task 9: Sub-panel nav — more compact, icon-prefixed

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx` (sub-panel nav buttons)

**Step 1: Write failing test**

```tsx
it("sub-panel nav buttons have leading icons", () => {
  render(<QuickTileCreate />);
  // The 4 nav buttons should each have a lucide-react icon as a child
  const buttons = [
    screen.getByRole("button", { name: /quickCreate\.recurrenceNavTitle/ }),
    screen.getByRole("button", { name: /quickCreate\.interruptNavTitle/ }),
    screen.getByRole("button", { name: /quickCreate\.automationNavTitle/ }),
    screen.getByRole("button", { name: /quickCreate\.metaNavTitle/ }),
  ];
  for (const btn of buttons) {
    expect(btn.querySelector("svg")).toBeTruthy();
  }
});
```

**Step 2: Implement**

Add a leading lucide icon to each sub-panel nav button:
- Recurrence: `Repeat`
- Interrupt: `AlertTriangle`
- Automation: `Zap` or `Bot`
- Timed labels: `Tag` (or a clock-like icon)

Each button becomes a smaller pill instead of a full-width row.

**Step 3: Verify** tests pass.

**Step 4: Commit** with message `feat(quick-tile): sub-panel nav uses icon-prefixed compact pills`.

---

## Task 10: Update submit/handleCreate tests for new selectors

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.test.tsx`

**Step 1: Update existing tests**

The tests that submit the form (e.g., "label-only toggle hides the duration field", "submits a task tile with targetWorkMin") need to:
- Click the new "Add note" button if memo is needed
- Locate the period label checkbox by its new accessible name
- Locate the date/time Start button (unchanged)

**Step 2: Add a "smoke test"** that asserts the full base panel is reachable without any sub-panel open:

```tsx
it("base panel is fully self-sufficient — no sub-panel needed for the common case", () => {
  render(<QuickTileCreate />);
  // Fill everything inline
  fireEvent.change(screen.getByRole("textbox", { name: /titlePlaceholder/ }), {
    target: { value: "Smoke test" },
  });
  // Add a project
  const projectInput = screen.getByRole("textbox", { name: /projectPlaceholder/ });
  fireEvent.change(projectInput, { target: { value: "TestProject" } });
  fireEvent.keyDown(projectInput, { key: "Enter" });
  // Submit
  fireEvent.click(screen.getByRole("button", { name: /quickCreate\.commit/ }));
  // Expect submit to fire with all fields
});
```

**Step 3: Verify** all tests pass.

**Step 4: Commit** with message `test(quick-tile): update selectors for icon-driven layout, add base-panel smoke test`.

---

## Task 11: Browser verification

**Files:** none — verification only

**Step 1: Start dev server** (if not running): `bun dev`

**Step 2: Open** `http://localhost:3000/dashboard/calendar`

**Step 3: Open the Create Tile panel** by clicking "+ New"

**Step 4: Verify in browser**:
- Title input has a leading icon, no "Title" heading
- Duration is a compact pill, no "Estimated duration" heading
- DoneRule is a 3-icon pill row, no heading
- Date/Time is a single inline pill ("📅 Anytime" when unset)
- Project is a single icon-prefixed input, no "Project / Tags" heading
- Tag input is icon-prefixed
- Memo shows "💬 Add a note" placeholder, no textarea
- Sub-panel nav buttons are smaller pills with icons
- All sub-panels still open correctly (Recurrence, Interrupt, Automation, Timed labels)
- Submit still works end-to-end (verify via POST /commands/tile/create in network panel)

**Step 5: Take a screenshot** for the user.

**Step 6: Commit** any final tweaks.

---

## Out of scope

- The DurationInput picker redesign (the existing time picker stays as-is)
- The recurrence sub-panel internals (already covered by separate UX work)
- Visual themes / dark mode
- Internationalization of icon tooltips
