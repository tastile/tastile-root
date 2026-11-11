-- Better Auth v1.7 schema, reconstructed from node_modules/better-auth/dist/db/schema/*.mjs
-- and node_modules/better-auth/dist/plugins/two-factor/schema.mjs.
-- Column names follow the better-auth defaults (camelCase, no snake_case aliases).
-- Applied only to local verification databases; production manage this via the
-- deployment's own migration flow.

CREATE TABLE IF NOT EXISTS "user" (
    "id"                  text PRIMARY KEY,
    "name"                text NOT NULL,
    "email"               text NOT NULL UNIQUE,
    "emailVerified"       boolean NOT NULL DEFAULT false,
    "image"               text,
    "twoFactorEnabled"    boolean NOT NULL DEFAULT false,
    "createdAt"           timestamptz NOT NULL DEFAULT now(),
    "updatedAt"           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
    "id"                  text PRIMARY KEY,
    "expiresAt"           timestamptz NOT NULL,
    "token"               text NOT NULL UNIQUE,
    "ipAddress"           text,
    "userAgent"           text,
    "userId"              text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "createdAt"           timestamptz NOT NULL DEFAULT now(),
    "updatedAt"           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session"("userId");

CREATE TABLE IF NOT EXISTS "account" (
    "id"                  text PRIMARY KEY,
    "accountId"           text NOT NULL,
    "providerId"           text NOT NULL,
    "userId"              text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "accessToken"         text,
    "refreshToken"        text,
    "idToken"             text,
    "accessTokenExpiresAt"  timestamptz,
    "refreshTokenExpiresAt" timestamptz,
    "scope"               text,
    "password"            text,
    "createdAt"           timestamptz NOT NULL DEFAULT now(),
    "updatedAt"           timestamptz NOT NULL DEFAULT now(),
    UNIQUE ("providerId", "accountId")
);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account"("userId");

CREATE TABLE IF NOT EXISTS "verification" (
    "id"                  text PRIMARY KEY,
    "identifier"          text NOT NULL,
    "value"               text NOT NULL,
    "expiresAt"           timestamptz NOT NULL,
    "createdAt"           timestamptz NOT NULL DEFAULT now(),
    "updatedAt"           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification"("identifier");

CREATE TABLE IF NOT EXISTS "twoFactor" (
    "id"                  text PRIMARY KEY,
    "secret"              text NOT NULL,
    "backupCodes"         text NOT NULL,
    "userId"              text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "verified"            boolean NOT NULL DEFAULT true,
    "failedVerificationCount" integer NOT NULL DEFAULT 0,
    "lockedUntil"         timestamptz,
    "createdAt"           timestamptz NOT NULL DEFAULT now(),
    "updatedAt"           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "twoFactor"("userId");
