# Desktop Auth Diagnostics and Fix Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix desktop→core API authentication by adding diagnostic logging on both sides, fixing the connection status masking bug, and adding a token verification debug endpoint.

**Architecture:** The desktop authenticates directly with Cognito (PKCE code flow), gets an `id_token`, and sends it as `Authorization: Bearer <id_token>` to the core API. The core API's `require_auth` middleware verifies the JWT against Cognito's JWKS. Currently, verification failures are silently logged server-side and masked client-side (connection shows `True` even on 401). This plan adds visibility at both ends.

**Tech Stack:** C# / WinUI 3 (desktop), Rust / axum (core API)

---

## Task 1: Add API response status logging to desktop `GetJsonAsync`

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs:140-149`

**Step 1: Add status code logging to `GetJsonAsync<T>`**

In `GetJsonAsync<T>`, after getting the response, log the status code and (on error) the response body:

```csharp
private async Task<T?> GetJsonAsync<T>(string path, CancellationToken cancellationToken = default)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    using var response = await SendWithAuthAsync(_httpClient, request, cancellationToken);
    if (!response.IsSuccessStatusCode)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        Log($"[GetJsonAsync] {path} => {(int)response.StatusCode} {response.StatusCode} body={body}");
        return default;
    }
    return await response.Content.ReadFromJsonAsync<T>(cancellationToken: cancellationToken);
}
```

**Step 2: Add status code logging to `PostJsonAsync` (both overloads)**

Same pattern for POST requests — log status code and body on failure.

**Step 3: Build and verify**

Run: `dotnet build .\src\TastileDesktop\TastileDesktop.csproj -r win-x64`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs
git commit -m "feat(desktop): add API response status logging to GetJsonAsync and PostJsonAsync"
```

---

## Task 2: Fix `EventDrivenPoller` connection status detection

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Services/EventDrivenPoller.cs:104-194`
- Modify: `tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs:140-149`

**Problem:** `EventDrivenPoller.RefreshAsync` sets `connected = true` by default, and `GetJsonAsync<T>` returns `default` (null) on non-2xx without throwing. So `connected` stays `True` even when all API calls return 401.

**Step 1: Make `GetJsonAsync<T>` return a result wrapper instead of null-on-failure**

Add a simple result type to `CoreApiClient`:

```csharp
public record ApiResult<T>(T? Data, System.Net.HttpStatusCode? StatusCode, bool IsSuccess);
```

Change `GetJsonAsync<T>` to:

```csharp
private async Task<ApiResult<T>> GetJsonAsync<T>(string path, CancellationToken cancellationToken = default)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    using var response = await SendWithAuthAsync(_httpClient, request, cancellationToken);
    if (!response.IsSuccessStatusCode)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        Log($"[GetJsonAsync] {path} => {(int)response.StatusCode} {response.StatusCode} body={body}");
        return new ApiResult<T>(default, response.StatusCode, false);
    }
    var data = await response.Content.ReadFromJsonAsync<T>(cancellationToken: cancellationToken);
    return new ApiResult<T>(data, response.StatusCode, true);
}
```

**Step 2: Update all callers of `GetJsonAsync<T>` to use `.Data`**

Update `GetTilesAsync`, `GetExecutionViewAsync`, `GetPendingPromptAsync`, `GetTimelineForViewportAsync`, `GetTileQuotaAsync`, etc. to return `T?` by accessing `.Data`:

```csharp
public Task<ExecutionView?> GetExecutionViewAsync()
    => GetJsonResultAsync<ExecutionView>("/read/execution-view");

private async Task<T?> GetJsonResultAsync<T>(string path, CancellationToken ct = default)
{
    var result = await GetJsonAsync<T>(path, ct);
    return result.Data;
}
```

**Step 3: Update `EventDrivenPoller.RefreshAsync` to check `IsSuccess`**

```csharp
try
{
    var executionViewTask = _api.GetExecutionViewAsync();
    var tilesTask = _api.GetTilesAsync();
    var promptTask = _api.GetPendingPromptAsync();
    var timelineTask = _api.GetTimelineForViewportAsync(_timelineViewport);
    await Task.WhenAll(executionViewTask, tilesTask, promptTask, timelineTask);
    executionView = executionViewTask.Result;
    tiles = tilesTask.Result;
    prompt = promptTask.Result;
    timeline = timelineTask.Result;

    // If all results are null, the API is likely returning 401
    if (executionView is null && tiles is null && prompt is null && timeline is null)
    {
        connected = false;
    }
}
catch
{
    connected = false;
}
```

**Step 4: Build and verify**

Run: `dotnet build .\src\TastileDesktop\TastileDesktop.csproj -r win-x64`
Expected: BUILD SUCCESSFUL

**Step 5: Run tests**

Run: `dotnet test .\tests\TastileDesktop.Tests`
Expected: ALL PASS (update tests for new `ApiResult<T>` type)

**Step 6: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs tastile-desktop/src/TastileDesktop/Services/EventDrivenPoller.cs
git commit -m "fix(desktop): detect 401 as connection failure in EventDrivenPoller"
```

