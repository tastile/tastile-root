# Account Menu and Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add avatar menu with account settings, subscription management, tile statistics, and usage dashboard to dashboard header.

**Architecture:** Reuse existing AccountMenu component from /app directory, integrate into dashboard Header, create account settings page with multiple sections (profile, subscription, statistics, usage), add logout functionality.

**Tech Stack:** React 19, Next.js 15, TypeScript, Supabase (auth + data), Tailwind CSS v4, lucide-react icons

---

## Current State

- ✅ AccountMenu component exists (`src/app/app/account-menu.tsx`)
- ✅ Header has avatar display but no menu (`src/components/layout/Header.tsx`)
- ❌ No account settings page
- ❌ No subscription management UI
- ❌ No tile statistics display
- ❌ No usage dashboard

---

## Task 1: Integrate AccountMenu into Dashboard Header

**Files:**
- Modify: `src/components/layout/Header.tsx:105-110`

**Goal:** Replace static avatar with interactive AccountMenu component.

**Step 1: Import AccountMenu and required hooks**

Add imports to `src/components/layout/Header.tsx`:

```tsx
import { AccountMenu } from '@/app/app/account-menu'
```

**Step 2: Add user data state**

Add state after existing `avatarUrl` state (line 28):

```tsx
const [userData, setUserData] = useState<{
  displayName: string
  email: string
  plan: string
} | null>(null)
```

**Step 3: Update user data fetch**

Replace the existing `useEffect` (lines 30-45) with:

```tsx
useEffect(() => {
  const supabase = createClient()
  void supabase.auth.getUser().then(({ data, error }) => {
    if (error || !data.user) {
      setAvatarUrl(null)
      setUserData(null)
      return
    }

    const metadata = data.user.user_metadata
    const googleAvatar =
      (typeof metadata?.avatar_url === 'string' ? metadata.avatar_url : null) ??
      (typeof metadata?.picture === 'string' ? metadata.picture : null)

    setAvatarUrl(googleAvatar)
    setUserData({
      displayName: metadata?.full_name ?? metadata?.name ?? data.user.email?.split('@')[0] ?? 'User',
      email: data.user.email ?? '',
      plan: 'free', // TODO: Get from Supabase profiles table
    })
  })
}, [])
```

**Step 4: Replace avatar display with AccountMenu**

Replace lines 105-109:

```tsx
{userData ? (
  <AccountMenu
    displayName={userData.displayName}
    avatarUrl={avatarUrl}
    plan={userData.plan}
    email={userData.email}
    menuPlacement="down"
  />
) : (
  <div className="h-9 w-9 rounded-full bg-surface-2" aria-label="User avatar placeholder" />
)}
```

**Step 5: Test**

Run: `bun run build`
Expected: Builds successfully, no TypeScript errors

**Step 6: Commit**

```bash
git add src/components/layout/Header.tsx
git commit -m "feat(header): integrate AccountMenu with user data

Replace static avatar with interactive menu.

Changes:
- Add AccountMenu component to dashboard header
- Fetch user display name, email, plan from auth
- Show menu with Settings, Billing, Sign out options

Users can now access account actions from header.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Update AccountMenu Styling for Dashboard Theme

**Files:**
- Modify: `src/app/app/account-menu.tsx:44-131`

**Goal:** Replace hardcoded Tailwind dark mode classes with theme-aware CSS variables.

**Step 1: Update button styles**

Replace line 55:

```tsx
className="shrink-0 flex items-center gap-1.5 rounded-full px-1 focus:outline-none focus:ring-2 focus:ring-border-strong"
```

**Step 2: Update avatar placeholder**

Replace line 65:

```tsx
<div className="h-7 w-7 shrink-0 rounded-full bg-surface-2 flex items-center justify-center text-xs font-medium text-foreground">
```

**Step 3: Update menu container**

Replace line 77:

```tsx
className={`absolute ${menuPositionClass} w-64 rounded-xl border border-border bg-surface-elevated shadow-lg z-50 transition-all duration-200 ${
  open ? 'pointer-events-auto opacity-100 translate-y-0 scale-100' : 'pointer-events-none opacity-0 translate-y-1 scale-95'
}`}
```

**Step 4: Update menu sections**

Replace line 81 (header section):

```tsx
<div className="p-4 border-b border-border">
```

Replace line 91 (avatar placeholder in menu):

```tsx
<div className="h-10 w-10 shrink-0 rounded-full bg-surface-2 flex items-center justify-center text-sm font-medium text-foreground">
```

Replace line 96 (user info):

```tsx
<p className="text-sm font-medium text-foreground truncate">{displayName}</p>
<p className="text-xs text-foreground-muted truncate">{email}</p>
```

Replace lines 101-107 (plan badge):

```tsx
<span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
  plan === 'pro'
    ? 'bg-primary text-primary-fg'
    : 'bg-surface-2 text-foreground-muted'
}`}>
  {plan === 'pro' ? 'Pro' : 'Free'}
</span>
```

