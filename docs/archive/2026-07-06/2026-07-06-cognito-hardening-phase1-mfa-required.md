# Cognito MFA-Required Sign-In Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AWS Cognito で MFA 必須 (TOTP) 認証を有効化し、`https://app.tastile.app/auth/email` のサインインが **TOTP 入力なしには完了しない** 状態を 7/8 (明後日) までに運用環境に立ち上げる。

**Architecture (2026-07-06 Pivoted):**
- Cognito User Pool の `MfaConfiguration=ON` + `SoftwareTokenMfa=enabled` + SMS MFA 無効化 + `AllowedFirstAuthFactors=["PASSWORD"]` で PASSWORD+TOTP 必須
- **EMAIL_OTP は Cognito 制約により第一因子から除外** (MFA=ON 時のみ PASSWORD/WEB_AUTHN 許可)。EMAIL_OTP を MFA 因子として復活させる Phase 2 では Custom Challenge Lambda が必要
- TOTP 列挙/検証は Cognito 組み込み (`AssociateSoftwareToken` / `VerifySoftwareToken`) を使う
- サインイン flow: `email + password` 入力 → Cognito が password 検証 → MFA_SETUP (初回) または SOFTWARE_TOKEN_MFA (2回目以降) を返す → `/auth/mfa-setup` または `/auth/email/verify?mode=software_token_mfa` で TOTP 検証 → tokens 発行
- Web app の `/auth/email` page を password 入力付きに変更。`startEmailOtpSignIn` を `startPasswordSignIn` に rename し、password + MFA_SETUP/SOFTWARE_TOKEN_MFA チャレンジを返す
- 既存の `app.tastile.app` 環境へデプロイし、7/8 までに E2E (signup → confirm → MFA setup → sign-in) を user-flow Playwright で確認

**重要:** Sign-up flow も password 必須に変更 (`/auth/email/signup`)。既存の `rebuild.up.up@gmail.com` (Google 連携) は Hosted UI 経由でこれまで通り sign-in 可能。

**Tech Stack:**
- AWS Cognito (ap-northeast-1, pool `ap-northeast-1_buh6oWoQ2`)
- AWS CLI v2 (`aws cognito-idp`)
- Next.js 14+ App Router (`tastile-web`)
- TypeScript (Node 20)
- vitest for unit tests (`tastile-web/vitest.config.ts` 既存)
- `@playwright/test` for E2E

---

## Phase 1: MFA-Required Auth Live by 2026-07-08

### Task 1: Verify Cognito User Pool Tier is Plus

**Files:**
- Read-only: `tastile-core/.env.product` (確認用)

- [ ] **Step 1.1: Read current Tier from AWS**

Run:
```bash
aws cognito-idp describe-user-pool \
  --user-pool-id ap-northeast-1_buh6oWoQ2 \
  --region ap-northeast-1 \
  --query 'UserPool.Tier'
```

Expected: `"PLUS"`.

- [ ] **Step 1.2: If Tier is `LITE`, request upgrade via console**

This cannot be done via CLI. Open https://ap-northeast-1.console.aws.amazon.com/cognito/v2/idp/user-pools/ap-northeast-1_buh6oWoQ2?region=ap-northeast-1#/user-pool-general-settings/overview → "Edit" → set tier to Plus → save.

Expected: Billing alert shows Plus tier.

- [ ] **Step 1.3: Re-verify Tier with CLI**

Run same command as 1.1. Expected: `"PLUS"`.

- [ ] **Step 1.4: Commit (config note)**

No code change, but write the verification result to a commit note:
```bash
git commit --allow-empty -m "infra: confirm Cognito User Pool Tier=PLUS for MFA-required auth"
```

### Task 2: Enable MFA=ON with TOTP only on the user pool

**Files:**
- Read-only: `tastile-core/.env.product`

- [ ] **Step 2.1: Build update command**

Run:
```bash
aws cognito-idp set-user-pool-mfa-config \
  --user-pool-id ap-northeast-1_buh6oWoQ2 \
  --region ap-northeast-1 \
  --mfa-configuration ON,SOFTWARE_TOKEN_MFA=true,SMS_MFA=false \
  --sms-mfa-configuration '{"SmsAuthenticationMessage":"","SmsConfiguration":{}}'
```

Expected: returns 200 OK JSON (or no output on success).

- [ ] **Step 2.2: Verify via describe**

Run:
```bash
aws cognito-idp get-user-pool-mfa-config \
  --user-pool-id ap-northeast-1_buh6oWoQ2 \
  --region ap-northeast-1
```

Expected output:
```json
{
  "SmsMfaConfiguration": null,
  "SoftwareTokenMfaConfiguration": { "Enabled": true },
  "MfaConfiguration": "ON",
  "AdaptiveAuthenticationConfiguration": { ... }
}
```

`MfaConfiguration` should be `"ON"`.

- [ ] **Step 2.3: Probe: an existing Google user gets MFA_SETUP challenge**

Run:
```bash
aws cognito-idp admin-initiate-auth \
  --user-pool-id ap-northeast-1_buh6oWoQ2 \
  --client-id 3f14cs42nkc0v3qf6k57gthlfe \
  --region ap-northeast-1 \
  --auth-flow USER_AUTH \
  --auth-parameters '{"USERNAME":"rebuild.up.up@gmail.com"}'
```

Expected: returns a `Session` token and `ChallengeName` of `PASSWORD_SRP` or `EMAIL_OTP` (one of the first factors).

Note: Google-federated users can't fully proceed in admin-initiate-auth because they're external providers; that's fine — we're verifying the pool state accepts MFA=ON, not that this specific user can use PASSWORD_SRP end-to-end.

- [ ] **Step 2.4: Commit (config)**

```bash
git commit --allow-empty -m "infra: enable TOTP MFA on tastile-v1-users; SMS MFA disabled"
```

### Task 3: Extend `cognitoRequest` to surface MFA challenge names

**Files:**
- Read: `tastile-web/src/lib/cognito/public-client.ts`
- Test: `tastile-web/src/lib/cognito/public-client.test.ts` (create if missing)

- [ ] **Step 3.1: Write a failing vitest**

