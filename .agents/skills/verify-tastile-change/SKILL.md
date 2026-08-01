---
name: verify-tastile-change
description: Use when about to claim a Tastile change PASS, DONE, GREEN, ready to commit, ready to merge, or ready to ship across any root or child repository.
---

# Verify Tastile Change

Distinguish **REVIEWED** (read code) from **VERIFIED** (executed and observed behavior). Never claim PASS when any touched package lacks current execution evidence.

## Repository Routing

| Change | Read and verify in |
| --- | --- |
| Domain, API, schema | `tastile-core/v1/02`, `v1/10`, `v1/14`; core instructions |
| Rust handler, store, worker | `tastile-core/AGENTS.md`, `tastile-core/HARNESS.md` |
| Web | `tastile-web/AGENTS.md` |
| Android | `tastile-android/README.md` |
| Desktop | `tastile-desktop/AGENTS.md` |
| Workspace or infrastructure | `docs/HARNESS.md` |

Run `git status --short` and `git diff --stat` from every touched child repository. Never trust a subagent's file list without checking it.

## Binding Evidence Rules

- **PostgreSQL:** use a reachable real Postgres instance. Observe `test result: ok. N passed; 0 failed; 0 ignored`. A skip branch that returns when no URL exists proves no SQL behavior.
- **Backend behavior:** run the daemon and exercise the affected endpoint with `curl`. Tests may encode stale assumptions.
- **Web UI:** use a real browser through Chrome DevTools, exercise the flow, and inspect live DOM or screenshots. JSDOM and snapshots are insufficient.
- **Android:** confirm JDK 17, install the current APK on the intended device, and compare source/APK timestamps before judging behavior.
- **Rust:** Windows Defender blocks required C compilation. Build and test through the cached `tastile-v1-api` wslc image; Windows-side cargo output is not verification.
- **Evidence freshness:** cached output from an earlier run is not current evidence.

## Quick Reference

1. Identify every touched repository from its own Git root.
2. Label each check REVIEWED or VERIFIED.
3. Record command, exit code, and decisive observed output.
4. Report BLOCKED with the missing check if any required evidence is absent.

## Common Mistakes

- Treating an apparent passing count as proof when integration tests skipped database access.
- Treating a DDL/source match as migrated-schema verification.
- Treating a web unit test or Android build as exercised UI behavior.
- Declaring success from stale binaries, cached output, or a subagent summary.
