---
id: adr.root.0019
status: Accepted
date: 2026-09-29
scope: tastile-core, tastile-openapi, tastile-web, tastile-android, tastile-desktop, tastile-cli, tastile-root
relates: [adr.root.0013]
---

# ADR-0019: API contract — Core が生成し、tastile-openapi が配布し、consumer は tag を pin する

## Context

- OpenAPI の pin が 4 通りに分かれていた: root submodule `8461ffa`、CLI submodule `0a8a66b` (v1.0.1)、Android CI checkout
  `b0c781d` (v1.0.0)、Desktop は contract 参照なし (手書き DTO)。
- Web は `../openapi/openapi.yaml`、Android は `../../openapi/openapi.yaml` を読み、root の filesystem 配置が build 依存に
  なっていた (root#44)。
- Desktop は contract に無い endpoint (`/v1/debug/events` 等) を呼んでいる。
- tastile-openapi の lint workflow は 0/3 (Redocly rule 違反)。

## Decision

1. **正本は Core の Rust 定義 (`crates-v1/api/src/openapi.rs`)。** openapi.yaml は `dump_openapi` で生成する derived artifact。
2. **tastile-openapi は配布専用。** Core の release ごとに生成物を commit し、Core と同じ version の tag (`vX.Y.Z`) を付ける。
   手編集禁止。lint (Redocly) は publish 前に Core 側 CI で実行する。
3. **consumer は tag を自 repository 内で pin する** (submodule または fetch script + checksum)。sibling / root の path を読まない。
   pin の更新は consumer の PR で行う。
4. **全 consumer が drift check を持つ。** Web は型生成、Android は client 生成 + coverage、CLI は operation contract、Desktop は
   手書き DTO と contract の照合 (新設)。contract に無い endpoint の呼び出しは check で失敗させる。
5. **root の openapi submodule は削除する** (root は contract を消費しない)。
6. `/v1` の後方互換は core v1/14 の方針に従う。breaking change は `/v2` を切る。

## Consequences

- Core release 手順に「openapi.yaml 生成 → tastile-openapi commit / tag」を含める (ADR-0020)。
- consumer 間で pin version が異なることは許容するが、production で稼働する Core version より新しい contract を pin しない。

## Verification

各 consumer の drift check が CI で green、root に openapi 参照が無いこと (`architecture:audit` の cross.stale-claim)。
