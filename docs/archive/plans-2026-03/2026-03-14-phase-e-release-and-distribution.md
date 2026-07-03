# Release & Distribution Implementation Plan (Revised)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Tastile a distributable product with release binaries, landing page, free/pro tiers, Stripe billing, and Microsoft Store presence.

**Architecture:** 6 phases. Phase 1 (release binaries) and Phase 2 (web public pages) run in parallel. Phase 3 (free web app) depends on Phase 2. Phase 4 (Stripe) depends on Phase 3.1 (schema). Phase 5 (Pro dashboard) depends on Phase 4. Phase 6 (Store) depends on Phase 1.

**Tech Stack:** Rust (daemon/CLI), C# WinUI 3 (desktop), Next.js 16 + Tailwind v4 (web), Supabase (auth/DB), Stripe (billing), Vercel (hosting)

**Pricing:**

| | Free | Pro ($5/month) |
|---|---|---|
| Tiles | Local 100 / Cloud 50 | 10,000 |
| History | 30 days | 2 years |
| Events | — | 100,000 |
| Desktop sync | No | Yes |
| Web | `/app/*` only | `/app/*` + `/dashboard/*` |
| Condition vector editing | No | Yes |

---

## Completed Tasks (for reference)

- ~~Task 1.1: Version infrastructure~~ — `6162c4e` version.rs, CLI --version, daemon log
- ~~Task 1.2: /version API endpoint~~ — `6162c4e` version_handler.rs + router
- ~~Task 1.3: Release build script~~ — `6162c4e` scripts/build-release.ps1
- ~~Task 2.8: Daemon startup version check~~ — `6162c4e` reqwest + version check spawn
- ~~Compiler warnings~~ — `0d3091c` all warnings fixed
- ~~DB path~~ — `0d3091c` AppData resolution via dirs crate

---

## Phase 1: Release Binaries (remaining)

### Task 1.4: Desktop Daemon Lifecycle Management

**Context:** Desktop app must auto-start tastile-daemon.exe as a child process so users launch one app.

**Files:**
- Create: `tastile-desktop/src/TastileDesktop/Services/DaemonManager.cs`
- Modify: `tastile-desktop/src/TastileDesktop/MainWindow.xaml.cs`

**Step 1: Create DaemonManager service**

```csharp
// Services/DaemonManager.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

namespace TastileDesktop.Services;

public class DaemonManager : IDisposable
{
    private Process? _daemonProcess;
    private readonly string _daemonPath;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };

    public DaemonManager()
    {
        var appDir = AppContext.BaseDirectory;
        var localPath = Path.Combine(appDir, "tastile-daemon.exe");
        _daemonPath = File.Exists(localPath) ? localPath : "tastile-daemon.exe";
    }

    public async Task EnsureRunningAsync()
    {
        if (await IsHealthyAsync()) return;

        var psi = new ProcessStartInfo
        {
            FileName = _daemonPath,
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        try { _daemonProcess = Process.Start(psi); }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to start daemon: {ex.Message}");
            return;
        }

        for (int i = 0; i < 10; i++)
        {
            await Task.Delay(500);
            if (await IsHealthyAsync()) return;
        }
    }

    public async Task<bool> IsHealthyAsync()
    {
        try
        {
            var resp = await _http.GetAsync("http://localhost:3140/health");
            return resp.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    public void Dispose()
    {
        if (_daemonProcess is { HasExited: false })
        {
            _daemonProcess.Kill();
            _daemonProcess.Dispose();
        }
        _http.Dispose();
    }
}
```

**Step 2: Wire DaemonManager into MainWindow**

In `MainWindow.xaml.cs` constructor, before the timer starts:

```csharp
private readonly DaemonManager _daemonManager = new();
// In constructor: _ = _daemonManager.EnsureRunningAsync();
// On window close: _daemonManager.Dispose();
```

**Step 3: Build and verify**

Run: `cd tastile-desktop && dotnet build`
Expected: Build succeeds

**Step 4: Commit**

```bash
cd tastile-desktop
git add src/TastileDesktop/Services/DaemonManager.cs src/TastileDesktop/MainWindow.xaml.cs
git commit -m "feat: desktop auto-starts daemon as child process"
```

---

### Task 1.5: MSIX Packaging Configuration