Create `tastile-web/src/lib/cognito/public-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { startEmailOtpSignIn, AuthChallenge } from "./public-client";

const env = {
  region: "ap-northeast-1",
  clientId: "test-client",
  userPoolId: "test-pool",
  issuer: "https://example.com",
  jwksUrl: "https://example.com/.well-known/jwks.json",
};

describe("startEmailOtpSignIn", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("returns MFA_SETUP challenge when Cognito requires TOTP enrollment", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ChallengeName: "MFA_SETUP",
            Session: "test-session-mfa-setup",
          }),
        ),
    });

    const result = await startEmailOtpSignIn(env, "test@example.com");
    expect(result.challengeName).toBe("MFA_SETUP");
    expect(result.session).toBe("test-session-mfa-setup");
  });

  it("returns SOFTWARE_TOKEN_MFA challenge for returning TOTP users", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ChallengeName: "SOFTWARE_TOKEN_MFA",
            Session: "test-session-totp",
          }),
        ),
    });

    const result = await startEmailOtpSignIn(env, "test@example.com");
    expect(result.challengeName).toBe("SOFTWARE_TOKEN_MFA");
    expect(result.session).toBe("test-session-totp");
  });

  it("returns EMAIL_OTP challenge for first-factor-only users (no MFA)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ChallengeName: "EMAIL_OTP",
            Session: "test-session-email-otp",
          }),
        ),
    });

    const result = await startEmailOtpSignIn(env, "test@example.com");
    expect(result.challengeName).toBe("EMAIL_OTP");
    expect(result.session).toBe("test-session-email-otp");
  });

  it("returns PASSWORD_SRP challenge as first-factor fallback", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ChallengeName: "PASSWORD_SRP",
            Session: "test-session-password-srp",
          }),
        ),
    });

    const result = await startEmailOtpSignIn(env, "test@example.com");
    expect(result.challengeName).toBe("PASSWORD_SRP");
    expect(result.session).toBe("test-session-password-srp");
  });

  it("throws when challenge name is not handled", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ChallengeName: "SMS_MFA",
            Session: "irrelevant",
          }),
        ),
    });

    await expect(startEmailOtpSignIn(env, "test@example.com")).rejects.toThrow(
      /Email OTP sign-in is not available/,
    );
  });
});
```

- [ ] **Step 3.2: Run the failing tests**

Run:
```bash
cd tastile-web && bunx vitest run src/lib/cognito/public-client.test.ts
```

