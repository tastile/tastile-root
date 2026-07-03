# PKCE OAuth Desktop Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use @superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement secure Google OAuth authentication for desktop app using PKCE flow with localhost callback (industry standard)

**Architecture:** Replace WebView2-based OAuth with system browser + local HTTP listener approach. Desktop app generates PKCE code verifier/challenge, opens system browser for Google consent, listens on localhost for callback, exchanges code for tokens via backend.

**Tech Stack:** WinUI 3, .NET 10, HttpListener (localhost callback), System.Security.Cryptography (PKCE), Supabase Auth

---

## Background: Why PKCE + Localhost?

| Approach | Security | User Experience | Google Policy |
|----------|----------|-----------------|---------------|
| WebView2 (current) | ❌ Poor (embedded browser) | ✅ Seamless | ❌ May be blocked |
| PKCE + localhost | ✅ Excellent (system browser) | ✅ Good (one click) | ✅ Recommended |
| Custom URI scheme | ⚠️ Medium | ✅ Seamless | ⚠️ Requires registration |

PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks. Required for OAuth 2.1 public clients like desktop apps.

---

## Task 1: Create PKCE Helper Class

**Files:**
- Create: `tastile-desktop/src/TastileDesktop/Services/PkceHelper.cs`

**Step 1: Write the code verifier generator**

```csharp
using System;
using System.Security.Cryptography;
using System.Text;

namespace TastileDesktop.Services;

/// <summary>
/// PKCE (Proof Key for Code Exchange) helper for OAuth 2.0.
/// Required for secure authentication in public clients (desktop apps).
/// </summary>
public static class PkceHelper
{
    /// <summary>
    /// Generate a cryptographically random code verifier (43-128 chars).
    /// </summary>
    public static string GenerateCodeVerifier(int length = 128)
    {
        // RFC 7636: code verifier must be 43-128 chars of [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
        var bytes = new byte[length];
        using (var rng = RandomNumberGenerator.Create())
        {
            rng.GetBytes(bytes);
        }
        var sb = new StringBuilder(length);
        foreach (var b in bytes)
        {
            sb.Append(chars[b % chars.Length]);
        }
        return sb.ToString();
    }

    /// <summary>
    /// Generate code challenge from verifier using SHA-256 (S256 method).
    /// </summary>
    public static string GenerateCodeChallenge(string codeVerifier)
    {
        using (var sha256 = SHA256.Create())
        {
            var bytes = Encoding.ASCII.GetBytes(codeVerifier);
            var hash = sha256.ComputeHash(bytes);
            return Base64UrlEncode(hash);
        }
    }

    /// <summary>
    /// Base64 URL-safe encoding (no padding, no +/, replace with -_).
    /// </summary>
    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}
```

**Step 2: Build to verify no errors**

Run: `cd tastile-desktop/src/TastileDesktop && dotnet build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Services/PkceHelper.cs
git commit -m "feat(auth): add PKCE helper for OAuth security"
```

---

## Task 2: Create Local OAuth Server

**Files:**
- Create: `tastile-desktop/src/TastileDesktop/Services/LocalOAuthServer.cs`

**Step 1: Implement HTTP listener for localhost callback**

