# ADR-0011: `tastile-precommit-review` canonical Skill の配置 precedence

- 日付: 2026-09-12
- 状態: Accepted
- 対象: Tastile root workspace + 全 child repository の `tastile-precommit-review` / thin-adapter 解決
- 先行 ADR: [ADR-0005](./0005-skills-and-mcp-extensions.md) (Skills catalog), [ADR-0007](./0007-release-branch-and-ticket-workflow.md) (pre-commit reviewer の発火位置)
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

### D-2. 同名 Skill が複数 canonical に存在する場合の precedence rule

`.agents/skills/<name>/SKILL.md` が複数箇所 (workspace root + 1 個以上の child
repository) に存在する場合、以下の順で precedence を決定する。

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

### D-3. `tastile-precommit-review` の適用

- `tastile-web` 配下から発火 → `/home/basic/work/tastile/tastile-web/.agents/skills/tastile-precommit-review/SKILL.md`
  (web-specific overlay) を primary canonical とし、Cognito / cookie / server-only secret /
  Stripe / 環境分離の security boundary を review する。
- workspace root / sibling child から発火 → `/home/basic/work/tastile/.agents/skills/tastile-precommit-review/SKILL.md`
  (generic) を primary canonical とし、`gate-root.ps1` 実行と sibling layout snapshot
  を証跡とする。
- `.claude/skills/tastile-precommit-review/SKILL.md` (両側) は thin-adapter として
  上記 precedence rule を encode し、primary canonical のパスを返す。

### D-4. future 同名 Skill 追加時の制約

- 同名 Skill を 2 個以上の canonical に置く場合、本 ADR の precedence rule に従う。
- child 専用 canonical には frontmatter description に
  `Use only when scope is <child-repo>.` を必ず含める。orchestration layer が
  scope 外発火を検出した場合は警告して親へ escalate する。
- workspace 共通 canonical は child 横断の contract (cross-repo, multi-repo) を扱う
  用途に限定する。child 固有の business / security boundary は必ず child 側 canonical
  に置く (D-3 の `tastile-precommit-review` と同型)。

## 選定評価

| 候補 | 判断 | 理由 |
| --- | --- | --- |
| cwd-based precedence (本 ADR) | 採用 | AI agent の起動位置は executor の責務分離 (root vs child) と 1:1 対応。resolver rule が単純で監査可能性が高い |
| priority field in frontmatter | 不採用 | 同一 file 内に scope と priority を併記すると dual-canonical 状態が残る。precedence を 1 箇所 (resolver) に集約する方が事故が減る |
| workspace canonical に統合 | 不採用 | web の Cognito / Stripe / proxy boundary は root の generic 範囲外。統合すると root canonical が巨大化し、child 固有 contract の update が root 編集を要求する |
| web canonical に統合 | 不採用 | workspace root + 4 つの他 child の contract 検証 (gate-root.ps1 + sibling layout) は web 責務外。逆向きに統合不可 |
| workspace-wide 名前空間 (例: `tastile-web/precommit-review`) | 保留 | Skill 名衝突を構造で解決する案だが、現状 1 件の同名 Skill のみ。rule を導入する複雑さに対して便益が小さい |

## Security、license、再現性

- resolver rule は cwd + `git rev-parse --show-toplevel` の 2 段階判定のみで、外部
  API / 環境変数を参照しない。決定論的かつ再現可能。
- thin-adapter (`/home/basic/work/tastile/.claude/skills/tastile-precommit-review/SKILL.md`,
  `/home/basic/work/tastile/tastile-web/.claude/skills/tastile-precommit-review/SKILL.md`)
  の本文は primary canonical の path を返すだけで、手順 / check list / 証跡を複製
  しない (canonical 編集時に drift しない)。
- 本 ADR 採択後に `.agent-loop/Invoke-PreCommitReview.ps1` が child repo で起動
  された場合、root canonical を誤って適用する path がないことを manual smoke で
  検証する (1 ticket / 1 sprint 単位)。

## Consequences and re-evaluation

### 直接的な影響

- Codex / Claude Code / Cursor いずれの harness でも、`tastile-precommit-review`
  Skill が発火した時点でどの canonical が適用されたかが出力 trace に明示される
  (primary canonical の path を thin-adapter が echo する)。
- `tastile-web` の Cognito / Stripe 周辺の security boundary review が web canonical
  に局所化され、root canonical の編集責任が軽くなる。
- workspace root 側で web-specific check (Cognito, Stripe) を要求する場面は無くなる。
  必要なら root → web へ escalation する。

### トレードオフ

- AI agent executor は cwd と `git rev-parse --show-toplevel` を発火前に毎回検査する
  必要があり、初回 spawn 時に +1 step 増える。orchestration layer
  (`.agents/skills/subagent-coordination/SKILL.md`) が spawn 時点で
  `resolve-skill-canonical.sh` を hook として挟むことで吸収する。
- 今後 child repo が増えるたびに同名 Skill の canonical 配置判断が必要になる。
  判断コストは D-4 の制約 (frontmatter に `scope:` を必ず書く) で抑えている。

### 再評価 trigger

- 1 sprint 完了後に thin-adapter が返す primary canonical path と、実際に review で
  走った check list が一致しているか spot check する (5 commit / 1 sprint 単位)。
- 別の同名 Skill で precedence rule が破綻した場合 (例: `cross-repo-contract-check`
  を child 側に置きたいという要求が出た場合) は本 ADR を revise する。
- Codex harness が `.claude/skills/` を 1 度も読まないことが確認できた場合、
  thin-adapter を `.agents/skills/` 内の routing メタデータに統合する可能性を検討
  する (canonical 数 = 11 → 11 維持)。

### 関連 ADR / 関連 Skill

- [ADR-0005](./0005-skills-and-mcp-extensions.md): Skills と Codex role canonical
  reference。本 ADR は同名 Skill 衝突時の precedence を導入する。
- [ADR-0007](./0007-release-branch-and-ticket-workflow.md): pre-commit reviewer の
  発火位置と branch pattern check。本 ADR はその reviewer の中身 (canonical 本文)
  の precedence を扱う。
- `.agents/skills/subagent-coordination/SKILL.md`: parent→child immutable snapshot
  に `cwd` / `git-toplevel` を含めて resolver rule を subagent へ伝播する。
- `.agents/skills/cross-repo-contract-check/SKILL.md`: workspace 共通 canonical の
  隣接 Skill。本 ADR 採択により thin-adapter (`/home/basic/work/tastile/.claude/skills/cross-repo-contract-check/SKILL.md`)
  が安定する。
- `/home/basic/work/tastile/tastile-web/.agents/skills/tastile-precommit-review/SKILL.md`:
  web-specific overlay (Cognito, cookies, server-only secrets, Stripe, proxy, env)。
- `/home/basic/work/tastile/.agents/skills/tastile-precommit-review/SKILL.md`:
  workspace root 共通 (gate-root.ps1 + sibling layout)。