Expected: FAIL with "Cannot find name 'AuthChallenge'" or similar (because the type doesn't exist yet).

- [ ] **Step 3.3: Update `public-client.ts` to expose `AuthChallenge` type and handle MFA**

Modify `tastile-web/src/lib/cognito/public-client.ts`:

1. Replace the existing `EmailOtpStartResult` type with a broader `AuthChallenge`:

```typescript
export type AuthChallenge =
  | "EMAIL_OTP"
  | "PASSWORD_SRP"
  | "MFA_SETUP"
  | "SOFTWARE_TOKEN_MFA"
  | "SELECT_CHALLENGE";

export type EmailOtpStartResult = {
  session: string;
  challengeName: AuthChallenge;
};
```

2. Update `startEmailOtpSignIn` to return new challenge names:

```typescript
const HANDLED: ReadonlyArray<AuthChallenge> = [
  "EMAIL_OTP",
  "PASSWORD_SRP",
  "MFA_SETUP",
  "SOFTWARE_TOKEN_MFA",
];

export async function startEmailOtpSignIn(
  env: CognitoEnv,
  email: string,
): Promise<EmailOtpStartResult> {
  const initial = await cognitoRequest(env, "InitiateAuth", {
    AuthFlow: "USER_AUTH",
    ClientId: env.clientId,
    AuthParameters: {
      USERNAME: email,
    },
  });

  const cn = initial.ChallengeName;
  if (typeof cn === "string" && HANDLED.includes(cn as AuthChallenge)) {
    if (typeof initial.Session !== "string") {
      throw new CognitoPublicError(
        `Cognito returned ${cn} without a session`,
        "MISSING_SESSION",
      );
    }
    return { session: initial.Session, challengeName: cn as AuthChallenge };
  }

  if (cn === "SELECT_CHALLENGE" && typeof initial.Session === "string") {
    const selected = await cognitoRequest(env, "RespondToAuthChallenge", {
      ClientId: env.clientId,
      ChallengeName: "SELECT_CHALLENGE",
      Session: initial.Session,
      ChallengeResponses: {
        USERNAME: email,
        ANSWER: "EMAIL_OTP",
      },
    });
    const scn = selected.ChallengeName;
    if (typeof scn === "string" && HANDLED.includes(scn as AuthChallenge)) {
      if (typeof selected.Session !== "string") {
        throw new CognitoPublicError(
          `Cognito selected ${scn} without a session`,
          "MISSING_SESSION",
        );
      }
      return { session: selected.Session, challengeName: scn as AuthChallenge };
    }
  }

  throw new CognitoPublicError(
    "Email OTP sign-in is not available for this user.",
    "EMAIL_OTP_UNAVAILABLE",
  );
}
```

Note the change: removed `PREFERRED_CHALLENGE: "EMAIL_OTP"` from the InitiateAuth call so the user can choose any first factor. With MFA=ON and PASSWORD_SRP being first factor, we don't want to force EMAIL_OTP.

- [ ] **Step 3.4: Re-run vitest, expect PASS**

Run:
```bash
cd tastile-web && bunx vitest run src/lib/cognito/public-client.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 3.5: Run typecheck**

Run:
```bash
cd tastile-web && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3.6: Commit**

```bash
git add tastile-web/src/lib/cognito/public-client.ts tastile-web/src/lib/cognito/public-client.test.ts
git commit -m "feat(cognito-public): handle MFA_SETUP and SOFTWARE_TOKEN_MFA challenge names"
```

### Task 4: Update `/auth/email/start/route.ts` to route MFA challenges

**Files:**
- Modify: `tastile-web/src/app/auth/email/start/route.ts`

- [ ] **Step 4.1: Write failing test for the route**

Create `tastile-web/src/app/auth/email/start/route.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/cognito/public-client", () => ({
  startEmailOtpSignIn: vi.fn(),
  CognitoPublicError: class extends Error {
    constructor(public override message: string, public readonly code: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/cognito/env", () => ({
  tryGetCognitoEnv: () => ({
    region: "ap-northeast-1",
    clientId: "test",
    userPoolId: "test",
    issuer: "https://example.com",
    jwksUrl: "https://example.com/jwks",
  }),
}));

import { startEmailOtpSignIn } from "@/lib/cognito/public-client";
import {
  COOKIE_EMAIL_AUTH_SESSION,
  COOKIE_EMAIL_AUTH_USERNAME,
} from "@/lib/cognito/cookies";

describe("POST /auth/email/start", () => {
  it("redirects to /auth/mfa-setup when MFA_SETUP challenge is returned", async () => {
    (startEmailOtpSignIn as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session: "sess-mfa-setup",
      challengeName: "MFA_SETUP",
    });

    const request = new Request("https://app.tastile.app/auth/email/start", {
      method: "POST",
      body: new URLSearchParams({ email: "test@example.com" }),
    });
    const response = await POST(request as never);

    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toContain("/auth/mfa-setup");
    expect(location).toContain("email=test%40example.com");
  });

  it("redirects to /auth/email/verify with mfa param when SOFTWARE_TOKEN_MFA challenge is returned", async () => {
    (startEmailOtpSignIn as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session: "sess-totp",
      challengeName: "SOFTWARE_TOKEN_MFA",
    });

    const request = new Request("https://app.tastile.app/auth/email/start", {
      method: "POST",
      body: new URLSearchParams({ email: "test@example.com" }),
    });
    const response = await POST(request as never);

    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toContain("/auth/email/verify");
    expect(location).toContain("mode=software_token_mfa");
  });
});
```

- [ ] **Step 4.2: Run, expect FAIL**

Run:
```bash
cd tastile-web && bunx vitest run src/app/auth/email/start/route.test.ts
```

Expected: FAIL (test asserts `/auth/mfa-setup` but route currently redirects to `/auth/email/verify`).

- [ ] **Step 4.3: Update the route handler**

Modify `tastile-web/src/app/auth/email/start/route.ts` to route based on challenge name:

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { COOKIE_EMAIL_AUTH_SESSION, COOKIE_EMAIL_AUTH_USERNAME } from "@/lib/cognito/cookies";
import { tryGetCognitoEnv } from "@/lib/cognito/env";
import { normalizeEmail } from "@/lib/cognito/form";
import { safeOAuthRedirectUri, safePkceValue } from "@/lib/cognito/login-url";
import { CognitoPublicError, startEmailOtpSignIn } from "@/lib/cognito/public-client";
import { getCognitoPublicOrigin } from "@/lib/cognito/public-origin";

export async function POST(request: NextRequest) {
  const env = tryGetCognitoEnv();
  const origin = getCognitoPublicOrigin(env?.callbackUrl);
  if (!env) return NextResponse.redirect(`${origin}/login?error=cognito_not_configured`, 303);

  const form = await request.formData();
  const email = normalizeEmail(form.get("email"));
  const redirectUri = safeOAuthRedirectUri(
    form.get("redirect_uri")?.toString() ?? null,
    env.callbackUrl,
  );
  const state = safePkceValue(form.get("state")?.toString() ?? null);
  const codeChallenge = safePkceValue(form.get("code_challenge")?.toString() ?? null);
  const desktopQuery =
    redirectUri === "tastile://auth/callback" && state
      ? buildDesktopQuery(redirectUri, state, codeChallenge)
      : "";
  if (!email)
    return NextResponse.redirect(`${origin}/auth/email?error=missing_email${desktopQuery}`, 303);

  try {
    const started = await startEmailOtpSignIn(env, email);
    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: 600,
    };

    let targetPath: string;
    let query: string;
    switch (started.challengeName) {
      case "MFA_SETUP":
        targetPath = "/auth/mfa-setup";
        query = `email=${encodeURIComponent(email)}`;
        break;
      case "SOFTWARE_TOKEN_MFA":
        targetPath = "/auth/email/verify";
        query = `email=${encodeURIComponent(email)}&mode=software_token_mfa`;
        break;
      case "PASSWORD_SRP":
        targetPath = "/auth/email/verify";
        query = `email=${encodeURIComponent(email)}&mode=password_srp`;
        break;
      case "EMAIL_OTP":
      default:
        targetPath = "/auth/email/verify";
        query = `email=${encodeURIComponent(email)}`;
        break;
    }

    const response = NextResponse.redirect(
      `${origin}${targetPath}?${query}${desktopQuery}`,
      303,
    );
    response.cookies.set(COOKIE_EMAIL_AUTH_SESSION, started.session, options);
    response.cookies.set(COOKIE_EMAIL_AUTH_USERNAME, email, options);
    return response;
  } catch (error) {
    if (error instanceof CognitoPublicError && error.code === "UserNotConfirmedException") {
      return NextResponse.redirect(
        `${origin}/auth/confirm?email=${encodeURIComponent(email)}&error=not_confirmed${desktopQuery}`,
        303,
      );
    }
    if (error instanceof CognitoPublicError && error.code === "EMAIL_OTP_UNAVAILABLE") {
      const loginQuery =
        redirectUri === "tastile://auth/callback" && state && codeChallenge
          ? `?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}`
          : "";
      return NextResponse.redirect(`${origin}/auth/cognito/login${loginQuery}`, 303);
    }
    console.error("Email OTP start failed", error);
    return NextResponse.redirect(
      `${origin}/auth/email?email=${encodeURIComponent(email)}&error=otp_unavailable${desktopQuery}`,
      303,
    );
  }
}

function buildDesktopQuery(
  redirectUri: string,
  s: string,
  codeChallenge: string | null,
): string {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    state: s,
  });
  if (codeChallenge) params.set("code_challenge", codeChallenge);
  return `?${params.toString()}`;
}
```

- [ ] **Step 4.4: Run, expect PASS**

Run:
```bash
cd tastile-web && bunx vitest run src/app/auth/email/start/route.test.ts
```

- [ ] **Step 4.5: Typecheck**

Run:
```bash
cd tastile-web && bunx tsc --noEmit
```

- [ ] **Step 4.6: Commit**

```bash
git add tastile-web/src/app/auth/email/start/route.ts tastile-web/src/app/auth/email/start/route.test.ts
git commit -m "feat(auth): route MFA_SETUP and SOFTWARE_TOKEN_MFA challenges to dedicated pages"
```

### Task 5: Add `/auth/mfa-setup` server-side handler for `AssociateSoftwareToken`

**Files:**
- Create: `tastile-web/src/lib/cognito/associate-software-token.ts`
- Test: `tastile-web/src/lib/cognito/associate-software-token.test.ts`

- [ ] **Step 5.1: Write failing test**

Create `tastile-web/src/lib/cognito/associate-software-token.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { associateSoftwareToken } from "./associate-software-token";

const env = {
  region: "ap-northeast-1",
  clientId: "client-abc",
  userPoolId: "pool-abc",
  issuer: "https://example.com",
  jwksUrl: "https://example.com/.well-known/jwks.json",
};