---

## Task 3: Add JWT verification failure logging to core API

**Files:**
- Modify: `tastile-core/crates/tastile-api/src/auth/cognito.rs:211-236`

**Problem:** When JWT verification fails, the error is logged at `warn` level but the specific failure reason (which claim check failed, JWKS fetch error, etc.) is not detailed enough.

**Step 1: Enhance `verify()` logging**

In `CognitoVerifier::verify()`, add detailed logging for each failure point:

```rust
pub async fn verify(&self, bearer: &str) -> Result<CognitoClaims, ApiError> {
    let header = decode_header(bearer)
        .map_err(|e| {
            tracing::warn!("[JWT] Header parse failed: {}", e);
            ApiError::Auth(format!("JWT header parse failed: {e}"))
        })?;

    let kid = header
        .kid
        .ok_or_else(|| {
            tracing::warn!("[JWT] Header missing 'kid' field");
            ApiError::Auth("JWT header missing 'kid'".to_string())
        })?;

    tracing::info!("[JWT] Verifying token with kid={}, issuer={}, audience={:?}",
        &kid[..kid.len().min(20)], self.issuer, self.client_ids);

    let key = self.get_key(&kid).await?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[self.issuer.as_str()]);
    validation.set_audience(&self.client_ids);

    let token_data = decode::<IdTokenClaims>(bearer, &key, &validation).map_err(|e| {
        tracing::warn!("[JWT] Verification failed: {}", e);
        ApiError::Auth(format!("JWT verification failed: {e}"))
    })?;

    tracing::info!("[JWT] Claims: sub={}, token_use={:?}, iss={:?}, aud={:?}",
        token_data.claims.sub,
        token_data.claims.token_use,
        token_data.claims.iss,
        token_data.claims.aud);

    validate_id_token_claims(&token_data.claims)?;

    Ok(CognitoClaims {
        sub: token_data.claims.sub,
        email: token_data.claims.email,
        exp: token_data.claims.exp as i64,
    })
}
```

**Step 2: Enhance `validate_id_token_claims()` logging**

```rust
fn validate_id_token_claims(claims: &IdTokenClaims) -> Result<(), ApiError> {
    match claims.token_use.as_deref() {
        Some("id") => {
            tracing::info!("[JWT] token_use='id' accepted");
            validate_non_password_only_auth(claims)
        }
        Some(other) => {
            tracing::warn!("[JWT] Rejected: token_use='{}' (expected 'id')", other);
            Err(ApiError::Auth(format!("unexpected Cognito token_use: {other}")))
        }
        None => {
            tracing::warn!("[JWT] Rejected: token_use is missing");
            Err(ApiError::Auth("missing Cognito token_use".into()))
        }
    }
}
```

**Step 3: Build and verify**

Run: `cargo build` in `tastile-core/`
Expected: BUILD SUCCESSFUL

**Step 4: Run tests**

Run: `cargo test` in `tastile-core/`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-api/src/auth/cognito.rs
git commit -m "feat(core): add detailed JWT verification failure logging"
```

---

## Task 4: Add token verification debug endpoint to core API

**Files:**
- Modify: `tastile-core/crates/tastile-api/src/handlers/auth_handlers.rs`
- Modify: `tastile-core/crates/tastile-api/src/router.rs`

**Step 1: Add `GET /auth/debug/token` handler**

This endpoint verifies the current Bearer token and returns the decoded claims. Useful for debugging auth issues.

```rust
#[derive(Debug, Serialize)]
pub struct TokenDebugResponse {
    pub valid: bool,
    pub sub: Option<String>,
    pub email: Option<String>,
    pub exp: Option<i64>,
    pub token_use: Option<String>,
    pub issuer: Option<String>,
    pub audience: Option<String>,
    pub error: Option<String>,
}