```csharp
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;

namespace TastileDesktop.Services;

/// <summary>
/// Local HTTP server to receive OAuth callback on localhost.
/// Implements PKCE flow for secure desktop authentication.
/// </summary>
public class LocalOAuthServer : IDisposable
{
    private HttpListener? _listener;
    private TaskCompletionSource<OAuthCallbackResult> _tcs = new();
    private CancellationTokenSource _cts = new();
    private readonly string _expectedState;

    public int Port { get; private set; }
    public string RedirectUri => $"http://localhost:{Port}/auth/callback";

    public LocalOAuthServer(string expectedState)
    {
        _expectedState = expectedState;
    }

    /// <summary>
    /// Start the local server on an available port.
    /// </summary>
    public void Start()
    {
        // Find an available port
        Port = FindAvailablePort();
        
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://localhost:{Port}/");
        _listener.Start();
        
        Debug.WriteLine($"OAuth server listening on {RedirectUri}");
        
        // Start listening for requests
        _ = ListenAsync();
    }

    /// <summary>
    /// Wait for OAuth callback with timeout.
    /// </summary>
    public async Task<OAuthCallbackResult> WaitForCallbackAsync(TimeSpan timeout)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
        cts.CancelAfter(timeout);
        
        try
        {
            return await _tcs.Task.WaitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            return new OAuthCallbackResult 
            { 
                Success = false, 
                Error = "Authentication timed out. Please try again." 
            };
        }
    }

    private async Task ListenAsync()
    {
        try
        {
            while (!_cts.Token.IsCancellationRequested)
            {
                var context = await _listener!.GetContextAsync().WaitAsync(_cts.Token);
                _ = ProcessRequestAsync(context);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected when cancelled
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"OAuth server error: {ex.Message}");
            _tcs.TrySetException(ex);
        }
    }

    private async Task ProcessRequestAsync(HttpListenerContext context)
    {
        var request = context.Request;
        var response = context.Response;
        
        try
        {
            var url = request.Url!;
            var path = url.AbsolutePath;
            
            if (path == "/auth/callback")
            {
                // Parse query parameters
                var query = ParseQueryString(url.Query);
                
                query.TryGetValue("code", out var code);
                query.TryGetValue("state", out var state);
                query.TryGetValue("error", out var error);
                query.TryGetValue("error_description", out var errorDescription);

                // Validate state parameter (CSRF protection)
                if (state != _expectedState)
                {
                    await SendResponseAsync(response, 400, "Invalid state parameter.");
                    _tcs.TrySetResult(new OAuthCallbackResult 
                    { 
                        Success = false, 
                        Error = "Invalid state parameter (CSRF attack detected)." 
                    });
                    return;
                }

                if (!string.IsNullOrEmpty(error))
                {
                    await SendResponseAsync(response, 400, $"Authentication failed: {errorDescription ?? error}");
                    _tcs.TrySetResult(new OAuthCallbackResult 
                    { 
                        Success = false, 
                        Error = errorDescription ?? error 
                    });
                    return;
                }

                if (!string.IsNullOrEmpty(code))
                {
                    // Success! Send success page to browser
                    await SendSuccessResponseAsync(response);
                    _tcs.TrySetResult(new OAuthCallbackResult 
                    { 
                        Success = true, 
                        Code = code 
                    });
                }
                else
                {
                    await SendResponseAsync(response, 400, "Missing authorization code.");
                    _tcs.TrySetResult(new OAuthCallbackResult 
                    { 
                        Success = false, 
                        Error = "No authorization code received." 
                    });
                }
            }
            else
            {
                response.StatusCode = 404;
                response.Close();
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Error processing request: {ex.Message}");
            response.StatusCode = 500;
            response.Close();
        }
    }

    private async Task SendResponseAsync(HttpListenerResponse response, int statusCode, string message)
    {
        response.StatusCode = statusCode;
        response.ContentType = "text/html; charset=utf-8";
        
        var html = $@"<!DOCTYPE html>
<html>
<head><title>Authentication</title></head>
<body style='font-family: sans-serif; text-align: center; padding: 50px;'>
    <h1>{(statusCode == 200 ? "✓ Success" : "✗ Error")}</h1>
    <p>{message}</p>
    <p style='color: #666; margin-top: 30px;'>You can close this window and return to the app.</p>
</body>
</html>";
        
        var buffer = System.Text.Encoding.UTF8.GetBytes(html);
        response.ContentLength64 = buffer.Length;
        await response.OutputStream.WriteAsync(buffer);
        response.Close();
    }

    private async Task SendSuccessResponseAsync(HttpListenerResponse response)
    {
        response.StatusCode = 200;
        response.ContentType = "text/html; charset=utf-8";
        
        var html = @"<!DOCTYPE html>
<html>
<head>
    <title>Authentication Successful</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #1a1a2e; color: #fff; }
        .success { color: #4CAF50; font-size: 64px; margin-bottom: 20px; }
        h1 { margin-bottom: 10px; }
        p { color: #aaa; }
    </style>
</head>
<body>
    <div class='success'>✓</div>
    <h1>Authentication Successful</h1>
    <p>You have successfully signed in to Tastile.</p>
    <p>You can close this window and return to the application.</p>
</body>
</html>";
        
        var buffer = System.Text.Encoding.UTF8.GetBytes(html);
        response.ContentLength64 = buffer.Length;
        await response.OutputStream.WriteAsync(buffer);
        response.Close();
    }

    private static Dictionary<string, string> ParseQueryString(string query)
    {
        var result = new Dictionary<string, string>();
        if (string.IsNullOrEmpty(query)) return result;
        
        var queryString = query.TrimStart('?');
        var pairs = queryString.Split('&');
        
        foreach (var pair in pairs)
        {
            var parts = pair.Split('=', 2);
            if (parts.Length == 2)
            {
                var key = Uri.UnescapeDataString(parts[0]);
                var value = Uri.UnescapeDataString(parts[1]);
                result[key] = value;
            }
        }
        
        return result;
    }

    private static int FindAvailablePort()
    {
        // Try ports in the ephemeral range
        var random = new Random();
        for (int i = 0; i < 100; i++)
        {
            var port = random.Next(10000, 65000);
            try
            {
                using var listener = new HttpListener();
                listener.Prefixes.Add($"http://localhost:{port}/");
                listener.Start();
                listener.Stop();
                return port;
            }
            catch { /* Port in use, try another */ }
        }
        throw new InvalidOperationException("Could not find an available port");
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener?.Stop();
        _listener?.Close();
        _cts.Dispose();
    }
}

/// <summary>
/// OAuth callback result from localhost server.
/// </summary>
public class OAuthCallbackResult
{
    public bool Success { get; set; }
    public string? Code { get; set; }
    public string? Error { get; set; }
}
```