Replace lines 113-116 (menu items):

```tsx
<a
  href="/dashboard/settings"
  className="block px-4 py-2 text-sm text-foreground hover:bg-surface-1"
>
  Account settings
</a>
<a
  href={plan === 'pro' ? '/dashboard/billing' : '/pricing'}
  className="block px-4 py-2 text-sm text-foreground hover:bg-surface-1"
>
  {plan === 'pro' ? 'Billing' : 'Upgrade to Pro'}
</a>
```

Replace line 126 (sign out button):

```tsx
<button
  onClick={handleSignOut}
  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-surface-1"
>
  Sign out
</button>
```

**Step 5: Test**

Run: `bun run build`
Test: Toggle themes and verify menu colors adapt correctly

**Step 6: Commit**

```bash
git add src/app/app/account-menu.tsx
git commit -m "style(menu): update AccountMenu to use theme CSS variables

Replace hardcoded Tailwind dark mode classes with theme-aware variables.

Changes:
- Use bg-surface-* instead of bg-zinc-*
- Use text-foreground* instead of text-zinc-*
- Use border-border instead of border-zinc-*
- Menu now adapts to all 3 themes (light/gray/dark)

Ensures visual consistency with dashboard theme system.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Account Settings Page Structure

**Files:**
- Create: `src/app/dashboard/account/page.tsx`

**Goal:** Create account settings page with tab navigation for different sections.

**Step 1: Create account page**

Create `src/app/dashboard/account/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils/cn'

type TabId = 'profile' | 'subscription' | 'statistics' | 'usage'

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'statistics', label: 'Statistics' },
  { id: 'usage', label: 'Usage' },
]