pub async fn debug_token(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<TokenDebugResponse>, ApiError> {
    let token = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(|| ApiError::Auth("No Bearer token".to_string()))?;

    match state.cognito_verifier().verify(token).await {
        Ok(claims) => Ok(Json(TokenDebugResponse {
            valid: true,
            sub: Some(claims.sub),
            email: claims.email,
            exp: Some(claims.exp),
            token_use: None, // Already validated
            issuer: None,
            audience: None,
            error: None,
        })),
        Err(e) => Ok(Json(TokenDebugResponse {
            valid: false,
            sub: None,
            email: None,
            exp: None,
            token_use: None,
            issuer: None,
            audience: None,
            error: Some(e.to_string()),
        })),
    }
}
```

**Step 2: Register the route in the auth (non-protected) section of the router**

```rust
.route("/auth/debug/token", get(handlers::debug_token))
```

**Step 3: Add a `GET /auth/debug/token/claims` endpoint that decodes without verification**

This is for cases where verification fails but we want to see what the token actually contains:

```rust
pub async fn debug_token_claims(
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(|| ApiError::Auth("No Bearer token".to_string()))?;

    // Decode without verification
    let claims = crate::auth::parse_jwt_claims(token)
        .map_err(|e| ApiError::Auth(format!("Failed to decode token: {e}")))?;

    Ok(Json(serde_json::json!({
        "decoded": claims,
        "note": "Claims decoded WITHOUT signature verification. For debugging only."
    })))
}
```

**Step 4: Register the route**

```rust
.route("/auth/debug/token/claims", get(handlers::debug_token_claims))
```

**Step 5: Build and verify**

Run: `cargo build` in `tastile-core/`
Expected: BUILD SUCCESSFUL

**Step 6: Commit**

```bash
git add tastile-core/crates/tastile-api/src/handlers/auth_handlers.rs tastile-core/crates/tastile-api/src/router.rs
git commit -m "feat(core): add /auth/debug/token endpoints for auth diagnostics"
```

---

## Task 5: Add token debug test to desktop

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs`
- Modify: `tests/TastileDesktop.Tests/CoreApiClientTests.cs`

**Step 1: Add `DebugTokenAsync` method to `CoreApiClient`**

```csharp
public async Task<JsonElement?> DebugTokenAsync()
{
    try
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/auth/debug/token");
        using var response = await SendWithAuthAsync(_httpClient, request);
        var body = await response.Content.ReadAsStringAsync();
        Log($"[DebugTokenAsync] Status={(int)response.StatusCode} body={body}");
        if (!response.IsSuccessStatusCode) return null;
        return JsonDocument.Parse(body).RootElement;
    }
    catch (Exception ex)
    {
        Log($"[DebugTokenAsync] Exception: {ex.Message}");
        return null;
    }
}
```

**Step 2: Call `DebugTokenAsync` on startup after auth**

In `App.xaml.cs` or `MainViewModel.cs`, after successful auth, call `DebugTokenAsync` and log the result. This helps verify the token is valid before any API calls.

**Step 3: Build and verify**

Run: `dotnet build .\src\TastileDesktop\TastileDesktop.csproj -r win-x64`
Expected: BUILD SUCCESSFUL

**Step 4: Run tests**

Run: `dotnet test .\tests\TastileDesktop.Tests`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs tests/TastileDesktop.Tests/CoreApiClientTests.cs
git commit -m "feat(desktop): add token debug endpoint call for auth diagnostics"
```

---

## Task 6: Fix concurrent refresh race condition

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs:86-117`

**Problem:** When 4 parallel API calls all get 401, they all try to refresh simultaneously. If Cognito has token revocation enabled, only the first refresh succeeds; the other 3 fail because the refresh token was already revoked.

**Step 1: Add a semaphore to serialize refresh attempts**

```csharp
private static readonly SemaphoreSlim _refreshLock = new(1, 1);

private async Task<HttpResponseMessage> SendWithAuthAsync(
    HttpClient client,
    HttpRequestMessage request,
    CancellationToken cancellationToken = default)
{
    await AttachBearerAsync(request);

    var response = await client.SendAsync(request, cancellationToken);
    if (response.StatusCode != HttpStatusCode.Unauthorized || _refreshTokens is null)
    {
        return response;
    }

    // 401 → serialize refresh attempts to avoid revocation race
    response.Dispose();
    TastileDesktop.Models.AuthSession? refreshed = null;
    await _refreshLock.WaitAsync(cancellationToken);
    try
    {
        // Double-check: another request may have refreshed already
        var currentToken = await _getAccessToken?.Invoke();
        if (!string.IsNullOrEmpty(currentToken))
        {
            // Token was refreshed by another request, retry with it
            var retry = new HttpRequestMessage(request.Method, request.RequestUri);
            if (request.Content is not null) retry.Content = request.Content;
            retry.Headers.Authorization = new AuthenticationHeaderValue("Bearer", currentToken);
            return await client.SendAsync(retry, cancellationToken);
        }
        refreshed = await _refreshTokens();
    }
    finally
    {
        _refreshLock.Release();
    }

    if (refreshed is null)
    {
        return new HttpResponseMessage(HttpStatusCode.Unauthorized)
        {
            Content = new StringContent("token refresh failed"),
        };
    }

    var retryWithRefresh = new HttpRequestMessage(request.Method, request.RequestUri);
    if (request.Content is not null) retryWithRefresh.Content = request.Content;
    retryWithRefresh.Headers.Authorization = new AuthenticationHeaderValue("Bearer", refreshed.IdToken);
    return await client.SendAsync(retryWithRefresh, cancellationToken);
}
```

**Step 2: Build and verify**

Run: `dotnet build .\src\TastileDesktop\TastileDesktop.csproj -r win-x64`
Expected: BUILD SUCCESSFUL

**Step 3: Run tests**

Run: `dotnet test .\tests\TastileDesktop.Tests`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs
git commit -m "fix(desktop): serialize token refresh to avoid Cognito revocation race"
```

---

## Task 7: Add `TASTILE_REQUIRE_NON_PASSWORD_AUTH` bypass for desktop testing

**Files:**
- Modify: `tastile-core/crates/tastile-api/src/auth/cognito.rs:249-277`

**Problem:** If `TASTILE_REQUIRE_NON_PASSWORD_AUTH=1` is set on the production API, desktop users without WebAuthn/passkey will always get "password-only authentication is not allowed". We need a way to allow specific users.

**Step 1: Add user allowlist check to `validate_non_password_only_auth`**

```rust
fn validate_non_password_only_auth(claims: &IdTokenClaims) -> Result<(), ApiError> {
    if !require_non_password_auth() {
        return Ok(());
    }

    // Allow specific users via allowlist (bypasses non-password requirement)
    let allowed_subs = parse_csv_env("TASTILE_NON_PASSWORD_AUTH_ALLOWED_SUBS");
    if !allowed_subs.is_empty() && allowed_subs.iter().any(|allowed| allowed == &claims.sub) {
        tracing::info!(user_sub = %claims.sub, "User in non-password auth allowlist, bypassing check");
        return Ok(());
    }

    let methods: Vec<&str> = claims
        .amr
        .iter()
        .chain(claims.cognito_amr.iter())
        .map(String::as_str)
        .collect();

    if methods.iter().any(|method| is_non_password_auth_method(method)) {
        return Ok(());
    }

    if methods.is_empty() {
        tracing::warn!(user_sub = %claims.sub, amr = ?claims.amr, cognito_amr = ?claims.cognito_amr,
            "Rejected: empty AMR chain");
        return Err(ApiError::Auth(
            "non-password authentication evidence is required".into(),
        ));
    }

    tracing::warn!(user_sub = %claims.sub, amr = ?claims.amr, cognito_amr = ?claims.cognito_amr,
        "Rejected: password-only authentication");
    Err(ApiError::Auth(
        "password-only authentication is not allowed".into(),
    ))
}
```

**Step 2: Add the `parse_csv_env` import if not already available**

The function already exists in `router.rs`. We need to either:
- Make it `pub(crate)` in `router.rs` and import it in `cognito.rs`
- Or duplicate it in `cognito.rs`
- Or move it to a shared utility module

Best approach: move `parse_csv_env` to a shared location (e.g., `lib.rs` or a new `util.rs`).

**Step 3: Build and verify**

Run: `cargo build` in `tastile-core/`
Expected: BUILD SUCCESSFUL

**Step 4: Run tests**

Run: `cargo test` in `tastile-core/`
Expected: ALL PASS (add test for the allowlist bypass)

**Step 5: Commit**

```bash
git add tastile-core/crates/tastile-api/src/auth/cognito.rs
git commit -m "feat(core): add TASTILE_NON_PASSWORD_AUTH_ALLOWED_SUBS allowlist for desktop testing"
```

---

## Verification Steps

After all tasks are complete:

1. **Deploy core API** with the new logging and debug endpoints
2. **Build desktop** with diagnostic logging
3. **Run desktop** and check `%TEMP%\tastile-desktop.log` for:
   - `[GetJsonAsync] /read/execution-view => 401 ...` (shows the actual error)
   - `[DebugTokenAsync]` output (shows if token is valid)
4. **Check core API logs** for:
   - `[JWT] Verifying token with kid=...` (shows verification attempt)
   - `[JWT] Claims: sub=..., token_use=...` (shows decoded claims)
   - Any `[JWT] Rejected:` messages (shows why verification failed)
5. **If token_use is wrong**: The desktop is sending an access_token instead of id_token
6. **If iss/aud mismatch**: The core API env vars don't match the Cognito config
7. **If JWKS fetch fails**: Network issue between API server and Cognito
8. **If non-password auth required**: Set `TASTILE_NON_PASSWORD_AUTH_ALLOWED_SUBS` with the user's sub

## Expected Outcome

After this plan, we will have:
- Full visibility into why tokens are rejected (server-side logs)
- Full visibility into API responses (client-side logs)
- A debug endpoint to test token validity without modifying the core auth flow
- A fix for the connection status masking bug
- A fix for the concurrent refresh race condition
- An allowlist mechanism for desktop users without WebAuthn