**Context:** MSIX package bundles Desktop + daemon for Windows Store and direct download.

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/TastileDesktop.csproj`

**Step 1: Add packaging properties to csproj**

```xml
<PropertyGroup>
  <AppxPackage>true</AppxPackage>
  <AppxBundle>Never</AppxBundle>
  <AppxPackageSigningEnabled>false</AppxPackageSigningEnabled>
  <GenerateAppInstallerFile>false</GenerateAppInstallerFile>
</PropertyGroup>
```

**Step 2: Include daemon binary in package**

Add to csproj:
```xml
<ItemGroup>
  <Content Include="..\..\tastile-core\target\release\tastile-daemon.exe"
           Condition="Exists('..\..\tastile-core\target\release\tastile-daemon.exe')">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </Content>
</ItemGroup>
```

**Step 3: Test packaging**

Run: `dotnet publish -c Release -r win-x64`
Expected: Published output contains both TastileDesktop.exe and tastile-daemon.exe

**Step 4: Commit**

```bash
git add src/TastileDesktop/TastileDesktop.csproj
git commit -m "feat: MSIX packaging with bundled daemon"
```

---

## Phase 2: Web — Landing + Download + Legal

**Working directory:** `C:\Users\rebui\Desktop\tastile\tastile-web`

### Task 2.1: Fix Supabase Env Var Inconsistency

**Context:** Multiple files use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` but `.env.local.example` defines `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Standardize to match example.

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/components/providers/supabase-provider.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/middleware.ts`
- Modify: `src/app/auth/callback/route.ts`

**Step 1: Search and replace all occurrences**

```
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY → NEXT_PUBLIC_SUPABASE_ANON_KEY
```

**Step 2: Verify build**

Run: `bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A && git commit -m "fix: standardize Supabase env var to ANON_KEY"
```

---

### Task 2.2: Root Layout with Metadata

**Files:**
- Modify: `src/app/layout.tsx`

**Step 1: Update metadata and add SupabaseProvider**

```tsx
export const metadata: Metadata = {
  title: "Tastile — Execution Control",
  description: "Stop managing tasks. Start controlling execution.",
  metadataBase: new URL("https://tastile.app"),
};
```

Keep the existing Geist font setup. Add SupabaseProvider wrapper in body if needed for client components.

**Step 2: Commit**

```bash
git add src/app/layout.tsx && git commit -m "feat: update root layout metadata"
```

---

### Task 2.3: Landing Page

**Context:** Replace default Next.js template. High-contrast, minimal, text-focused.

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Build landing page**

Sections:
1. **Hero** — "Stop managing tasks. Start controlling execution." + CTAs (Download / Try Free)
2. **How It Works** — 3 steps: Create tiles → Execute → Review
3. **Pricing preview** — Free vs Pro summary, link to /pricing
4. **Footer** — Privacy, Terms, Pricing links

Use Tailwind utility classes. Dark mode support. No external images.

**Step 2: Verify**

Run: `bun dev` → check http://localhost:3000
Expected: Landing page renders

**Step 3: Commit**

```bash
git add src/app/page.tsx && git commit -m "feat: landing page"
```

---

### Task 2.4: Pricing Page

**Files:**
- Modify: `src/app/pricing/page.tsx`

**Step 1: Build pricing comparison**

Two-column layout:

| Free | Pro ($5/month) |
|---|---|
| Local execution control | Everything in Free |
| 100 local / 50 cloud tiles | 10,000 tiles |
| 30 day history | 2 year history |
| Web: status, prompt, memo | Cloud sync + Dashboard |
| | Condition vector editing |

CTA: "Get Started Free" → /login
CTA: "Upgrade to Pro" → /login (wired to Stripe in Phase 4)

**Step 2: Commit**

```bash
git add src/app/pricing/page.tsx && git commit -m "feat: pricing page"
```

---

### Task 2.5: Download Page

**Files:**
- Create: `src/app/download/page.tsx`

**Step 1: Build download page**

- "Download Tastile for Windows"
- Direct download button (placeholder URL)
- Microsoft Store badge (placeholder)
- Version: 0.1.0
- System requirements: Windows 10/11, x64
- "Or use on the web" → /login

**Step 2: Commit**

```bash
git add src/app/download/page.tsx && git commit -m "feat: download page"
```

---

### Task 2.6: Version Check API Route

**Files:**
- Create: `src/app/api/version/route.ts`

**Step 1: Create API route**

```typescript
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    latest: '0.1.0',
    download_url: 'https://tastile.app/download',
    required: false,
    release_notes: 'Initial release',
  })
}
```

