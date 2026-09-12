# ADR-0011: `tastile-precommit-review` canonical Skill の配置 precedence

- 日付: 2026-09-12
- 状態: Accepted
- 対象: Tastile root workspace + 全 child repository の `tastile-precommit-review` / thin-adapter 解決
- 先行 ADR: [ADR-0005](./0005-skills-and-mcp-extensions.md) (Skills catalog), [ADR-0007](./0007-ticket-driven-isolated-agent-delivery.md) (pre-commit reviewer の発火位置)
- 後続 ADR: なし
- canonical policy: [agent orchestration policy](../agent-orchestration.md) §3 (Skill routing)

## Context

2026-09-12 時点で `tastile-precommit-review` という同名の Skill が 2 箇所に canonical
本文として存在する。

1. workspace root: `/home/basic/work/tastile/.agents/skills/tastile-precommit-review/SKILL.md`
   — root workspace + 5 child repositories + 共有 `.agent-loop/`、`.claude/`、
   `.codex/` の構造を review する。証跡は `pwsh -NoProfile -File .agent-loop/gate-root.ps1`
   の出力。
2. `tastile-web`: `/home/basic/work/tastile/tastile-web/.agents/skills/tastile-precommit-review/SKILL.md`
   — web 固有 security boundary (Cognito, cookies, server-only secrets, Stripe,
   proxy, production env isolation) を review する。証跡は `bun run check` + focused
   tests on auth / billing / event / deploy 変更。

両者は scope が直交しており、reconcile するときの canonical が曖昧である。さらに
`.claude/skills/tastile-precommit-review/SKILL.md` という thin-adapter も 2 箇所
(`/home/basic/work/tastile/.claude/skills/`, `/home/basic/work/tastile/tastile-web/.claude/skills/`)
に存在する。Claude Code は起動時に同名 Skill を発見すると発火経路が不定となる。

なお、Codex / Cursor / 他の AI agent harness は `.claude/skills/` を読まない可能性が
高いため、`.agents/skills/` が真の canonical 本文である (canonical は thin-adapter
側ではなく `.agents/skills/` 側に置く)。`.claude/skills/` は Claude Code 専用の
binding 解決器としてのみ機能する。

## Decision

### D-1. canonical Skill 本文は常に `.agents/skills/` に置く

`.agents/skills/<name>/SKILL.md` が canonical であり、`reasoning_effort = binding` で
再読込される。`.claude/skills/<name>/SKILL.md` は canonical を 1 行で指す thin
adapter であり、手順の複製を禁止する。

### D-2. 同名 Skill が複数 canonical に存在する場合の precedence rule (仕様)

`.agents/skills/<name>/SKILL.md` が複数箇所 (workspace root + 1 個以上の child
repository) に存在する場合、以下の順で precedence を決定する。本 rule は仕様であり、
実装は D-3 の節で個別 scope ごとに明示する。

1. **child repository 配下の発火** (cwd が `tastile-{core,web,android,desktop,brands}/`
   配下、または `git rev-parse --show-toplevel` が child repo を指す場合):
   `<child>/.agents/skills/<name>/SKILL.md` を primary canonical、
   workspace root `.agents/skills/<name>/SKILL.md` を補助参照 (read-only) とする。
2. **workspace root からの発火** (cwd が root 配下、または `git rev-parse --show-toplevel`
   が root を指す場合):
   root canonical を primary、child canonical は補助参照としない (scope 外のため)。
3. **sibling child repository への cross-repo 編集** (例: root から `tastile-android`
   を編集する subagent を spawn する場合):
   spawn 時に cwd を child repo に切り替えてから Skill を発火する。primary canonical は
   child 側となる。

### D-3. `tastile-precommit-review` への適用 (実装状態 2026-09-12)

precedence rule をこの Skill に適用した結果と、各 scope の現状:

