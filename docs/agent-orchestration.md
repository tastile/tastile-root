# Agent orchestration policy

> **正本**: Tastile workspace における multi-agent 並行開発の運用契約。
> `AGENTS.md` / `CODEX_ROLES.ja.md` では扱いきれない不変条件をここに集約する。
>
> **読み込み規律**: 本文書は **初回初期化、または orchestration policy
> を再構成する時だけ全文を読む**。通常 task では `AGENTS.md` の pointer
> のみ参照する。policy 全文をここに再録しない。
>
> **依存正本**: `AGENTS.md`, `CODEX_ROLES.ja.md`, `docs/HARNESS.md`,
> `docs/decisions.md`, `docs/adr/`, `.codex/agents/*.toml`,
> `.claude/agents/*.md`, `.agents/skills/*/SKILL.md`,
> `.agent-loop/Invoke-PreCommitReview.ps1`,
> `scripts/orchestration/release-claim.ps1`, `scripts/orchestration/*`

## 目次

1. [目的と適用範囲](#1-目的と適用範囲)
2. [Sprint workflow](#2-sprint-workflow)
3. [Engineering decision precedence](#3-engineering-decision-precedence)
4. [User escalation boundary](#4-user-escalation-boundary)
5. [Subagent mode taxonomy](#5-subagent-mode-taxonomy)
6. [Worker lease / fencing](#6-worker-lease--fencing)
7. [Recovery checkpoint](#7-recovery-checkpoint)
8. [External side-effect journal](#8-external-side-effect-journal)

---

## 1. 目的と適用範囲

本文書は、5 つの独立 child repository を束ねる shell repository における
並行開発時の **運用契約** を集約する。個別の role 定義 / Skill / hook は
それぞれ canonical source を参照する。

| 領域 | canonical source |
| --- | --- |
| role unit の責務 / sandbox mode | `CODEX_ROLES.ja.md`, `.codex/agents/*.toml`, `.claude/agents/*.md` |
| cross-repo contract | `.agents/skills/cross-repo-contract-check/SKILL.md` |
| verification taxonomy / binding evidence | `.agents/skills/verify-tastile-change/SKILL.md` |
| pre-commit review flow | `.agent-loop/Invoke-PreCommitReview.ps1`, `.agent-loop/README.md` |
| release verification | `scripts/orchestration/verify-release.ps1` |
| 既存 release-stack claim | `scripts/orchestration/release-claim.ps1` |

本文書で扱う範囲:

- **§2 sprint workflow** — `release-x-y-z` branch と ticket branch の rule
- **§3 decision precedence** — 6 段階判断順序
- **§4 escalation boundary** — 自明な判断と escalate の境界
- **§5 subagent mode taxonomy** — Research / Worker / Reviewer と sandbox 契約
- **§6 worker lease / fencing** — 実装中の lease と execution generation
- **§7 recovery checkpoint** — context handoff 用 structured schema
- **§8 external side-effect journal** — 外部 mutation の idempotency

### 1-1. host portability scope

primary host は Windows + WSLC (`docs/HARNESS.md` §9-3) とする。macOS /
Apple Silicon / Linux / cloud sandbox からの contribution は wslc / Linux
runtime 経由で同等検証する。host-specific hidden state への依存は
`AGENTS.md` 「常時適用する不変条件」に従い禁止する。

---

## 2. Sprint workflow

この sprint branch、ticket branch、Draft PR、release gate の lifecycle は
[ADR-0007](adr/0007-release-branch-and-ticket-workflow.md) を canonical decision とする。

### 2-1. release branch

`main` は **released / integrated state** を表す。active sprint は
`release-<major>-<minor>-<patch>` branch で表現し、sprint 開始時に `main`
から作成する。semantic version は `tastile-core/Cargo.toml` および公開 API
の version と同期させる。

```text
main                                  ← released state
└─ release-0-3-0                     ← active sprint integration
   ├─ 142                            ← ticket branch (issue number のみ)
   ├─ 143
   └─ 144
```

### 2-2. ticket branch

1 つの top-level Issue に対し 1 つの durable ticket branch を作成する。
branch 名は **`<issue-number>` のみ**。`issue/` prefix、slug、title、
work type を含めてはならない。説明責務は Issue / PR 側に置く。

### 2-3. Draft PR

ticket branch に最初の meaningful commit が入ったら、target
`release-x-y-z` への **Draft PR を早期作成** する。Draft → Ready は
次の条件を全て満たすこと:

- acceptance criteria が実装済み
- `.agent-loop/Invoke-PreCommitReview.ps1` の structured verdict が
  `approve` (independent reviewer + child fast gate 通過)。これは pre-commit review
  verdict であり、checkpoint `status` や child result `verdict` とは別の分類である。
- blocking Issue が解消済み、または scope 外として明示済み
- PR description が current state と一致
- release branch との staleness / conflict が処理済み
- latest durable checkpoint (`§7`) と branch state が矛盾していない

### 2-4. release gate

`release-x-y-z` → `main` merge 直前に
`scripts/orchestration/verify-release.ps1` を実行する。`live-stack` claim
(`scripts/orchestration/release-claim.ps1`、下記 §6-1) を取得してから release-wide
verification を走らせる。途中中断した partial pass は full pass と
みなさない。stale な success 出力は再実行せず、commit 直前の snapshot で
取り直す。

---

## 3. Engineering decision precedence

判断は次の precedence に従う。同一 level で矛盾する場合は、より specific
かつ新しい canonical source を優先する。

| 優先 | 根拠 |
| --- | --- |
| 1 | project-wide policy / canonical architecture / invariant (`AGENTS.md`, `docs/HARNESS.md`) |
| 2 | design / specification / 承認済み plan (`tastile-core/v1/*.md`, `docs/plans/`, `docs/superpowers/specs/`) |
| 3 | coherent 既存実装 majority (ただし migration 途中 / vendored / generated は除外) |
| 4 | current official framework / runtime / SDK guidance (Context7, 公式 docs) |
| 5 | established ecosystem convention |
| 6 | local best judgment |

### 3-1. 既存実装の扱い

既存実装は重要な evidence だが、**古い多数派や migration 途中の pattern
が新しい canonical design / policy を上書きしてはならない**。ADR
(`docs/adr/`) は canonical precedence の source として最優先される。
role 定義や scope 変更は ADR を起こしてから native file (`*.toml` /
`*.md`) を編集する。

### 3-2. convention 確認

同じ責務の **複数実装** を比較し、generated / vendored / example /
migration 途中を除外する。最初に発見した 1 file だけを project
convention と扱ってはならない。

---

## 4. User escalation boundary

### 4-1. agent 側で決定してよい条件 (全て満たすこと)

- §3 precedence から答えが一意、または実質一意
- reversible で局所的
- acceptance criteria を変更しない
- public / external contract を新規確定しない
- security / privacy / cost / release scope を重大に変えない

### 4-2. escalate すべき条件 (いずれか 1 つでも該当)

- canonical sources 同士が矛盾し product semantics が変わる
- acceptance criteria が複数解釈でき user-visible behavior が変わる
- irreversible / destructive operation
- public / external API contract 確定
- security / privacy / compliance risk の受容
- meaningful cost increase
- release scope / date 変更
- explicit design-first approval gate (`AGENTS.md` 不変条件を参照)

質問する場合は、調査可能な fact を先に確認し、**選択肢・影響・推奨案**
を整理してから聞く。precedence で解ける自明な判断を user へ返しては
ならない。

---

## 5. Subagent mode taxonomy

### 5-1. mode 一覧

| Mode | 責務 | Sandbox mode | 触れないもの |
| --- | --- | --- | --- |
| Research | read-only な repository / external / architecture 調査 | read-only | edit / write / commit / push / deploy / mutation |
| Worker | 実装 / refactor / test / migration / generation / runtime verification | workspace-write | 割り当て外 file / 無許可 commit / push / deploy / 外部 mutation |
| Reviewer | code / architecture / correctness / test adequacy / integration の独立 review | read-only | edit / write / commit / push / deploy / mutation |

### 5-2. Parent → Child: immutable snapshot

parent が未統合変更を持つ状態で child を spawn する場合、必ず immutable
snapshot を作成する:

- ephemeral Git commit
- immutable Git ref
- filesystem / container snapshot
- content-addressed workspace snapshot

必要条件:

- snapshot identity を追跡可能
- spawn 後の parent 変更で child input が変化しない
- clean environment へ再現可能
- result との base relationship を判定可能

### 5-3. Child → Parent: immutable result

child は parent workspace を編集して成果を返してはならない。必ず次の
immutable result を返す:

```text
schema_version
agent_id
issue_or_task_id
base_snapshot
execution_generation
result_commit_or_ref
summary
validation_results
artifacts
known_issues
verdict
fencing_token
```

`verdict` は child result 専用の terminal classification
(`pass | fail | blocked | abandoned`) であり、checkpoint の `status` lifecycle enum
(`pending | in_progress | awaiting_review | integrated | failed | abandoned`) とは別の
field である。外部 operation の journal `result` (`ok | blocked | failed`) と
recover-task の human output `STATUS: READY | BLOCKED` も、それぞれ別の分類である。

Coordinator / Supervisor は inspect / integrate / reject / request
revision のいずれかで応答する。

### 5-4. role unit binding

role 定義は canonical な `.codex/agents/<role>.toml` または
`.claude/agents/<role>.md` に置く。1 role = 1 file。`sandbox_mode` を
role ごとに必ず明示する。read-only な role が write できてはいけない。
`CODEX_ROLES.ja.md` を routing / repair の一元点とし、role の追加 / 削除
/ 統合は ADR を起こす。

---

## 6. Worker lease / fencing

execution generation と fencing の recovery 連動は
[ADR-0008](adr/0008-structured-recovery-checkpoint.md) と整合させる。

### 6-1. live-stack lease (release verification 専用)

`scripts/orchestration/release-claim.ps1` に既存。`live-stack` を mutex +
`leaseToken` + `expiresUtc` で排他的に claim し、release verification
中のみ他 process を block する。

### 6-2. 実装中 work の lease

ticket 実装中は per-work lease を持つ。canonical 配置:

```text
docs/implementation/<area>/.claims/<issue-number>.json
```

reference implementation は `scripts/orchestration/claim.ps1`
(`docs/implementation/recurring-to-source/.claims/` 配下)。`Test-GlobOverlap`
で file glob の衝突を拒否する設計を踏襲する。

extended record shape:

```json
{
  "id": "<issue-number>",
  "agent": "<role-or-cli-name>",
  "fileGlob": ["<glob>"],
  "acquiredUtc": "<iso8601>",
  "expiresUtc": "<iso8601>",
  "leaseToken": "<uuid>",
  "executionGeneration": "<int>",
  "releaseState": "active | released"
}
```

- `fileGlob` の衝突は既存 `claim.ps1` の `Test-GlobOverlap` で拒否
- `executionGeneration` は fence token として機能する。recover / resume
  時に increment して旧 generation の continuation を拒否する
- TTL 切れ + 未 release は stale claim として扱う

### 6-3. release

release は **active owner + matching leaseToken** でなければ拒否する。
実装 agent が落ちた場合は lease TTL 切れを待ち、`executionGeneration`
を increment してから再 claim する。同じ leaseToken での二重 release は
失敗させる。

### 6-4. parent / child recovery と split-brain

network partition や timeout 後に旧 agent と新 agent が同時実行される
可能性を前提とする。Supervisor は task ごとに lease または generation
fencing token を持たせ、recovery 時に:

- `executionGeneration` を increment
- active children を再発見
- completed child result を immutable result として回収
- stale child result は自動統合しない
- 必要なら retry / resume / re-spawn

を行う。

---

## 7. Recovery checkpoint

checkpoint、immutable child result、execution generation、fencing token の詳細は
[ADR-0008](adr/0008-structured-recovery-checkpoint.md) を canonical decision とする。

### 7-1. failure model

最低限次を想定する:

- model / session context loss
- agent process crash / cancellation
- IDE / terminal restart
- parent agent crash while child continues
- child / subagent crash
- sandbox / container / VM recreation
- Supervisor restart
- transient network / provider failure
- host reboot
- context-window exhaustion

provider loss までの RPO / RTO は project / provider 要件に応じて ADR
で別途定義する。

### 7-2. durable sources (優先 evidence)

1. GitHub Issue / Project
2. target release branch
3. ticket branch / commit graph
4. Draft / Ready PR / review / CI state
5. committed design / ADR / Skills / docs
6. immutable worker / subagent results
7. structured recovery checkpoint (下記)

native conversation ID、agent ID、Supervisor local DB、shell history、
IDE state は transient optimization であり canonical source ではない。

### 7-3. checkpoint schema

canonical 配置: `.agent-loop/checkpoints/<issue-number>-<generation>.json`

```json
{
  "schema_version": "1.0.0",
  "issue_id": "142",
  "target_release": "release-0-3-0",
  "ticket_branch": "142",
  "base_sha": "0000000000000000000000000000000000000000",
  "checkpoint_sha_or_snapshot": "<git-sha-or-snapshot-id>",
  "execution_generation": 3,
  "status": "in_progress",
  "completed_steps": ["string"],
  "next_steps": ["string"],
  "pending_validation": ["string"],
  "active_children": [
    {
      "role": "luna-implementer",
      "agent_id": "agent-id",
      "fencing_token": "<opaque-fencing-token>",
      "last_heartbeat": "2026-09-06T00:00:00Z"
    }
  ],
  "integrated_child_results": [],
  "external_side_effects": [],
  "blockers": [],
  "decision_refs": ["docs/adr/0008-structured-recovery-checkpoint.md"],
  "artifact_refs": [".agent-loop/checkpoints/142-2.json"],
  "updated_at": "2026-09-06T00:00:00Z"
}
```

上記 `status` は checkpoint lifecycle 専用であり、child result の `verdict`、外部
journal の `result`、recover-task の human output `STATUS` と混同してはならない。

private chain-of-thought は保存しない。secret、machine-specific absolute
path、private reasoning を含めてはならない。

### 7-4. soft / hard checkpoint

- **soft checkpoint**: same host / sandbox recovery 向け。local
  immutable ref、filesystem snapshot、Supervisor journal 等
- **hard checkpoint**: sandbox / provider 損失に対する境界。meaningful
  code / work state が durable remote infrastructure (GitHub remote、
  release branch、Draft PR) から到達可能であること

すべての小 edit を remote commit して history を汚す必要はない。
project の RPO、task length、provider TTL から checkpoint 頻度を設計する。

### 7-5. checkpoint trigger

最低限次の前後で checkpoint を残す:

- meaningful implementation milestone
- risky refactor / migration
- child spawn
- child result integration
- long validation
- external side effect (下記 §8)
- user / external input 待ち
- provider TTL / shutdown 接近
- graceful cancellation / shutdown signal
- context limit 接近

### 7-6. recovery algorithm

fresh agent は previous conversation を推測せず次の順で再構成する:

1. Issue / PR / target release を特定
2. ticket branch / remote commit graph を fetch
3. latest valid checkpoint を `.agent-loop/checkpoints/` から読む
4. canonical policy / design / decision refs を確認
5. active children を Supervisor / §6 claim から再発見
6. checkpoint から workspace を recreate
7. completed / pending validation を再評価
8. external side effect の actual remote state を §8 journal で確認
9. stale base / conflicting integration を確認
10. remaining plan を再構成
11. safe な最小 verification で reconstructed state を確認
12. `execution_generation` / lease を更新して続行

native resume に成功しても branch / PR / checkpoint との整合を確認
してから続行する。

---

## 8. External side-effect journal

Issue / Project の durable work state と status transition は
[ADR-0009](adr/0009-github-projects-work-state.md) を canonical decision とする。

### 8-1. 対象

次の操作は **side-effect journal に記録してから** 実行する:

- AWS リソース mutation (sops 復号は §8-3 の例外)
- database schema migration
- 外部 SaaS API call (SES、Stripe 等)
- production deploy
- 共有 file system への書き出し (`.tmp/` 以外)

### 8-2. record shape

canonical 配置: `docs/journal/<env>/<date>.jsonl` (1 行 1 record)。

```json
{
  "id": "<uuid>",
  "ts": "<iso8601>",
  "env": "dev | staging | production",
  "agent": "<role-or-cli-name>",
  "issue_id": 142,
  "execution_generation": 3,
  "operation": "<verb>",
  "target": "<arn | endpoint | path>",
  "idempotency_key": "<key>",
  "result": "ok | blocked | failed",
  "evidence": "<ref or path>"
}
```

journal の `result` は外部 operation の outcome (`ok | blocked | failed`) であり、
checkpoint `status` や child result `verdict` ではない。

### 8-3. idempotency

retry 前に journal を読み、`idempotency_key` が `ok` で記録されていれば
再実行しない。`blocked` / `failed` のみ再試行対象。`partial` は認めない
(file-level envelope encryption など atomic な操作のみ例外)。

### 8-4. 監査と保持

journal は read-only で `docs/superpowers/specs/` 配下の plan 進行時に
参照する。scrub せず 90 日保持する。秘密値 (`.env.*` の中身、API key、
DB credential 等) は書かない。

---

## 付録 A. 既存 artifact との整合チェック

本文書が既存実装と矛盾していないか、初期化時に再確認する anchor:

- [ ] `AGENTS.md` 「常時適用する不変条件」と §2 / §3 / §4 が矛盾しない
- [ ] `docs/HARNESS.md` §10 (Source of Truth) と §1 の役割分担が一致
- [ ] `CODEX_ROLES.ja.md` の role 一覧と §5 / §6 の sandbox mode が一致
- [ ] `scripts/orchestration/release-claim.ps1` の live-stack lease と §6-1 が一致
- [ ] `.agent-loop/Invoke-PreCommitReview.ps1` の snapshot pattern と
      §7 の hard checkpoint が一致
- [ ] `scripts/check-agent-environment.ps1` の required files に §6 /
      §7 / §8 の canonical path が含まれている

新しい role や contract を追加したら本付録も更新する。
