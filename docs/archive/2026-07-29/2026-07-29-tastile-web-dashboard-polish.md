# Dashboard Shell + Tile Panel Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the tastile-web dashboard shell and tile creation panel — visual hierarchy, accessibility, error/validation display, and refactor the 2419-line `QuickTileCreate.tsx` into focused subcomponents. No domain or API changes.

**Architecture:** Token unification (CSS variables + focus ring + reduced-motion) → 5 new subcomponents (SubPanelShell, StagedSection, FieldRow, SubmitBar, PanelErrorBanner) → shell ARIA landmarks + skip-link → QuickTileCreate refactor consuming the new parts → SubmitState machine in the Zustand store. TDD throughout.

**Tech Stack:** Next.js 16, React 19, Mantine 9.4, Tailwind 4, Zustand, Vitest + Testing Library, Playwright, axe-core.

**Spec:** `docs/superpowers/specs/2026-07-29-tastile-web-dashboard-polish-design.md`

---

## File Map

```
src/
  app/
    globals.css                            (MODIFY: tokens + focus + reduced-motion)
    dashboard/
      layout.tsx                           (MODIFY: skip-link)
  components/
    shell/
      FloatingHeader.tsx                   (MODIFY: role="banner", aria-label)
      ActivityBar.tsx                      (MODIFY: role="navigation", aria-current)
      SideToolPanel.tsx                    (MODIFY: role="complementary")
      BottomSheet.tsx                      (MODIFY: aria-labelledby)
    tiles/
      QuickTileCreate.tsx                  (MODIFY: use SubPanelShell + SubmitBar)
      editor/
        SubPanelShell.tsx                  (NEW)
        StagedSection.tsx                  (NEW)
        FieldRow.tsx                       (NEW)
        SubmitBar.tsx                      (NEW)
        PanelErrorBanner.tsx               (NEW)
        panel-styles.ts                    (MODIFY: add FOCUS_RING_CLASS, SURFACE_CLASSES)
        editor.test.tsx (NEW entries)      (MODIFY: stacked component tests)
  lib/
    stores/
      quick-create-store.ts                (MODIFY: submitState, canSubmit, fieldErrors)

docs/superpowers/plans/2026-07-29-tastile-web-dashboard-polish.md  (this file)
```

Every new file has one responsibility. Subcomponents live next to the existing editor sub-panels they shadow. No new top-level dirs.

---

## Task 1: Add CSS tokens and global focus rule

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Open `src/app/globals.css` and inspect the existing light/dark token block**

Run: `grep -n "oklch\|--surface" src/app/globals.css | head -30`
Expected: existing tokens listed so we don't duplicate.

- [ ] **Step 2: Add the new tokens in `:root` and `[data-theme="dark"]` blocks**

Locate the existing `:root { ... }` block and append (do NOT duplicate existing tokens):

```css
  --focus-ring: oklch(0.55 0.18 250 / 0.55);
  --ring-offset: 2px;
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.04);
  --shadow-2: 0 4px 8px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.04);
  --shadow-3: 0 8px 24px rgb(0 0 0 / 0.08), 0 24px 48px rgb(0 0 0 / 0.06);
  --surface-3: oklch(0.985 0 0);
  --surface-inset: oklch(0.97 0 0);
  --border-subtle: oklch(0 0 0 / 0.06);
  --border-default: oklch(0 0 0 / 0.1);
```

Locate the `[data-theme="dark"]` block and append:

```css
  --focus-ring: oklch(0.7 0.18 250 / 0.6);
  --surface-3: oklch(0.18 0 0);
  --surface-inset: oklch(0.15 0 0);
  --border-subtle: oklch(1 0 0 / 0.06);
  --border-default: oklch(1 0 0 / 0.1);
```

- [ ] **Step 3: Append the global focus-visible rule and reduced-motion gate at the bottom of the file**

```css
@layer base {
  :where(button, a, [role="button"], input, select, textarea, [tabindex]):focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: var(--ring-offset);
    border-radius: inherit;
  }
}

@media (prefers-reduced-motion: reduce) {
  :where([data-panel-anim]) {
    transition-property: opacity;
    transform: none !important;
  }
}
```

- [ ] **Step 4: Verify the dev server still boots**

Run: `cd tastile-web && timeout 30 bun dev 2>&1 | head -20` then kill
Expected: "Ready in" / "Local: http://localhost:3000" appears; no CSS parse errors.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/app/globals.css && git commit -m "feat(web): add focus-ring, surface-3, shadow tokens, reduced-motion gate"
```

---

## Task 2: Expand panel-styles.ts

**Files:**
- Modify: `src/components/tiles/editor/panel-styles.ts`
- Create: `src/components/tiles/editor/panel-styles.test.ts`

- [ ] **Step 1: Write the failing test**

`src/components/tiles/editor/panel-styles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FOCUS_RING_CLASS,
  INPUT_RADIUS,
  PANEL_ANIM_ATTR,
  SEGMENT_STYLES,
  SURFACE_CLASSES,
} from "./panel-styles";

