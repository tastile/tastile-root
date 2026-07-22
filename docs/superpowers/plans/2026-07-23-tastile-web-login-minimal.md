# Tastile Web Login Minimal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/login` を認証だけに集中したモバイル優先画面へ縮小し、全体のフォント指定を実在する CSS スタックへ戻す。

**Architecture:** Cognito の route、セッション、クエリ引き継ぎは変更しない。`/login` の JSX だけを専用の中央カードへ置き換え、共有レイアウトは触らない。グローバルなフォントトークンだけは未定義変数を除去し、既存の日本語フォントトークンをログイン画面で明示利用する。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Vitest, Bun.

---

## File map

- `tastile-web/src/app/login/page.tsx` — ログイン画面の構造、プロバイダー表示、認証リンク
- `tastile-web/src/app/layout.tsx` — body のフォントクラスとルートフォント初期化
- `tastile-web/src/app/globals.css` — Tailwind のフォントトークンとグローバル CSS
- `tastile-web/src/app/marketing-layout.test.tsx` — ログイン構成とフォント設定の回帰テスト

`AuthShell`、`src/app/auth/*`、Cognito API route は変更しない。作業ツリーにある既存の未コミット変更はステージしない。

### Task 1: Restore concrete font stacks

**Files:**
- Modify: `tastile-web/src/app/marketing-layout.test.tsx`
- Modify: `tastile-web/src/app/layout.tsx:12-18,57-59`
- Modify: `tastile-web/src/app/globals.css:166-169`

- [ ] **Step 1: Add a failing font regression test**

`marketing-layout.test.tsx` に `node:fs` の `readFileSync` を追加し、次のテストを追加する。

```tsx
it("uses concrete font variables without unresolved mock references", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const layout = readFileSync("src/app/layout.tsx", "utf8");

  expect(css).not.toContain("var(--font-inter)");
  expect(css).not.toContain("var(--font-geist-mono)");
  expect(css).toContain(
    '--font-sans: "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;',
  );
  expect(layout).not.toContain("Mock font variables");
  expect(layout).toContain('className="font-sans antialiased"');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `tastile-web/`:

```bash
bun test src/app/marketing-layout.test.tsx
```

Expected: FAIL because `globals.css` still contains `var(--font-inter)` / `var(--font-geist-mono)` and `layout.tsx` still contains the mock-font comment.

- [ ] **Step 3: Replace the mock font variables**

In `src/app/layout.tsx`, delete the five mock constants and change the body opening tag to:

```tsx
<body className="font-sans antialiased">
```

In `src/app/globals.css`, replace the two theme declarations with concrete stacks:

```css
--font-sans: "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
```

Leave `--font-jp`, `--font-zen-kaku`, and `--font-jp-heading` unchanged.

- [ ] **Step 4: Run the focused test and verify it passes**

```bash
bun test src/app/marketing-layout.test.tsx
```

Expected: PASS, including the existing marketing layout assertions.

- [ ] **Step 5: Commit only the font change**

From `tastile-web/`, stage only the three listed files and create:

```bash
git add src/app/layout.tsx src/app/globals.css src/app/marketing-layout.test.tsx
git commit -m "fix(web): restore concrete font stacks"
```

Do not stage `.env*`, `node_modules`, or any pre-existing modified file.

### Task 2: Replace login with the compact auth card

**Files:**
- Modify: `tastile-web/src/app/marketing-layout.test.tsx`
- Modify: `tastile-web/src/app/login/page.tsx:1-195`

- [ ] **Step 1: Replace the old login assertions with failing compact-layout tests**

Keep the existing `LoginPage` import. Add `afterEach` to the Vitest imports and add `afterEach(() => vi.unstubAllEnvs())` inside the test file. Replace the old login composition test with:

```tsx
it("renders only configured providers in the compact login shell", async () => {
  vi.stubEnv("NEXT_PUBLIC_COGNITO_ENABLED_PROVIDERS", "Google");

  const { container } = render(
    await LoginPage({ searchParams: Promise.resolve({}) }),
  );

  expect(container.querySelector("header")).toBeNull();
  expect(container.querySelector("footer")).toBeNull();
  expect(screen.getByRole("heading", { name: "ログイン" })).toBeTruthy();
  expect(screen.queryByText("実行制御を、すぐ始める")).toBeNull();
  expect(screen.getByRole("link", { name: "Google で続行" })).toBeTruthy();
  expect(screen.queryByText("Apple で続行")).toBeNull();
  expect(screen.getByRole("link", { name: "Passkey / メールで続行" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "アカウントを作成" })).toBeTruthy();
});