**Step 2: Build to verify**

Run: `cd tastile-desktop/src/TastileDesktop && dotnet build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Services/LocalOAuthServer.cs
git commit -m "feat(auth): add local OAuth server for PKCE flow"
```

---

## Task 3: Update CoreApiClient with PKCE Endpoints

**Files:**
- Modify: `tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs`

**Step 1: Add Supabase PKCE OAuth methods**

Add these methods to CoreApiClient class:

```csharp
    /// <summary>
    /// Exchange authorization code for tokens using PKCE.
    /// </summary>
    public async Task<AuthSession?> ExchangeCodeForTokensAsync(
        string code, 
        string codeVerifier, 
        string redirectUri)
    {
        try
        {
            var request = new 
            { 
                auth_code = code,
                code_verifier = codeVerifier,
                redirect_uri = redirectUri
            };
            
            var response = await _httpClient.PostAsJsonAsync("/auth/oauth/exchange", request);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<AuthSession>();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Token exchange failed: {ex.Message}");
            return null;
        }
    }
```

**Step 2: Build to verify**

Run: `dotnet build`
Expected: Success

**Step 3: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Services/CoreApiClient.cs
git commit -m "feat(auth): add PKCE token exchange endpoint"
```

---

## Task 4: Rewrite AuthWindow for PKCE Flow

**Files:**
- Rewrite: `tastile-desktop/src/TastileDesktop/Views/AuthWindow.xaml`
- Rewrite: `tastile-desktop/src/TastileDesktop/Views/AuthWindow.xaml.cs`

**Step 1: Simplify XAML - remove WebView2**

```xml
<Window
    x:Class="TastileDesktop.Views.AuthWindow"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:local="using:TastileDesktop.Views"
    xmlns:d="http://schemas.microsoft.com/expression/blend/2008"
    xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
    mc:Ignorable="d"
    Title="Sign in to Tastile"
    Width="400"
    Height="300">

    <Grid Background="{ThemeResource ApplicationPageBackgroundThemeBrush}">
        <StackPanel HorizontalAlignment="Center" VerticalAlignment="Center" Spacing="20">
            <!-- Loading indicator -->
            <ProgressRing IsActive="True" Width="48" Height="48"/>
            
            <TextBlock 
                Text="Waiting for authentication..." 
                Style="{StaticResource SubtitleTextBlockStyle}"
                HorizontalAlignment="Center"/>
            
            <TextBlock 
                Text="Please complete sign-in in your browser" 
                Foreground="{ThemeResource TextFillColorSecondaryBrush}"
                HorizontalAlignment="Center"/>
            
            <!-- Cancel button -->
            <Button 
                x:Name="CancelButton"
                Content="Cancel" 
                Click="OnCancelClick"
                HorizontalAlignment="Center"/>
        </StackPanel>
    </Grid>
