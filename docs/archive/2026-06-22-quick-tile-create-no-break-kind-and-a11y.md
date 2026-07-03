# QuickTileCreate — Remove kind discriminator + a11y fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the `tileKind` (work/break/label) discriminator and the `breakSplitsWork` field from `QuickTileCreate.tsx`, then improve accessibility of the remaining form controls.

**Architecture:** Tiles are condition vectors, not kind enums (per workspace memory). The form becomes a single, mode-agnostic creator: title, duration, temporal constraints, recurrence, metadata. The only legitimate mode distinction is "label only" (period marker) which is already first-class in the domain model as `objectiveMode = "label_only"`.

**Tech Stack:** Next.js 15 / React 19 / Vitest 4 + @testing-library/react / TypeScript

---

## Constraints (must hold)

- **No `kind` / `source_kind` / `type` enum in UI** — workspace memory `feedback_no_kind_enums.md`. Work vs. break must fall out of the recurring-tile engine, not from consumer-side questions.
- **No "is this a break?" discriminator anywhere** — workspace memory `feedback_no_fragmented_reimplementations.md`. `breakSplitsWork` is a behavior flag (interruption policy), not a kind discriminator, but the UI control asks "should breaks split this work?" which is exactly the question the memory forbids. Remove it from the UI; default the field to `true` (existing default).
- **Use existing `FieldLabel` from `src/components/ui/Input.tsx`** for labels — it already supports `htmlFor`, `required`, and `hint`.
- **Single commit** — kind removal + a11y in one commit (per "まとめて1コミット" precedent).

---

## Task 1: Write failing component tests

**Files:**
- Create: `tastile-web/src/components/tiles/QuickTileCreate.test.tsx`

**Step 1: Write tests**

The tests assert BEHAVIOR (what the user can do) not implementation (which React state hooks exist):

1. **No kind discriminator** — There are no buttons named "タスク" / "休憩" / "ラベル" (and no English equivalents). The panel must not ask "what kind of tile is this?".
2. **No breakSplitsWork UI** — There are no buttons named "分割してよい" / "分割しない" / "Allow splitting" / "Keep going".
3. **Label-only toggle** — There is a checkbox / toggle named something like "Treat as period label" that:
   - When OFF, the duration field is shown.
   - When ON, the duration field is hidden and `objectiveMode` is set to `"label_only"` on submit.
4. **Title input is required** — `<input>` for title has `aria-required="true"` and an accessible name (label or `aria-label`).
5. **Date inputs have accessible names** — every `<input type="date">` / `<input type="time">` is reachable by `getByLabelText` or has an `aria-label`.
6. **Error message is announced** — when the form fails to submit, an element with `role="alert"` (or `aria-live="polite"`) appears.
7. **Submit creates a task tile with targetWorkMin (not targetRestMin)** — invoking the create flow with a duration produces a command that sets `tile.objective.targetWorkMin = <duration>`, never `tile.objective.targetRestMin` for break-mode.

**Mocking:** mock `useExecutionEngineContext`, `useQuickCreateStore`, `useTranslation`, `useIsDesktop`. Capture the `create_tile` command via the `execute` mock.

**Step 2: Run tests, verify they FAIL**

