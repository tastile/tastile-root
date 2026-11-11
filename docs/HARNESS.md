# HARNESS — Tastile workspace entry point

> **この文書は pointer であり、事実を持たない (ADR-0013)。** 2026-09-29 以前の本文 (全体方針・infra・認証・API 方針・
> 禁止事項) は `architecture/` と tastile-core の正本へ移し、履歴は git history と `docs/raw/` に残る。
> ここに事実を書き足さない。

## どこを読むか

| 知りたいこと | 正本 |
| --- | --- |
| 何がどこで canonical か | [`architecture/model/sot-registry.yaml`](../architecture/model/sot-registry.yaml) ([一覧](../architecture/generated/sot-registry.md)) |
| Tastile の目的・product 原則・product KPI | tastile-core `docs/product/README.md` (private) — root 側 summary は [architecture/docs/01](../architecture/docs/01-context-and-goals.md) |
| domain 語彙・仕様・不変条件・API | tastile-core `v1/00..15` |
| system 構造・通信 | [architecture/docs/02](../architecture/docs/02-structure.md) / `architecture/model/elements.yaml`, `relationships.yaml` |
| 認証・trust boundary・secret | [architecture/docs/03](../architecture/docs/03-trust-and-security.md) / `security.yaml`、ADR-0015、ADR-0016 |
| data・backup・retention | [architecture/docs/04](../architecture/docs/04-data.md) / `data.yaml` |
| infra・environment・費用 | [architecture/docs/05](../architecture/docs/05-infrastructure-and-environments.md) / `deployment.yaml`, `environments.yaml`、ADR-0014 |
| build・release・deploy・SLO・KPI | [architecture/docs/06](../architecture/docs/06-delivery-and-operations.md) / `quality.yaml`、ADR-0020 |
| repository の責務 | [architecture/docs/07](../architecture/docs/07-sot-and-ownership.md) / `repositories.yaml` |
| 移行計画 | [architecture/docs/08](../architecture/docs/08-migration-roadmap.md) / `roadmap.yaml` |
| 未検証事項・PoC・evidence | [architecture/docs/09](../architecture/docs/09-evidence-and-unknowns.md) / `pocs.yaml`, `risks.yaml` |
| system-level の判断 | [`docs/adr/`](./adr/) ([索引](../architecture/generated/adrs.md)) |
| 開発 workflow | [`docs/agent-orchestration.md`](./agent-orchestration.md)、ADR-0007〜0009 |
| agent の作業規約 | [`AGENTS.md`](../AGENTS.md) |
| 前史から現在までの履歴 (evidence) | [`docs/raw/`](./raw/)、tastile-core `docs/raw/` |

## 検証

```bash
bun run architecture:validate   # architecture SoT
```

```powershell
pwsh -NoProfile -File .\scripts\check-workspace.ps1 -Profile fast -KeepGoing
```