**Step 2: Verify**

Run: `curl http://localhost:3000/api/version`
Expected: JSON with version info

**Step 3: Commit**

```bash
git add src/app/api/version/route.ts && git commit -m "feat: version check API"
```

---

### Task 2.7: Legal Pages

**Files:**
- Modify: `src/app/privacy/page.tsx`
- Modify: `src/app/terms/page.tsx`

**Step 1: Privacy policy**

Cover: data collected (email, usage), storage (Supabase), third parties (Stripe, Google), deletion rights.

**Step 2: Terms of service**

Cover: account terms, acceptable use, billing/refunds, liability, termination.

**Step 3: Commit**

```bash
git add src/app/privacy/page.tsx src/app/terms/page.tsx
git commit -m "feat: privacy policy and terms of service"
```

---

## Phase 3: Web — Free App (/app/*)

### Task 3.1: Supabase Schema — Plan Fields & Tier Enforcement

**Files:**
- Create: `supabase/migrations/20260314000001_add_plan_fields.sql`

**Step 1: Write migration**

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

-- Free: 50 cloud tiles, Pro: 10,000
CREATE OR REPLACE FUNCTION check_tile_limit()
RETURNS TRIGGER AS $$
DECLARE
  tile_count INTEGER;
  user_plan TEXT;
  max_tiles INTEGER;
BEGIN
  SELECT plan INTO user_plan FROM public.profiles WHERE id = NEW.user_id;
  max_tiles := CASE WHEN user_plan = 'pro' THEN 10000 ELSE 50 END;

  SELECT COUNT(*) INTO tile_count
    FROM public.tiles
    WHERE user_id = NEW.user_id AND deleted_at IS NULL;

  IF tile_count >= max_tiles THEN
    RAISE EXCEPTION 'Tile limit reached (% of %)', tile_count, max_tiles;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_tile_limit ON public.tiles;
CREATE TRIGGER enforce_tile_limit
  BEFORE INSERT ON public.tiles
  FOR EACH ROW EXECUTE FUNCTION check_tile_limit();

-- Pro only: event sync, 100,000 limit
CREATE OR REPLACE FUNCTION check_event_limit()
RETURNS TRIGGER AS $$
DECLARE
  event_count INTEGER;
  user_plan TEXT;
BEGIN
  SELECT plan INTO user_plan FROM public.profiles WHERE id = NEW.user_id;
  IF user_plan != 'pro' THEN
    RAISE EXCEPTION 'Event sync requires Pro plan';
  END IF;

  SELECT COUNT(*) INTO event_count FROM public.events WHERE user_id = NEW.user_id;
  IF event_count >= 100000 THEN
    RAISE EXCEPTION 'Event limit reached (100,000)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_event_limit ON public.events;
CREATE TRIGGER enforce_event_limit
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION check_event_limit();
```

**Step 2: Apply to Supabase** (manual via dashboard SQL editor)

**Step 3: Commit**

```bash
git add supabase/migrations/20260314000001_add_plan_fields.sql
git commit -m "feat: plan fields and tier enforcement triggers"
```

---

### Task 3.2: App Layout

**Files:**
- Create: `src/app/app/layout.tsx`

**Step 1: Create shared layout for /app/* routes**

Mobile-first. Top bar with "Tastile" + navigation (Now / Prompt / Memo). Max-width container.

**Step 2: Commit**

```bash
git add src/app/app/layout.tsx && git commit -m "feat: /app layout with navigation"
```

---

### Task 3.3: /app root redirect

**Files:**
- Modify: `src/app/app/page.tsx`

**Step 1: Redirect to /app/now**

```tsx
import { redirect } from 'next/navigation'
export default function AppPage() { redirect('/app/now') }
```

**Step 2: Commit**

```bash
git add src/app/app/page.tsx && git commit -m "feat: /app redirects to /app/now"
```

---

### Task 3.4: Supabase Query Helpers

**Files:**
- Create: `src/lib/supabase/queries.ts`

**Step 1: Create reusable query functions**

```typescript
import { SupabaseClient } from '@supabase/supabase-js'

export async function getTiles(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from('tiles')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(50)
  return data ?? []
}