export default function AccountPage() {
  const [activeTab, setActiveTab] = useState<TabId>('profile')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Account Settings</h1>

      {/* Tab Navigation */}
      <div className="border-b border-border">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "pb-3 text-sm font-medium transition-colors relative",
                activeTab === tab.id
                  ? "text-foreground"
                  : "text-foreground-muted hover:text-foreground"
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="rounded-xl bg-surface-elevated p-6">
        {activeTab === 'profile' && (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Profile</h2>
            <p className="text-foreground-muted">Profile settings coming soon...</p>
          </div>
        )}

        {activeTab === 'subscription' && (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
            <p className="text-foreground-muted">Subscription management coming soon...</p>
          </div>
        )}

        {activeTab === 'statistics' && (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Statistics</h2>
            <p className="text-foreground-muted">Tile statistics coming soon...</p>
          </div>
        )}

        {activeTab === 'usage' && (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Usage Dashboard</h2>
            <p className="text-foreground-muted">Usage dashboard coming soon...</p>
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Update AccountMenu link**

Modify `src/app/app/account-menu.tsx` line 113:

```tsx
<a
  href="/dashboard/account"
  className="block px-4 py-2 text-sm text-foreground hover:bg-surface-1"
>
  Account settings
</a>
```

**Step 3: Test**

Run: `bun run build`
Navigate: http://localhost:3000/dashboard/account
Expected: Page loads, tabs switch correctly

**Step 4: Commit**

```bash
git add src/app/dashboard/account/page.tsx src/app/app/account-menu.tsx
git commit -m "feat(account): create account settings page with tab navigation

Add account settings page structure with 4 sections.

Changes:
- Create /dashboard/account page
- Add tab navigation (Profile, Subscription, Statistics, Usage)
- Update AccountMenu link to point to new page
- Placeholder content for each tab

Foundation for account management features.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Tile Statistics Display

**Files:**
- Create: `src/components/account/TileStatistics.tsx`
- Modify: `src/app/dashboard/account/page.tsx`

**Goal:** Display tile count statistics (total, completed, completion rate).

**Step 1: Create TileStatistics component**

Create `src/components/account/TileStatistics.tsx`:

```tsx
'use client'

import { useExecutionEngine } from '@/lib/hooks/use-execution-engine'
import { getTileLifecycle } from '@/lib/domain/tile'
import { Skeleton } from '@/components/ui/Skeleton'

export function TileStatistics() {
  const { state, loading } = useExecutionEngine()

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-lg bg-surface-1 p-4">
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
    )
  }

  const tiles = Array.from(state.tiles.values())
  const totalCount = tiles.length
  const completedCount = tiles.filter(tile => getTileLifecycle(tile) === 'done').length
  const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const stats = [
    { label: 'Total Tiles', value: totalCount, color: 'text-foreground' },
    { label: 'Completed', value: completedCount, color: 'text-green-600' },
    { label: 'Completion Rate', value: `${completionRate}%`, color: 'text-primary' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg bg-surface-1 border border-border p-4">
            <p className="text-sm text-foreground-muted mb-1">{stat.label}</p>
            <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-surface-1 border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Breakdown by Status</h3>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">Ready</span>
            <span className="font-medium text-foreground">
              {tiles.filter(t => getTileLifecycle(t) === 'ready').length}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">Started</span>
            <span className="font-medium text-foreground">
              {tiles.filter(t => getTileLifecycle(t) === 'started').length}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">Done</span>
            <span className="font-medium text-foreground">
              {completedCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Integrate into account page**

Modify `src/app/dashboard/account/page.tsx` - add import:

```tsx
import { TileStatistics } from '@/components/account/TileStatistics'
```

Replace statistics tab content (around line 56):

```tsx
{activeTab === 'statistics' && (
  <div>
    <h2 className="text-lg font-semibold text-foreground mb-4">Tile Statistics</h2>
    <TileStatistics />
  </div>
)}
```

**Step 3: Test**

Run: `bun run build`
Navigate: /dashboard/account → Statistics tab
Expected: Shows tile counts and completion rate

**Step 4: Commit**

```bash
git add src/components/account/TileStatistics.tsx src/app/dashboard/account/page.tsx
git commit -m "feat(account): add tile statistics display

Show tile counts and completion metrics.

Changes:
- Create TileStatistics component
- Display total, completed, completion rate
- Show breakdown by status (ready/started/done)
- Integrate into account settings Statistics tab

Users can now track tile usage metrics.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Subscription Management Section

**Files:**
- Create: `src/components/account/SubscriptionSection.tsx`
- Modify: `src/app/dashboard/account/page.tsx`

**Goal:** Display subscription plan, billing info, and upgrade/cancel options.

**Step 1: Create SubscriptionSection component**

Create `src/components/account/SubscriptionSection.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/Skeleton'
import { BUTTON_STYLES } from '@/lib/styles/button-styles'
import { cn } from '@/lib/utils/cn'

export function SubscriptionSection() {
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<'free' | 'pro'>('free')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id)
        // TODO: Fetch plan from profiles table
        setPlan('free')
      }
      setLoading(false)
    })
  }, [])

  async function handleManageBilling() {
    // Redirect to Stripe customer portal
    const response = await fetch('/api/stripe/portal', {
      method: 'POST',
    })
    const { url } = await response.json()
    window.location.href = url
  }

  async function handleUpgrade() {
    // Redirect to Stripe checkout
    const response = await fetch('/api/stripe/checkout', {
      method: 'POST',
    })
    const { url } = await response.json()
    window.location.href = url
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-32" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <div className="rounded-lg bg-surface-1 border border-border p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-1">Current Plan</h3>
            <p className="text-2xl font-bold text-primary mb-2">
              {plan === 'pro' ? 'Pro' : 'Free'}
            </p>
            <p className="text-sm text-foreground-muted">
              {plan === 'pro'
                ? 'Full access to all features'
                : 'Limited to 100 tiles'}
            </p>
          </div>
          {plan === 'pro' ? (
            <span className="inline-block text-xs font-medium px-3 py-1 rounded-full bg-primary text-primary-fg">
              Active
            </span>
          ) : (
            <span className="inline-block text-xs font-medium px-3 py-1 rounded-full bg-surface-2 text-foreground-muted">
              Free Tier
            </span>
          )}
        </div>
      </div>

      {/* Features Comparison */}
      <div className="rounded-lg bg-surface-1 border border-border p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Plan Features</h3>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">Tile Limit</span>
            <span className="font-medium text-foreground">
              {plan === 'pro' ? 'Unlimited' : '100 tiles'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">Realtime Sync</span>
            <span className="font-medium text-foreground">
              {plan === 'pro' ? 'Enabled' : 'Enabled'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">AI Integrations</span>
            <span className="font-medium text-foreground">
              {plan === 'pro' ? 'Enabled' : 'Coming soon'}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {plan === 'pro' ? (
          <button
            onClick={handleManageBilling}
            className={cn(
              BUTTON_STYLES.base,
              BUTTON_STYLES.variants.secondary,
              BUTTON_STYLES.sizes.md
            )}
          >
            Manage Billing
          </button>
        ) : (
          <button
            onClick={handleUpgrade}
            className={cn(
              BUTTON_STYLES.base,
              BUTTON_STYLES.variants.primary,
              BUTTON_STYLES.sizes.md
            )}
          >
            Upgrade to Pro
          </button>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Integrate into account page**

Modify `src/app/dashboard/account/page.tsx` - add import:

```tsx
import { SubscriptionSection } from '@/components/account/SubscriptionSection'
```

Replace subscription tab content (around line 49):

```tsx
{activeTab === 'subscription' && (
  <div>
    <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
    <SubscriptionSection />
  </div>
)}
```

**Step 3: Test**

Run: `bun run build`
Navigate: /dashboard/account → Subscription tab
Expected: Shows plan info and upgrade/billing buttons

**Step 4: Commit**

```bash
git add src/components/account/SubscriptionSection.tsx src/app/dashboard/account/page.tsx
git commit -m "feat(account): add subscription management section

Display plan info and billing actions.

Changes:
- Create SubscriptionSection component
- Show current plan (Free/Pro) with status badge
- Display feature comparison
- Add Upgrade/Manage Billing buttons (Stripe integration)
- Integrate into account settings Subscription tab

Users can now manage their subscription.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Usage Dashboard (Future Enhancement)

**Files:**
- Create: `src/components/account/UsageDashboard.tsx`
- Modify: `src/app/dashboard/account/page.tsx`

**Goal:** Placeholder for usage dashboard with charts (future implementation).

**Step 1: Create UsageDashboard component**

Create `src/components/account/UsageDashboard.tsx`:

```tsx
'use client'

export function UsageDashboard() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface-1 border border-border p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Usage Overview</h3>
        <p className="text-foreground-muted text-sm mb-4">
          Usage dashboard with charts and graphs will be available soon.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-48 rounded-lg bg-surface-2 flex items-center justify-center">
            <p className="text-foreground-muted text-sm">Tiles Over Time</p>
          </div>
          <div className="h-48 rounded-lg bg-surface-2 flex items-center justify-center">
            <p className="text-foreground-muted text-sm">Completion Rate</p>
          </div>
          <div className="h-48 rounded-lg bg-surface-2 flex items-center justify-center">
            <p className="text-foreground-muted text-sm">Focus Time</p>
          </div>
          <div className="h-48 rounded-lg bg-surface-2 flex items-center justify-center">
            <p className="text-foreground-muted text-sm">Activity Heatmap</p>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Integrate into account page**

Modify `src/app/dashboard/account/page.tsx` - add import:

```tsx
import { UsageDashboard } from '@/components/account/UsageDashboard'
```

Replace usage tab content (around line 63):

```tsx
{activeTab === 'usage' && (
  <div>
    <h2 className="text-lg font-semibold text-foreground mb-4">Usage Dashboard</h2>
    <UsageDashboard />
  </div>
)}
```

**Step 3: Test**

Run: `bun run build`
Navigate: /dashboard/account → Usage tab
Expected: Shows placeholder dashboard with chart areas

**Step 4: Commit**

```bash
git add src/components/account/UsageDashboard.tsx src/app/dashboard/account/page.tsx
git commit -m "feat(account): add usage dashboard placeholder

Prepare structure for future charts and graphs.

Changes:
- Create UsageDashboard component
- Add placeholder areas for 4 charts
- Integrate into account settings Usage tab

Foundation for future analytics features.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Summary

**6 tasks total:**
1. Integrate AccountMenu into Dashboard Header (6 steps)
2. Update AccountMenu Styling for Dashboard Theme (6 steps)
3. Create Account Settings Page Structure (4 steps)
4. Add Tile Statistics Display (4 steps)
5. Add Subscription Management Section (4 steps)
6. Add Usage Dashboard Placeholder (4 steps)

**Estimated time:** 1-2 hours

**Features implemented:**
- ✅ Avatar menu in dashboard header
- ✅ Account settings page with tab navigation
- ✅ Tile statistics (total, completed, rate)
- ✅ Subscription management (plan, billing, upgrade)
- ✅ Usage dashboard structure (placeholder)
- ✅ Logout functionality
- ✅ Theme-aware styling

**Result:** Complete account management system accessible from header avatar menu.