it("preserves native auth query values in compact provider links", async () => {
  vi.stubEnv("NEXT_PUBLIC_COGNITO_ENABLED_PROVIDERS", "Google,SignInWithApple");

  const { container } = render(
    await LoginPage({
      searchParams: Promise.resolve({
        redirect_uri: "tastile://auth/callback",
        state: "abcdefghijklmnop",
        code_challenge: "qrstuvwxyz123456",
        platform: "android",
      }),
    }),
  );

  const googleHref = container
    .querySelector<HTMLAnchorElement>('a[href^="/auth/cognito/login?provider=Google"]')
    ?.getAttribute("href");
  expect(googleHref).toContain("redirect_uri=tastile%3A%2F%2Fauth%2Fcallback");
  expect(googleHref).toContain("state=abcdefghijklmnop");
  expect(googleHref).toContain("code_challenge=qrstuvwxyz123456");
  expect(googleHref).toContain("platform=android");
});
```

- [ ] **Step 2: Run the focused test and verify the old layout fails**

```bash
bun test src/app/marketing-layout.test.tsx
```

Expected: FAIL because the current page still renders `SiteHeader`, `SiteFooter`, the marketing headline, and disabled-provider placeholders.

- [ ] **Step 3: Replace the login page return tree**

In `src/app/login/page.tsx`, remove the `Laptop`, `Smartphone`, `Info`, and `KeyRound` imports, remove `SiteHeader`, `SiteFooter`, and translation imports, and keep the existing error map, query parsing, provider detection, and suffix construction. Replace the current return block with a single compact frame:

```tsx
return (
  <div className="min-h-svh bg-background font-[family-name:var(--font-jp)]">
    <main className="flex min-h-svh w-full flex-col items-center justify-center px-4 py-4">
      <Link
        href="/"
        aria-label="Tastile ホーム"
        className="flex min-h-12 items-center gap-2 text-foreground"
      >
        <TastileLogo size={36} />
        <span className="text-lg font-semibold tracking-tight">tastile</span>
      </Link>

      <section
        data-testid="login-panel"
        className="mt-6 w-full max-w-sm rounded-xl bg-surface-elevated p-5 sm:p-6"
      >
        <h1 className="font-[family-name:var(--font-jp-heading)] text-xl font-semibold text-foreground">
          ログイン
        </h1>

        {errorMessage ? (
          <div role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm leading-5 text-danger">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-5 space-y-2">
          {googleEnabled ? (
            <a href={`/auth/cognito/login?provider=Google${desktopSuffix}`} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
              <Globe className="h-4 w-4" aria-hidden="true" />
              Google で続行
            </a>
          ) : null}
          {appleEnabled ? (
            <a href={`/auth/cognito/login?provider=SignInWithApple${desktopSuffix}`} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-md bg-surface-1 px-4 py-3 text-sm font-medium text-foreground hover:bg-surface-2">
              <Apple className="h-4 w-4" aria-hidden="true" />
              Apple で続行
            </a>
          ) : null}
          <a href={`/auth/email${desktopPageSuffix}`} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-md bg-surface-1 px-4 py-3 text-sm font-medium text-foreground hover:bg-surface-2">
            <Fingerprint className="h-4 w-4" aria-hidden="true" />
            Passkey / メールで続行
          </a>
        </div>

        <a href={`/auth/signup${desktopPageSuffix}`} className="mt-3 flex min-h-12 items-center justify-center text-sm text-foreground-muted underline underline-offset-2 hover:text-foreground">
          アカウントを作成
        </a>

        <p className="text-center text-[11px] leading-4 text-foreground-subtle">
          続行すると、<Link href="/terms" className="underline underline-offset-2 hover:text-foreground">利用規約</Link>と<Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">プライバシーポリシー</Link>に同意したものとみなされます。
        </p>
      </section>
    </main>
  </div>
);
```

- [ ] **Step 4: Run focused tests and verify the compact shell passes**

```bash
bun test src/app/marketing-layout.test.tsx
```

Expected: PASS with no `header`, no `footer`, no marketing copy, correct provider filtering, and preserved native query values.

- [ ] **Step 5: Commit only the login change**

```bash
git add src/app/login/page.tsx src/app/marketing-layout.test.tsx
git commit -m "feat(web): simplify login screen"
```

The test file is intentionally included in both task commits; stage only its current complete contents each time.

### Task 3: Run full verification and inspect the real UI

**Files:** None unless a test exposes a defect.

- [ ] **Step 1: Confirm only intended commits and files changed**

From `tastile-web/`:

```bash
git status --short
git diff HEAD~2..HEAD --stat
```

Expected: the two commits contain only the four planned source/test files, with no `.env`, `node_modules`, deployment, or unrelated user changes.

- [ ] **Step 2: Run release-relevant checks**

```bash
bun run lint
bun run typecheck
bun run test:unit
bun run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify the rendered UI at target viewports**

Start the existing development server with `bun dev` if needed, then use the browser-testing workflow against `/login` at 320×568, 390×844, and 1280×800. Confirm the logo, configured buttons, signup link, and legal text are visible; confirm normal state has no vertical or horizontal scroll; confirm an `error` query leaves the alert readable. Do not claim UI verification from unit tests alone.

- [ ] **Step 4: Inspect generated CSS for unresolved font variables**

After `bun run build`, inspect the generated CSS under `.next/static/` and confirm no `var(--font-inter)` or `var(--font-geist-mono)` reference remains in the font token declarations.

- [ ] **Step 5: Report verification evidence and rollback**

Record the exact test/build outputs and viewport results. If rollback is required, revert only the two implementation commits in reverse order; do not reset or clean the working tree.

---

## Commit sequence

1. `fix(web): restore concrete font stacks`
2. `feat(web): simplify login screen`

The root-level design/spec/plan documents remain separate from the child `tastile-web` repository. Do not stage unrelated root or child-repository changes.
