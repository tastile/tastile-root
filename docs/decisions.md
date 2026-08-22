# Decisions

## 2026-08-22 — Cognito → BetterAuth 認証置き換え

アカウント認証を AWS Cognito Hosted UI から BetterAuth へ置き換える。

### 背景

v1/15 の polymorphic owner(USER subject = identity record 兼 personal scope、profile を
`v1_owner` が保持)は **identity の正本をドメイン内に置く設計** である。一方 Cognito は
user pool を外部 SaaS に持ち、identity の実正本が AWS 側に置かれる。email 変更・account
lifecycle・profile 属性の管理権が Cognito に奪われ、owner 概念と構造的に矛盾する。

### 決定

1. **配置**: better-auth を tastile-web (Next.js) の route handler として内蔵する。
   独立 auth service は作らない。core (Rust) には認証 provider を導入しない。
2. **auth 用 DB**: 同一 private RDS 内に auth 専用 database + 最小権限 role を作成する。
   web 汎用サーバー → RDS 5432 の security group 許可を追加する。
   **tastile-web の「PostgreSQL 直接接続禁止」不変条件への例外** を本 ADR で承認する。
   例外の範囲は auth 用 role のみであり、core domain table への権限は与えない。
3. **identity key**: `v1_subject.external_subject` = better-auth user id。
   core の owner 導出 `Uuid::new_v5(NAMESPACE_OID, external_subject bytes)` と
   bridge secret 契約 (`x-tastile-web-bridge-secret` / `x-tastile-web-session-user`) は
   **不変**。変わるのは external_subject に入る値の意味のみ。
4. **既存ユーザーデータ**: 破棄する。cognito_sub 由来 owner_id からの移行 linking は
   行わない。
5. **機能パリティ**: email+password / Google・Apple OAuth / email OTP / TOTP MFA /
   メール送信は SES 直接送信 (sendEmail hook)。Cognito Hosted UI は廃止。
6. **mobile / desktop**: system browser / Custom Tabs で web の login page を開き、
   better-auth bearer token を取得 → `/api/mobile/api-token` 形式を踏襲して検証後に
   core API token を mint。desktop の loopback callback は web login page 経由に統一。

### core schema 変更

- `v1_owner_user.cognito_sub` を provider 中立名 (external_subject 相当) へ rename する
  migration (V1_0xx) を新設する
- v1/15 の「Cognito リンク」表記を改訂する

### 実装フェーズ

1. 本 ADR + root HARNESS §7 + v1/15 改訂 (design freeze)
2. core schema migration (cognito_sub rename) — v1/12 AT 更新と同時
3. tastile-web better-auth 統合 + Cognito 関連 ~40 file 削除
4. tastile-android / tastile-desktop 載せ替え (bearer token 経由)
5. foundation.yaml の UserPool / UserPoolClient / SSM parameter 削除。
   SES は残置 (better-auth 送信に使用)

### Rollback

フェーズ 3 完了前なら Cognito 資材は削除されないため即時復帰可能。完了後は Cognito
user pool teardown 済みのため、旧 identity への復帰は不可能 (データ破棄を承認済み)。

## 2026-06-19 — zero-warning sweep status

Snapshot of `main` branch quality gates across all 4 Tastile packages.

| Check | tastile-core (Rust) | tastile-desktop (.NET) | tastile-web (Next.js) | tastile-android (Kotlin) |
| --- | --- | --- | --- | --- |
| `git log -1` (HEAD on main) | `9ad0e89` | `dd60b03` | `3adff0c` | `fc5bc06` |
| Build | ✗ env blocker (MinGW gcc) | ✓ 0 warn / 0 err (default + win-x64) | ✓ exit 0 | ✗ JDK class file mismatch (61 vs 55) |
| Test | ✗ (cannot run; build fails) | ✓ 156 pass / 0 fail | ✓ 32 files / 159 tests, no stderr noise | ✗ (build fails) |
| Lint / typecheck | ✗ (build fails) | ✓ via check.ps1 | ✓ biome exit 0, tsc exit 0 | ✗ (build fails) |
| Knip / dead-code | n/a | n/a | ✓ exit 0 | n/a |

### What works
- **tastile-desktop**: full pipeline green (156/156 unit tests pass, default + win-x64 builds clean, TimelineWindow connector wiring validated). Commit `06a8035` then `dd60b03`.
- **tastile-web**: biome + tsc + vitest (159/159) + knip + next build all exit 0. Commit `3adff0c` (`chore(web): zero-warning biome/typecheck/knip/build/test`).

### Blocked — environmental, not code
- **tastile-core**: `cargo build` fails on `ring-0.17.14` and `libsqlite3-sys-0.28.0` because `gcc.exe` itself crashes silently (exit 1, no stderr, no output `.o`). The detection step `gcc -E detect_compiler_family.c` returns 1, and the real compile of `curve25519.c` also returns 1. cc-rs reports "command did not execute successfully" but gcc itself prints nothing. Symptom matches a broken MSYS2/MinGW runtime (DLL missing or quarantine-stripped). Reinstall of MinGW 15.2.0 at `C:\ProgramData\mingw64\mingw64\` is required; this cannot be fixed via Cargo.toml changes. Last known-good cargo output predates this environment break — recursion fix `9ad0e89` is committed.
- **tastile-android**: gradle daemon reports `dagger/hilt/android/plugin/HiltGradlePlugin has been compiled by a more recent version of the Java Runtime (class file version 61.0), this version of the Java Runtime only recognizes class file versions up to 55.0`. Running JDK is 11 (class 55), Hilt plugin needs JDK 17 (class 61). Build env must be switched to JDK 17 (project already configures JDK 17 in build.gradle but gradle wrapper is loading JDK 11). Last known-good android commit `fc5bc06` was verified under JDK 17.

### Rollback
- All committed cleanup is revertible via `git reset --hard <prev-head>` on each package's `main`. No destructive ops performed during this sweep.

### Next 3 improvements
1. Repair MinGW toolchain on this host (or pin a working rustup sysroot) so core cargo build/test can run.
2. Pin gradle wrapper to require JDK 17 (currently uses `JAVA_HOME` which resolves to JDK 11 in some shells).
3. Add a top-level `scripts/check-all.ps1` that fans out to each package's check script and surfaces exit codes — one command to gate the whole monorepo.