describe("associateSoftwareToken", () => {
  it("posts to Cognito and returns secretCode + session", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            SecretCode: "ABCDEFGHSECRET12345",
            Session: "session-xyz",
          }),
        ),
    });

    const result = await associateSoftwareToken(env, "incoming-session");
    expect(result.secretCode).toBe("ABCDEFGHSECRET12345");
    expect(result.session).toBe("session-xyz");
  });

  it("throws on Cognito error", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(JSON.stringify({ __type: "InvalidParameterException", message: "bad session" })),
    });

    await expect(associateSoftwareToken(env, "bad")).rejects.toThrow(/bad session/);
  });
});
```

- [ ] **Step 5.2: Run, expect FAIL**

Run:
```bash
cd tastile-web && bunx vitest run src/lib/cognito/associate-software-token.test.ts
```

- [ ] **Step 5.3: Implement**

Create `tastile-web/src/lib/cognito/associate-software-token.ts`:

```typescript
import type { CognitoEnv } from "./env";
import { cognitoRequest } from "./public-client";

export type AssociateSoftwareTokenResult = {
  secretCode: string;
  session: string;
};

export async function associateSoftwareToken(
  env: CognitoEnv,
  session: string,
): Promise<AssociateSoftwareTokenResult> {
  const response = await cognitoRequest(env, "AssociateSoftwareToken", {
    Session: session,
  });

  const secretCode = typeof response.SecretCode === "string" ? response.SecretCode : "";
  const newSession = typeof response.Session === "string" ? response.Session : session;
  if (!secretCode) {
    throw new Error("Cognito did not return a SecretCode");
  }
  return { secretCode, session: newSession };
}
```

- [ ] **Step 5.4: Run, expect PASS**

Run same as 5.2.

- [ ] **Step 5.5: Commit**

```bash
git add tastile-web/src/lib/cognito/associate-software-token.ts tastile-web/src/lib/cognito/associate-software-token.test.ts
git commit -m "feat(cognito): add AssociateSoftwareToken helper for TOTP setup"
```

### Task 6: Add `verifySoftwareToken` helper

**Files:**
- Create: `tastile-web/src/lib/cognito/verify-software-token.ts`
- Test: same dir test

- [ ] **Step 6.1: Write failing test**

Create `tastile-web/src/lib/cognito/verify-software-token.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { verifySoftwareToken } from "./verify-software-token";

const env = {
  region: "ap-northeast-1",
  clientId: "client-abc",
  userPoolId: "pool-abc",
  issuer: "https://example.com",
  jwksUrl: "https://example.com/.well-known/jwks.json",
};

describe("verifySoftwareToken", () => {
  it("returns CognitoAuthTokens on success", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            AuthenticationResult: {
              IdToken: "id-token-xyz",
              AccessToken: "access-token-xyz",
              RefreshToken: "refresh-token-xyz",
              ExpiresIn: 3600,
            },
          }),
        ),
    });

    const result = await verifySoftwareToken(env, "session-1", "123456");
    expect(result.idToken).toBe("id-token-xyz");
    expect(result.accessToken).toBe("access-token-xyz");
    expect(result.refreshToken).toBe("refresh-token-xyz");
  });

  it("returns MFA_SETUP challenge when Cognito says so", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            ChallengeName: "MFA_SETUP",
            Session: "continue-session",
          }),
        ),
    });

    const result = await verifySoftwareToken(env, "session-1", "000000");
    expect(result.challengeName).toBe("MFA_SETUP");
    expect(result.session).toBe("continue-session");
    expect(result.idToken).toBe("");
  });

  it("throws on CodeMismatch", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(JSON.stringify({ __type: "CodeMismatchException", message: "Bad code" })),
    });

    await expect(verifySoftwareToken(env, "session", "111111")).rejects.toThrow(/Bad code/);
  });
});
```

- [ ] **Step 6.2: Run, expect FAIL**

Run:
```bash
cd tastile-web && bunx vitest run src/lib/cognito/verify-software-token.test.ts
```

- [ ] **Step 6.3: Implement**

Create `tastile-web/src/lib/cognito/verify-software-token.ts`:

```typescript
import type { CognitoEnv } from "./env";
import { cognitoRequest } from "./public-client";

export type VerifySoftwareTokenResult = {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  challengeName?: string;
  session?: string;
};

export async function verifySoftwareToken(
  env: CognitoEnv,
  session: string,
  code: string,
): Promise<VerifySoftwareTokenResult> {
  const response = await cognitoRequest(env, "VerifySoftwareToken", {
    Session: session,
    UserCode: code,
    FriendlyDeviceName: "tastile-web",
  });

  // VerifySoftwareToken returns ChallengeName=MFA_SETUP if a confirmation challenge is still pending,
  // otherwise returns AuthenticationResult with tokens.
  if (
    response.ChallengeName === "MFA_SETUP" &&
    typeof response.Session === "string"
  ) {
    return {
      idToken: "",
      accessToken: "",
      refreshToken: null,
      expiresIn: 0,
      challengeName: "MFA_SETUP",
      session: response.Session,
    };
  }

  const result = response.AuthenticationResult as
    | {
        IdToken?: unknown;
        AccessToken?: unknown;
        RefreshToken?: unknown;
        ExpiresIn?: unknown;
      }
    | undefined;

  return {
    idToken: typeof result?.IdToken === "string" ? result.IdToken : "",
    accessToken: typeof result?.AccessToken === "string" ? result.AccessToken : "",
    refreshToken: typeof result?.RefreshToken === "string" ? result.RefreshToken : null,
    expiresIn: typeof result?.ExpiresIn === "number" ? result.ExpiresIn : 0,
  };
}
```

- [ ] **Step 6.4: Run, expect PASS**

Run same as 6.2.

- [ ] **Step 6.5: Commit**

```bash
git add tastile-web/src/lib/cognito/verify-software-token.ts tastile-web/src/lib/cognito/verify-software-token.test.ts
git commit -m "feat(cognito): add VerifySoftwareToken helper"
```

### Task 7: API endpoint `POST /api/account/mfa/setup`

**Files:**
- Create: `tastile-web/src/app/api/account/mfa/setup/route.ts`
- Test: same dir test

- [ ] **Step 7.1: Write failing test**

Create `tastile-web/src/app/api/account/mfa/setup/route.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/cognito/env", () => ({
  tryGetCognitoEnv: () => ({
    region: "ap-northeast-1",
    clientId: "c",
    userPoolId: "p",
    issuer: "https://example.com",
    jwksUrl: "https://example.com/jwks",
  }),
}));

