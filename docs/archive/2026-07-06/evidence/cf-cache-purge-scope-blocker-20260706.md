# CF cache:purge scope — manual re-auth required (2026-07-06)

## Status: BLOCKED on user action

`cf` CLI OAuth token in `~/.cf/config.toml` does NOT include `cache:purge`.
DNS edit works (scope present), cache purge returns 401.

## Reproduction

```
$ cf cache purge --body '{"files":["https://app.tastile.app/?test=1"]}' -z tastile.app --force

┌ APIError
│ [10000] Authentication error
│ 401 Unauthorized · POST /zones/4af3ad3398afe48ef5877b49117f7d97/purge_cache
└
```

## Current scope list (`~/.cf/config.toml`)

Token has 90+ scopes including:
- `dns_records:edit` ✅ (DNS works)
- `dns_records:read`
- `lb:edit` / `lb:read`
- `zone:read`
- (no `cache:purge`) ❌

## Why this can't be auto-fixed

OAuth refresh tokens grant the **same scopes** the user originally consented
to. To add `cache:purge`, the user must re-run the OAuth consent flow with the
new scope requested. This requires interactive `cf auth login` (opens browser)
or a fresh API token created in the Cloudflare dashboard.

I can't open a browser or navigate the dashboard.

## Two paths forward — user picks

### Path A — Re-auth via OAuth (keeps existing token, just expands scopes)

In a normal interactive shell (where browser opens work):

```
cf auth logout
cf auth login
# In the browser consent screen, ENSURE "Edit Cache Purge" is included
# (Cloudflare's "scope" picker — should be under Account → Cache Purge
#  OR Zone → Cache Purge, depending on whether you choose Account-scoped
#  or Zone-scoped permissions)
```

After login, verify:

```
cf cache purge --body '{"purge_everything":true}' -z tastile.app --dry-run
# should print a successful request without 401
```

The new token's scopes will include `cache:purge` (and any others you ticked).

### Path B — Create API Token in dashboard, swap to env var auth

1. Open https://dash.cloudflare.com/profile/api-tokens
2. **Create Token → Custom Token**
3. Permissions:
   - `Zone → Cache Purge: Edit`
   - `Zone → DNS: Edit`
   - `Account → Account Settings: Read` (for zone lookup)
4. Zone Resources: include `tastile.app` and `*.tastile.app`
5. TTL: indefinite (or rotate manually)
6. Copy the token (`cf_token_…` format)

Save the token:

```bash
# Linux/macOS
echo 'export CLOUDFLARE_API_TOKEN=cf_token_xxxxxxxxxxxxxxxxxxxxx' >> ~/.bashrc
echo 'export CLOUDFLARE_ZONE_ID=4af3ad3398afe48ef5877b49117f7d97' >> ~/.bashrc

# Windows PowerShell
[Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "cf_token_xxx", "User")
[Environment]::SetEnvironmentVariable("CLOUDFLARE_ZONE_ID", "4af3ad3398afe48ef5877b49117f7d97", "User")
```

Then verify:

```bash
cf cache purge --body '{"files":["https://app.tastile.app/?test=1"]}' -z tastile.app --force
```

The `cf` CLI auto-detects `CLOUDFLARE_API_TOKEN` env var and prefers it over
the OAuth token in `config.toml`.

## Recommended next step

**Path B (API Token)** for one-time setup. Cleaner than re-doing OAuth flow:

- No browser interaction needed after dashboard token creation
- Token can be scoped narrowly (cache:purge + dns:edit on `tastile.app` zone only)
- Doesn't carry the 90+ scopes of the OAuth user-token (smaller blast radius)
- Rotation is independent of user account

Save the token once, set the env var, then `cf cache purge` works for future
deploys. After a deploy, run:

```bash
cf cache purge --body '{"purge_everything":true}' -z tastile.app --force
```

This wipes the entire CF edge cache for the zone (acceptable since `tastile.app`
HTML is `Cache-Control: no-store` and only `_next/static/*` is cached, and
those are content-hashed).

## Fallback (no action needed)

Deploys work **without** cache:purge. After a deploy, CF edge cache propagates
naturally within ~30s. Users hitting a stale cache see broken styles for at
most 30s after a deploy. Acceptable for now; fix when convenient.