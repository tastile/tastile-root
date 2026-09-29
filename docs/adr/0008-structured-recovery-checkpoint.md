# ADR-0008: Structured recovery checkpoint — soft / hard、execution generation、fencing token

- 日付: 2026-09-06
- 状態: Accepted
- 対象: Tastile root workspace の AI agent 実行 recovery
- 先行 ADR: [ADR-0001](./0001-agent-toolchain.md) (関連), [ADR-0005](./0005-skills-and-mcp-extensions.md) (関連), [ADR-0007](./0007-release-branch-and-ticket-workflow.md) (連動)
- 後続 ADR: [ADR-0009](./0009-github-projects-work-state.md) (関連, Project Status)
- canonical policy: [agent orchestration policy](../agent-orchestration.md) §7

## Context

Tastile root は複数の AI agent (Claude、Codex、OpenCode retire) が同一 workspace を
書き換えうる。`.agent-loop/Invoke-PreCommitReview.ps1` は commit 直前に HEAD snapshot
を tar で展開し patch を適用する isolated snapshot で reviewer を起動する。これは実質
的な soft checkpoint だが、schema / contract / fence を持たない。

2026-08 以降の運用で以下の gap が顕在化した。

1. **context 消失からの復旧**: AI agent の conversation / session が切れた場合、
   Git log + reviewer snapshot + Codex / Claude role catalog からしか再構成できない。
   fresh agent が「次に何をすべきか」を判断する minimum input が ADR 化されていない。
2. **agent の重複実行防止**: parent agent が落ちても child を即 cancel しない
   (parent → child transfer が immutable snapshot であるべき) 方針は ADR-0001
   §「不変条件」と整合するが、child が完了報告を返す親 slot を保護する generation
   / fencing token が定義されていない。
3. **child → parent の result 形式**: child は immutable commit / ref / diff /
   validation result / artifact / known issue を含む result オブジェクトを返すべき
   だが、現状 prose 自然言語のみで reviewer engine が structured に解釈できない。
4. **hard checkpoint の境界**: provider / sandbox 消失時に GitHub Issue / PR / tag /
   checkpoint のどこに到達可能かが ADR で pin されていない。RPO / RTO の target も
   未定義。

## Decision

### D-1. soft checkpoint と hard checkpoint の 2 段

- **soft checkpoint**: 同一 host / sandbox 内で同一 agent が再開することを想定した
  復旧手段。filesystem snapshot、`.agent-loop/Invoke-PreCommitReview.ps1` の
  snapshot primitive、native session state などが該当。保存先は `.tmp/` 配下。
  GitHub などの remote durable storage への到達不能時にも最低限の復元を目指す。
- **hard checkpoint**: sandbox / provider 消失後にも durable remote infrastructure
  から到達できる復旧手段。GitHub Issue、target release branch、ticket branch、
  Draft / Ready PR、PR review、CI state、commit された design / ADR / Skill /
  checkpoint object (Step D-2 の schema) が該当。native conversation ID、agent ID、
  Supervisor local DB、shell history、IDE state は transient optimization とする。

### D-2. checkpoint schema

`.agent-loop/checkpoint.schema.json` (新規) の minimum key は次の通り。`status` は
`pending | in_progress | awaiting_review | integrated | failed | abandoned` の enum。
この `status` は checkpoint lifecycle 専用であり、child result の `verdict`、外部
operation journal の `result`、recover-task の human output `STATUS` とは別の分類である。
hard checkpoint 拡張は `rpo_seconds`, `rto_seconds`, `last_hard_at` を加える。

- `schema_version` (string, semver-like)
- `issue_id` (string, GitHub Issue 番号)
- `target_release` (string, `release-x-y-z` 形式)
- `ticket_branch` (string, Issue 番号のみ)
- `pr_number` (integer, optional, ≥1)
- `base_sha` (string, 40 char hex)
- `checkpoint_sha_or_snapshot` (string, commit SHA または snapshot path)
- `execution_generation` (integer, ≥1; resume ごとに increment)
- `status` (string, enum)
- `completed_steps` (array of string)
- `next_steps` (array of string)
- `pending_validation` (array of string)
- `active_children` (array of object: `{role, agent_id, fencing_token, last_heartbeat}`)
- `integrated_child_results` (array of object: child result object)
- `external_side_effects` (array of object: `{kind, target, idempotency_key, observed_state}`)
- `blockers` (array of string)
- `decision_refs` (array of string, ADR / document path)
- `artifact_refs` (array of string, file path or remote URL)
- `updated_at` (string, RFC 3339 timestamp)

machine-private path、secret、private reasoning は checkpoint に含めない。
`schema_version` が増加した場合、`.agent-loop/checkpoint.schema.json` の
`backward_compat` フィールドに旧 version を残す。

### D-3. fencing token と execution generation

- 親 agent が子 agent を spawn するとき、fencing token を生成し child に渡す。
  child → parent result には同じ token を必須化する。token を持たない result は
  reject する。
- fence token は `parent-execution-id + role + child-id + monotonic counter` を
  内容に持つ secret で、repository / public checkpoint に直接 commit しない。
  child が token を使い回すことを禁止し、parent が複数 version を並行統合する
  split-brain を防ぐ。