vi.mock("@/lib/cognito/associate-software-token", () => ({
  associateSoftwareToken: vi.fn(),
}));
vi.mock("@/lib/cognito/cookies", () => ({
  COOKIE_EMAIL_AUTH_SESSION: "tastile_mfa_session",
}));

import { associateSoftwareToken } from "@/lib/cognito/associate-software-token";

describe("POST /api/account/mfa/setup", () => {
  it("returns 400 if no mfa session cookie", async () => {
    const request = new Request("https://app.tastile.app/api/account/mfa/setup", {
      method: "POST",
    });
    const response = await POST(request as never);
    expect(response.status).toBe(400);
  });

  it("returns SecretCode JSON on success", async () => {
    (associateSoftwareToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      secretCode: "SECRET-XYZ",
      session: "session-1",
    });

    const request = new Request("https://app.tastile.app/api/account/mfa/setup", {
      method: "POST",
      headers: { cookie: "tastile_mfa_session=session-from-cookie" },
    });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.secretCode).toBe("SECRET-XYZ");
    expect(json.otpauthUrl).toContain("otpauth://totp/");
    expect(json.otpauthUrl).toContain("secret=SECRET-XYZ");
  });
});
```

- [ ] **Step 7.2: Run, expect FAIL**

Run:
```bash
cd tastile-web && bunx vitest run src/app/api/account/mfa/setup/route.test.ts
```

- [ ] **Step 7.3: Implement**

Create `tastile-web/src/app/api/account/mfa/setup/route.ts`:

```typescript
import { cookies, NextResponse } from "next/server";
import { tryGetCognitoEnv } from "@/lib/cognito/env";
import { associateSoftwareToken } from "@/lib/cognito/associate-software-token";
import { COOKIE_EMAIL_AUTH_SESSION } from "@/lib/cognito/cookies";

export async function POST(request: Request) {
  const env = tryGetCognitoEnv();
  if (!env) return NextResponse.json({ error: "no_cognito" }, { status: 500 });

  const cookieStore = cookies();
  const session = cookieStore.get(COOKIE_EMAIL_AUTH_SESSION)?.value;
  if (!session) {
    return NextResponse.json(
      { error: "Missing MFA setup session. Please restart sign-in." },
      { status: 400 },
    );
  }

  try {
    const { secretCode, session: newSession } = await associateSoftwareToken(env, session);

    const cookieMutator = (response: NextResponse) => {
      response.cookies.set(COOKIE_EMAIL_AUTH_SESSION, newSession, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });
      return response;
    };

    const issuer = "Tastile";
    const accountName = cookieStore.get("tastile_user_email")?.value ?? "user";
    const otpauthUrl =
      `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}` +
      `?secret=${secretCode}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    return cookieMutator(
      NextResponse.json({ secretCode, otpauthUrl }),
    );
  } catch (error) {
    console.error("AssociateSoftwareToken failed", error);
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: "cognito_error", message }, { status: 502 });
  }
}
```

Note: we expect a `tastile_user_email` cookie set during the earlier `startEmailOtpSignIn` step. Ensure the route handler in Task 4 also sets this cookie. This depends on `COOKIE_EMAIL_AUTH_USERNAME` constant being aliased — we'll need to add a thin wrapper or rename. For Phase 1 we'll just import `COOKIE_EMAIL_AUTH_USERNAME` directly:

```typescript
import { COOKIE_EMAIL_AUTH_SESSION, COOKIE_EMAIL_AUTH_USERNAME } from "@/lib/cognito/cookies";
// ...
const accountName = cookieStore.get(COOKIE_EMAIL_AUTH_USERNAME)?.value ?? "user";
```

- [ ] **Step 7.4: Run, expect PASS**

Run same as 7.2.

- [ ] **Step 7.5: Commit**

```bash
git add tastile-web/src/app/api/account/mfa/setup/route.ts tastile-web/src/app/api/account/mfa/setup/route.test.ts
git commit -m "feat(api): POST /api/account/mfa/setup returning TOTP secret + otpauth URL"
```

### Task 8: API endpoint `POST /api/account/mfa/verify`

**Files:**
- Create: `tastile-web/src/app/api/account/mfa/verify/route.ts`
- Test: same dir test

- [ ] **Step 8.1: Write failing test**

Create `tastile-web/src/app/api/account/mfa/verify/route.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/cognito/env", () => ({
  tryGetCognitoEnv: () => ({
    region: "ap-northeast-1",
    clientId: "c",
    userPoolId: "p",
    issuer: "https://example.com",
    jwksUrl: "https://example.com/jwks",
  }),
}));

vi.mock("@/lib/cognito/verify-software-token", () => ({
  verifySoftwareToken: vi.fn(),
}));
vi.mock("@/lib/cognito/cookies", () => ({
  COOKIE_EMAIL_AUTH_SESSION: "tastile_mfa_session",
}));

import { verifySoftwareToken } from "@/lib/cognito/verify-software-token";

describe("POST /api/account/mfa/verify", () => {
  it("returns 400 if no session cookie", async () => {
    const request = new Request("https://app.tastile.app/api/account/mfa/verify", {
      method: "POST",
      body: new URLSearchParams({ code: "123456" }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(400);
  });

  it("returns 200 with auth tokens on success", async () => {
    (verifySoftwareToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      idToken: "id-xyz",
      accessToken: "access-xyz",
      refreshToken: "refresh-xyz",
      expiresIn: 3600,
    });

    const request = new Request("https://app.tastile.app/api/account/mfa/verify", {
      method: "POST",
      headers: { cookie: "tastile_mfa_session=session-1" },
      body: new URLSearchParams({ code: "123456" }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.idToken).toBe("id-xyz");
  });

  it("returns 401 on CodeMismatch", async () => {
    (verifySoftwareToken as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Bad code"),
    );

    const request = new Request("https://app.tastile.app/api/account/mfa/verify", {
      method: "POST",
      headers: { cookie: "tastile_mfa_session=session-1" },
      body: new URLSearchParams({ code: "000000" }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 8.2: Run, expect FAIL**

Run:
```bash
cd tastile-web && bunx vitest run src/app/api/account/mfa/verify/route.test.ts
```

- [ ] **Step 8.3: Implement**

Create `tastile-web/src/app/api/account/mfa/verify/route.ts`:

```typescript
import { cookies, NextResponse } from "next/server";
import { tryGetCognitoEnv } from "@/lib/cognito/env";
import { verifySoftwareToken } from "@/lib/cognito/verify-software-token";
import { COOKIE_EMAIL_AUTH_SESSION } from "@/lib/cognito/cookies";
import { buildAccountSessionCookie } from "@/lib/cognito/account-session";

export async function POST(request: Request) {
  const env = tryGetCognitoEnv();
  if (!env) return NextResponse.json({ error: "no_cognito" }, { status: 500 });

  const cookieStore = cookies();
  const session = cookieStore.get(COOKIE_EMAIL_AUTH_SESSION)?.value;
  if (!session) {
    return NextResponse.json(
      { error: "Missing MFA verify session. Please restart sign-in." },
      { status: 400 },
    );
  }

  const form = await request.formData();
  const code = form.get("code")?.toString().trim() ?? "";
  if (!/^[0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "invalid_code_format" }, { status: 400 });
  }

  try {
    const result = await verifySoftwareToken(env, session, code);

    if (result.challengeName === "MFA_SETUP") {
      // Cognito is asking for additional verification. Update cookie, return redirect hint.
      const response = NextResponse.json(
        { challengeName: "MFA_SETUP" },
        { status: 202 },
      );
      if (result.session) {
        response.cookies.set(COOKIE_EMAIL_AUTH_SESSION, result.session, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 600,
        });
      }
      return response;
    }

    if (!result.idToken || !result.accessToken) {
      return NextResponse.json(
        { error: "mfa_verify_no_tokens" },
        { status: 502 },
      );
    }

    const response = NextResponse.json({
      ok: true,
      idToken: result.idToken,
      expiresIn: result.expiresIn,
    });
    response.cookies.set(...buildAccountSessionCookie({
      idToken: result.idToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    }));

    return response;
  } catch (error) {
    console.error("VerifySoftwareToken failed", error);
    const message = error instanceof Error ? error.message : "unknown_error";
    // 401 because the user error is recoverable by re-entering the code
    if (
      message.includes("CodeMismatch") ||
      message.includes("Bad code") ||
      message.includes("CodeMismatchException")
    ) {
      return NextResponse.json({ error: "code_mismatch", message }, { status: 401 });
    }
    return NextResponse.json({ error: "cognito_error", message }, { status: 502 });
  }
}
```

- [ ] **Step 8.4: Run, expect PASS**

Run same as 8.2.

- [ ] **Step 8.5: Typecheck**

Run:
```bash
cd tastile-web && bunx tsc --noEmit
```

If `buildAccountSessionCookie` doesn't exist with that exact signature, inspect `tastile-web/src/lib/cognito/account-session.ts` to match its real shape. Adjust the destructure/spread.

- [ ] **Step 8.6: Commit**

```bash
git add tastile-web/src/app/api/account/mfa/verify/route.ts tastile-web/src/app/api/account/mfa/verify/route.test.ts
git commit -m "feat(api): POST /api/account/mfa/verify verifies TOTP code and sets session"
```

### Task 9: Update `completeEmailOtpSignIn` to handle `SOFTWARE_TOKEN_MFA`

**Files:**
- Modify: `tastile-web/src/lib/cognito/public-client.ts`
- Test: existing `public-client.test.ts` (extend it)

- [ ] **Step 9.1: Extend vitest for SOFTWARE_TOKEN_MFA**

Open `tastile-web/src/lib/cognito/public-client.test.ts` and add a test:

```typescript
import { completeEmailOtpSignIn } from "./public-client";

