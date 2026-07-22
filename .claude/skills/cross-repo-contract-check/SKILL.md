---
name: cross-repo-contract-check
description: Use when a Tastile change touches two or more sibling child repositories, when an API or schema field is renamed, added, or removed, or before approving multi-package work as PASS.
---

# Cross-Repo Contract Check

A Tastile change is not done at the root. The shell repo ignores every child repo; a clean root `git status` proves nothing about `tastile-core`, `tastile-web`, `tastile-android`, or `tastile-desktop`. Each child has its own Git history and instructions.

## When to Use

Invoke before approval, merge, or "ready to ship" when a core API or schema field changes, a backend may ship ahead of a client, two or more child repositories are affected, or a subagent asks for sign-off because all packages compile. Pair with `verify-tastile-change`: that skill asks whether each package proved green; this skill asks whether the contract between them holds.

## Enumerate Affected Children

List every child repository in scope before approval. A core API change requires checking every consumer: web, Android, and desktop. Use the routing table in root `CLAUDE.md` as the entry index, not as the complete answer.

## Read Relevant Instructions

Open each affected child's `CLAUDE.md`, `AGENTS.md`, or `README.md`, plus matching canonical `tastile-core/v1/` chapters. For example, schema and API changes require `v1/10` and `v1/14`. Never rely on root instructions alone.

## Produce a Contract Matrix

Create rows for:

| Concern | Required evidence |
| --- | --- |
| Producer | Core type, handler, serializer |
| Consumers | Web, Android, desktop call sites |
| Schema | Canonical columns and numeric registry |
| Migration | Executed migration path |
| Tests | Producer and consumer contract coverage |

A required blank or mismatch means BLOCKED.

## Check Composition Parity

For user-visible behavior shared by web and Android, compare control count, order, labels, and i18n keys. Mobile layout and individual control rendering may differ; behavior and composition may not drift.

## Check Each Git Repository

Run `git status --short` and `git diff --stat` inside every affected child. Plan commits, versions, and releases independently. Root status is irrelevant.

## Reject Invented Compatibility Shims

Do not add dual-read, aliases, or "accept both fields" behavior unless the canonical contract explicitly requires it. A shim that avoids coordinating consumers is not a contract fix.

## Quick Reference

1. List affected children.
2. Read every affected instruction file and matching v1 chapters.
3. Fill the producer/consumer/schema/migration/test matrix.
4. Check web–Android parity when user-visible.
5. Inspect status and diff per child; plan independent releases.
6. Report PASS only when every required cell agrees; otherwise report `BLOCKED: <mismatch>`.

## Common Mistakes

- Trusting root `git status` because children are ignored.
- Approving because each package compiles independently.
- Updating web while forgetting Android or desktop.
- Inventing a compatibility shim instead of aligning the canonical contract.