| scope | primary canonical | 補助参照 | 実装状態 |
| --- | --- | --- | --- |
| `tastile-web` 配下から発火 | `tastile-web/.agents/skills/tastile-precommit-review/SKILL.md` (web-specific overlay: Cognito / cookies / server-only secrets / Stripe / proxy / env) | workspace root canonical (read-only) | **完全実装**: web thin-adapter (`tastile-web/.claude/skills/tastile-precommit-review/SKILL.md`) が precedence rule を encode し、`git rev-parse --show-toplevel` で child を判定 |
| workspace root / sibling child から発火 | `.agents/skills/tastile-precommit-review/SKILL.md` (generic: gate-root.ps1 + sibling layout) | 補助参照なし (scope 外) | **部分実装**: root thin-adapter (`tastile-root/.claude/skills/tastile-precommit-review/SKILL.md`) は static pointer — root 以外で発火しても resolver 判定を行わない。precedence rule は本 ADR (D-2) のみが source of truth |
| sibling child へ cross-repo 編集時 | child canonical | workspace canonical は補助参照 | **未実装**: 自動 resolver hook は存在しない。orchestration layer が spawn 時に cwd を切り替える運用が必要 |

**現状の制約**: `tastile-web` 以外 (`tastile-core`, `tastile-android`, `tastile-desktop`,
`tastile-brands`) には web 相当の同名 Skill 衝突が存在しない。当該 4 child に将来同
precedence rule を要する同名 Skill が追加された場合は、D-3 の web 行と同型の thin-adapter
追加が要求される。

### D-4. future 同名 Skill 追加時の制約

- 同名 Skill を 2 個以上の canonical に置く場合、本 ADR の precedence rule (D-2) に従う。
- child 専用 canonical には frontmatter description に
  `Use only when scope is <child-repo>.` を必ず含める。orchestration layer が
  scope 外発火を検出した場合は警告して親へ escalate する。
- workspace 共通 canonical は child 横断の contract (cross-repo, multi-repo) を扱う
  用途に限定する。child 固有の business / security boundary は必ず child 側 canonical
  に置く (D-3 の `tastile-precommit-review` と同型)。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| cwd-based precedence (本 ADR) | 採用 | AI agent の起動位置は executor の責務分離 (root vs child) と 1:1 対応。rule が単純で監査可能性が高い |
| priority field in frontmatter | 不採用 | 同一 file 内に scope と priority を併記すると dual-canonical 状態が残る。precedence を 1 箇所 (本 ADR / 将来の resolver 実装) に集約する方が事故が減る |
| workspace canonical に統合 | 不採用 | web の Cognito / Stripe / proxy boundary は root の generic 範囲外。統合すると root canonical が巨大化し、child 固有 contract の update が root 編集を要求する |
| web canonical に統合 | 不採用 | workspace root + 4 つの他 child の contract 検証 (gate-root.ps1 + sibling layout) は web 責務外。逆向きに統合不可 |
| workspace-wide 名前空間 (例: `tastile-web/precommit-review`) | 保留 | Skill 名衝突を構造で解決する案だが、現状 1 件の同名 Skill のみ。rule を導入する複雑さに対して便益が小さい |

## Security、license、再現性

- precedence rule (D-2) は cwd + `git rev-parse --show-toplevel` の 2 段階判定のみで、
  外部 API / 環境変数を参照しない。決定論的かつ再現可能。
- thin-adapter (`/home/basic/work/tastile/.claude/skills/tastile-precommit-review/SKILL.md`,
  `/home/basic/work/tastile/tastile-web/.claude/skills/tastile-precommit-review/SKILL.md`)
  の本文は primary canonical の path を返すだけで、手順 / check list / 証跡を複製
  しない (canonical 編集時に drift しない)。
- 既存実装で precedence rule を実行する唯一のパスは `.agent-loop/Invoke-PreCommitReview.ps1`
  の `git rev-parse --show-toplevel` 判定。`repositories.json` の catalog と照合して
  child repo を解決する。web thin-adapter は Claude Code から発火した際の docstring
  上の precedence を encode するが、root thin-adapter は static pointer のままで
  ある点に注意 (D-3 参照)。
- `.agent-loop/Invoke-PreCommitReview.ps1` の child repo 起動時に root canonical が
  誤適用されないことは、`repositories.json` catalog match + `--show-toplevel` 解
  決によって構造的に保証される。