describe("panel-styles", () => {
  it("exposes focus-ring class with outline utilities", () => {
    expect(FOCUS_RING_CLASS).toContain("focus-visible:outline");
    expect(FOCUS_RING_CLASS).toContain("var(--focus-ring)");
  });

  it("exposes surface classes for raised/elevated/inset", () => {
    expect(SURFACE_CLASSES.raised).toContain("var(--surface-1)");
    expect(SURFACE_CLASSES.elevated).toContain("var(--surface-3)");
    expect(SURFACE_CLASSES.inset).toContain("var(--surface-inset)");
  });

  it("matches Mantine default input radius", () => {
    expect(INPUT_RADIUS).toBe("rounded-md");
  });

  it("names the data attribute for reduced-motion targeting", () => {
    expect(PANEL_ANIM_ATTR).toBe("data-panel-anim");
  });

  it("keeps the legacy segment styles constant", () => {
    expect(SEGMENT_STYLES.root.backgroundColor).toBe("var(--surface-2)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tastile-web && bun test src/components/tiles/editor/panel-styles.test.ts`
Expected: FAIL — `FOCUS_RING_CLASS` is not exported.

- [ ] **Step 3: Replace the contents of `panel-styles.ts` with the expanded exports**

```ts
export const SEGMENT_STYLES = {
  root: { backgroundColor: "var(--surface-2)" },
  indicator: { backgroundColor: "var(--surface-1)" },
  label: { color: "var(--foreground)" },
} as const;

export const FOCUS_RING_CLASS =
  "focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

export const SURFACE_CLASSES = {
  raised: "bg-[var(--surface-1)] shadow-[var(--shadow-1)]",
  elevated: "bg-[var(--surface-3)] shadow-[var(--shadow-2)]",
  inset: "bg-[var(--surface-inset)]",
} as const;

export const INPUT_RADIUS = "rounded-md";

export const PANEL_ANIM_ATTR = "data-panel-anim";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tastile-web && bun test src/components/tiles/editor/panel-styles.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/components/tiles/editor/panel-styles.ts src/components/tiles/editor/panel-styles.test.ts && git commit -m "feat(web): extend panel-styles with focus, surface, radius tokens"
```

---

## Task 3: SubPanelShell — TDD

**Files:**
- Create: `src/components/tiles/editor/SubPanelShell.tsx`
- Create: `src/components/tiles/editor/SubPanelShell.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/tiles/editor/SubPanelShell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SubPanelShell } from "./SubPanelShell";

describe("SubPanelShell", () => {
  const baseProps = {
    panelKey: "intent" as const,
    headingId: "intent-heading",
    title: "Intent",
    onClose: vi.fn(),
    layout: "drawer" as const,
    children: <p>body</p>,
  };

  it("renders children when active", () => {
    render(<SubPanelShell {...baseProps} activeKey="intent" />);
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("hides and inerts when idle", () => {
    render(<SubPanelShell {...baseProps} activeKey="base" />);
    const region = screen.getByRole("region", { name: "Intent" });
    expect(region).toHaveAttribute("aria-hidden", "true");
    expect(region).toHaveAttribute("inert");
  });

  it("uses translate-x-full when idle on desktop drawer", () => {
    render(<SubPanelShell {...baseProps} activeKey="base" layout="drawer" />);
    const region = screen.getByRole("region", { name: "Intent" });
    expect(region.className).toContain("translate-x-full");
  });

  it("uses translate-y-full when idle on mobile sheet", () => {
    render(<SubPanelShell {...baseProps} activeKey="base" layout="sheet" />);
    const region = screen.getByRole("region", { name: "Intent" });
    expect(region.className).toContain("translate-y-full");
  });

  it("uses translate-x-0 when active on desktop drawer", () => {
    render(<SubPanelShell {...baseProps} activeKey="intent" layout="drawer" />);
    const region = screen.getByRole("region", { name: "Intent" });
    expect(region.className).toContain("translate-x-0");
  });

  it("calls onClose when Esc is pressed", async () => {
    const onClose = vi.fn();
    render(<SubPanelShell {...baseProps} activeKey="intent" onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sets aria-labelledby to the heading id", () => {
    render(<SubPanelShell {...baseProps} activeKey="intent" />);
    const region = screen.getByRole("region", { name: "Intent" });
    expect(region).toHaveAttribute("aria-labelledby", "intent-heading");
  });

  it("marks the root with data-panel-anim for reduced-motion targeting", () => {
    render(<SubPanelShell {...baseProps} activeKey="intent" />);
    const region = screen.getByRole("region", { name: "Intent" });
    expect(region).toHaveAttribute("data-panel-anim", "");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tastile-web && bun test src/components/tiles/editor/SubPanelShell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SubPanelShell.tsx`**

```tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { CloseButton } from "@mantine/core";
import { PANEL_ANIM_ATTR } from "./panel-styles";

export type SubPanelKey =
  | "base"
  | "intent"
  | "time"
  | "duration"
  | "recurring"
  | "source-rules"
  | "relations"
  | "flows"
  | "tasks";

interface Props {
  panelKey: SubPanelKey;
  activeKey: SubPanelKey | null;
  onClose: () => void;
  headingId: string;
  title: string;
  description?: string;
  children: ReactNode;
  layout: "drawer" | "sheet";
}

export function SubPanelShell({
  panelKey,
  activeKey,
  onClose,
  headingId,
  title,
  description,
  children,
  layout,
}: Props) {
  const isActive = activeKey === panelKey;

  useEffect(() => {
    if (!isActive) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isActive, onClose]);

  const idleTransform = layout === "drawer" ? "translate-x-full" : "translate-y-full";
  const activeTransform = layout === "drawer" ? "translate-x-0" : "translate-y-0";

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      aria-hidden={!isActive}
      inert={!isActive}
      {...{ [PANEL_ANIM_ATTR]: "" }}
      className={`absolute inset-0 flex flex-col bg-[var(--surface-1)] transition-transform duration-200 ${isActive ? activeTransform : idleTransform} ${isActive ? "" : "pointer-events-none"}`}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
        <div>
          <h2 id={headingId} className="text-sm font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="text-xs text-[var(--foreground-muted)]">{description}</p>
          ) : null}
        </div>
        <CloseButton onClick={onClose} aria-label={`Close ${title}`} />
      </header>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tastile-web && bun test src/components/tiles/editor/SubPanelShell.test.tsx`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/components/tiles/editor/SubPanelShell.tsx src/components/tiles/editor/SubPanelShell.test.tsx && git commit -m "feat(web): add SubPanelShell with ARIA, keyboard, reduced-motion"
```

---

## Task 4: StagedSection — TDD

**Files:**
- Create: `src/components/tiles/editor/StagedSection.tsx`
- Create: `src/components/tiles/editor/StagedSection.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/tiles/editor/StagedSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StagedSection } from "./StagedSection";

describe("StagedSection", () => {
  it("renders a button with aria-expanded=false when collapsed", () => {
    render(
      <StagedSection title="Plan" isOpen={false} onToggle={() => {}}>
        <div>body</div>
      </StagedSection>,
    );
    const toggle = screen.getByRole("button", { name: "Plan" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("renders children when open and aria-expanded=true", () => {
    render(
      <StagedSection title="Plan" isOpen onToggle={() => {}}>
        <div>body</div>
      </StagedSection>,
    );
    const toggle = screen.getByRole("button", { name: "Plan" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("renders digest when collapsed", () => {
    render(
      <StagedSection
        title="Plan"
        isOpen={false}
        onToggle={() => {}}
        digest={<span data-testid="digest">3 items</span>}
      >
        <div>body</div>
      </StagedSection>,
    );
    expect(screen.getByTestId("digest")).toBeInTheDocument();
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("calls onToggle when clicked", async () => {
    const onToggle = vi.fn();
    render(
      <StagedSection title="Plan" isOpen={false} onToggle={onToggle}>
        <div>body</div>
      </StagedSection>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows a required indicator when required", () => {
    render(
      <StagedSection title="Identity" required isOpen={false} onToggle={() => {}}>
        <div/>
      </StagedSection>,
    );
    expect(screen.getByText("Identity").parentElement?.textContent).toContain("*");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tastile-web && bun test src/components/tiles/editor/StagedSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `StagedSection.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  title: string;
  required?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  digest?: ReactNode;
  children: ReactNode;
}

export function StagedSection({
  title,
  required,
  isOpen,
  onToggle,
  digest,
  children,
}: Props) {
  const Icon = isOpen ? ChevronDown : ChevronRight;
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)]">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icon size={16} aria-hidden />
          {title}
          {required ? (
            <span aria-hidden className="text-[var(--color-danger,#dc2626)]">
              *
            </span>
          ) : null}
        </span>
        <span className="text-xs text-[var(--foreground-muted)] flex items-center gap-2">
          {isOpen ? null : digest}
        </span>
      </button>
      {isOpen ? <div className="border-t border-[var(--border-subtle)] p-4">{children}</div> : null}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tastile-web && bun test src/components/tiles/editor/StagedSection.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/components/tiles/editor/StagedSection.tsx src/components/tiles/editor/StagedSection.test.tsx && git commit -m "feat(web): add StagedSection collapsible with digest slot"
```

---

## Task 5: FieldRow — TDD

**Files:**
- Create: `src/components/tiles/editor/FieldRow.tsx`
- Create: `src/components/tiles/editor/FieldRow.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/tiles/editor/FieldRow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldRow } from "./FieldRow";

describe("FieldRow", () => {
  it("renders label linked to control by id", () => {
    render(
      <FieldRow label="Title" htmlFor="title-input">
        <input id="title-input" />
      </FieldRow>,
    );
    const label = screen.getByText("Title");
    expect(label).toHaveAttribute("for", "title-input");
  });

  it("renders hint with aria-describedby", () => {
    render(
      <FieldRow label="Title" htmlFor="t" hint="max 80 chars">
        <input id="t" />
      </FieldRow>,
    );
    const input = screen.getByLabelText("Title");
    const hintId = input.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(screen.getByText("max 80 chars").id).toBe(hintId);
  });

  it("renders error with aria-errormessage and role=alert", () => {
    render(
      <FieldRow label="Title" htmlFor="t" error="Required">
        <input id="t" />
      </FieldRow>,
    );
    const input = screen.getByLabelText("Title");
    const errId = input.getAttribute("aria-errormessage");
    expect(errId).toBeTruthy();
    const err = screen.getByRole("alert");
    expect(err.id).toBe(errId);
    expect(err.textContent).toBe("Required");
  });

  it("renders required indicator", () => {
    render(
      <FieldRow label="Title" htmlFor="t" required>
        <input id="t" />
      </FieldRow>,
    );
    const label = screen.getByText("Title");
    expect(label.parentElement?.textContent).toContain("*");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tastile-web && bun test src/components/tiles/editor/FieldRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FieldRow.tsx`**

```tsx
"use client";

import { useId, type ReactNode } from "react";

interface Props {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}

export function FieldRow({ label, htmlFor, hint, error, required, children }: Props) {
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium flex items-center gap-1">
        {label}
        {required ? <span aria-hidden className="text-[var(--color-danger,#dc2626)]">*</span> : null}
      </label>
      {hint ? (
        <span id={hintId} className="text-[11px] text-[var(--foreground-muted)]">
          {hint}
        </span>
      ) : null}
      <div
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        {...(error ? { "aria-errormessage": errorId } : {})}
        data-error={error ? "true" : undefined}
      >
        {children}
      </div>
      {error ? (
        <span id={errorId} role="alert" className="text-[11px] text-[var(--color-danger,#dc2626)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tastile-web && bun test src/components/tiles/editor/FieldRow.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/components/tiles/editor/FieldRow.tsx src/components/tiles/editor/FieldRow.test.tsx && git commit -m "feat(web): add FieldRow with hint/error ARIA wiring"
```

---

## Task 6: PanelErrorBanner — TDD

**Files:**
- Create: `src/components/tiles/editor/PanelErrorBanner.tsx`
- Create: `src/components/tiles/editor/PanelErrorBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/tiles/editor/PanelErrorBanner.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PanelErrorBanner } from "./PanelErrorBanner";

describe("PanelErrorBanner", () => {
  it("renders title and body with role=alert", () => {
    render(<PanelErrorBanner title="Network error" body="Could not reach server" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Network error");
    expect(alert).toHaveTextContent("Could not reach server");
  });

  it("renders dismiss button when onDismiss provided", async () => {
    const onDismiss = vi.fn();
    render(
      <PanelErrorBanner title="x" body="y" onDismiss={onDismiss} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("hides dismiss button when onDismiss absent", () => {
    render(<PanelErrorBanner title="x" body="y" />);
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tastile-web && bun test src/components/tiles/editor/PanelErrorBanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PanelErrorBanner.tsx`**

```tsx
"use client";

import { CloseButton } from "@mantine/core";

interface Props {
  title: string;
  body: string;
  onDismiss?: () => void;
}

export function PanelErrorBanner({ title, body, onDismiss }: Props) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-[var(--color-danger,#dc2626)]/30 bg-[var(--color-danger,#dc2626)]/5 p-3"
    >
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-[var(--foreground-muted)]">{body}</p>
      </div>
      {onDismiss ? (
        <CloseButton onClick={onDismiss} aria-label="Dismiss error" />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tastile-web && bun test src/components/tiles/editor/PanelErrorBanner.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/components/tiles/editor/PanelErrorBanner.tsx src/components/tiles/editor/PanelErrorBanner.test.tsx && git commit -m "feat(web): add PanelErrorBanner with role=alert"
```

---

## Task 7: SubmitBar — TDD

**Files:**
- Create: `src/components/tiles/editor/SubmitBar.tsx`
- Create: `src/components/tiles/editor/SubmitBar.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/tiles/editor/SubmitBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SubmitBar } from "./SubmitBar";

describe("SubmitBar", () => {
  const baseProps = {
    canSubmit: true,
    blockedReason: null,
    isSubmitting: false,
    serverError: null,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    submitLabel: "Create tile",
    cancelLabel: "Cancel",
  };

  it("renders submit and cancel buttons enabled when canSubmit", () => {
    render(<SubmitBar {...baseProps} />);
    expect(screen.getByRole("button", { name: "Create tile" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("disables submit when canSubmit=false", () => {
    render(<SubmitBar {...baseProps} canSubmit={false} />);
    expect(screen.getByRole("button", { name: "Create tile" })).toBeDisabled();
  });

  it("shows blocked reason text below the button", () => {
    render(<SubmitBar {...baseProps} canSubmit={false} blockedReason="Title required" />);
    expect(screen.getByText("Title required")).toBeInTheDocument();
  });

  it("shows loading spinner when isSubmitting", () => {
    render(<SubmitBar {...baseProps} isSubmitting />);
    const btn = screen.getByRole("button", { name: "Create tile" });
    expect(btn).toHaveAttribute("data-loading", "true");
  });

  it("renders serverError via PanelErrorBanner", () => {
    render(
      <SubmitBar
        {...baseProps}
        serverError={{ title: "Server error", body: "Try again" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Server error");
  });

  it("calls onSubmit when submit clicked", async () => {
    const onSubmit = vi.fn();
    render(<SubmitBar {...baseProps} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Create tile" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when cancel clicked", async () => {
    const onClose = vi.fn();
    render(<SubmitBar {...baseProps} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tastile-web && bun test src/components/tiles/editor/SubmitBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SubmitBar.tsx`**

```tsx
"use client";

import { Button, Group } from "@mantine/core";
import { PanelErrorBanner } from "./PanelErrorBanner";

interface Props {
  canSubmit: boolean;
  blockedReason: string | null;
  isSubmitting: boolean;
  serverError: { title: string; body: string } | null;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  cancelLabel: string;
}

export function SubmitBar({
  canSubmit,
  blockedReason,
  isSubmitting,
  serverError,
  onClose,
  onSubmit,
  submitLabel,
  cancelLabel,
}: Props) {
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
      {serverError ? (
        <PanelErrorBanner title={serverError.title} body={serverError.body} />
      ) : null}
      <Group justify="space-between" align="center">
        <Button variant="default" onClick={onClose} disabled={isSubmitting}>
          {cancelLabel}
        </Button>
        <Button onClick={onSubmit} loading={isSubmitting} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </Group>
      {blockedReason && !canSubmit ? (
        <p className="text-xs text-[var(--foreground-muted)]" aria-live="polite">
          {blockedReason}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tastile-web && bun test src/components/tiles/editor/SubmitBar.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/components/tiles/editor/SubmitBar.tsx src/components/tiles/editor/SubmitBar.test.tsx && git commit -m "feat(web): add SubmitBar with gate, loading, error banner"
```

---

## Task 8: SubmitState + canSubmit + fieldErrors in the store

**Files:**
- Modify: `src/lib/stores/quick-create-store.ts`
- Create: `src/lib/stores/quick-create-store.test.ts`

- [ ] **Step 1: Read the existing store to find the right insertion points**

Run: `cd tastile-web && wc -l src/lib/stores/quick-create-store.ts && grep -nE "interface|type|setField|getFieldError" src/lib/stores/quick-create-store.ts | head -40`
Expected: prints the interface and key methods. Use the output in Step 3.

- [ ] **Step 2: Write the failing test**

`src/lib/stores/quick-create-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useQuickCreateStore } from "./quick-create-store";

describe("useQuickCreateStore", () => {
  beforeEach(() => {
    useQuickCreateStore.setState({
      submitState: { kind: "idle" },
      canSubmit: false,
      submitBlockedReason: "Title required",
      fieldErrors: new Map(),
    });
  });

  it("exposes submitState", () => {
    expect(useQuickCreateStore.getState().submitState).toEqual({ kind: "idle" });
  });

  it("exposes canSubmit and submitBlockedReason", () => {
    const s = useQuickCreateStore.getState();
    expect(s.canSubmit).toBe(false);
    expect(s.submitBlockedReason).toBe("Title required");
  });

  it("getFieldError returns null when no error", () => {
    expect(useQuickCreateStore.getState().getFieldError("title")).toBeNull();
  });

  it("getFieldError returns the error from fieldErrors", () => {
    useQuickCreateStore.setState({
      fieldErrors: new Map([["title", "Required"]]),
    });
    expect(useQuickCreateStore.getState().getFieldError("title")).toBe("Required");
  });

  it("resetSubmitState goes back to idle", () => {
    useQuickCreateStore.setState({
      submitState: { kind: "submitting" },
    });
    useQuickCreateStore.getState().resetSubmitState();
    expect(useQuickCreateStore.getState().submitState).toEqual({ kind: "idle" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tastile-web && bun test src/lib/stores/quick-create-store.test.ts`
Expected: FAIL — `submitState` is not a property.

- [ ] **Step 4: Edit the store to add the new fields**

Open `src/lib/stores/quick-create-store.ts`. Below the existing state interface, add:

```ts
export type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; reason: string; message: string }
  | { kind: "success" };
```

Inside the state interface, add fields (after the existing fields):

```ts
  submitState: SubmitState;
  canSubmit: boolean;
  submitBlockedReason: string | null;
  fieldErrors: Map<string, string>;
  getFieldError: (path: string) => string | null;
  resetSubmitState: () => void;
```

In the `create<QuickCreateState>((set, get) => ({ ... }))` initial state, add:

```ts
    submitState: { kind: "idle" },
    canSubmit: false,
    submitBlockedReason: null,
    fieldErrors: new Map(),
    getFieldError: (path) => get().fieldErrors.get(path) ?? null,
    resetSubmitState: () => set({ submitState: { kind: "idle" } }),
```

In the existing `close()` action, add the resets:

```ts
    close: () =>
      set({
        open: false,
        activePanel: null,
        submitState: { kind: "idle" },
      }),
```

(If `close()` already exists with a different body, append the resets without removing the existing fields.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tastile-web && bun test src/lib/stores/quick-create-store.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Run all store-related tests to confirm no regression**

Run: `cd tastile-web && bun test src/lib/stores`
Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
cd tastile-web && git add src/lib/stores/quick-create-store.ts src/lib/stores/quick-create-store.test.ts && git commit -m "feat(web): add SubmitState, canSubmit, fieldErrors selectors to quick-create-store"
```

---

## Task 9: FloatingHeader — ARIA landmark + focus

**Files:**
- Modify: `src/components/shell/FloatingHeader.tsx`

- [ ] **Step 1: Read the file to find the top-level element**

Run: `cd tastile-web && head -40 src/components/shell/FloatingHeader.tsx`
Expected: shows the top-level wrapper element and prop types.

- [ ] **Step 2: Add `role="banner"` to the header wrapper**

Find the top-level `<header` or `<div` element that wraps the entire `FloatingHeader` body. If it is `<header>` already, leave it; the `role="banner"` is implicit. If it is a `<div>`, add `role="banner"` to it. Do not change layout.

- [ ] **Step 3: Add `aria-label` to icon-only buttons**

For each `<button>` whose only child is a Lucide icon (no text), add `aria-label="..."` with a descriptive label. Example:

```tsx
<button onClick={onOpenSearch} aria-label="Open search">
  <Search size={18} />
</button>
```

If the button already has `aria-label`, leave it.

- [ ] **Step 4: Mark the user-name area with `aria-live="polite"`**

Find the element rendering `{session?.displayName ?? "Loading..."}`. Wrap it in `aria-live="polite"` (or add the attribute to the existing element). Do not change text.

- [ ] **Step 5: Replace any `<div onClick>` with `<button>`**

If any clickable element is a `<div>`, change it to `<button type="button">`. There should be no remaining divs with onClick handlers.

- [ ] **Step 6: Verify typecheck and existing tests**

Run: `cd tastile-web && bun run typecheck && bun test src/components/layout`
Expected: typecheck clean; tests green.

- [ ] **Step 7: Commit**

```bash
cd tastile-web && git add src/components/shell/FloatingHeader.tsx && git commit -m "feat(web): add banner role, aria-label, aria-live to FloatingHeader"
```

---

## Task 10: ActivityBar — ARIA nav landmark + aria-current

**Files:**
- Modify: `src/components/shell/ActivityBar.tsx`

- [ ] **Step 1: Wrap nav in a `<nav role="navigation" aria-label="Primary">`**

The nav links loop in `ActivityBar.tsx` renders `<Link>` or `<button>` elements. Wrap the existing container in:

```tsx
<nav role="navigation" aria-label="Primary">
  ...existing children
</nav>
```

- [ ] **Step 2: Add `aria-current="page"` to the active item**

Inside the loop, when `pathname === href`, add `aria-current="page"` to the rendered element. For `<Link>`:

```tsx
<Link href={href} aria-current={isActive ? "page" : undefined} ...>
```

- [ ] **Step 3: Replace `title` attributes with `aria-describedby` on the pin/expand button**

If a `<button>` has `title="..."`, replace it with `aria-describedby="..."` and a hidden `<span id="...">` carrying the text. If the existing pattern uses Mantine `Tooltip`, leave it.

- [ ] **Step 4: Verify tests**

Run: `cd tastile-web && bun run typecheck && bun test src/components/layout`
Expected: Pass.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/components/shell/ActivityBar.tsx && git commit -m "feat(web): add nav landmark, aria-current, aria-describedby to ActivityBar"
```

---

## Task 11: SideToolPanel — ARIA complementary

**Files:**
- Modify: `src/components/shell/SideToolPanel.tsx`

- [ ] **Step 1: Read the file**

Run: `cd tastile-web && cat src/components/shell/SideToolPanel.tsx`
Expected: 28 lines, wraps `useSidePanelContent()` output.

- [ ] **Step 2: Add the landmark and labels**

Replace the wrapping element with:

```tsx
<aside
  role="complementary"
  aria-label="Detail panel"
  className="..."  // existing classes
>
  <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-subtle)]">
    <span className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
      Details
    </span>
    <button onClick={onClose} aria-label="Close detail panel" type="button" className="rounded-md p-1 hover:bg-[var(--surface-2)]">
      <X size={16} aria-hidden />
    </button>
  </header>
  <div aria-label="Detail content" className="p-4">
    {content}
  </div>
</aside>
```

(If `onClose` is not a prop, omit the close button. Wire it via the existing close mechanism.)

- [ ] **Step 3: Verify tests**

Run: `cd tastile-web && bun run typecheck && bun test src/components/layout`
Expected: Pass.

- [ ] **Step 4: Commit**

```bash
cd tastile-web && git add src/components/shell/SideToolPanel.tsx && git commit -m "feat(web): add complementary landmark + close button to SideToolPanel"
```

---

## Task 12: BottomSheet — aria-labelledby + skip-link in layout

**Files:**
- Modify: `src/components/shell/BottomSheet.tsx`
- Modify: `src/app/dashboard/layout.tsx`

- [ ] **Step 1: Read `BottomSheet.tsx`**

Run: `cd tastile-web && wc -l src/components/shell/BottomSheet.tsx && head -50 src/components/shell/BottomSheet.tsx`
Expected: file uses Mantine `Drawer` or `Modal`.

- [ ] **Step 2: Add `aria-labelledby` to the underlying Mantine component**

If it uses `Drawer`:

```tsx
<Drawer
  opened={open}
  onClose={onClose}
  title={title}
  aria-labelledby="bottom-sheet-title"
  ...
>
```

If it uses `Modal`, apply the same `aria-labelledby` to the modal. The title must already render an `<h2 id="bottom-sheet-title">` (or use Mantine's `title` prop which sets one).

- [ ] **Step 3: Add `data-panel-anim` to the Mantine wrapper**

Find the Mantine component's `classNames` prop or wrap it in a `<div {...{ [PANEL_ANIM_ATTR]: "" }} className="...">` so the reduced-motion CSS targets it.

- [ ] **Step 4: Add skip-link to layout.tsx**

In `src/app/dashboard/layout.tsx`, immediately after the `<body>` element's children (or after the provider wrappers), add:

```tsx
<a
  href="#main"
  className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-[var(--surface-3)] focus:px-3 focus:py-2 focus:text-sm"
>
  Skip to main
</a>
```

Find the `<main>` element and add `id="main"` to it.

- [ ] **Step 5: Verify tests**

Run: `cd tastile-web && bun run typecheck && bun test src/components/layout && bun test src/components/shell`
Expected: Pass.

- [ ] **Step 6: Commit**

```bash
cd tastile-web && git add src/components/shell/BottomSheet.tsx src/app/dashboard/layout.tsx && git commit -m "feat(web): add aria-labelledby to BottomSheet and skip-link to layout"
```

---

## Task 13: Wire SubPanelShell into the existing intent sub-panel

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx`

- [ ] **Step 1: Capture before screenshot**

Run: `cd tastile-web && bun dev &` (in background). Wait 8 seconds.
Then in another shell: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard/timeline` (expect 200).
Note: chrome-devtools MCP is out of scope here; the visual comparison happens in Task 17. For this task, just ensure the dev server boots.

- [ ] **Step 2: Locate the inline sub-panel rendering for `intent`**

In `QuickTileCreate.tsx`, find the `<section className={subPanelClass("intent")} ...>` (around line 1238 per the file structure). Wrap it in SubPanelShell:

```tsx
<SubPanelShell
  panelKey="intent"
  activeKey={activePanel}
  onClose={() => setActivePanel("base")}
  headingId="intent-heading"
  title={t("create.intentTitle")}
  layout={isDesktop ? "drawer" : "sheet"}
>
  <ConditionPanel />
</SubPanelShell>
```

Replace the entire `<section className={subPanelClass("intent")} ...>` block with the above.

- [ ] **Step 3: Remove the inline `aria-hidden`/`inert` props that were attached to the section**

Since SubPanelShell manages those, drop any duplicate attributes from the replaced section.

- [ ] **Step 4: Verify the dev server still renders**

Run: `curl -s http://localhost:3000/dashboard/tasks -o /dev/null -w "%{http_code}\n"`
Expected: 200.

- [ ] **Step 5: Run the existing tests**

Run: `cd tastile-web && bun test src/components/tiles`
Expected: Pass.

- [ ] **Step 6: Commit**

```bash
cd tastile-web && git add src/components/tiles/QuickTileCreate.tsx && git commit -m "refactor(web): wire SubPanelShell into intent sub-panel"
```

---

## Task 14: Wire SubPanelShell into remaining sub-panels

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx`

- [ ] **Step 1: Apply the same wrapping to `time`, `duration`, `recurring`, `source-rules`, `relations`, `flows`, `tasks`**

For each remaining `<section className={subPanelClass("...")}>` block, replace it with:

```tsx
<SubPanelShell
  panelKey="<key>"
  activeKey={activePanel}
  onClose={() => setActivePanel("base")}
  headingId="<key>-heading"
  title={t("create.<key>Title")}
  layout={isDesktop ? "drawer" : "sheet"}
>
  <AppropriateChildComponent />
</SubPanelShell>
```

Use the existing component rendered inside each section (e.g., `SchedulePanel`, `RequiredTimePanel`, `RelationPanel`, `FlowSequencePanel`, `SourceGenerationPanel`, `SourceWindowPanel`, `AutomationPanel`, `AvailabilityPanel`).

- [ ] **Step 2: Delete the inline `subPanelClass` helper from `QuickTileCreate.tsx`**

It is no longer used. Search for any other usage first; if none, remove the helper.

- [ ] **Step 3: Run all tests**

Run: `cd tastile-web && bun run typecheck && bun test`
Expected: 0 failures.

- [ ] **Step 4: Commit**

```bash
cd tastile-web && git add src/components/tiles/QuickTileCreate.tsx && git commit -m "refactor(web): wire SubPanelShell into all sub-panels, drop inline helper"
```

---

## Task 15: Replace the inline submit footer with SubmitBar

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx`

- [ ] **Step 1: Find the inline footer**

Find the `<Group>` (or `<div>`) at the bottom of the form containing the Cancel + Create buttons. It is around the `submitCreateTile` call site.

- [ ] **Step 2: Replace with SubmitBar**

```tsx
<SubmitBar
  canSubmit={canSubmit}
  blockedReason={submitBlockedReason}
  isSubmitting={submitState.kind === "submitting"}
  serverError={
    submitState.kind === "error"
      ? { title: t("create.submitErrorTitle"), body: submitState.message }
      : null
  }
  onClose={close}
  onSubmit={onSubmit}
  submitLabel={t("create.submitCreate")}
  cancelLabel={t("create.cancel")}
/>
```

`onSubmit` is the existing handler that calls `submitCreateTile`.

- [ ] **Step 3: Remove the redundant inline alerts and error blocks**

If there were inline `<Alert>` elements above the buttons, remove them — SubmitBar handles errors via `PanelErrorBanner`.

- [ ] **Step 4: Run tests**

Run: `cd tastile-web && bun run typecheck && bun test`
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/components/tiles/QuickTileCreate.tsx && git commit -m "refactor(web): replace inline form footer with SubmitBar"
```

---

## Task 16: Wire field-level errors into FieldRow

**Files:**
- Modify: `src/components/tiles/QuickTileCreate.tsx`

- [ ] **Step 1: Find three high-traffic fields**

Find the title input, the span-order pair, and the duration-range row. Each is currently a bare `<TextInput>` / `<NumberInput>`.

- [ ] **Step 2: Wrap each in a FieldRow with `getFieldError`**

For example:

```tsx
<FieldRow
  label={t("create.titleLabel")}
  htmlFor="tile-title"
  required
  error={getFieldError("title")}
>
  <TextInput id="tile-title" value={title} onChange={(e) => setField("title", e.currentTarget.value)} />
</FieldRow>
```

Apply the same pattern to `spanOrder` and `durationRange`.

- [ ] **Step 3: Add the fieldErrors triggers**

In the existing `useEffect` (or a new one) that updates `canSubmit`/`submitBlockedReason`, also push errors into `fieldErrors`:

```ts
useEffect(() => {
  const errors = new Map<string, string>();
  if (!title.trim()) errors.set("title", t("create.titleRequired"));
  if (spanOrderInverted) errors.set("spanOrder", t("create.spanOrderInvalid"));
  if (durationRangeInverted) errors.set("durationRange", t("create.durationInvalid"));
  setFieldErrors(errors);
  setCanSubmit(errors.size === 0);
  setSubmitBlockedReason(errors.size === 0 ? null : errors.values().next().value ?? null);
}, [title, spanOrderInverted, durationRangeInverted, t, setFieldErrors, setCanSubmit, setSubmitBlockedReason]);
```

Use the existing selectors/variables. Add `setFieldErrors`, `setCanSubmit`, `setSubmitBlockedReason` actions to the store if they don't exist.

- [ ] **Step 4: Run tests**

Run: `cd tastile-web && bun run typecheck && bun test`
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add src/components/tiles/QuickTileCreate.tsx && git commit -m "feat(web): wire field-level errors into FieldRow via quick-create-store"
```

---

## Task 17: Browser verification — walk all states

**Files:**
- Create: `evidence/2026-07-29-dashboard-polish/shots/` (capture directory)

- [ ] **Step 1: Start the dev server**

Run: `cd tastile-web && bun dev &` (background). Wait 10 seconds.

- [ ] **Step 2: Navigate via chrome-devtools MCP**

Use: `mcp__chrome-devtools__navigate_page` to `http://localhost:3000/dashboard/tasks`.

- [ ] **Step 3: Walk each state and capture a screenshot**

For each state below, capture a screenshot into `evidence/2026-07-29-dashboard-polish/shots/`:

- `shell-header.png` — header collapsed
- `shell-header-expanded-account.png` — hover user account
- `shell-sidebar-pinned.png` — ActivityBar pinned open
- `shell-sidebar-hover.png` — ActivityBar hover-expanded
- `shell-side-panel.png` — SideToolPanel populated
- `tile-create-base.png` — tile creation base panel open
- `tile-create-intent.png` — sub-panel "intent" open
- `tile-create-tasks.png` — sub-panel "tasks" open
- `tile-create-task-detail.png` — task detail sub-panel
- `tile-create-submit-blocked.png` — submit blocked (empty title)
- `tile-create-submit-error.png` — submit error (force a server error or mock)
- `tile-create-submit-success.png` — submit success (verify it closes)
- `focus-ring-input.png` — focus-visible on a text input
- `focus-ring-button.png` — focus-visible on a button
- `dark-mode-token-swap.png` — same screen in dark mode

- [ ] **Step 4: Set prefers-reduced-motion and re-capture the slide**

Set via `mcp__chrome-devtools__emulate` with no specific flag; use `prefers-reduced-motion: reduce` emulation. Re-capture `tile-create-intent-open.png` and verify it does not transform (only opacity).

- [ ] **Step 5: Verify visually that the focus ring appears and the tokens look right**

Open each screenshot in the file system. Compare against the spec's concentric-radius rules. Note any anomalies in `evidence/2026-07-29-dashboard-polish/notes.md`.

- [ ] **Step 6: Commit**

```bash
cd tastile-web && git add evidence/2026-07-29-dashboard-polish/ && git commit -m "docs: capture dashboard polish verification screenshots"
```

---

## Task 18: axe-core accessibility audit

**Files:**
- Create: `tastile-web/scripts/axe-audit.mjs`
- Create: `evidence/2026-07-29-dashboard-polish/axe-audit.json`

- [ ] **Step 1: Install axe-core if not already present**

Run: `cd tastile-web && grep -q '"axe-core"' package.json || bun add -D axe-core`
Expected: either present (skip) or installed.

- [ ] **Step 2: Write the audit script**

`tastile-web/scripts/axe-audit.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const SCREENS = [
  { name: "dashboard", url: "/dashboard/tasks" },
  { name: "tile-create-base", url: "/dashboard/tasks", openToolbar: "n" },
  { name: "tile-create-subpanel", url: "/dashboard/tasks", openToolbar: "n", openSubPanel: "intent" },
];

const results = {};

for (const screen of SCREENS) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3000${screen.url}`, { waitUntil: "networkidle" });
  if (screen.openToolbar) {
    await page.keyboard.press(`Control+${screen.openToolbar}`);
  }
  await page.waitForTimeout(800);
  const audit = await page.evaluate(async () => {
    const axe = await import("/node_modules/axe-core/axe.min.js");
    return axe.default.run({ exclude: [["#__next-build-watcher"]] });
  });
  results[screen.name] = {
    violations: audit.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
    })),
  };
  await browser.close();
}

fs.mkdirSync(path.dirname("evidence/2026-07-29-dashboard-polish/"), { recursive: true });
fs.writeFileSync(
  "evidence/2026-07-29-dashboard-polish/axe-audit.json",
  JSON.stringify(results, null, 2),
);

const critical = Object.values(results).flatMap((r) =>
  r.violations.filter((v) => v.impact === "critical" || v.impact === "serious"),
);

if (critical.length > 0) {
  console.error("AXE AUDIT FAILED: critical/serious violations present", critical);
  process.exit(1);
}
console.log("AXE AUDIT PASS: 0 critical/serious violations");
```

- [ ] **Step 3: Run the audit (dev server must be running)**

Run: `cd tastile-web && bun dev &` (background, 8s wait), then `node scripts/axe-audit.mjs`
Expected: "AXE AUDIT PASS: 0 critical/serious violations".

- [ ] **Step 4: If any violations exist, fix them**

Read the JSON, fix one violation at a time, re-run the script. Common fixes:
- Missing labels → add `htmlFor` or `aria-label`
- Color contrast → adjust `--foreground-muted` token
- Missing landmarks → add `role="..."` + `aria-label`

- [ ] **Step 5: Commit**

```bash
cd tastile-web && git add scripts/axe-audit.mjs evidence/2026-07-29-dashboard-polish/axe-audit.json && git commit -m "test(web): add axe-core audit and 0-violation baseline"
```

---

## Task 19: Final checks

**Files:**
- (no code changes; verification only)

- [ ] **Step 1: Run lint**

Run: `cd tastile-web && bun run lint`
Expected: clean.

- [ ] **Step 2: Run typecheck**

Run: `cd tastile-web && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run knip**

Run: `cd tastile-web && bun run knip`
Expected: no new unused exports.

- [ ] **Step 4: Run all unit tests**

Run: `cd tastile-web && bun run test:unit`
Expected: 0 failures.

- [ ] **Step 5: Run build**

Run: `cd tastile-web && bun run build`
Expected: succeeds.

- [ ] **Step 6: Visual-contract comparison**

Compare the screenshots in `evidence/2026-07-29-dashboard-polish/shots/` against the spec's expected layout. Document any drift in `evidence/2026-07-29-dashboard-polish/notes.md`.

- [ ] **Step 7: If anything is broken, fix it**

Tiny fixes (typo, className) → commit fix. Architectural changes → re-plan.

- [ ] **Step 8: Final commit if notes changed**

```bash
cd tastile-web && git add evidence/2026-07-29-dashboard-polish/notes.md && git commit -m "docs: polish verification notes"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task |
|---|---|
| §1 Tokens (`--focus-ring`, shadows, `--surface-3`, `--surface-inset`, `--border-subtle`, `--border-default`) | Task 1 |
| §1 Universal focus rule | Task 1 |
| §1 Reduced-motion gate | Task 1 |
| §1 Expanded `panel-styles.ts` | Task 2 |
| §2 FloatingHeader ARIA | Task 9 |
| §2 ActivityBar ARIA | Task 10 |
| §2 SideToolPanel ARIA | Task 11 |
| §2 BottomSheet ARIA | Task 12 |
| §2 Skip-link | Task 12 |
| §2 Concentric radius audit | Tasks 9-12 (verified visually in Task 17) |
| §3 SubPanelShell | Task 3 |
| §3 StagedSection | Task 4 |
| §3 FieldRow | Task 5 |
| §3 SubmitBar | Task 7 |
| §3 PanelErrorBanner | Task 6 |
| §3 panel-styles.ts expansion | Task 2 |
| §4 SubmitState state machine | Task 8 |
| §4 Store additions | Task 8 |
| §4 activePanel lifecycle | Tasks 13-14 (wiring) + Task 8 (state) |
| §4 Field-level error sourcing | Task 16 |
| §4 Submit flow unchanged | Task 15 (uses existing submitCreateTile) |
| §5 Unit tests | Tasks 2-7 (one per subcomponent) |
| §5 Browser verification | Task 17 |
| §5 axe-core audit | Task 18 |
| §5 Verification checklist | Task 19 |
| Out of scope (domain, API, store schema rewrite, i18n, calendar, theming, motion library, mobile, performance) | All explicit non-goals — no tasks needed |

**2. Placeholder scan:** No TBD / TODO / "fill in later" patterns. Every code step has the actual code.

**3. Type consistency:**
- `SubmitState` defined in Task 8, used in Task 15. ✓
- `getFieldError` defined in Task 8, used in Task 16. ✓
- `SubPanelKey` defined in Task 3, used in Task 13-14. ✓
- `SubPanelShell` props defined in Task 3, used identically in Tasks 13-14. ✓
- `SubmitBar` props defined in Task 7, used identically in Task 15. ✓
- `FieldRow` props defined in Task 5, used identically in Task 16. ✓
- `PanelErrorBanner` props defined in Task 6, used identically in Task 7. ✓

No issues found.