- execution generation は `1` 開始、recovery ごとに increment する。`base_sha` が
  stale で generation が古い child result は parent が stale と判定し統合しない。
  詳細 protocol は `.agents/skills/recover-task/SKILL.md` が正本。

### D-4. child → parent の result schema

`.agent-loop/agent-result.schema.json` (新規) は child → parent の immutable result
を定義する。minimum key は `schema_version, agent_id, role, issue_or_task_id,
base_snapshot, execution_generation, result_commit_or_ref, summary, verdict,
validation_results, artifacts, known_issues, fencing_token`。`verdict` は child result
専用の terminal classification (`pass | fail | blocked | abandoned`) であり、D-2 の
checkpoint `status` と統合しない。`findings` 形式は既存
`.agent-loop/review-result.schema.json` (severity / file / line / message) を流用する。

### D-5. recovery algorithm

fresh agent は次の 12 手順で再構成する (canonical reference は
`.agents/skills/recover-task/SKILL.md`)。

1. Issue / target release を特定する。`gh issue list --search` を使う。
2. ticket branch の remote commit graph を `git fetch` で取得。
3. latest valid checkpoint を `.agent-loop/checkpoint.schema.json` で parse する。
4. canonical policy / design / decision refs を確認する (本 ADR、HARNESS、対象 child
   `AGENTS.md`)。
5. active_children を `.codex/agents/*.toml` と `.claude/agents/*.md` の catalog から
   再発見する。
6. checkpoint から workspace を再構成する。
7. completed / pending validation を再評価する。
8. external_side_effects の actual remote state を `gh` / `git` で確認する。
9. stale base / conflict 統合を差分比較する。
10. remaining plan を再構成する。
11. safe な最小 verification で reconstructed state を確認する。
12. execution generation / lease を更新して続行する。

recovery report の `STATUS: READY | BLOCKED` は human-facing な手順結果であり、
checkpoint `status`、child result `verdict`、journal `result` のいずれとも別である。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| soft + hard の 2 段 checkpoint | 採用 | provider 消失の RPO / RTO target を ADR に残せる。soft のみで運用すると host loss で work state が失われる |
| generation + fencing token 併存 | 採用 | parent loss → child survival / split-brain 防止に両方必要。token のみで generation を補えない (long-running task で counter が衝突する) |
| checklist を ADR に書く | 採用 | fresh agent が会話履歴なしで再構成できる。recover-task Skill が canonical 手順になる |
| provider 抽象 (Supabase / Temporal 等) | 不採用 | 外部 dependency を増やさない方針 (ADR-0001 §「選定評価」) と整合せず、host / WSL 環境で独立した solving にならない |
| checkpoint を GitHub Issue body にだけ書く | 不採用 | Issue body は marker 用途には良いが、strict schema の host が居ない。`.agent-loop/checkpoint.schema.json` で strictness を確保する |
| checkpoint を毎回 commit する | 不採用 | commit 単位が細かすぎて Git history を汚す。ADR-0001 §「不変条件」の SKILL 経路以外では commit しない方針と整合する |

## Security、license、再現性

`checkpoint.schema.json` / `agent-result.schema.json` は fresh clone + Bun + PowerShell
で再現できる project-local artifact。fencing token は process memory / short-lived
Sidecar に置き、repository には commit しない。secret が checkpoint に混入した場合の
検知は `agent-result.schema.json` の `fencing_token` の entropy test と
`.agent-loop/gate-root.ps1` の JSON parse / 構造 spot check で担保する。

## Consequences and re-evaluation

### 直接的な影響

- 親 agent 死亡後にも child を cancel せず、Supervisor / control plane が lifecycle
  を所有する運用が ADR に pin される。
- fresh agent が conversation 履歴なしで再構成できる operation chain が明示される。
- `.agent-loop/tests/` の Pester suite に checkpoint schema round-trip test を追加
  することで、schema regression を weekly cron で検知できる。

### トレードオフ

- checkpoint を writing する頻度を間違えると RPO / RTO target を満たさない。
  step の duration と provider TTL から trigger policy を運用で調整する。
- fencing token を memory で持つため long-lived provider outage で token が GC される
  可能性がある。`.agents/skills/recover-task/SKILL.md` で grace period を明示する。

### 再評価 trigger

- checkpoint schema version が 1 → 2 に上がる backward-incompatible 変更を行うとき。
- 同一 release window で child 数が 5 を超え、token collision が運用上問題化した
  とき。
- provider 切り替え (vendor 移行) を行うとき。

### 関連 ADR / 関連 Skill

- [ADR-0001](./0001-agent-toolchain.md): root agent 構成。soft checkpoint 経路を
  `.agent-loop/Invoke-PreCommitReview.ps1` に持たせる方針を inherit する。
- [ADR-0005](./0005-skills-and-mcp-extensions.md): Codex role catalog を active_children
  の再発見に利用する。
- [ADR-0007](./0007-release-branch-and-ticket-workflow.md): 本 ADR の
  `execution_generation` フィールドと連動する。
- [ADR-0009](./0009-github-projects-work-state.md): Project Status との同期。
- `.agent-loop/checkpoint.schema.json` (新規): D-2 参照。
- `.agent-loop/agent-result.schema.json` (新規): D-4 参照。
- `.agents/skills/recover-task/SKILL.md` (新規): D-5 の canonical reference。
- `.agent-loop/gate-root.ps1`: 拡張で schema parse を検証する。