## Consequences and re-evaluation

### 直接的な影響

- Codex / Claude Code / Cursor いずれの harness でも、`tastile-precommit-review`
  Skill が発火した時点でどの canonical が適用されたかを本 ADR (D-3 表) で照合できる。
  web thin-adapter は `git rev-parse --show-toplevel` を実行して child 判定し、
  primary canonical の path を明示する。
- `tastile-web` の Cognito / Stripe 周辺の security boundary review が web canonical
  に局所化され、root canonical の編集責任が軽くなる。
- workspace root 側で web-specific check (Cognito, Stripe) を要求する場面は無くなる。
  必要なら root → web へ escalation する。

### トレードオフ

- AI agent executor は cwd と `git rev-parse --show-toplevel` を発火前に毎回検査する
  必要があり、初回 spawn 時に +1 step 増える。**現状**: `.agent-loop/Invoke-PreCommitReview.ps1`
  は PowerShell ベースでこの判定を実行する。Claude Code / Codex の発火経路からは
  web thin-adapter が同等の判定を記述する。orchestration layer (`.claude/skills/subagent-coordination/SKILL.md`
  thin-adapter が指す canonical) は現状未実装。
- 今後 child repo が増えるたびに同名 Skill の canonical 配置判断が必要になる。
  判断コストは D-4 の制約 (frontmatter に `scope:` を必ず書く) で抑えている。
- root thin-adapter が static pointer のままだと、workspace root で同 Skill が発火し
  た場合に暗黙的に root canonical に落ちる。これは仕様 (D-3 表の root 行) と一致
  しているので問題は無いが、誤って web で発火した場合は web canonical が読まれない。
  これは web 側で `cwd` を強制する運用で担保する。

### 再評価 trigger

- 1 sprint 完了後に thin-adapter が返す primary canonical path と、実際に review で
  走った check list が一致しているか spot check する (5 commit / 1 sprint 単位)。
- 別の同名 Skill で precedence rule が破綻した場合 (例: `cross-repo-contract-check`
  を child 側に置きたいという要求が出た場合) は本 ADR を revise する。
- root thin-adapter の static-ness が誤適用を生む事案が記録された場合、root 側に
  web と同型の resolver encode を入れるか、`Invoke-PreCommitReview.ps1` 経由で強制
  dispatch するかを別 ADR で決定する。
- Codex harness が `.claude/skills/` を 1 度も読まないことが確認できた場合、
  thin-adapter を `.agents/skills/` 内の routing メタデータに統合する可能性を検討
  する (canonical 数 = 11 → 11 維持)。

### 関連 ADR / 関連 Skill

- [ADR-0005](./0005-skills-and-mcp-extensions.md): Skills と Codex role canonical
  reference。本 ADR は同名 Skill 衝突時の precedence を導入する。
- [ADR-0007](./0007-ticket-driven-isolated-agent-delivery.md): pre-commit reviewer の
  発火位置と branch pattern check。本 ADR はその reviewer の中身 (canonical 本文)
  の precedence を扱う。
- `/home/basic/work/tastile/tastile-web/.agents/skills/tastile-precommit-review/SKILL.md`:
  web-specific overlay (Cognito, cookies, server-only secrets, Stripe, proxy, env)。
- `/home/basic/work/tastile/.agents/skills/tastile-precommit-review/SKILL.md`:
  workspace root 共通 (gate-root.ps1 + sibling layout)。
- `/home/basic/work/tastile/.agent-loop/Invoke-PreCommitReview.ps1`: 既存実装で
  precedence rule を実行する唯一の dispatcher。`git rev-parse --show-toplevel`
  + `repositories.json` catalog match で child repo を解決する。
- `/home/basic/work/tastile/.agents/skills/cross-repo-contract-check/SKILL.md`:
  workspace 共通 canonical。本 ADR 採択により、薄い thin-adapter
  (`/home/basic/work/tastile/.claude/skills/cross-repo-contract-check/SKILL.md`)
  が安定する。