export async function getUserPlan(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single()
  return data?.plan ?? 'free'
}
```

**Step 2: Commit**

```bash
git add src/lib/supabase/queries.ts && git commit -m "feat: Supabase query helpers"
```

---

### Task 3.5: /app/now — Execution Status

**Files:**
- Modify: `src/app/app/now/page.tsx`

**Step 1: Build execution status page**

Client component. Shows:
- Current tile list from Supabase (cloud tiles)
- Active tile with lifecycle state
- Create tile form (title, next_action, done_definition)
- Start / complete / defer buttons
- For web-only users, tile lifecycle is tracked directly in `tiles.temporal_conditions` JSONB

**Step 2: Verify**

Login → /app/now → create tile → start → complete
Expected: Full lifecycle works via Supabase

**Step 3: Commit**

```bash
git add src/app/app/now/page.tsx && git commit -m "feat: /app/now execution status"
```

---

### Task 3.6: /app/memo — Quick Memo

**Files:**
- Modify: `src/app/app/memo/page.tsx`

**Step 1: Build memo page**

Simple form: text input (auto-focus) + submit. Saves as a tile with `annotation_conditions.memo = true` or into a dedicated memos array. Show success feedback.

**Step 2: Commit**

```bash
git add src/app/app/memo/page.tsx && git commit -m "feat: /app/memo quick memo input"
```

---

### Task 3.7: /app/prompt — Prompt Response

**Files:**
- Modify: `src/app/app/prompt/page.tsx`

**Step 1: Build prompt page**

Shows pending prompts (e.g. "Tile running 25 min — continue or break?"). For web, prompts are derived from tile state (e.g. tile started > X minutes ago). Action buttons to respond.

**Step 2: Commit**

```bash
git add src/app/app/prompt/page.tsx && git commit -m "feat: /app/prompt response page"
```

---

## Phase 4: Stripe Billing

### Task 4.1: Stripe Server Utility

**Files:**
- Create: `src/lib/stripe.ts`

**Step 1: Create Stripe client + plan config**

```typescript
import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export const PLANS = {
  free: { name: 'Free', priceId: null },
  pro: { name: 'Pro', priceId: process.env.STRIPE_PRO_PRICE_ID! },
} as const
```

**Step 2: Update .env.local.example**

Add: `STRIPE_PRO_PRICE_ID=`, `NEXT_PUBLIC_APP_URL=https://tastile.app`, `SUPABASE_SERVICE_ROLE_KEY=`

**Step 3: Commit**

```bash
git add src/lib/stripe.ts .env.local.example
git commit -m "feat: Stripe server client and plan config"
```

---

### Task 4.2: Checkout Session API

**Files:**
- Create: `src/app/api/stripe/checkout/route.ts`

**Step 1: Create checkout endpoint**

POST → authenticate user → get/create Stripe customer → create Checkout Session → return URL.
On success redirect to `/dashboard/settings?billing=success`.
On cancel redirect to `/pricing?billing=cancelled`.

**Step 2: Commit**

```bash
git add src/app/api/stripe/checkout/route.ts
git commit -m "feat: Stripe checkout session API"
```

---

### Task 4.3: Webhook Handler

**Files:**
- Create: `src/app/api/stripe/webhook/route.ts`

**Step 1: Create webhook handler**

Verify `stripe-signature`. Handle:
- `customer.subscription.created/updated` → set `profiles.plan = 'pro'`
- `customer.subscription.deleted` → set `profiles.plan = 'free'`

Use `supabaseAdmin` (service role key) for writes.

**Step 2: Commit**

```bash
git add src/app/api/stripe/webhook/route.ts
git commit -m "feat: Stripe webhook for subscription lifecycle"
```

---

### Task 4.4: Customer Portal API

**Files:**
- Create: `src/app/api/stripe/portal/route.ts`

**Step 1: Create portal endpoint**

POST → authenticate → get `stripe_customer_id` → create portal session → return URL.

**Step 2: Commit**

```bash
git add src/app/api/stripe/portal/route.ts
git commit -m "feat: Stripe customer portal API"
```

---

### Task 4.5: Wire Pricing to Stripe

**Files:**
- Modify: `src/app/pricing/page.tsx`

**Step 1: Add checkout button**

"Upgrade to Pro" button calls `POST /api/stripe/checkout` and redirects to Stripe Checkout URL.

**Step 2: Commit**

```bash
git add src/app/pricing/page.tsx && git commit -m "feat: wire pricing to Stripe checkout"
```

---

### Task 4.6: Billing Page

**Files:**
- Modify: `src/app/dashboard/billing/page.tsx`