describe("completeEmailOtpSignIn", () => {
  it("sends SOFTWARE_TOKEN_MFA challenge response", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            AuthenticationResult: {
              IdToken: "id-token-X",
              AccessToken: "access-X",
              RefreshToken: "refresh-X",
              ExpiresIn: 3600,
            },
          }),
        ),
    });

    const result = await completeEmailOtpSignIn(
      env,
      "test@example.com",
      "123456",
      "session-xyz",
      "SOFTWARE_TOKEN_MFA",
    );
    expect(result.idToken).toBe("id-token-X");
    expect(result.accessToken).toBe("access-X");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining("SOFTWARE_TOKEN_MFA"),
      }),
    );
  });
});
```

- [ ] **Step 9.2: Run, expect FAIL**

Run:
```bash
cd tastile-web && bunx vitest run src/lib/cognito/public-client.test.ts
```

- [ ] **Step 9.3: Update `completeEmailOtpSignIn` to accept challenge name parameter**

Replace the existing `completeEmailOtpSignIn` in `tastile-web/src/lib/cognito/public-client.ts`:

```typescript
export async function completeEmailOtpSignIn(
  env: CognitoEnv,
  email: string,
  code: string,
  session: string,
  challengeName: "EMAIL_OTP" | "SOFTWARE_TOKEN_MFA" = "EMAIL_OTP",
): Promise<CognitoAuthTokens> {
  const challengeResponses: Record<string, string> = { USERNAME: email };
  if (challengeName === "EMAIL_OTP") {
    challengeResponses.EMAIL_OTP_CODE = code;
  } else if (challengeName === "SOFTWARE_TOKEN_MFA") {
    challengeResponses.SOFTWARE_TOKEN_MFA_CODE = code;
  }

  const response = await cognitoRequest(env, "RespondToAuthChallenge", {
    ClientId: env.clientId,
    ChallengeName: challengeName,
    Session: session,
    ChallengeResponses: challengeResponses,
  });

  const result = response.AuthenticationResult as CognitoJson | undefined;
  const idToken = typeof result?.IdToken === "string" ? result.IdToken : "";
  const accessToken = typeof result?.AccessToken === "string" ? result.AccessToken : "";
  const refreshToken =
    typeof result?.RefreshToken === "string" ? result.RefreshToken : null;
  const expiresIn = typeof result?.ExpiresIn === "number" ? result.ExpiresIn : 0;

  if (!idToken || !accessToken) {
    throw new CognitoPublicError(
      "Cognito did not return tokens after MFA challenge",
      "MISSING_AUTH_TOKENS",
    );
  }

  return { idToken, accessToken, refreshToken, expiresIn };
}
```

- [ ] **Step 9.4: Run, expect PASS**

Run:
```bash
cd tastile-web && bunx vitest run src/lib/cognito/public-client.test.ts
```

- [ ] **Step 9.5: Typecheck**

Run:
```bash
cd tastile-web && bunx tsc --noEmit
```

Expected: errors at every existing call-site that did not pass a challenge name argument. Add `import { completeEmailOtpSignIn } from ...` and either:
1. Pass the appropriate challenge name based on context (the verify page reads `?mode=software_token_mfa` from URL)
2. Default arg keeps `"EMAIL_OTP"` so existing EMAIL_OTP flow keeps working without breaking

Existing call sites use the default. Add an explicit call site where TOTP is needed (the `/auth/email/verify` UI).

- [ ] **Step 9.6: Commit**

```bash
git add tastile-web/src/lib/cognito/public-client.ts
git commit -m "feat(cognito): completeEmailOtpSignIn accepts challenge name param"
```

### Task 10: Web UI `/auth/mfa-setup` page

**Files:**
- Create: `tastile-web/src/app/auth/mfa-setup/page.tsx`
- Test: `tastile-web/src/app/auth/mfa-setup/page.test.tsx`

- [ ] **Step 10.1: Write failing vitest for the page**

Create `tastile-web/src/app/auth/mfa-setup/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MfaSetupPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams({ email: "test@example.com" }),
}));