Run: `cd tastile-web && bunx vitest run src/components/tiles/QuickTileCreate.test.tsx`
Expected: every test in the file fails (the file doesn't exist yet — vitest will report "test file not found"). After the file is added, the kind-discriminator and breakSplitsWork tests must fail because those buttons currently exist.

**Step 3: Commit the failing test (RED)**

```bash
git add tastile-web/src/components/tiles/QuickTileCreate.test.tsx
git commit -m "test(quick-create): assert no kind discriminator and label-only toggle"
```

---

## Task 2: Refactor QuickTileCreate.tsx

**Files:**
- Modify: `tastile-web/src/components/tiles/QuickTileCreate.tsx`

**Step 1: Remove the `tileKind` discriminator**

- Remove the `useState<SemanticRole>("work")` state.
- Remove the three ChoiceButtons (`タスク`/`休憩`/`ラベル`).
- Remove the imports: `SemanticRole`.
- In the submit logic, set `tile.annotation.semanticRole = "work"` (or omit; engine default). Drop the `targetRestMin` branch — `tile.objective.targetWorkMin = effectiveDurationMin`.
- Drop the `breakSplitsWork` state and the "Schedule & Splitting" section's splitter ChoiceButtons. Keep `tile.interruption.breakSplitsWork` defaulted to `true` (the existing `Tile.create` default).

**Step 2: Add a label-only toggle**

- Add `isLabelOnly` state (`useState<boolean>(false)`).
- Render a real `<input type="checkbox">` with `<label>` in the Schedule section: `{t("quickCreate.labelOnly")}`.
- When `isLabelOnly === true`:
  - Hide the duration field (the existing `SectionBlock` for `workTargetTitle`).
  - On submit, set `tile.objective.objectiveMode = "label_only"` and skip `targetWorkMin` / `targetRestMin`.
- Update the `canSubmit` rule so a label-only tile does NOT require a positive duration.

**Step 3: Replace ChoiceButton with proper radio inputs**

For mutually-exclusive choices (objective mode, recurrence frequency, weekday single-select), use:

```tsx
<div role="radiogroup" aria-label={...}>
  {options.map((opt) => (
    <label key={opt.value} className="...">
      <input
        type="radio"
        name="..."
        value={opt.value}
        checked={state === opt.value}
        onChange={() => setState(opt.value)}
        className="sr-only"
      />
      <span aria-hidden>{opt.label}</span>
    </label>
  ))}
</div>
```

For non-exclusive choices (multi-select weekdays), use real `<input type="checkbox">` in a `<div role="group">` with `aria-labelledby`.

For purely visual toggles (a single boolean), use `<button aria-pressed={active}>`.

Keep the visual styling identical — only the semantics change.

**Step 4: Add accessible labels to all inputs**

For each `<input>`, `<textarea>`, `<select>`:
- If a `<label>` text exists, render it via `FieldLabel` from `Input.tsx` with `htmlFor={id}` and an `id` on the input.
- Title input additionally gets `aria-required="true"`.
- Date / time inputs get either visible labels (preferred) or `aria-label`.

Use `useId()` from React 19 to generate stable ids.

**Step 5: Fix suggestion dropdowns (project / tags)**

Replace the `onMouseDown` button pattern with a real combobox:

```tsx
<input
  role="combobox"
  aria-expanded={isOpen}
  aria-controls="project-listbox"
  aria-autocomplete="list"
  aria-activedescendant={activeId}
/>
<ul role="listbox" id="project-listbox">
  {suggestions.map((s) => (
    <li role="option" id={...} aria-selected={...}>{s}</li>
  ))}
</ul>
```

Support arrow-key navigation and `Enter` / `Escape`.

**Step 6: Add aria-live for errors**

Wrap the error `<p>` in:

```tsx
<p role="alert" className="...">{error}</p>
```

**Step 7: Convert SectionBlock titles from `<p>` to `<h3>`**

Use `<h3 id={...}>` with `aria-labelledby` on the surrounding section. Don't break the visual layout.

**Step 8: Run the tests**

Run: `cd tastile-web && bunx vitest run src/components/tiles/QuickTileCreate.test.tsx`
Expected: all tests PASS.

If any fail, read the actual error and adjust (do NOT loosen the assertion).

**Step 9: Run lint + typecheck**

Run: `cd tastile-web && bun run typecheck && bun run lint`
Expected: 0 errors.

**Step 10: Commit (GREEN)**

```bash
git add tastile-web/src/components/tiles/QuickTileCreate.tsx
git commit -m "feat(quick-create): remove kind discriminator and improve a11y

- Drop tileKind (work/break/label) and breakSplitsWork UI controls;
  tiles are condition vectors, not kind enums
- Add label-only toggle that sets objectiveMode = 'label_only'
- Replace ChoiceButton groups with proper role=radiogroup / role=group
- Add htmlFor labels via FieldLabel; aria-required on title input
- Convert project/tag suggestion dropdowns to combobox/listbox semantics
- Add role=alert on error message and h3 headings in SectionBlock"
```

---

## Task 3: Clean up i18n translations

**Files:**
- Modify: `tastile-web/src/lib/i18n/translations.ts`

**Step 1: Remove unused keys**

Delete `kindTask`, `kindBreak`, `kindLabel`, `kindGuide`, `kindTitle`, `splitTitle`, `splitGuide`, `splitAllow`, `splitAllowDesc`, `splitKeep`, `splitKeepDesc`. Add `labelOnly: { ja: "期間ラベルとして扱う", en: "Treat as period label" }`.

**Step 2: Run lint**

Run: `cd tastile-web && bun run typecheck && bun run lint`
Expected: 0 errors. (If TS complains about a removed key elsewhere, the call site is also dead — clean it up.)

**Step 3: Commit**

```bash
git add tastile-web/src/lib/i18n/translations.ts
git commit -m "chore(i18n): drop unused kind-discriminator keys"
```

Note: per CLAUDE.md "small commits" + "まとめて1コミット" precedent (one commit for perf fixes), this step is OPTIONAL. Combine with Task 2's commit if the user prefers one commit total.

---

## Definition of Done

- [ ] `tileKind` state and the three ChoiceButtons are gone.
- [ ] `breakSplitsWork` state and its UI are gone.
- [ ] Submit never sets `targetRestMin` (engine handles break placement).
- [ ] All radio / checkbox groups have correct ARIA roles.
- [ ] All inputs are reachable by `getByLabelText` or `getByRole`.
- [ ] Error message has `role="alert"`.
- [ ] Suggestion dropdowns use combobox/listbox semantics.
- [ ] Component tests pass.
- [ ] `bun run typecheck` clean.
- [ ] `bun run lint` clean.

## Rollback

`git revert <commit>` — single commit, single-touch surface; revert is one command.

## Risks (top 3)

1. **Hidden consumers of `tile.annotation.semanticRole`.** Grep the codebase before deleting the field entirely; we default to `"work"` here so consumers still see a valid value.
2. **Submit semantics change.** Tiles that previously wrote `targetRestMin` (break kind) now write `targetWorkMin` (default). The engine's placement behavior should be unchanged because the FocusBlockBased generator owns break placement.
3. **Dropdown UX regression.** Replacing `onMouseDown` with combobox may shift focus or close-on-click timing. Test on a real browser before declaring victory — automated tests cover semantics, not feel.