**Step 1: Build billing management**

Show current plan, usage stats (tile count / limit, event count / limit). "Manage Billing" button opens Stripe Customer Portal via `POST /api/stripe/portal`.

**Step 2: Commit**

```bash
git add src/app/dashboard/billing/page.tsx
git commit -m "feat: billing management page"
```

---

## Phase 5: Web — Pro Dashboard

### Task 5.1: Dashboard Layout + Pro Gate

**Files:**
- Create: `src/app/dashboard/layout.tsx`
- Modify: `src/middleware.ts`

**Step 1: Create dashboard layout**

Sidebar: Overview, Tiles, History, Settings, Billing. Server component.

**Step 2: Add Pro gate in middleware**

```typescript
if (request.nextUrl.pathname.startsWith('/dashboard')) {
  const { data: profile } = await supabase
    .from('profiles').select('plan').eq('id', user.id).single()
  if (profile?.plan !== 'pro') {
    return NextResponse.redirect(new URL('/pricing?upgrade=required', request.url))
  }
}
```

**Step 3: Commit**

```bash
git add src/app/dashboard/layout.tsx src/middleware.ts
git commit -m "feat: dashboard layout with Pro gate"
```

---

### Task 5.2: Dashboard Overview

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Step 1: Build overview**

Today's execution summary: tiles started/completed, total work time. Recent tiles (last 5). Quick actions.

**Step 2: Commit**

```bash
git add src/app/dashboard/page.tsx && git commit -m "feat: dashboard overview"
```

---

### Task 5.3: Tiles Management

**Files:**
- Modify: `src/app/dashboard/tiles/page.tsx`

**Step 1: Build tiles CRUD**

List all tiles with lifecycle filter. Create/edit/delete forms. Condition vector editing (temporal, objective, interruption, automation, annotation JSONB fields). Supabase Realtime for live updates.

**Step 2: Commit**

```bash
git add src/app/dashboard/tiles/page.tsx && git commit -m "feat: tiles management with CRUD"
```

---

### Task 5.4: History Page

**Files:**
- Modify: `src/app/dashboard/history/page.tsx`

**Step 1: Build history**

Event timeline from `events` table. Filter by date/tile/event type. Daily/weekly stats.

**Step 2: Commit**

```bash
git add src/app/dashboard/history/page.tsx && git commit -m "feat: execution history"
```

---

### Task 5.5: Settings Page

**Files:**
- Modify: `src/app/dashboard/settings/page.tsx`

**Step 1: Build settings**

Profile editing. Sync config. Plan info + usage. Link to billing.

**Step 2: Commit**

```bash
git add src/app/dashboard/settings/page.tsx && git commit -m "feat: settings page"
```

---

## Phase 6: Microsoft Store

### Task 6.1: Store Assets & Submission

**Files:**
- Create: `tastile-desktop/assets/` with placeholder logos
- Modify: `tastile-desktop/src/TastileDesktop/TastileDesktop.csproj` (publisher identity)

**Step 1: Generate placeholder assets (150x150, 310x150, 44x44)**

**Step 2: Configure Package.appxmanifest with Store identity**

**Step 3: Build signed MSIX**: `dotnet publish -c Release -r win-x64`

**Step 4: Submit to Microsoft Partner Center** (manual)

**Step 5: Commit**

```bash
git add assets/ src/TastileDesktop/ && git commit -m "feat: Store submission package"
```

---

## Dependency Graph

```
Phase 1 (Release Binaries)  ← mostly done, 2 tasks remain
Phase 2 (Web Public Pages)  ← independent, 7 tasks
Phase 3 (Free Web App)      ← depends on Phase 2
Phase 4 (Stripe)             ← depends on Phase 3.1 (schema)
Phase 5 (Pro Dashboard)      ← depends on Phase 4
Phase 6 (Store)              ← depends on Phase 1
```

**Phase 1 and 2 can run in parallel.**

## Environment Variables (complete)

### tastile-web/.env.local
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=https://tastile.app
```

### tastile-core (daemon)
```
TASTILE_DB=                    # optional, defaults to %LocalAppData%\tastile\tastile.db
SUPABASE_URL=                  # optional, for sync
SUPABASE_ANON_KEY=             # optional, for sync
USER_ID=                       # optional, for sync
TASTILE_UPDATE_URL=            # optional, defaults to tastile.app/api/version
```

## Total: 6 Phases, 22 Tasks