global.fetch = vi.fn();

describe("MfaSetupPage", () => {
  beforeEach(() => {
    (global.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it("fetches SecretCode on mount and shows QR-style otpauth URL", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          secretCode: "JBSWY3DPEHPK3PXP",
          otpauthUrl: "otpauth://totp/Tastile:test@example.com?secret=JBSWY3DPEHPK3PXP",
        }),
    });

    render(<MfaSetupPage />);
    await waitFor(() => {
      expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    });
  });

  it("submits code and redirects to home on success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            secretCode: "SECRET",
            otpauthUrl: "otpauth://totp/Tastile:u@example.com?secret=SECRET",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, idToken: "id" }),
      });

    render(<MfaSetupPage />);
    await waitFor(() => screen.getByText(/SECRET/));
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 10.2: Run, expect FAIL**

Run:
```bash
cd tastile-web && bunx vitest run src/app/auth/mfa-setup/page.test.tsx
```

- [ ] **Step 10.3: Implement the page**

Create `tastile-web/src/app/auth/mfa-setup/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SetupState =
  | { kind: "loading" }
  | { kind: "ready"; secretCode: string; otpauthUrl: string }
  | { kind: "error"; message: string }
  | { kind: "submitting" }
  | { kind: "done" };

export default function MfaSetupPage() {
  const params = useSearchParams();
  const router = useRouter();
  const email = params.get("email") ?? "";
  const [state, setState] = useState<SetupState>({ kind: "loading" });
  const [code, setCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/mfa/setup", { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error ?? "setup_failed");
        }
        if (!cancelled) {
          setState({ kind: "ready", secretCode: json.secretCode, otpauthUrl: json.otpauthUrl });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "unknown",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitCode() {
    if (!/^[0-9]{6}$/.test(code)) return;
    setState({ kind: "submitting" });
    try {
      const form = new FormData();
      form.set("code", code);
      const res = await fetch("/api/account/mfa/verify", { method: "POST", body: form });
      const json = await res.json();
      if (res.status === 401) {
        setState({ kind: "error", message: "コードが違います" });
        return;
      }
      if (!res.ok && res.status !== 202) {
        throw new Error(json.error ?? "verify_failed");
      }
      if (json.challengeName === "MFA_SETUP" || res.status === 202) {
        setState({ kind: "ready", secretCode: state.kind === "ready" ? state.secretCode : "", otpauthUrl: state.kind === "ready" ? state.otpauthUrl : "" });
        return;
      }
      setState({ kind: "done" });
      router.replace("/dashboard");
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  if (state.kind === "loading" || state.kind === "submitting") {
    return <main><p>読み込み中…</p></main>;
  }
  if (state.kind === "done") {
    return <main><p>OK</p></main>;
  }
  if (state.kind === "error") {
    return (
      <main>
        <p>エラー: {state.message}</p>
        <button onClick={() => router.push("/auth/email")}>サインインをやり直す</button>
      </main>
    );
  }

  return (
    <main>
      <h1>2 段階認証のセットアップ</h1>
      <p>{email} のアカウントで認証アプリによる TOTP 認証を有効化します。</p>
      <ol>
        <li>認証アプリ(Google Authenticator、1Password、Authy など)を開く</li>
        <li>下のシークレットを Base32 文字列として登録、または otpauth URL を貼り付け</li>
        <li>6 桁コードを入力して「検証」を押す</li>
      </ol>
      <pre data-testid="secret">{state.secretCode}</pre>
      <p>
        <small>otpauth URL: {state.otpauthUrl}</small>
      </p>
      <label htmlFor="code">6 桁コード</label>
      <input
        id="code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
        inputMode="numeric"
        pattern="[0-9]{6}"
        autoComplete="one-time-code"
      />
      <button onClick={submitCode}>検証</button>
    </main>
  );
}
```

- [ ] **Step 10.4: Run, expect PASS**

Run same as 10.2.

- [ ] **Step 10.5: Commit**

```bash
git add tastile-web/src/app/auth/mfa-setup/page.tsx tastile-web/src/app/auth/mfa-setup/page.test.tsx
git commit -m "feat(auth-mfa): MFA-setup page with QR-style otpauth URL and code form"
```

### Task 11: Update `/auth/email/verify` page to handle TOTP mode

**Files:**
- Modify: `tastile-web/src/app/auth/email/verify/page.tsx` (or similar name — inspect existing app structure first)

- [ ] **Step 11.1: Inspect existing verify page**

Run:
```bash
ls tastile-web/src/app/auth/email/verify
```

Read the page and the API route used.

- [ ] **Step 11.2: Pass `mode=software_token_mfa` to `completeEmailOtpSignIn`**

Edit the form submit handler to:
- Read `mode` query param
- If `mode === "software_token_mfa"`, call the API with `challengeName="SOFTWARE_TOKEN_MFA"`
- Update the UI label to "認証アプリのコード" instead of "メールコード"

Show diff against current code based on what step 11.1 reveals.

- [ ] **Step 11.3: Run existing tests + typecheck**

Run:
```bash
cd tastile-web && bunx vitest run
cd tastile-web && bunx tsc --noEmit
```

- [ ] **Step 11.4: Commit**

```bash
git add tastile-web/src/app/auth/email/verify/
git commit -m "feat(auth-verify): route TOTP confirmation by mode query param"
```

### Task 12: Add Playwright E2E spec for the full sign-in flow

**Files:**
- Create: `tastile-web/e2e/mfa-signin.spec.ts` (or wherever Playwright tests live)
- Run via existing Playwright config

- [ ] **Step 12.1: Inspect existing Playwright config**

Run:
```bash
ls tastile-web/playwright* 2>/dev/null
ls tastile-web/e2e 2>/dev/null
```

Determine test directory.