</Window>
```

**Step 2: Rewrite code-behind for PKCE flow**

```csharp
using Microsoft.UI.Xaml;
using Microsoft.UI.Windowing;
using System;
using System.Diagnostics;
using System.Threading.Tasks;
using TastileDesktop.Services;

namespace TastileDesktop.Views;

/// <summary>
/// PKCE OAuth authentication window.
/// Opens system browser and waits for localhost callback.
/// </summary>
public sealed partial class AuthWindow : Window
{
    private readonly CoreApiClient _api;
    private readonly TaskCompletionSource<AuthResult> _tcs = new();
    private LocalOAuthServer? _oauthServer;
    private string? _codeVerifier;
    private string? _state;

    public Task<AuthResult> AuthResultTask => _tcs.Task;

    // Supabase configuration
    private const string SupabaseUrl = "https://cltymfzdhdnebazmayxd.supabase.co";
    private const string SupabaseAnonKey = "eyJhbGciOiJIUzI1NiIs..."; // Get from Supabase dashboard

    public AuthWindow(CoreApiClient api)
    {
        this.InitializeComponent();
        _api = api;

        // Set window size
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
        var appWindow = AppWindow.GetFromWindowId(windowId);
        appWindow.Resize(new Windows.Graphics.SizeInt32(400, 300));

        // Start authentication flow
        _ = StartAuthenticationAsync();
    }

    private async Task StartAuthenticationAsync()
    {
        try
        {
            // Generate PKCE parameters
            _codeVerifier = PkceHelper.GenerateCodeVerifier();
            var codeChallenge = PkceHelper.GenerateCodeChallenge(_codeVerifier);
            _state = Guid.NewGuid().ToString("N");

            // Start local OAuth server
            _oauthServer = new LocalOAuthServer(_state);
            _oauthServer.Start();

            // Build Supabase OAuth URL with PKCE
            var authUrl = BuildSupabaseAuthUrl(codeChallenge, _oauthServer.RedirectUri);

            // Open system browser
            Debug.WriteLine($"Opening browser: {authUrl}");
            OpenBrowser(authUrl);

            // Wait for callback (5 minute timeout)
            var callbackResult = await _oauthServer.WaitForCallbackAsync(TimeSpan.FromMinutes(5));

            if (!callbackResult.Success)
            {
                _tcs.SetResult(new AuthResult 
                { 
                    Success = false, 
                    Error = callbackResult.Error 
                });
                ShowError(callbackResult.Error ?? "Authentication failed");
                return;
            }

            // Exchange code for tokens
            var session = await _api.ExchangeCodeForTokensAsync(
                callbackResult.Code!, 
                _codeVerifier, 
                _oauthServer.RedirectUri);

            if (session != null)
            {
                _tcs.SetResult(new AuthResult 
                { 
                    Success = true, 
                    Code = callbackResult.Code 
                });
                DispatcherQueue.TryEnqueue(() => this.Close());
            }
            else
            {
                _tcs.SetResult(new AuthResult 
                { 
                    Success = false, 
                    Error = "Failed to exchange code for tokens" 
                });
                ShowError("Failed to complete authentication. Please try again.");
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Authentication error: {ex.Message}");
            _tcs.SetResult(new AuthResult 
            { 
                Success = false, 
                Error = ex.Message 
            });
            ShowError($"Authentication error: {ex.Message}");
        }
        finally
        {
            _oauthServer?.Dispose();
        }
    }

    private string BuildSupabaseAuthUrl(string codeChallenge, string redirectUri)
    {
        // Supabase OAuth with PKCE
        var queryParams = System.Web.HttpUtility.ParseQueryString(string.Empty);
        queryParams["provider"] = "google";
        queryParams["redirect_to"] = redirectUri;
        queryParams["code_challenge"] = codeChallenge;
        queryParams["code_challenge_method"] = "S256";
        queryParams["state"] = _state;

        return $"{SupabaseUrl}/auth/v1/authorize?{queryParams}";
    }

    private void OpenBrowser(string url)
    {
        var psi = new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true
        };
        Process.Start(psi);
    }

