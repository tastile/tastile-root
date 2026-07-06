# Task 8 (E2E curl verification) — BLOCKED

## Symptom
`Store::connect()` (used by `integration_*` and `at_gap_break_emission` tests)
exits with `sqlx::Error::PoolTimedOut` after the configured Postgres
pool acquire timeout (5 s) when `DATABASE_URL` points at:
  * `localhost:5432` -> relayed by `wslrelay.exe` (PID 25144, listening on
    127.0.0.1:5432) but the relayed upstream returns nothing (TN=NT status).
  * `172.22.156.22:5432` (WSL2 NIC IP from `hostname -I`) -> connection
    actively refused from Windows.
  * Inside WSL (`psql -h 127.0.0.1 -U tastile -d tastile_db`) -> connects
    in <50 ms and `SELECT 1` returns `1`, so the database itself is
    healthy.

## Reproduction
```
$env:DATABASE_URL = "postgres://tastile:password@127.0.0.1:5432/tastile_db"
cd C:\Users\rebui\Desktop\tastile\tastile-core
cargo test -p storage --test test_subject_schema_present -- --nocapture
# -> "store connect: PoolTimedOut" on every test that calls Store::connect()
```

## Environment
* Host: Windows 11 (this Codex desktop instance).
* WSL2 distro: Ubuntu 24.04, wslrelay.exe bridging localhost:5432 to the
  distro, postgres 16 listening on `0.0.0.0:5432` (verified via `ss -ltn`
  inside the distro).
* Postgres 16 role `tastile` (SUPERUSER) + database `tastile_db` created
  via `sudo -u postgres psql`.

## Root cause (best guess)
Either the wslrelay upstream is misconfigured (no peer to relay to) or a
firewall rule blocks inbound TCP from the Windows host into the WSL2 NAT
interface. Adding `netsh interface portproxy` for 5432 -> WSL IP fails
with "requested operation requires elevation" (admin-only).

## What we cannot do without DB access
* `cargo test -p storage --test at_gap_break_emission` (Tasks 3/5/AT-023..029)
* `cargo run -p api` + curl `/v1/timeline` (Task 8)
* Both require a working Postgres reachable from the Windows host.

## What we DID verify
* `cargo build --workspace` is clean (`evidence/api_build.txt`).
* `cargo build -p storage --all-targets` is clean.
* `cargo build -p api --all-targets` is clean.
* `cargo clippy --workspace --all-targets -- -D warnings` is clean.
* `cargo fmt --all -- --check` is clean.
* All Task 1..7 commits (spec, skeleton, implementation, tests, handler
  wiring, fmt, clippy) are present on `main`.

## Recommendation for follow-up
Run this Codex goal mode in an environment with a reachable Postgres
(e.g. the project's CI Ubuntu runner, or a Windows host with a
non-WSL Postgres install), then execute Tasks 8-10 there.