- [ ] **Step 12.2: Write E2E spec**

Create spec (path depends on step 12.1):

```typescript
import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? `e2e-${Date.now()}@example.com`;
const TEST_PASSWORD = "TestPass!2345Aa";

test("sign up → MFA setup → sign in (TOTP)", async ({ page, request }) => {
  // Signup
  const signUpResponse = await request.post("/api/account/signup", {
    form: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  expect([200, 201]).toContain(signUpResponse.status());

  // For CI / local without email delivery, we use admin API to verify sign-up
  // by simulating a confirmation. In production, use admin-confirm-sign-up.
  // (See Task 12.3 below for the helper.)
  // ... continue via UI
});
```

- [ ] **Step 12.3: Stub helper for tests**

Real Cognito OTP can't be intercepted in CI. Use Cognito `AdminConfirmSignUp` from outside the browser to skip the email confirmation step during tests. Test relies on a test-only bypass or a controlled user.

For Phase 1 sign-off, the user can manually validate against the production URL.

- [ ] **Step 12.4: Run vitest + tsc end-to-end**

```bash
cd tastile-web && bunx vitest run
cd tastile-web && bunx tsc --noEmit
```

Expected: all green.

- [ ] **Step 12.5: Commit any updated test infra**

```bash
git add tastile-web/e2e
git commit -m "test(e2e): add MFA sign-in Playwright spec"
```

### Task 13: Build & deploy to production

**Files:**
- All changes from prior tasks

- [ ] **Step 13.1: Build**

```bash
cd tastile-web && bun run build
```

Expected: Next.js build completes with no errors.

- [ ] **Step 13.2: Deploy via existing deployment pipeline**

Run the project's standard deployment command. Inspect `tastile-web/package.json` for `scripts.deploy` or check memory for deployment workflow.

- [ ] **Step 13.3: Verify on production**

Open https://app.tastile.app/auth/email in a real browser.

Expected:
- Submit an email → redirect to `/auth/mfa-setup` (if user has never set up TOTP)
- Submit a fresh email → redirect to `/auth/email/verify` with `mode=software_token_mfa` (if user has TOTP set up from a prior session)
- For NEW email signup: signup → email confirm → first sign-in → MFA_SETUP challenge → QR + otpauth URL → enter 6-digit code → dashboard

- [ ] **Step 13.4: Commit any build artifacts**

If `.next` artifacts or env were touched: revert changes not in the build.

- [ ] **Step 13.5: Verify Cognito pool reflects tier change & MFA config**

```bash
aws cognito-idp describe-user-pool --user-pool-id ap-northeast-1_buh6oWoQ2 --region ap-northeast-1 --query 'UserPool.[Tier,UserPoolTier,MfaConfiguration,EmailConfiguration]'
```

Expected: `Tier: "PLUS"`, `MfaConfiguration: "ON"`, plus the email from D5 (DEVELOPER auth-noreply@tastile.app). For now, EmailConfiguration can stay COGNITO_DEFAULT until Phase 2.

- [ ] **Step 13.6: Tag release**

```bash
git tag -a mfa-required-live-2026-07-08 -m "MFA-required auth live"
git push origin main --tags
```

### Task 14: Smoke test 7/8 までに sign-in 通る確認

**Files:**
- None (operational task)

- [ ] **Step 14.1: With the user's actual test email**

Use the user's chosen email (or the existing `rebuild.up.up@gmail.com`) to:

1. Visit https://app.tastile.app/auth/email
2. Submit email
3. Receive confirm email (or this user is already confirmed)
4. Receive OTP / MFA challenge
5. If MFA_SETUP: scan QR with Google Authenticator, enter code
6. Verify session cookies set + redirected to dashboard

- [ ] **Step 14.2: Document operational readouts in commit message**

```bash
git commit --allow-empty -m "ops: 2026-07-08 MFA-required sign-in live; E2E verified with <email>"
```

---

## Phase 2-4: Out of Scope of This Plan

Phase 2-4 from the design doc remain as separate plans to be drafted after Phase 1 ships.

| Phase | Scope | Trigger |
|---|---|---|
| Phase 2 | SES domain identity + DKIM + SPF, EmailConfiguration=DEVELOPER, CustomMessage Lambda (HTML emails), PreSignUp throttle Lambda, PostConfirmation Lambda + v1_owner_user upsert | After 7/8 sign-in confirmed, target 7/11 |
| Phase 3 | Backup Lambda + S3 + EventBridge nightly, `DELETE /api/account` API, CloudWatch alarms 6 個 | After Phase 2, target 7/14 |
| Phase 4 | AdvancedSecurityMode=ENFORCED + Adaptive Authentication, /auth/mfa-recovery flow, 24h dry-run with full observability | After Phase 3, target 7/16 |

These will become separate plan files in `docs/superpowers/plans/` after this Phase 1 plan completes.

---

## Risks and Mitigations for Phase 1

| Risk | Impact | Mitigation |
|---|---|---|
| Cognito Tier is still LITE (user expected PLUS but not active) | TOTP not available | D1 step 1.3 verifies. If LITE, escalate immediately |
| Existing 2 Google users can't complete MFA_SETUP via Cognito's built-in API (external provider quirks) | They can't sign in | Document in the migration runbook: existing users can sign in via Google Hosted UI (always worked), but require manual `AdminSetUserMFAPreference` if they want TOTP later. Phase 1 doesn't auto-enroll existing users |
| `buildAccountSessionCookie` signature differs from our assumed shape | Compile errors | Task 8.5 typecheck catches this; adjust spread/callsite as needed |
| Browser Back button on `/auth/mfa-setup` after a successful verify loops back to stale session | UX bug | Set `Cache-Control: no-store` on the API route (best-effort) or detect stale session and re-init |
| `swaks` / actual OTP delivery fails in production | Phase 1 sign-in unreachable | Verify email path is intact from this morning's probe with existing Google user; that path proves delivery works for at least one domain |

---

## Acceptance Criteria for Phase 1 Close (2026-07-08 EOD)

- [ ] `UserPoolTier=PLUS` confirmed via describe-user-pool
- [ ] `MfaConfiguration=ON`, `SoftwareTokenMfaConfiguration.Enabled=true`, `SmsMfaConfiguration=null`
- [ ] Front-end builds without TS errors
- [ ] All vitest tests pass
- [ ] User can sign in at https://app.tastile.app/auth/email and reach dashboard with TOTP enforced
- [ ] User can sign up via `/auth/email/signup` flow and complete TOTP setup on first sign-in
- [ ] No SMS MFA path exists