    private void ShowError(string message)
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            // Could show error dialog here
            Debug.WriteLine($"Auth error: {message}");
        });
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        _oauthServer?.Dispose();
        if (!_tcs.Task.IsCompleted)
        {
            _tcs.SetResult(new AuthResult 
            { 
                Success = false, 
                Error = "User cancelled" 
            });
        }
        this.Close();
    }
}

/// <summary>
/// OAuth authentication result
/// </summary>
public class AuthResult
{
    public bool Success { get; set; }
    public string? Code { get; set; }
    public string? Error { get; set; }
}
```

**Step 3: Update csproj to remove WebView2 (if no longer needed elsewhere)**

Check if WebView2 is used elsewhere. If only for auth:

```bash
# In TastileDesktop.csproj, remove:
# <PackageReference Include="Microsoft.Web.WebView2" Version="1.0.3124.44" />
```

**Step 4: Build to verify**

Run: `dotnet build`
Expected: Success

**Step 5: Commit**

```bash
git add tastile-desktop/src/TastileDesktop/Views/AuthWindow.xaml
git add tastile-desktop/src/TastileDesktop/Views/AuthWindow.xaml.cs
git commit -m "feat(auth): implement PKCE OAuth flow with system browser"
```

---

## Task 5: Backend Rust Implementation (Required)

**Files:**
- Modify: `tastile-core/src/api/auth.rs` (or create new endpoint)

**Step 1: Add PKCE token exchange endpoint**

The Rust backend needs a new endpoint:

```rust
// POST /auth/oauth/exchange
// Request: { auth_code, code_verifier, redirect_uri }
// Response: AuthSession

pub async fn exchange_code_for_tokens(
    State(state): State<AppState>,
    Json(req): Json<OAuthExchangeRequest>,
) -> Result<Json<AuthSession>, ApiError> {
    let client = reqwest::Client::new();
    
    // Call Supabase to exchange code for tokens with PKCE
    let response = client
        .post(format!("{}/auth/v1/token?grant_type=authorization_code", state.supabase_url))
        .header("apikey", &state.supabase_anon_key)
        .json(&serde_json::json!({
            "auth_code": req.auth_code,
            "code_verifier": req.code_verifier,
            "redirect_uri": req.redirect_uri,
        }))
        .send()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    
    // Parse and return session
    let session: AuthSession = response
        .json()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    
    Ok(Json(session))
}
```

Note: The actual Supabase PKCE token endpoint details may vary. Need to check Supabase docs for exact API.

---

## Task 6: Update Supabase Redirect URLs

**Files:**
- Configuration: Supabase Dashboard

**Step 1: Add localhost redirect URL pattern**

In Supabase Dashboard → Authentication → URL Configuration:

Add to "Redirect URLs":
- `http://localhost:*/auth/callback` (if Supabase supports wildcards)
- OR: `http://localhost:10000/auth/callback` through `http://localhost:65000/auth/callback` (not practical)

Alternative: Use a fixed port range and register multiple URLs.

Better solution: Use `http://127.0.0.1:0/auth/callback` approach with dynamic port registration.

Note: Supabase may need exact redirect URI matching. If so, we need to:
1. Pick a fixed port (e.g., 10800)
2. Register `http://localhost:10800/auth/callback` in Supabase
3. Try to bind to that port, fail if taken

---

## Task 7: Test the Implementation

**Step 1: Test PKCE helper**

```csharp
// Unit test in TastileDesktop.Tests (if exists)
var verifier = PkceHelper.GenerateCodeVerifier();
var challenge = PkceHelper.GenerateCodeChallenge(verifier);
Assert.NotNull(verifier);
Assert.NotNull(challenge);
Assert.True(verifier.Length >= 43);
```

**Step 2: Integration test**

1. Run the app
2. Click "Sign In"
3. Verify system browser opens
4. Complete Google sign-in
5. Verify callback is received
6. Verify session is established

**Step 3: Error handling tests**

- Cancel authentication
- Let it timeout
- Use invalid state
- Network errors

---

## Summary

This implementation follows OAuth 2.1 best practices:
- ✅ PKCE prevents authorization code interception
- ✅ System browser is more secure than WebView2
- ✅ Localhost callback works reliably
- ✅ State parameter prevents CSRF

**Required before merge:**
1. Backend `/auth/oauth/exchange` endpoint
2. Supabase redirect URL configuration
3. End-to-end testing
